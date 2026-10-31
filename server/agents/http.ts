// Rotas das fichas de agente:
//   GET/POST /api/cards                       listar / criar ({name, role, projectId, instructions, model, look,
//                                             fromConsult?} — fromConsult = promover a consulta: a sessão dela
//                                             passa para a ficha nova)
//   PATCH/DELETE /api/cards/:id               editar / apagar a ficha (as sessões no driver ficam como estão)
//   POST /api/cards/:id/adopt   {sessionId}   ligar uma sessão existente à ficha
//   POST /api/cards/:id/release {sessionId}   soltar a sessão
//   POST /api/cards/:id/sessions              abrir sessão nova (vira a mais recente)
//   POST /api/cards/:id/messages {text}       conversar (SSE, mesmo formato do consultor)
// Ler é livre; o resto exige a trava de acesso (loopback ou HABBLAUD_REMOTE_ALLOW=agents).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readText, streamChat } from '../consult/http';
import { ConsultError } from '../consult/service';
import { HttpError, readJson, sendJson } from '../http/app';
import type { CardService } from './service';
import { AgentError, type AgentInput, type AgentStore } from './store';

export type CardRoute = (req: IncomingMessage, res: ServerResponse, path: string, method: string, allowed: boolean) => boolean;

export interface CardRouteDeps {
  cards: AgentStore;
  /** Conversa pelo driver; ausente = sem driver configurado (só fichas). */
  service?: CardService;
  /** Promover consulta. */
  consult?: { promote(id: string): string };
}

function obj(b: unknown): Record<string, unknown> {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'esperado um objeto JSON');
  return b as Record<string, unknown>;
}

const FIELDS = ['name', 'role', 'projectId', 'instructions', 'model', 'look'] as const;
function input(b: Record<string, unknown>): AgentInput {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in b) out[k] = b[k];
  return out as AgentInput;
}

function sessionOf(b: Record<string, unknown>): string {
  if (typeof b.sessionId !== 'string' || !b.sessionId.trim()) throw new HttpError(400, 'esperado {sessionId}');
  return b.sessionId.trim();
}

function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return void res.destroy();
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof AgentError) return sendJson(res, err.code === 'unknown' ? 404 : err.code === 'conflict' ? 409 : 400, { error: err.message });
  if (err instanceof ConsultError) return sendJson(res, err.code === 'unknown' ? 404 : 409, { error: err.message });
  sendJson(res, 502, { error: err instanceof Error ? err.message : 'erro no driver' });
}

function allow(req: IncomingMessage, res: ServerResponse, methods: string): void {
  req.resume();
  res.setHeader('Allow', methods);
  sendJson(res, 405, { error: 'método não permitido' });
}

function notFound(req: IncomingMessage, res: ServerResponse, msg = 'rota desconhecida'): void {
  req.resume();
  sendJson(res, 404, { error: msg });
}

export function createCardRoutes(deps: CardRouteDeps): CardRoute {
  const { cards } = deps;
  return (req, res, path, method, allowed) => {
    if (path !== '/api/cards' && !path.startsWith('/api/cards/')) return false;
    const rest = path.slice('/api/cards'.length).split('/').filter(Boolean).map(decodeURIComponent);
    const read = method === 'GET' || method === 'HEAD';
    if (!read && !allowed) {
      req.resume();
      sendJson(res, 403, { error: 'fichas de agente não liberadas neste acesso' });
      return true;
    }
    const run = (fn: () => Promise<void>) => void fn().catch((err) => sendError(res, err));

    if (rest.length === 0) {
      if (read) sendJson(res, 200, { cards: cards.list(), chat: !!deps.service });
      else if (method === 'POST')
        run(async () => {
          const b = obj(await readJson(req));
          if (b.fromConsult !== undefined) {
            if (!deps.consult) throw new HttpError(404, 'consultor desligado');
            if (typeof b.fromConsult !== 'string') throw new HttpError(400, 'fromConsult: id da consulta');
            const c = cards.create(input(b)); // valida antes de tirar a consulta do consultor
            try {
              cards.attachSession(c.id, deps.consult.promote(b.fromConsult));
            } catch (err) {
              cards.remove(c.id);
              throw err;
            }
            return sendJson(res, 201, cards.get(c.id));
          }
          sendJson(res, 201, cards.create(input(b)));
        });
      else allow(req, res, 'GET, POST');
      return true;
    }
    const [id, sub] = rest as [string, string | undefined];
    if (rest.length === 1) {
      if (read) {
        const c = cards.get(id);
        if (c) sendJson(res, 200, c);
        else notFound(req, res, 'agente desconhecido');
      } else if (method === 'PATCH') run(async () => sendJson(res, 200, cards.update(id, input(obj(await readJson(req))))));
      else if (method === 'DELETE')
        run(async () => {
          await readJson(req).catch(() => null);
          if (!cards.remove(id)) throw new AgentError('unknown', 'agente desconhecido');
          sendJson(res, 200, { ok: true });
        });
      else allow(req, res, 'GET, PATCH, DELETE');
      return true;
    }
    if (rest.length !== 2) {
      notFound(req, res);
      return true;
    }
    if (method !== 'POST') {
      allow(req, res, 'POST');
      return true;
    }
    if (sub === 'adopt') run(async () => sendJson(res, 200, cards.attachSession(id, sessionOf(obj(await readJson(req))))));
    else if (sub === 'release')
      run(async () => {
        const s = sessionOf(obj(await readJson(req)));
        if (cards.bySession(s)?.id !== id) throw new AgentError('unknown', 'a sessão não é deste agente');
        cards.detachSession(s);
        sendJson(res, 200, cards.get(id));
      });
    else if (sub === 'sessions' || sub === 'messages') {
      const svc = deps.service;
      if (!svc) {
        notFound(req, res, 'conversa desligada (configure HABBLAUD_HERMES_URL e HABBLAUD_HERMES_KEY)');
        return true;
      }
      if (sub === 'sessions')
        run(async () => {
          await readJson(req).catch(() => null);
          const sessionId = await svc.newSession(id);
          sendJson(res, 201, { sessionId, card: cards.get(id) });
        });
      else
        run(async () => {
          if (!cards.get(id)) throw new AgentError('unknown', 'agente desconhecido');
          const text = await readText(req);
          await streamChat(res, (signal) => svc.chat(id, text, signal), (err) => err instanceof AgentError);
        });
    } else notFound(req, res);
    return true;
  };
}
