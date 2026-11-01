// Cronjobs nativos do Hermes (`/api/jobs`), só pela API HTTP. Contrato sondado em 2026-11-01
// (docs/superpowers/verification/2026-10-31-fontes-painel-jobs.md): listar exige include_disabled=true,
// PATCH aceita só uma whitelist, regra inválida volta 500 com texto, `latest_execution` só vem na lista.
import { tr } from '../../../shared/i18n';

const DEFAULT_TIMEOUT_MS = 15_000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Campos que o PATCH do Hermes instalado aceita (`_UPDATE_ALLOWED_FIELDS`). */
export const JOB_PATCH_FIELDS = ['name', 'schedule', 'prompt', 'deliver', 'skills', 'skill', 'repeat', 'enabled'] as const;

export type JobsErrorCode = 'invalid' | 'not_found' | 'auth' | 'unavailable' | 'failed';

export class JobsError extends Error {
  constructor(readonly code: JobsErrorCode, message: string, readonly status?: number) {
    super(message);
  }
}

export interface HermesJobSchedule {
  kind: string;
  display: string;
  expr?: string;
  minutes?: number;
  runAt?: string;
}

export interface HermesJobExecution {
  status: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  deliveryOutcome?: string;
}

/** Job do Hermes como o Habblaud mostra. Sem origem/IP/pid: não são da conta do navegador. */
export interface HermesJob {
  id: string;
  name: string;
  prompt: string;
  schedule: HermesJobSchedule;
  enabled: boolean;
  state: string;
  pausedReason?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastError?: string;
  lastDeliveryError?: string;
  deliver: string;
  repeat: { times?: number; completed: number };
  skills: string[];
  /** Só leitura: o PATCH do Hermes não edita estes campos. */
  model?: string;
  provider?: string;
  workdir?: string;
  script?: string;
  /** Última execução conhecida (só a listagem traz). */
  latest?: HermesJobExecution;
}

export interface CreateJobInput {
  name: string;
  schedule: string;
  prompt: string;
  deliver?: string;
  skills?: string[];
  repeat?: number;
  paused?: boolean;
}

export type JobPatch = Partial<{
  name: string;
  schedule: string;
  prompt: string;
  deliver: string;
  skills: string[];
  skill: string | null;
  repeat: number | null;
  enabled: boolean;
}>;

export interface HermesJobsOptions {
  baseUrl: string;
  key: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function put<T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined): void {
  if (v !== undefined) o[k] = v;
}

function normalizeSchedule(raw: unknown, display: unknown): HermesJobSchedule {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: HermesJobSchedule = { kind: str(s.kind) ?? 'unknown', display: str(s.display) ?? str(display) ?? (typeof raw === 'string' ? raw : '') };
  put(out, 'expr', str(s.expr));
  put(out, 'minutes', num(s.minutes));
  put(out, 'runAt', str(s.run_at));
  return out;
}

function normalizeExecution(raw: unknown): HermesJobExecution | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;
  const status = str(e.status);
  if (!status) return undefined;
  const out: HermesJobExecution = { status };
  put(out, 'startedAt', str(e.started_at));
  put(out, 'finishedAt', str(e.finished_at));
  put(out, 'error', str(e.error));
  put(out, 'deliveryOutcome', str(e.delivery_outcome));
  return out;
}

export function normalizeJob(raw: unknown): HermesJob | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const j = raw as Record<string, unknown>;
  const id = str(j.id);
  if (!id) return undefined;
  const rep = (j.repeat && typeof j.repeat === 'object' ? j.repeat : {}) as Record<string, unknown>;
  const enabled = j.enabled !== false;
  const job: HermesJob = {
    id,
    name: str(j.name) ?? id,
    prompt: typeof j.prompt === 'string' ? j.prompt : '',
    schedule: normalizeSchedule(j.schedule, j.schedule_display),
    enabled,
    state: str(j.state) ?? (enabled ? 'scheduled' : 'paused'),
    deliver: str(j.deliver) ?? 'local',
    repeat: { completed: num(rep.completed) ?? 0 },
    skills: Array.isArray(j.skills) ? j.skills.filter((s): s is string => typeof s === 'string') : [],
  };
  put(job.repeat, 'times', num(rep.times));
  put(job, 'pausedReason', str(j.paused_reason));
  put(job, 'nextRunAt', str(j.next_run_at));
  put(job, 'lastRunAt', str(j.last_run_at));
  put(job, 'lastStatus', str(j.last_status));
  put(job, 'lastError', str(j.last_error));
  put(job, 'lastDeliveryError', str(j.last_delivery_error));
  put(job, 'model', str(j.model));
  put(job, 'provider', str(j.provider));
  put(job, 'workdir', str(j.workdir));
  put(job, 'script', str(j.script));
  put(job, 'latest', normalizeExecution(j.latest_execution));
  return job;
}

