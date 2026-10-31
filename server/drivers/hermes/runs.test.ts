import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunEvent } from '../contract';
import { HermesDriver } from './client';

// Runs do Hermes (/v1/runs): rodam no servidor do Hermes sem ninguém assistindo; o Habblaud assina os eventos.

interface Seen {
  method: string;
  url: string;
  body: unknown;
  lastEventId?: string;
}

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

async function fake(handler: (req: Seen, res: ServerResponse) => void): Promise<{ driver: HermesDriver; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const s: Seen = { method: req.method ?? '', url: req.url ?? '', body: raw ? JSON.parse(raw) : undefined };
      if (typeof req.headers['last-event-id'] === 'string') s.lastEventId = req.headers['last-event-id'];
      seen.push(s);
      handler(s, res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { driver: new HermesDriver({ baseUrl: base, key: 'segredo-123' }), seen };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const frame = (seq: number, d: Record<string, unknown>) => `id: ${seq}\ndata: ${JSON.stringify({ ...d, seq })}\n\n`;

async function collect(it: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('HermesDriver: runs', () => {
  it('declara approve, steer e stop', async () => {
    const { driver } = await fake((_r, res) => json(res, 200, {}));
    const caps = await driver.capabilities();
    for (const c of ['chat', 'create', 'approve', 'steer', 'stop'] as const) expect(caps.has(c)).toBe(true);
  });

  it('startRun manda input, session_id e instructions e devolve o run_id', async () => {
    const { driver, seen } = await fake((_r, res) => json(res, 202, { run_id: 'run_1', status: 'started' }));
    expect(await driver.startRun('s1', 'oi', { system: ' seja breve ' })).toBe('run_1');
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/runs', body: { input: 'oi', session_id: 's1', instructions: 'seja breve' } });
    await driver.startRun('s1', 'oi');
    expect(seen[1]!.body).toEqual({ input: 'oi', session_id: 's1' });
  });

  it('runEvents traduz os eventos e guarda o seq; retoma com Last-Event-ID', async () => {
    const { driver, seen } = await fake((_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        ': keepalive\n\n' +
          frame(3, { event: 'tool.started', tool: 'terminal', preview: 'ls' }) +
          frame(4, { event: 'tool.completed', tool: 'terminal' }) +
          frame(5, { event: 'reasoning.available', text: 'pensando' }) +
          frame(6, { event: 'message.delta', delta: 'Olá' }) +
          frame(7, { event: 'approval.request', command: 'rm -rf x', description: 'apaga', request_id: 'q1', choices: ['once', 'session', 'deny', 'bogus'] }) +
          frame(8, { event: 'approval.responded', choice: 'once' }) +
          frame(9, { event: 'run.completed', output: 'Olá' }),
      );
    });
    const evs = await collect(driver.runEvents('run_1', 2, new AbortController().signal));
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/v1/runs/run_1/events?last_seq=2', lastEventId: '2' });
    expect(evs).toEqual([
      { type: 'tool', tool: 'terminal', preview: 'ls', seq: 3 },
      { type: 'tool', tool: 'terminal', seq: 4 },
      { type: 'delta', text: 'Olá', seq: 6 },
      { type: 'approval', approval: { requestId: 'q1', command: 'rm -rf x', description: 'apaga', choices: ['once', 'session', 'deny'] }, seq: 7 },
      { type: 'approved', seq: 8 },
      { type: 'done', seq: 9 },
    ]);
  });

  it('run.failed vira error com o motivo (sem a chave) e done', async () => {
    const { driver } = await fake((_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(frame(0, { event: 'run.failed', error: 'quebrou segredo-123' }));
    });
    expect(await collect(driver.runEvents('r', -1, new AbortController().signal))).toEqual([
      { type: 'error', message: 'quebrou ***', seq: 0 },
      { type: 'done', seq: 0 },
    ]);
  });

  it('runEvents de run desconhecido: erro gone', async () => {
    const { driver } = await fake((_r, res) => json(res, 404, { error: { message: 'Run not found' } }));
    await expect(collect(driver.runEvents('r', -1, new AbortController().signal))).rejects.toMatchObject({ gone: true });
  });

  it('runStatus traduz o status do Hermes; 404 = gone', async () => {
    const answers: Record<string, [number, unknown]> = {
      '/v1/runs/a': [200, { status: 'running' }],
      '/v1/runs/b': [200, { status: 'waiting_for_approval' }],
      '/v1/runs/c': [200, { status: 'completed', output: 'pronto' }],
      '/v1/runs/d': [200, { status: 'failed', error: 'x' }],
      '/v1/runs/e': [404, {}],
      '/v1/runs/f': [200, { status: 'cancelled' }],
    };
    const { driver } = await fake((r, res) => json(res, ...(answers[r.url] ?? [500, {}])));
    expect(await driver.runStatus('a')).toEqual({ state: 'running' });
    expect(await driver.runStatus('b')).toEqual({ state: 'waiting' });
    expect(await driver.runStatus('c')).toEqual({ state: 'done', output: 'pronto' });
    expect(await driver.runStatus('d')).toEqual({ state: 'error', error: 'x' });
    expect(await driver.runStatus('e')).toEqual({ state: 'gone' });
    expect(await driver.runStatus('f')).toEqual({ state: 'interrupted', error: 'interrompido' });
  });

  it('approve, steer e stop chamam /v1/runs/:id/...; 409 vira erro legível', async () => {
    const { driver, seen } = await fake((r, res) => (r.url.endsWith('/steer') ? json(res, 409, { error: { message: 'Run is not currently accepting steer input' } }) : json(res, 200, {})));
    await driver.approve('r1', 'session', 'q1');
    await driver.approve('r1', 'deny');
    await driver.stop('r1');
    await expect(driver.steer('r1', 'mude o foco')).rejects.toThrow(/steer/);
    // Cada approve confere a projeção do run antes (procurando a geração de execução); sem
    // `execution_generation` na resposta, o corpo segue o formato antigo (só a escolha).
    expect(seen.map((s) => [s.method, s.url, s.body])).toEqual([
      ['GET', '/v1/runs/r1', undefined],
      ['POST', '/v1/runs/r1/approval', { choice: 'session', request_id: 'q1' }],
      ['GET', '/v1/runs/r1', undefined],
      ['POST', '/v1/runs/r1/approval', { choice: 'deny' }],
      ['POST', '/v1/runs/r1/stop', {}],
      ['POST', '/v1/runs/r1/steer', { text: 'mude o foco' }],
    ]);
  });

  it('approve manda request_id + execution_generation quando o Hermes exige (run com autoridade)', async () => {
    // Hermes com execução sob autoridade recusa qualquer corpo que não seja exatamente
    // {request_id, execution_generation, choice} (400 invalid_params) — o evento approval.request
    // traz o request_id, e a geração vem da projeção do run.
    const { driver, seen } = await fake((r, res) =>
      r.url === '/v1/runs/r1'
        ? json(res, 200, { status: 'waiting_for_approval', execution_generation: 4, pending_controls: [{ kind: 'approval', prompt_id: 'q9' }] })
        : json(res, 200, {}),
    );
    await driver.approve('r1', 'once', 'q1');
    await driver.approve('r1', 'deny');
    expect(seen.filter((s) => s.url.endsWith('/approval')).map((s) => s.body)).toEqual([
      { request_id: 'q1', execution_generation: 4, choice: 'once' },
      // Sem request_id de quem chamou, vale o pedido pendente da projeção.
      { request_id: 'q9', execution_generation: 4, choice: 'deny' },
    ]);
  });

  it('approve não quebra se a projeção do run falhar: cai no corpo antigo', async () => {
    const { driver, seen } = await fake((r, res) => (r.url === '/v1/runs/r1' ? json(res, 404, { error: { message: 'Run not found' } }) : json(res, 200, {})));
    await driver.approve('r1', 'once', 'q1');
    expect(seen.filter((s) => s.method === 'POST').map((s) => s.body)).toEqual([{ choice: 'once', request_id: 'q1' }]);
  });
});
