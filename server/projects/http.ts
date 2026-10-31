// Rotas dos projetos: GET/POST /api/projects, PATCH/DELETE /api/projects/:id. "Transformar sala em projeto" = POST
// com as pastas da sala; "Juntar com…" = PATCH {addPaths}. Ler é livre; alterar exige a trava de acesso (loopback ou
// HABBLAUD_REMOTE_ALLOW=projects). O Office acompanha as mudanças pelo onChange do store (server/index.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from '../http/app';
import { ProjectError, type ProjectInput, type ProjectStore } from './store';

export type ProjectRoute = (req: IncomingMessage, res: ServerResponse, path: string, method: string, allowed: boolean) => boolean;

function input(b: unknown): ProjectInput & { addPaths?: unknown } {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'esperado um objeto JSON');
  return b as ProjectInput & { addPaths?: unknown };
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
  if (err instanceof ProjectError) return sendJson(res, err.code === 'unknown' ? 404 : err.code === 'conflict' ? 409 : 400, { error: err.message });
  sendJson(res, 500, { error: err instanceof Error ? err.message : 'erro' });
}

function allow(req: IncomingMessage, res: ServerResponse, methods: string): void {
  req.resume();
  res.setHeader('Allow', methods);
  sendJson(res, 405, { error: 'método não permitido' });
}

export function createProjectRoutes(store: ProjectStore): ProjectRoute {
  return (req, res, path, method, allowed) => {
    if (path !== '/api/projects' && !path.startsWith('/api/projects/')) return false;
    const rest = path.slice('/api/projects'.length).split('/').filter(Boolean).map(decodeURIComponent);
    const read = method === 'GET' || method === 'HEAD';
    if (!read && !allowed) {
      req.resume();
      sendJson(res, 403, { error: 'projetos não liberados neste acesso' });
      return true;
    }
    const run = (fn: () => Promise<void>) => void fn().catch((err) => sendError(res, err));
    if (rest.length === 0) {
      if (read) sendJson(res, 200, { projects: store.list() });
      else if (method === 'POST') run(async () => sendJson(res, 201, store.create(input(await readJson(req)))));
      else allow(req, res, 'GET, POST');
      return true;
    }
    if (rest.length !== 1) {
      req.resume();
      sendJson(res, 404, { error: 'rota desconhecida' });
      return true;
    }
    const id = rest[0]!;
    if (method === 'PATCH')
      run(async () => {
        const b = input(await readJson(req));
        if (b.addPaths !== undefined) {
          if (!Array.isArray(b.addPaths)) throw new HttpError(400, 'addPaths: lista de pastas');
          store.addPaths(id, b.addPaths as string[]);
        }
        const { addPaths: _a, ...rest2 } = b;
        sendJson(res, 200, Object.keys(rest2).length ? store.update(id, rest2) : store.get(id) ?? store.update(id, {}));
      });
    else if (method === 'DELETE') {
      req.resume();
      if (store.remove(id)) sendJson(res, 200, { ok: true });
      else sendJson(res, 404, { error: 'projeto desconhecido' });
    } else allow(req, res, 'PATCH, DELETE');
    return true;
  };
}
