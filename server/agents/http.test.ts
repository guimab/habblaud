import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ConsultError } from '../consult/service';
import type { AgentDriver, ChatEvent } from '../drivers/contract';
import { createCardRoutes } from './http';
import { CardService } from './service';
import { AgentStore } from './store';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

const driver: AgentDriver = {
  id: 'fake',
  capabilities: async () => new Set(['chat'] as const),
  createSession: async (o) => ({ id: `sess-${o.title}`, title: o.title }),
  chat: async function* (id) {
    yield { type: 'delta', text: `resposta de ${id}` } as ChatEvent;
    yield { type: 'done' } as ChatEvent;
  },
  archive: async () => {},
};

async function setup(opts: { allowed?: boolean; withDriver?: boolean } = {}) {
  const cards = new AgentStore(null, (id) => id === 'p_aaaaaaaa');
  const consults = new Map([['c1', 'sess-consulta']]);
  const consult = {
    promote(id: string, attach: (sessionId: string) => void) {
      const s = consults.get(id);
      if (!s) throw new ConsultError('consulta desconhecida', 'unknown');
      attach(s);
      consults.delete(id);
    },
  };
  const route = createCardRoutes({ cards, consult, ...(opts.withDriver === false ? {} : { service: new CardService({ cards, driver }) }) });
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!route(req, res, url.pathname, req.method ?? 'GET', opts.allowed ?? true)) {
      res.writeHead(599);
      res.end();
    }
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: r.status, json: json as Record<string, any>, text };
  };
  return { cards, consults, call };
}

describe('rotas /api/cards', () => {
  it('fora de /api/cards não trata', async () => {
    const { call } = await setup();
    expect((await call('GET', '/api/cardsx')).status).toBe(599);
  });

  it('cria, lista, edita e apaga', async () => {
    const { call } = await setup();
    const c = await call('POST', '/api/cards', { name: 'Bia', role: 'busca', projectId: 'p_aaaaaaaa', instructions: 'x', bogus: 1 });
    expect(c.status).toBe(201);
    const id = c.json.id as string;
    expect(c.json).not.toHaveProperty('bogus');
    expect((await call('GET', '/api/cards')).json).toEqual({ cards: [c.json], chat: true });
    expect((await call('GET', `/api/cards/${id}`)).json.name).toBe('Bia');
    const e = await call('PATCH', `/api/cards/${id}`, { name: 'Bia 2', projectId: null });
    expect(e.json).toMatchObject({ name: 'Bia 2' });
    expect(e.json.projectId).toBeUndefined();
    expect((await call('DELETE', `/api/cards/${id}`, {})).status).toBe(200);
    expect((await call('DELETE', `/api/cards/${id}`, {})).status).toBe(404);
  });

  it('erros: 400 inválido, 404 desconhecido, 405 método, 403 sem permissão (ler continua livre)', async () => {
    const { call } = await setup();
    expect((await call('POST', '/api/cards', { name: '' })).status).toBe(400);
    expect((await call('POST', '/api/cards', { name: 'a', projectId: 'p_zzzzzzzz' })).status).toBe(400);
    expect((await call('PATCH', '/api/cards/a_nada0000', { name: 'x' })).status).toBe(404);
    expect((await call('PUT', '/api/cards')).status).toBe(405);
    expect((await call('GET', '/api/cards/a/b')).status).toBe(405);
    const ro = await setup({ allowed: false });
    expect((await ro.call('GET', '/api/cards')).status).toBe(200);
    expect((await ro.call('POST', '/api/cards', { name: 'a' })).status).toBe(403);
  });

  it('adotar e soltar sessão; conflito 409 quando a sessão é de outra ficha', async () => {
    const { call } = await setup();
    const a = (await call('POST', '/api/cards', { name: 'A' })).json.id;
    const b = (await call('POST', '/api/cards', { name: 'B' })).json.id;
    expect((await call('POST', `/api/cards/${a}/adopt`, { sessionId: 'tui-1' })).json.sessions).toEqual(['tui-1']);
    const conflict = await call('POST', `/api/cards/${b}/adopt`, { sessionId: 'tui-1' });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error).toContain('A');
    expect((await call('POST', `/api/cards/${b}/release`, { sessionId: 'tui-1' })).status).toBe(404);
    expect((await call('POST', `/api/cards/${a}/release`, { sessionId: 'tui-1' })).json.sessions).toEqual([]);
    expect((await call('POST', `/api/cards/${a}/adopt`, {})).status).toBe(400);
  });

  it('conversa em SSE cria a sessão na primeira vez; sessão nova pelo POST sessions', async () => {
    const { call, cards } = await setup();
    const id = (await call('POST', '/api/cards', { name: 'Zé' })).json.id;
    const r = await call('POST', `/api/cards/${id}/messages`, { text: 'oi' });
    expect(r.status).toBe(200);
    expect(r.text).toContain('event: delta');
    expect(r.text).toContain('resposta de sess-Zé');
    expect(cards.get(id)!.sessions).toEqual(['sess-Zé']);
    expect((await call('POST', `/api/cards/${id}/messages`, { text: '' })).status).toBe(400);
    expect((await call('POST', '/api/cards/a_nada0000/messages', { text: 'oi' })).status).toBe(404);
    const s = await call('POST', `/api/cards/${id}/sessions`, {});
    expect(s.status).toBe(201);
    expect(s.json.sessionId).toBe('sess-Zé');
  });

  it('sem driver: fichas funcionam, conversa responde 404', async () => {
    const { call } = await setup({ withDriver: false });
    const id = (await call('POST', '/api/cards', { name: 'Zé' })).json.id;
    expect((await call('GET', '/api/cards')).json.chat).toBe(false);
    expect((await call('POST', `/api/cards/${id}/messages`, { text: 'oi' })).status).toBe(404);
  });

  it('promover consulta: cria a ficha com a sessão da consulta; consulta desconhecida não deixa ficha órfã', async () => {
    const { call, consults, cards } = await setup();
    const r = await call('POST', '/api/cards', { name: 'Promovido', projectId: 'p_aaaaaaaa', fromConsult: 'c1' });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ name: 'Promovido', projectId: 'p_aaaaaaaa', sessions: ['sess-consulta'] });
    expect(consults.has('c1')).toBe(false);
    expect((await call('POST', '/api/cards', { name: 'X', fromConsult: 'c1' })).status).toBe(404);
    expect(cards.list().map((c) => c.name)).toEqual(['Promovido']);
    // nome inválido: a consulta continua no consultor
    consults.set('c2', 's2');
    expect((await call('POST', '/api/cards', { name: '', fromConsult: 'c2' })).status).toBe(400);
    expect(consults.has('c2')).toBe(true);
  });
});
