// Rotinas globais (/api/routines): lista numa resposta só as agendas do Habblaud e os cronjobs do Hermes, cada uma
// com chave `origem:id`, e administra os cronjobs do Hermes na própria origem. As agendas do Habblaud continuam sendo
// escritas só em /api/schedules: uma porta de escrita por origem, nada migra nem duplica.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tr } from '../../shared/i18n';
import type { CardRoute } from '../agents/http';
import { JOB_PATCH_FIELDS, JobsError, type CreateJobInput, type HermesJob, type HermesJobs, type JobPatch } from '../drivers/hermes/jobs';
import { HttpError, readJson, sendJson } from '../http/app';
import type { Schedule, Scheduler } from './scheduler';

export type JobsApi = Pick<HermesJobs, 'list' | 'get' | 'create' | 'update' | 'pause' | 'resume' | 'run' | 'remove'>;

export interface RoutineRouteDeps {
  scheduler?: Scheduler;
  jobs?: JobsApi;
  /** Espera entre consultas do "executar e manter pausada" (injetável nos testes). */
  sleep?: (ms: number) => Promise<void>;
  /** Quanto esperar a execução começar antes de desistir de repausar. */
  watchMs?: number;
}

export type SourceState = { ok: true; timeZone?: string } | { ok: false; code: string; error: string };

export type Routine =
  | { key: string; source: 'habblaud'; id: string; habblaud: Schedule }
  | { key: string; source: 'hermes'; id: string; hermes: HermesJob };

const POLL_MS = 2_000;
const DEFAULT_WATCH_MS = 90_000;
const CREATE_FIELDS = ['name', 'schedule', 'prompt', 'deliver', 'skills', 'repeat', 'paused'] as const;

function pick<K extends string>(body: unknown, keys: readonly K[]): Partial<Record<K, unknown>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, tr('esperado um objeto JSON'));
  const o = body as Record<string, unknown>;
  const out: Partial<Record<K, unknown>> = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
  return out;
}

const JOB_STATUS: Record<string, number> = { invalid: 400, not_found: 404, auth: 502, unavailable: 503, failed: 502 };

function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return void res.destroy();
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof JobsError) return sendJson(res, JOB_STATUS[err.code] ?? 502, { error: err.message, code: err.code });
  sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
}

function allow(req: IncomingMessage, res: ServerResponse, methods: string): void {
  req.resume();
  res.setHeader('Allow', methods);
  sendJson(res, 405, { error: tr('método não permitido') });
}