export class HermesJobs {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: HermesJobsOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.key = opts.key;
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private clean(text: string): string {
    return this.key ? text.split(this.key).join('***') : text;
  }

  private path(id: string, suffix = ''): string {
    if (!ID_RE.test(id)) throw new JobsError('invalid', tr('id de job inválido'));
    return `/api/jobs/${id}${suffix}`;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if ((err as Error)?.name === 'TimeoutError') throw new JobsError('unavailable', tr('o Hermes não respondeu em {0} s', [Math.ceil(this.timeoutMs / 1000)]));
      throw new JobsError('unavailable', tr('Hermes fora do ar'));
    }
    const text = await res.text().catch(() => '');
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = undefined;
    }
    const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
    if (res.ok) {
      if (!obj) throw new JobsError('failed', tr('resposta do Hermes inválida'), res.status);
      return obj;
    }
    const msg = this.clean(str(obj?.error) ?? str(obj?.message) ?? text.slice(0, 200)).slice(0, 600);
    if (res.status === 401 || res.status === 403) throw new JobsError('auth', tr('chave do Hermes inválida (HABBLAUD_HERMES_KEY)'), res.status);
    // 404 com JSON {error} = job inexistente; 404 sem JSON = a rota não existe nesta versão do Hermes.
    if (res.status === 404) throw obj ? new JobsError('not_found', msg || tr('job não encontrado'), 404) : new JobsError('unavailable', tr('este Hermes não tem a API de jobs'), 404);
    if (res.status === 501 || res.status === 405) throw new JobsError('unavailable', tr('este Hermes não tem a API de jobs'), res.status);
    // Validação do Hermes: 400, e regra inválida sai como 500 com o texto explicativo.
    if (res.status === 400 || res.status === 422 || (res.status === 500 && obj && /invalid|must|required/i.test(msg))) throw new JobsError('invalid', msg, res.status);
    throw new JobsError('failed', tr('Hermes respondeu {0}: {1}', [res.status, msg]), res.status);
  }

  private job(data: Record<string, unknown>): HermesJob {
    const job = normalizeJob(data.job);
    if (!job) throw new JobsError('failed', tr('resposta do Hermes inválida'));
    return job;
  }

  /** Todos os jobs, inclusive pausados. Resposta sem array é erro, nunca lista vazia. */
  async list(): Promise<HermesJob[]> {
    const data = await this.call('GET', '/api/jobs?include_disabled=true');
    if (!Array.isArray(data.jobs)) throw new JobsError('failed', tr('resposta do Hermes inválida'));
    return data.jobs.map(normalizeJob).filter((j): j is HermesJob => !!j);
  }

  async get(id: string): Promise<HermesJob> {
    return this.job(await this.call('GET', this.path(id)));
  }

  async create(input: CreateJobInput): Promise<HermesJob> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const schedule = typeof input.schedule === 'string' ? input.schedule.trim() : '';
    if (!name) throw new JobsError('invalid', tr('nome obrigatório'));
    if (!schedule) throw new JobsError('invalid', tr('regra obrigatória'));
    const body: Record<string, unknown> = { name, schedule, prompt: typeof input.prompt === 'string' ? input.prompt : '' };
    if (typeof input.deliver === 'string' && input.deliver) body.deliver = input.deliver;
    if (Array.isArray(input.skills) && input.skills.length) body.skills = input.skills.filter((s) => typeof s === 'string');
    if (typeof input.repeat === 'number') body.repeat = input.repeat;
    if (typeof input.paused === 'boolean') body.paused = input.paused;
    return this.job(await this.call('POST', '/api/jobs', body));
  }

  /** Manda só os campos da whitelist do Hermes; nada de reenviar o registro inteiro. */
  async update(id: string, patch: JobPatch): Promise<HermesJob> {
    const path = this.path(id);
    const body: Record<string, unknown> = {};
    for (const k of JOB_PATCH_FIELDS) if (patch && Object.prototype.hasOwnProperty.call(patch, k)) body[k] = (patch as Record<string, unknown>)[k];
    if (!Object.keys(body).length) throw new JobsError('invalid', tr('nada para alterar'));
    return this.job(await this.call('PATCH', path, body));
  }

  async pause(id: string): Promise<HermesJob> {
    return this.job(await this.call('POST', this.path(id, '/pause'), {}));
  }

  async resume(id: string): Promise<HermesJob> {
    return this.job(await this.call('POST', this.path(id, '/resume'), {}));
  }

  /** Dispara agora. Atenção (sondado): em job pausado o Hermes o reativa. Devolve o job aceito, não o resultado. */
  async run(id: string): Promise<HermesJob> {
    return this.job(await this.call('POST', this.path(id, '/run'), {}));
  }

  async remove(id: string): Promise<void> {
    await this.call('DELETE', this.path(id));
  }
}
