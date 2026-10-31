import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDriver, RunEvent } from '../drivers/contract';
import { RunManager } from '../runs/manager';
import { createInboxRoutes } from './http';
import { Inbox } from './inbox';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

const tick = () => new Promise((r) => setTimeout(r, 10));

async function setup(allowed = true) {
  const events = new Map<string, RunEvent[]>();
  const calls: string[] = [];
  let n = 0;
  const driver: AgentDriver = {
    id: 'fake',
    capabilities: async () => new Set(['chat', 'approve', 'steer', 'stop'] as const),
    createSession: async () => ({ id: 's', title: '', model: '', lastActive: 0, preview: '' }),
    chat: () => (async function* () {})(),
    archive: async () => {},
    startRun: async () => `run_${++n}`,
    async *runEvents(id) {
      yield* events.get(id) ?? [];
      await new Promise(() => {}); // fica aberto (run em andamento)
    },
    runStatus: async () => ({ state: 'running' }),
    approve: async (id, c) => void calls.push(`approve ${id} ${c}`),
    steer: async (id, t) => void calls.push(`steer ${id} ${t}`),
    stop: async (id) => void calls.push(`stop ${id}`),
  };
  const runs = new RunManager({ driver, retryMs: 1 });
  const inbox = new Inbox({ runs });
  const route = createInboxRoutes({ inbox, runs });
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
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
  };
  return { runs, events, calls, call, base };
}

describe('rotas /api/inbox e /api/runs', () => {
  it('aprovação aparece na Inbox e é respondida por ela', async () => {
    const { runs, events, calls, call } = await setup();
    events.set('run_1', [{ type: 'approval', approval: { command: 'rm x', choices: ['once', 'deny'] }, seq: 0 }]);
    await runs.start({ kind: 'card', id: 'c1', sessionId: 's1', title: 'Revisora' }, 'oi');
    await tick();
    const { body } = await call('GET', '/api/inbox');
    expect(body.items).toMatchObject([{ id: 'run:run_1', kind: 'approval', title: 'Revisora', text: 'rm x' }]);
    expect((await call('POST', '/api/inbox/run%3Arun_1', { action: 'approve', choice: 'bogus' })).status).toBe(400);
    expect((await call('POST', '/api/inbox/run%3Arun_1', { action: 'approve', choice: 'once' })).status).toBe(200);
    expect(calls).toEqual(['approve run_1 once']);
    expect((await call('POST', '/api/inbox/run%3Arun_1', { action: 'dismiss' })).status).toBe(409);
    expect((await call('POST', '/api/inbox/nada', { action: 'dismiss' })).status).toBe(404);
  });

  it('lista runs, assina eventos (SSE), redireciona e para', async () => {
    const { runs, events, calls, call, base } = await setup();
    events.set('run_1', [{ type: 'delta', text: 'meio', seq: 0 }]);
    await runs.start({ kind: 'card', id: 'c1', sessionId: 's1' }, 'oi');
    await tick();
    expect((await call('GET', '/api/runs')).body.runs).toMatchObject([{ runId: 'run_1', state: 'running', text: 'meio' }]);
    expect((await call('GET', '/api/runs/run_1')).body).toMatchObject({ runId: 'run_1' });
    expect((await call('GET', '/api/runs/nada')).status).toBe(404);
    const ctrl = new AbortController();
    const r = await fetch(`${base}/api/runs/run_1/events`, { signal: ctrl.signal });
    const reader = r.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"text":"meio"');
    ctrl.abort();
    expect((await call('POST', '/api/runs/run_1/steer', { text: 'foco' })).status).toBe(200);
    expect((await call('POST', '/api/runs/run_1/steer', { text: '' })).status).toBe(400);
    expect((await call('POST', '/api/runs/run_1/stop', {})).status).toBe(200);
    expect(calls).toEqual(['steer run_1 foco', 'stop run_1']);
    expect((await call('GET', '/api/runs/nada/events')).status).toBe(404);
  });

  it('sem a feature agents: leitura sim, mudança não', async () => {
    const { call } = await setup(false);
    expect((await call('GET', '/api/inbox')).status).toBe(200);
    expect((await call('POST', '/api/inbox/dismiss-all', {})).status).toBe(403);
    expect((await call('POST', '/api/runs/run_1/stop', {})).status).toBe(403);
  });

  it('rota de fora não é tratada', async () => {
    const { call } = await setup();
    expect((await call('GET', '/api/inboxx')).status).toBe(418);
  });
});