export function createRoutineRoutes(deps: RoutineRouteDeps): CardRoute {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()));
  const watchMs = deps.watchMs ?? DEFAULT_WATCH_MS;

  /** Depois do disparo, espera a execução nova começar e só então repausa (pausar antes cancelaria o disparo). */
  async function repauseWhenStarted(jobs: JobsApi, before: HermesJob): Promise<void> {
    const tries = Math.max(1, Math.ceil(watchMs / POLL_MS));
    for (let i = 0; i < tries; i++) {
      await sleep(POLL_MS);
      const now = (await jobs.list()).find((j) => j.id === before.id);
      if (!now) return; // apagado enquanto isso
      const started = !!now.latest?.startedAt && now.latest.startedAt !== before.latest?.startedAt;
      if (!started) continue;
      if (now.enabled) await jobs.pause(before.id);
      return;
    }
    // Não começou no prazo: deixa ativo (a listagem mostra) em vez de cancelar o disparo.
  }

  async function list(res: ServerResponse): Promise<void> {
    const sources: { habblaud: SourceState; hermes: SourceState } = {
      habblaud: deps.scheduler ? { ok: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { ok: false, code: 'off', error: tr('agendas desligadas (sem driver configurado)') },
      hermes: { ok: false, code: 'off', error: tr('Hermes não configurado (HABBLAUD_HERMES_URL e HABBLAUD_HERMES_KEY)') },
    };
    const routines: Routine[] = (deps.scheduler?.list() ?? []).map((s) => ({ key: `habblaud:${s.id}`, source: 'habblaud', id: s.id, habblaud: s }));
    if (deps.jobs) {
      try {
        for (const j of await deps.jobs.list()) routines.push({ key: `hermes:${j.id}`, source: 'hermes', id: j.id, hermes: j });
        sources.hermes = { ok: true };
      } catch (err) {
        sources.hermes = err instanceof JobsError ? { ok: false, code: err.code, error: err.message } : { ok: false, code: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
    }
    sendJson(res, 200, { sources, routines });
  }

  return (req, res, path, method, allowed) => {
    if (path !== '/api/routines' && !path.startsWith('/api/routines/')) return false;
    let rest: string[];
    try {
      rest = path.split('/').filter(Boolean).slice(2).map(decodeURIComponent);
    } catch {
      req.resume();
      sendJson(res, 400, { error: tr('id inválido') });
      return true;
    }
    const read = method === 'GET' || method === 'HEAD';
    const run = (fn: () => Promise<void>) => void fn().catch((err) => sendError(res, err));

    if (rest.length === 0) {
      if (read) run(() => list(res));
      else allow(req, res, 'GET');
      return true;
    }
    if (rest[0] !== 'hermes' || rest.length > 3) {
      req.resume();
      sendJson(res, 404, { error: tr('rota desconhecida') });
      return true;
    }
    if (!read && !allowed) {
      req.resume();
      sendJson(res, 403, { error: tr('agentes não liberados neste acesso') });
      return true;
    }
    const jobs = deps.jobs;
    if (!jobs) {
      req.resume();
      sendJson(res, 503, { error: tr('Hermes não configurado (HABBLAUD_HERMES_URL e HABBLAUD_HERMES_KEY)'), code: 'off' });
      return true;
    }

    if (rest.length === 1) {
      if (method === 'POST') run(async () => sendJson(res, 201, await jobs.create(pick(await readJson(req), CREATE_FIELDS) as unknown as CreateJobInput)));
      else allow(req, res, 'POST');
      return true;
    }
    const id = rest[1]!;
    if (rest.length === 2) {
      if (read) {
        req.resume();
        run(async () => sendJson(res, 200, await jobs.get(id)));
      } else if (method === 'PATCH') run(async () => sendJson(res, 200, await jobs.update(id, pick(await readJson(req), JOB_PATCH_FIELDS) as JobPatch)));
      else if (method === 'DELETE') {
        req.resume();
        run(async () => {
          await jobs.remove(id);
          sendJson(res, 200, { ok: true });
        });
      } else allow(req, res, 'GET, PATCH, DELETE');
      return true;
    }
    const action = rest[2];
    if (action !== 'pause' && action !== 'resume' && action !== 'run') {
      req.resume();
      sendJson(res, 404, { error: tr('rota desconhecida') });
      return true;
    }
    if (method !== 'POST') {
      allow(req, res, 'POST');
      return true;
    }
    if (action === 'pause' || action === 'resume') {
      req.resume();
      run(async () => sendJson(res, 200, await (action === 'pause' ? jobs.pause(id) : jobs.resume(id))));
      return true;
    }
    run(async () => {
      // Corpo inválido falha fechado (400/413): engolir o erro executaria e reativaria um job pausado sem querer.
      const hasBody = req.headers['content-length'] !== undefined ? req.headers['content-length'] !== '0' : req.headers['transfer-encoding'] !== undefined;
      const raw = hasBody ? await readJson(req) : (req.resume(), {});
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, tr('esperado um objeto JSON'));
      const keep = (raw as Record<string, unknown>).keepPaused === true;
      // `latest_execution` só vem na lista (sondado): o "antes" precisa sair dela, senão a execução anterior
      // contaria como "começou" e a pausa cancelaria o disparo.
      const before = keep ? (await jobs.list()).find((j) => j.id === id) : undefined;
      if (keep && !before) throw new JobsError('not_found', tr('job não encontrado'), 404);
      const job = await jobs.run(id);
      // Executar um job pausado o reativa no Hermes (sondado); "manter pausada" repausa depois que a execução começa.
      const repause = !!before && !before.enabled;
      if (repause) void repauseWhenStarted(jobs, before!).catch(() => {});
      sendJson(res, 202, { triggered: true, keepPaused: repause ? 'pending' : false, job });
    });
    return true;
  };
}
