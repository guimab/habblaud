import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatEvent } from '../contract';
import { HermesDriver } from './client';

interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  body: unknown;
}

let server: Server | undefined;

async function fake(handler: (req: Seen, res: ServerResponse) => void): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const s: Seen = { method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined };
      seen.push(s);
      handler(s, res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

describe('HermesDriver', () => {
  it('cria sessão com Bearer e source api_server', async () => {
    const { base, seen } = await fake((_r, res) => json(res, 201, { session: { id: 's1', title: 'Consultor' } }));
    const d = new HermesDriver({ baseUrl: base, key: 'k123' });
    expect(await d.createSession({ title: 'Consultor' })).toEqual({ id: 's1', title: 'Consultor' });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/sessions', auth: 'Bearer k123', body: { title: 'Consultor', source: 'api_server' } });
  });

  it('cria sessão com modelo quando pedido', async () => {
    const { base, seen } = await fake((_r, res) => json(res, 201, { session: { id: 's9' } }));
    await new HermesDriver({ baseUrl: base, key: 'k' }).createSession({ title: 'Ficha', model: 'gpt-x' });
    expect(seen[0]?.body).toEqual({ title: 'Ficha', source: 'api_server', model: 'gpt-x' });
  });

  it('chat manda system_message quando há instruções', async () => {
    const { base, seen } = await fake((_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('event: done\ndata: {}\n\n');
    });
    const d = new HermesDriver({ baseUrl: base, key: 'k' });
    for await (const _ of d.chat('s1', 'oi', new AbortController().signal, { system: 'Responda em PT.' })) void _;
    for await (const _ of d.chat('s1', 'oi', new AbortController().signal, { system: '  ' })) void _;
    expect(seen[0]?.body).toEqual({ message: 'oi', system_message: 'Responda em PT.' });
    expect(seen[1]?.body).toEqual({ message: 'oi' });
  });

  it('título em uso tenta (2), (3)…', async () => {
    const { base, seen } = await fake((r, res) => {
      const t = (r.body as { title: string }).title;
      if (t === 'C (3)') json(res, 200, { id: 's3' });
      else json(res, 400, { error: { code: 'invalid_title', message: 'Title already in use' } });
    });
    const d = new HermesDriver({ baseUrl: base, key: 'k' });
    expect(await d.createSession({ title: 'C' })).toEqual({ id: 's3', title: 'C (3)' });
    expect(seen.map((s) => (s.body as { title: string }).title)).toEqual(['C', 'C (2)', 'C (3)']);
  });

  it('chat mapeia eventos do stream', async () => {
    const { base, seen } = await fake((_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const f = (e: string, d: unknown) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`;
      res.end(
        f('run.started', {}) +
          f('assistant.delta', { delta: 'Ol' }) +
          f('tool.started', { tool_name: 'terminal', preview: 'ls' }) +
          f('assistant.delta', { delta: 'á' }) +
          f('desconhecido', {}) +
          f('run.completed', {}) +
          f('done', {}),
      );
    });
    const d = new HermesDriver({ baseUrl: base, key: 'k' });
    const evs: ChatEvent[] = [];
    for await (const e of d.chat('s1', 'oi', new AbortController().signal)) evs.push(e);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/sessions/s1/chat/stream', body: { message: 'oi' } });
    expect(evs).toEqual([
      { type: 'delta', text: 'Ol' },
      { type: 'tool', tool: 'terminal', preview: 'ls' },
      { type: 'delta', text: 'á' },
      { type: 'done' },
    ]);
  });

  it('erro no stream vira evento error', async () => {
    const { base } = await fake((_r, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('event: error\ndata: {"message":"quebrou"}\n\nevent: done\ndata: {}\n\n');
    });
    const evs: ChatEvent[] = [];
    for await (const e of new HermesDriver({ baseUrl: base, key: 'k' }).chat('s', 'x', new AbortController().signal)) evs.push(e);
    expect(evs).toEqual([{ type: 'error', message: 'quebrou' }, { type: 'done' }]);
  });

  it('archive manda PATCH archived', async () => {
    const { base, seen } = await fake((_r, res) => json(res, 200, { ok: true }));
    await new HermesDriver({ baseUrl: base, key: 'k' }).archive('s/1');
    expect(seen[0]).toMatchObject({ method: 'PATCH', url: '/api/sessions/s%2F1', body: { archived: true } });
  });

  it('401 dá erro claro sem vazar a chave', async () => {
    const { base } = await fake((_r, res) => json(res, 401, { error: { message: 'Invalid key segredo-xyz' } }));
    const err = await new HermesDriver({ baseUrl: base, key: 'segredo-xyz' }).createSession({ title: 'x' }).catch((e: Error) => e);
    expect((err as Error).message).toContain('chave do Hermes inválida');
    expect((err as Error).message).not.toContain('segredo-xyz');
  });

  it('Hermes fora do ar', async () => {
    const err = await new HermesDriver({ baseUrl: 'http://127.0.0.1:1', key: 'k' }).createSession({ title: 'x' }).catch((e: Error) => e);
    expect((err as Error).message).toContain('Hermes fora do ar');
  });

  it('capacidades desta entrega', async () => {
    expect([...(await new HermesDriver({ baseUrl: 'http://x', key: 'k' }).capabilities())].sort()).toEqual(['chat', 'create']);
  });
});
