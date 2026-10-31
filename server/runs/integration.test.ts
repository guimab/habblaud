import { describe, expect, it } from 'vitest';
import { AgentStore } from '../agents/store';
import { CardService } from '../agents/service';
import { ConsultService } from '../consult/service';
import type { AgentDriver, ChatEvent, RunEvent } from '../drivers/contract';
import { RunManager } from './manager';

// Ficha e consulta com runs: o turno vira run em segundo plano; o painel só assina.
function driver() {
  const runs: { session: string; text: string; system?: string }[] = [];
  const queued = new Map<string, RunEvent[]>();
  const d: AgentDriver = {
    id: 'fake',
    capabilities: async () => new Set(['chat', 'create'] as const),
    createSession: async (o) => ({ id: `sess_${o.title}`, title: o.title ?? '', model: '', lastActive: 0, preview: '' }),
    chat: () => {
      throw new Error('não deveria usar chat com runs');
    },
    archive: async () => {},
    startRun: async (session, text, opts) => {
      runs.push({ session, text, ...(opts?.system ? { system: opts.system } : {}) });
      const id = `run_${runs.length}`;
      queued.set(id, [{ type: 'delta', text: 'resposta', seq: 0 }, { type: 'done', seq: 1 }]);
      return id;
    },
    async *runEvents(id) {
      yield* queued.get(id) ?? [];
    },
    runStatus: async () => ({ state: 'done' }),
  };
  return { d, runs };
}

async function all(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('runs nas conversas', () => {
  it('ficha: abre run com as instruções e devolve o runId antes da resposta', async () => {
    const { d, runs } = driver();
    const cards = new AgentStore(null, () => true);
    const c = cards.create({ name: 'Revisora', instructions: 'revise' });
    const mgr = new RunManager({ driver: d, retryMs: 1 });
    const svc = new CardService({ cards, driver: d, runs: mgr });
    const evs = await all(svc.chat(c.id, 'oi', new AbortController().signal));
    expect(evs).toEqual([{ type: 'run', runId: 'run_1' }, { type: 'delta', text: 'resposta' }, { type: 'done' }]);
    expect(runs[0]).toMatchObject({ session: 'sess_Revisora', text: 'oi' });
    expect(runs[0]!.system).toContain('revise');
    expect(mgr.get('run_1')).toMatchObject({ owner: { kind: 'card', id: c.id, sessionId: 'sess_Revisora', title: 'Revisora' }, state: 'done' });
  });

  it('ficha em segundo plano (agenda): dispara o run marcado com a agenda, sem assinar', async () => {
    const { d, runs } = driver();
    const cards = new AgentStore(null, () => true);
    const c = cards.create({ name: 'Vigia' });
    const mgr = new RunManager({ driver: d, retryMs: 1 });
    const svc = new CardService({ cards, driver: d, runs: mgr });
    const runId = await svc.background(c.id, 'veja o cluster', 's_1');
    expect(runId).toBe('run_1');
    expect(runs[0]).toMatchObject({ session: 'sess_Vigia', text: 'veja o cluster' });
    expect(mgr.get(runId)!.owner).toMatchObject({ kind: 'card', id: c.id, scheduleId: 's_1' });
    await expect(svc.background(c.id, 'de novo')).rejects.toMatchObject({ code: 'busy' });
  });

  it('consulta: abre run (preâmbulo só no primeiro turno) e não arquiva com run ativo', async () => {
    const { d, runs } = driver();
    const mgr = new RunManager({ driver: d, retryMs: 1 });
    let now = 1000;
    const svc = new ConsultService({ driver: d, runs: mgr, now: () => now, idleMs: 10 });
    const c = await svc.start({ context: 'ctx' });
    const evs = await all(svc.send(c.id, 'oi', new AbortController().signal));
    expect(evs[0]).toEqual({ type: 'run', runId: 'run_1' });
    expect(runs[0]!.text).toMatch(/ctx[\s\S]*oi$/);
    expect(mgr.get('run_1')!.owner).toMatchObject({ kind: 'consult', id: c.id });
    await all(svc.send(c.id, 'de novo', new AbortController().signal));
    expect(runs[1]!.text).toBe('de novo');
    now += 100;
    expect(await svc.sweep()).toBe(1);
  });

  it('consulta: se o run não começa, o preâmbulo fica para a próxima', async () => {
    const { d, runs } = driver();
    const orig = d.startRun!.bind(d);
    let fail = true;
    d.startRun = async (...a) => {
      if (fail) throw new Error('Hermes fora');
      return orig(...a);
    };
    const mgr = new RunManager({ driver: d, retryMs: 1 });
    const svc = new ConsultService({ driver: d, runs: mgr });
    const c = await svc.start({ context: 'ctx' });
    await expect(all(svc.send(c.id, 'oi', new AbortController().signal))).rejects.toThrow('Hermes fora');
    fail = false;
    await all(svc.send(c.id, 'oi de novo', new AbortController().signal));
    expect(runs[0]!.text).toMatch(/ctx[\s\S]*oi de novo$/);
  });

  it('ficha sem sessão: duas chamadas ao mesmo tempo criam uma sessão só', async () => {
    const { d } = driver();
    let created = 0;
    const orig = d.createSession.bind(d);
    d.createSession = async (o) => {
      created++;
      await new Promise((r) => setTimeout(r, 5));
      return orig(o);
    };
    const cards = new AgentStore(null, () => true);
    const c = cards.create({ name: 'Dupla' });
    const svc = new CardService({ cards, driver: d, runs: new RunManager({ driver: d, retryMs: 1 }) });
    await Promise.allSettled([svc.background(c.id, 'a'), svc.background(c.id, 'b')]);
    expect(created).toBe(1);
    expect(cards.get(c.id)!.sessions).toHaveLength(1);
  });
});
