import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, ChatEvent, DriverCapability } from '../drivers/contract';
import { createConsultRoutes } from './http';
import { ConsultService } from './service';

class FakeDriver implements AgentDriver {
  readonly id = 'fake';
  aborted = false;
  mode: 'ok' | 'throw' | 'hang' = 'ok';
  async capabilities(): Promise<ReadonlySet<DriverCapability>> {
    return new Set(['chat', 'create']);
  }
  async createSession(o: { title: string }) {
    return { id: 's1', title: o.title };
  }
  async *chat(_id: string, _m: string, signal: AbortSignal): AsyncIterable<ChatEvent> {
    if (this.mode === 'throw') throw new Error('Hermes fora do ar');
    yield { type: 'delta', text: 'oi' };
    if (this.mode === 'hang') {
      await new Promise<void>((r) => signal.addEventListener('abort', () => ((this.aborted = true), r())));
      return;
    }
    yield { type: 'done' };
  }
  async archive() {}
}

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

async function setup(allowed = true) {
  const driver = new FakeDriver();
  const svc = new ConsultService({ driver });
  const route = createConsultRoutes(svc);
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
    return { status: r.status, text: await r.text() };
  };
  return { driver, svc, base, call };
}

describe('rotas /api/consult', () => {
  it('fora de /api/consult não trata', async () => {
    const { call } = await setup();
    expect((await call('GET', '/api/outra')).status).toBe(599);
  });

  it('sem permissão → 403', async () => {
    const { call } = await setup(false);
    expect((await call('GET', '/api/consult')).status).toBe(403);
    expect((await call('POST', '/api/consult', {})).status).toBe(403);
  });

  it('cria, lista, conversa em SSE e arquiva', async () => {
    const { call } = await setup();
    const created = await call('POST', '/api/consult', { context: 'infra' });
    expect(created.status).toBe(201);
    const c = JSON.parse(created.text) as { id: string };
    const list = JSON.parse((await call('GET', '/api/consult')).text) as { available: boolean; consults: { id: string }[] };
    expect(list.available).toBe(true);
    expect(list.consults.map((x) => x.id)).toEqual([c.id]);
    const sse = await call('POST', `/api/consult/${c.id}/messages`, { text: 'oi' });
    expect(sse.status).toBe(200);
    expect(sse.text).toBe('event: delta\ndata: {"type":"delta","text":"oi"}\n\nevent: done\ndata: {"type":"done"}\n\n');
    expect((await call('DELETE', `/api/consult/${c.id}`)).status).toBe(200);
    expect((await call('POST', `/api/consult/${c.id}/messages`, { text: 'oi' })).status).toBe(409);
  });

  it('validações', async () => {
    const { call } = await setup();
    const c = JSON.parse((await call('POST', '/api/consult', {})).text) as { id: string };
    expect((await call('POST', `/api/consult/${c.id}/messages`, { text: '  ' })).status).toBe(400);
    expect((await call('POST', `/api/consult/nada/messages`, { text: 'x' })).status).toBe(404);
    expect((await call('DELETE', `/api/consult/nada`)).status).toBe(404);
    expect((await call('POST', '/api/consult', { context: 5 })).status).toBe(400);
    expect((await call('PUT', '/api/consult')).status).toBe(405);
  });

  it('erro do driver vira frame error', async () => {
    const { call, driver } = await setup();
    driver.mode = 'throw';
    const c = JSON.parse((await call('POST', '/api/consult', {})).text) as { id: string };
    const sse = await call('POST', `/api/consult/${c.id}/messages`, { text: 'x' });
    expect(sse.text).toBe('event: error\ndata: {"type":"error","message":"Hermes fora do ar"}\n\n');
  });

  it('cliente fecha no meio do stream → aborta o driver', async () => {
    const { call, driver, base } = await setup();
    driver.mode = 'hang';
    const c = JSON.parse((await call('POST', '/api/consult', {})).text) as { id: string };
    await new Promise<void>((resolve) => {
      const req = request(`${base}/api/consult/${c.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
        res.once('data', () => req.destroy());
      });
      req.on('error', () => {});
      req.on('close', () => resolve());
      req.end(JSON.stringify({ text: 'x' }));
    });
    for (let i = 0; i < 50 && !driver.aborted; i++) await new Promise((r) => setTimeout(r, 10));
    expect(driver.aborted).toBe(true);
  });
});
