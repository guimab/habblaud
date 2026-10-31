// Rotas da Inbox (/api/inbox) e dos runs (/api/runs): listar, assinar a conversa de um run em andamento, redirecionar e
// parar. Mudanças exigem a feature `agents` pela porta remota (mesmo `allowed` das fichas).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CardRoute } from '../agents/http';
import { readText, streamChat } from '../consult/http';
import { APPROVAL_CHOICES, type ApprovalChoice } from '../drivers/contract';
import { HttpError, readJson, sendJson } from '../http/app';
import { RunError, type RunManager, type RunRecord } from '../runs/manager';
import { Inbox, InboxError } from './inbox';

export interface InboxRouteDeps {
  inbox: Inbox;
  runs: RunManager;
}

const RUN_TEXT_MAX = 2000;

function view(r: RunRecord): RunRecord {
  return r.text.length > RUN_TEXT_MAX ? { ...r, text: `…${r.text.slice(-RUN_TEXT_MAX)}` } : r;
}

function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return void res.destroy();
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof InboxError) return sendJson(res, err.code === 'unknown' ? 404 : 409, { error: err.message });
  if (err instanceof RunError) return sendJson(res, err.code === 'unknown' ? 404 : err.code === 'unsupported' ? 501 : 409, { error: err.message });
  sendJson(res, 502, { error: err instanceof Error ? err.message : 'erro no driver' });
}

function allow(req: IncomingMessage, res: ServerResponse, methods: string): void {
  req.resume();
  res.setHeader('Allow', methods);
  sendJson(res, 405, { error: 'método não permitido' });
}

function choiceOf(v: unknown): ApprovalChoice {
  if (typeof v !== 'string' || !APPROVAL_CHOICES.includes(v as ApprovalChoice)) throw new HttpError(400, `choice: ${APPROVAL_CHOICES.join(', ')}`);
  return v as ApprovalChoice;
}

export function createInboxRoutes({ inbox, runs }: InboxRouteDeps): CardRoute {
  return (req, res, path, method, allowed) => {
    const isInbox = path === '/api/inbox' || path.startsWith('/api/inbox/');
    const isRuns = path === '/api/runs' || path.startsWith('/api/runs/');
    if (!isInbox && !isRuns) return false;
    const rest = path.split('/').filter(Boolean).slice(2).map(decodeURIComponent);
    const read = method === 'GET' || method === 'HEAD';
    if (!read && !allowed) {
      req.resume();
      sendJson(res, 403, { error: 'agentes não liberados neste acesso' });
      return true;
    }
    const run = (fn: () => Promise<void>) => void fn().catch((err) => sendError(res, err));

    if (isInbox) {
      if (rest.length === 0) {
        if (read) sendJson(res, 200, { items: inbox.items() });
        else allow(req, res, 'GET');
      } else if (rest.length === 1 && rest[0] === 'dismiss-all') {
        if (method === 'POST') run(async () => sendJson(res, 200, { dismissed: inbox.dismissAll() }));
        else allow(req, res, 'POST');
      } else if (rest.length === 1) {
        if (method !== 'POST') allow(req, res, 'POST');
        else
          run(async () => {
            const b = ((await readJson(req)) ?? {}) as { action?: unknown; choice?: unknown };
            if (b.action === 'dismiss') inbox.dismiss(rest[0]!);
            else if (b.action === 'approve') await inbox.approve(rest[0]!, choiceOf(b.choice));
            else throw new HttpError(400, 'action: dismiss ou approve');
            sendJson(res, 200, { ok: true });
          });
      } else {
        req.resume();
        sendJson(res, 404, { error: 'rota desconhecida' });
      }
      return true;
    }

    // /api/runs
    if (rest.length === 0) {
      if (read) sendJson(res, 200, { runs: runs.list().map(view) });
      else allow(req, res, 'GET');
      return true;
    }
    const id = rest[0]!;
    if (rest.length === 1) {
      if (!read) allow(req, res, 'GET');
      else {
        const r = runs.get(id);
        if (r) sendJson(res, 200, view(r));
        else sendJson(res, 404, { error: 'run desconhecido' });
      }
      return true;
    }
    const action = rest[1];
    if (rest.length === 2 && action === 'events') {
      if (method !== 'GET') allow(req, res, 'GET');
      else run(() => streamChat(res, (signal) => runs.subscribe(id, signal), (err) => err instanceof RunError));
      return true;
    }
    if (rest.length === 2 && (action === 'steer' || action === 'stop')) {
      if (method !== 'POST') allow(req, res, 'POST');
      else
        run(async () => {
          if (action === 'steer') await runs.steer(id, await readText(req));
          else {
            req.resume();
            await runs.stop(id);
          }
          sendJson(res, 200, { ok: true });
        });
      return true;
    }
    req.resume();
    sendJson(res, 404, { error: 'rota desconhecida' });
    return true;
  };
}
