import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectRoutes } from './http';
import { ProjectStore } from './store';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

async function setup(allowed = true) {
  const store = new ProjectStore(null);
  const route = createProjectRoutes(store);
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!route(req, res, url.pathname, req.method ?? 'GET', allowed)) {
      res.writeHead(599);
      res.end();
    }
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  };
  return { store, call };
}

describe('rotas /api/projects', () => {
  it('fora de /api/projects não trata', async () => {
    const { call } = await setup();
    expect((await call('GET', '/api/projectsx')).status).toBe(599);
  });

  it('cria, lista, edita, junta pastas e apaga', async () => {
    const { call } = await setup();
    const c = await call('POST', '/api/projects', { name: 'Base', paths: ['/a'], context: 'ctx' });
    expect(c.status).toBe(201);
    const id = c.json.id as string;
    expect((await call('GET', '/api/projects')).json).toEqual({ projects: [{ id, name: 'Base', paths: ['/a'], context: 'ctx' }] });
    expect((await call('PATCH', `/api/projects/${id}`, { name: 'B2', context: '' })).json).toEqual({ id, name: 'B2', paths: ['/a'] });
    expect((await call('PATCH', `/api/projects/${id}`, { addPaths: ['/b'] })).json.paths).toEqual(['/a', '/b']);
    expect((await call('DELETE', `/api/projects/${id}`)).status).toBe(200);
    expect((await call('DELETE', `/api/projects/${id}`)).status).toBe(404);
  });

  it('erros: 400 inválido, 409 pasta em outro projeto, 404 desconhecido, 405 método', async () => {
    const { call } = await setup();
    expect((await call('POST', '/api/projects', { name: '', paths: [] })).status).toBe(400);
    expect((await call('POST', '/api/projects', { name: 'x', paths: 'nao-lista' })).status).toBe(400);
    await call('POST', '/api/projects', { name: 'A', paths: ['/a'] });
    const conflict = await call('POST', '/api/projects', { name: 'B', paths: ['/a'] });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error).toContain('/a');
    expect((await call('PATCH', '/api/projects/p_nada0000', { name: 'x' })).status).toBe(404);
    expect((await call('PUT', '/api/projects')).status).toBe(405);
  });

  it('sem liberação: lista sim, altera não', async () => {
    const { call } = await setup(false);
    expect((await call('GET', '/api/projects')).status).toBe(200);
    expect((await call('POST', '/api/projects', { name: 'A', paths: [] })).status).toBe(403);
  });
});
