import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduleRoutes } from './http';
import { Scheduler } from './scheduler';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

async function setup(allowed = true) {
  const start = vi.fn(async () => 'run_1');
  const scheduler = new Scheduler({ start, cardExists: (id) => id === 'c1', tickMs: 0 });
  const route = createScheduleRoutes(scheduler);
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (!route(req, res, path, req.method ?? 'GET', allowed)) {
      res.statusCode = 418;
      res.end();
    }
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
    return { status: r.status, body: await r.json() };
  };
  return { call, start };
}

describe('rotas /api/schedules', () => {
  it('cria, lista por ficha, edita, pausa, roda agora e apaga', async () => {
    const { call, start } = await setup();
    const c = await call('POST', '/api/schedules', { cardId: 'c1', text: 'veja o cluster', rule: { kind: 'every', minutes: 60 } });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ cardId: 'c1', enabled: true });
    expect(typeof c.body.next).toBe('number');
    const id = c.body.id as string;
    const l = await call('GET', '/api/schedules?card=c1');
    expect(l.body.schedules).toHaveLength(1);
    expect(typeof l.body.timeZone).toBe('string');
    expect((await call('GET', '/api/schedules?card=outra')).body.schedules).toHaveLength(0);
    expect((await call('PATCH', `/api/schedules/${id}`, { enabled: false })).body).toMatchObject({ enabled: false });
    expect((await call('PATCH', `/api/schedules/${id}`, { text: 'novo' })).body.text).toBe('novo');
    expect((await call('POST', `/api/schedules/${id}/run`)).body.last).toMatchObject({ result: 'started', runId: 'run_1' });
    expect(start).toHaveBeenCalledWith('c1', 'novo', id);
    expect((await call('DELETE', `/api/schedules/${id}`)).status).toBe(200);
    expect((await call('GET', `/api/schedules/${id}`)).status).toBe(404);
  });

  it('erros: ficha, regra, enabled, rota e método', async () => {
    const { call } = await setup();
    expect((await call('POST', '/api/schedules', { cardId: 'zz', text: 'x', rule: { kind: 'every', minutes: 60 } })).status).toBe(400);
    expect((await call('POST', '/api/schedules', { cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 1 } })).status).toBe(400);
    expect((await call('PATCH', '/api/schedules/nada', { text: 'x' })).status).toBe(404);
    const c = await call('POST', '/api/schedules', { cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 60 } });
    expect((await call('PATCH', `/api/schedules/${c.body.id}`, { enabled: 'sim' })).status).toBe(400);
    expect((await call('PUT', '/api/schedules')).status).toBe(405);
    expect((await call('GET', `/api/schedules/${c.body.id}/x`)).status).toBe(404);
  });

  it('sem a feature agents: lê, mas não muda', async () => {
    const { call } = await setup(false);
    expect((await call('GET', '/api/schedules')).status).toBe(200);
    expect((await call('POST', '/api/schedules', { cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 60 } })).status).toBe(403);
  });
});
