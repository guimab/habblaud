// Rotas do Consultor: /api/consult (listar, criar), /api/consult/:id/messages (conversa em SSE), DELETE (arquivar).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from '../http/app';
import { ConsultError, type ConsultService } from './service';

export const CONSULT_TEXT_MAX = 20_000;
export const CONSULT_CONTEXT_MAX = 20_000;

/** Devolve true se tratou a rota. `allowed` = a trava de acesso (loopback ou HABBLAUD_REMOTE_ALLOW=consult). */
export type ConsultRoute = (req: IncomingMessage, res: ServerResponse, path: string, method: string, allowed: boolean) => boolean;

function optText(v: unknown, max: number, name: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, `${name}: texto de até ${max} caracteres`);
  return v;
}

function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return void res.destroy();
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof ConsultError) return sendJson(res, err.code === 'unknown' ? 404 : 409, { error: err.message });
  sendJson(res, 502, { error: err instanceof Error ? err.message : 'erro no driver' });
}

async function streamMessage(svc: ConsultService, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  const body = (await readJson(req)) as { text?: unknown } | null;
  const text = optText(body?.text, CONSULT_TEXT_MAX, 'text');
  if (!text?.trim()) throw new HttpError(400, 'esperado {text: texto não vazio}');
  const ctrl = new AbortController();
  const onClose = () => ctrl.abort();
  res.on('close', onClose);
  const it = svc.send(id, text, ctrl.signal)[Symbol.asyncIterator]();
  try {
    // Primeiro evento antes do cabeçalho: erro de consulta desconhecida/arquivada ainda vira status HTTP.
    let next: IteratorResult<unknown>;
    try {
      next = await it.next();
    } catch (err) {
      if (err instanceof ConsultError) throw err;
      next = { done: false, value: { type: 'error', message: err instanceof Error ? err.message : 'erro no driver' } };
      res.writeHead(200, sseHeaders());
      res.end(frame(next.value as { type: string }));
      return;
    }
    res.writeHead(200, sseHeaders());
    while (!next.done) {
      res.write(frame(next.value as { type: string }));
      try {
        next = await it.next();
      } catch (err) {
        if (!ctrl.signal.aborted) res.write(frame({ type: 'error', message: err instanceof Error ? err.message : 'erro no driver' }));
        break;
      }
    }
    res.end();
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) ctrl.abort();
  }
}

function sseHeaders() {
  return { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' };
}

function frame(e: { type: string; message?: string }): string {
  return `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
}

export function createConsultRoutes(svc: ConsultService): ConsultRoute {
  return (req, res, path, method, allowed) => {
    if (path !== '/api/consult' && !path.startsWith('/api/consult/')) return false;
    if (!allowed) {
      req.resume();
      sendJson(res, 403, { error: 'consultor não liberado neste acesso' });
      return true;
    }
    const rest = path.slice('/api/consult'.length).split('/').filter(Boolean).map(decodeURIComponent);
    const run = (p: Promise<void>) => void p.catch((err) => sendError(res, err));

    if (rest.length === 0) {
      if (method === 'GET' || method === 'HEAD') sendJson(res, 200, { available: true, consults: svc.list() });
      else if (method === 'POST')
        run(
          (async () => {
            const b = (await readJson(req)) as { context?: unknown; screen?: unknown } | null;
            const c = await svc.start({ context: optText(b?.context, CONSULT_CONTEXT_MAX, 'context'), screen: optText(b?.screen, CONSULT_CONTEXT_MAX, 'screen') });
            sendJson(res, 201, c);
          })(),
        );
      else allow(req, res, 'GET, POST');
      return true;
    }
    const [id, sub] = rest as [string, string | undefined];
    if (rest.length === 1) {
      if (method === 'DELETE') run(svc.archive(id).then(() => sendJson(res, 200, { ok: true })));
      else allow(req, res, 'DELETE');
    } else if (rest.length === 2 && sub === 'messages') {
      if (method === 'POST') run(streamMessage(svc, req, res, id));
      else allow(req, res, 'POST');
    } else {
      req.resume();
      sendJson(res, 404, { error: 'rota desconhecida' });
    }
    return true;
  };
}

function allow(req: IncomingMessage, res: ServerResponse, methods: string) {
  req.resume();
  res.setHeader('Allow', methods);
  sendJson(res, 405, { error: 'método não permitido' });
}
