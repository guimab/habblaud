import { describe, expect, it } from 'vitest';
import type { AgentDriver, ChatEvent, ChatOptions, CreateSessionOptions } from '../drivers/contract';
import { ProjectStore } from '../projects/store';
import { CardService } from './service';
import { AgentStore } from './store';

function fakeDriver() {
  const created: CreateSessionOptions[] = [];
  const chats: { id: string; msg: string; opts?: ChatOptions }[] = [];
  let n = 0;
  const driver: AgentDriver = {
    id: 'fake',
    capabilities: async () => new Set(['chat', 'create'] as const),
    createSession: async (o) => {
      created.push(o);
      return { id: `s${++n}`, title: o.title };
    },
    chat: async function* (id, msg, _signal, opts) {
      chats.push({ id, msg, opts });
      yield { type: 'delta', text: 'ok' } as ChatEvent;
      yield { type: 'done' } as ChatEvent;
    },
    archive: async () => {},
  };
  return { driver, created, chats };
}

async function drain(it: AsyncIterable<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('CardService', () => {
  it('primeira conversa cria sessão (com modelo), liga à ficha e manda instruções do projeto + ficha', async () => {
    const projects = new ProjectStore(null);
    const p = projects.create({ name: 'Base', paths: ['/srv/kb'], context: 'Use a base vetorial.' });
    const cards = new AgentStore(null, (id) => !!projects.get(id));
    const c = cards.create({ name: 'Bia', role: 'bibliotecária', projectId: p.id, instructions: 'Cite as fontes.', model: 'gpt-x' });
    const { driver, created, chats } = fakeDriver();
    const svc = new CardService({ cards, driver, projects });
    expect(await drain(svc.chat(c.id, 'oi', new AbortController().signal))).toHaveLength(2);
    expect(created).toEqual([{ title: 'Bia', model: 'gpt-x' }]);
    expect(cards.get(c.id)!.sessions).toEqual(['s1']);
    expect(chats[0]!.id).toBe('s1');
    const sys = chats[0]!.opts!.system!;
    expect(sys).toContain('Você é Bia, bibliotecária.');
    expect(sys).toContain('Projeto: Base (pastas: /srv/kb).');
    expect(sys).toContain('Use a base vetorial.');
    expect(sys).toContain('Cite as fontes.');
    // segunda conversa reusa a sessão
    await drain(svc.chat(c.id, 'de novo', new AbortController().signal));
    expect(created).toHaveLength(1);
    expect(chats[1]!.id).toBe('s1');
  });

  it('nova sessão vira a mais recente; ficha desconhecida dá erro unknown', async () => {
    const cards = new AgentStore(null, () => false);
    const c = cards.create({ name: 'Zé' });
    const { driver, chats } = fakeDriver();
    const svc = new CardService({ cards, driver });
    await drain(svc.chat(c.id, 'a', new AbortController().signal));
    expect(await svc.newSession(c.id)).toBe('s2');
    await drain(svc.chat(c.id, 'b', new AbortController().signal));
    expect(chats.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(chats[1]!.opts!.system).toBe('Você é Zé.');
    await expect(drain(svc.chat('a_nonexist', 'x', new AbortController().signal))).rejects.toMatchObject({ code: 'unknown' });
  });
});
