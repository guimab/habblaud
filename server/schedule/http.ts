// Rotas das agendas (/api/schedules): listar (?card=), criar, editar (texto, regra, pausar/retomar), apagar e rodar
// agora. Mudanças pela porta remota pedem a feature `agents` (como as fichas).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tr } from '../../shared/i18n';
import type { CardRoute } from '../agents/http';
import { HttpError, readJson, sendJson } from '../http/app';
import { ScheduleError, type ScheduleInput, type Scheduler } from './scheduler';

function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return void res.destroy();
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof ScheduleError) return sendJson(res, err.code === 'unknown' ? 404 : 400, { error: err.message });
  sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
}

function allow(req: IncomingMessage, res: ServerResponse, methods: string): void {
  req.resume();
  res.setHeader('Allow', methods);
  sendJson(res, 405, { error: tr('método não permitido') });
}

function input(b: unknown): ScheduleInput {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, tr('esperado um objeto JSON'));
  const o = b as Record<string, unknown>;
  if (o.enabled !== undefined && typeof o.enabled !== 'boolean') throw new HttpError(400, 'enabled: true/false');
  return {
    ...(typeof o.cardId === 'string' ? { cardId: o.cardId } : {}),
    ...(o.text !== undefined ? { text: o.text as string } : {}),
    ...(o.rule !== undefined ? { rule: o.rule } : {}),
    ...(o.enabled !== undefined ? { enabled: o.enabled as boolean } : {}),
  };
}

export function createScheduleRoutes(scheduler: Scheduler): CardRoute {
  return (req, res, path, method, allowed) => {
    if (path !== '/api/schedules' && !path.startsWith('/api/schedules/')) return false;
    const rest = path.split('/').filter(Boolean).slice(2).map(decodeURIComponent);
    const read = method === 'GET' || method === 'HEAD';
    if (!read && !allowed) {
      req.resume();
      sendJson(res, 403, { error: tr('agentes não liberados neste acesso') });
      return true;
    }
    const run = (fn: () => Promise<void>) => void fn().catch((err) => sendError(res, err));
    if (rest.length === 0) {
      if (read) {
        const card = new URL(req.url ?? '/', 'http://x').searchParams.get('card') ?? undefined;
        sendJson(res, 200, { schedules: scheduler.list(card), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      } else if (method === 'POST') run(async () => sendJson(res, 201, scheduler.create(input(await readJson(req)))));
      else allow(req, res, 'GET, POST');
      return true;
    }
    const id = rest[0]!;
    if (rest.length === 1) {
      if (read) {
        const s = scheduler.get(id);
        if (s) sendJson(res, 200, s);
        else sendJson(res, 404, { error: tr('agenda desconhecida') });
      } else if (method === 'PATCH') run(async () => sendJson(res, 200, scheduler.update(id, input(await readJson(req)))));
      else if (method === 'DELETE') {
        req.resume();
        if (scheduler.remove(id)) sendJson(res, 200, { ok: true });
        else sendJson(res, 404, { error: tr('agenda desconhecida') });
      } else allow(req, res, 'GET, PATCH, DELETE');
      return true;
    }
    if (rest.length === 2 && rest[1] === 'run') {
      if (method === 'POST') {
        req.resume();
        run(async () => sendJson(res, 200, await scheduler.runNow(id)));
      } else allow(req, res, 'POST');
      return true;
    }
    req.resume();
    sendJson(res, 404, { error: tr('rota desconhecida') });
    return true;
  };
}
