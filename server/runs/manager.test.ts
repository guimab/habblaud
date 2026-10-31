import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentDriver, ChatEvent, RunEvent, RunStatus } from '../drivers/contract';
import { RunManager } from './manager';

// Driver falso: cada run tem uma fila de eventos controlada pelo teste.
class FakeRuns {
  n = 0;
  queues = new Map<string, { events: RunEvent[]; waiters: (() => void)[]; closed: boolean }>();
  status = new Map<string, RunStatus>();
  calls: string[] = [];
  starts: { session: string; text: string; system?: string }[] = [];
  /** Quantas vezes o próximo runEvents deve cair antes de entregar (simula conexão perdida). */
  drops = 0;

  q(id: string) {
    let q = this.queues.get(id);
    if (!q) this.queues.set(id, (q = { events: [], waiters: [], closed: false }));
    return q;
  }
  push(id: string, ...es: RunEvent[]) {
    const q = this.q(id);
    q.events.push(...es);
    q.waiters.splice(0).forEach((w) => w());
  }

  driver(): AgentDriver {
    const self = this;
    return {
      id: 'fake',
      capabilities: async () => new Set(['chat', 'approve', 'steer', 'stop'] as const),
      createSession: async () => ({ id: 's', title: '', model: '', lastActive: 0, preview: '' }),
      chat: () => (async function* () {})(),
      archive: async () => {},
      async startRun(session: string, text: string, opts?: { system?: string }) {
        self.starts.push({ session, text, ...(opts?.system ? { system: opts.system } : {}) });
        const id = `run_${++self.n}`;
        self.status.set(id, { state: 'running' });
        return id;
      },
      async *runEvents(id: string, after: number, signal: AbortSignal) {
        self.calls.push(`events ${id} ${after}`);
        if (self.drops > 0) {
          self.drops--;
          throw new Error('conexão caiu');
        }
        if (!self.status.has(id)) throw Object.assign(new Error('sumiu'), { gone: true });
        const q = self.q(id);
        let i = q.events.findIndex((e) => (e.seq ?? -1) > after);
        if (i < 0) i = q.events.length;
        for (;;) {
          while (i < q.events.length) {
            const e = q.events[i++]!;
            yield e;
            if (e.type === 'done') return;
          }
          if (signal.aborted) return;
          await new Promise<void>((r) => q.waiters.push(r));
        }
      },
      async runStatus(id: string) {
        return self.status.get(id) ?? { state: 'gone' };
      },
      async approve(id: string, choice: string) {
        self.calls.push(`approve ${id} ${choice}`);
      },
      async steer(id: string, text: string) {
        self.calls.push(`steer ${id} ${text}`);
      },
      async stop(id: string) {
        self.calls.push(`stop ${id}`);
      },
    };
  }
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const owner = { kind: 'card' as const, id: 'c1', sessionId: 's1', title: 'Revisora' };

async function take(it: AsyncIterable<ChatEvent>, n = Infinity): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of it) {
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}

describe('RunManager', () => {
  it('consome o run sem ninguém assistindo; quem chega depois recebe o histórico', async () => {
    const f = new FakeRuns();
    const m = new RunManager({ driver: f.driver(), retryMs: 1 });
    const id = await m.start(owner, 'oi', { system: 'sys' });
    expect(f.starts).toEqual([{ session: 's1', text: 'oi', system: 'sys' }]);
    f.push(id, { type: 'delta', text: 'Olá ', seq: 0 }, { type: 'tool', tool: 'terminal', seq: 1 }, { type: 'delta', text: 'mundo', seq: 2 }, { type: 'done', seq: 3 });
    await tick();
    expect(m.get(id)).toMatchObject({ state: 'done', text: 'Olá mundo', lastSeq: 3, owner });
    expect(await take(m.subscribe(id, new AbortController().signal))).toEqual([
      { type: 'delta', text: 'Olá ' },
      { type: 'tool', tool: 'terminal' },
      { type: 'delta', text: 'mundo' },
      { type: 'done' },
    ]);
  });

  it('assinante recebe o que já houve e o que vier; desassinar não para o run', async () => {
    const f = new FakeRuns();
    const m = new RunManager({ driver: f.driver(), retryMs: 1 });
    const id = await m.start(owner, 'oi');
    f.push(id, { type: 'delta', text: 'a', seq: 0 });
    await tick();
    const ctrl = new AbortController();
    const got: ChatEvent[] = [];
    const p = (async () => {
      for await (const e of m.subscribe(id, ctrl.signal)) got.push(e);
    })();
    await tick();
    f.push(id, { type: 'delta', text: 'b', seq: 1 });
    await tick();
    ctrl.abort();
    await p;
    expect(got).toEqual([{ type: 'delta', text: 'a' }, { type: 'delta', text: 'b' }]);
    f.push(id, { type: 'delta', text: 'c', seq: 2 }, { type: 'done', seq: 3 });
    await tick();
    expect(m.get(id)).toMatchObject({ state: 'done', text: 'abc' });
  });

  it('aprovação: estado waiting com o pedido; resposta volta a running; erro vira estado error', async () => {
    const f = new FakeRuns();
    const changes: string[] = [];
    const m = new RunManager({ driver: f.driver(), retryMs: 1 });
    m.onChange((r) => changes.push(`${r.runId}:${r.state}`));
    const id = await m.start(owner, 'apague');
    f.push(id, { type: 'approval', approval: { command: 'rm x', choices: ['once', 'deny'] }, seq: 0 });
    await tick();
    expect(m.get(id)).toMatchObject({ state: 'waiting', approval: { command: 'rm x', choices: ['once', 'deny'] } });
    await m.approve(id, 'once');
    expect(f.calls).toContain(`approve ${id} once`);
    f.push(id, { type: 'approved', seq: 1 }, { type: 'error', message: 'falhou', seq: 2 }, { type: 'done', seq: 2 });
    await tick();
    expect(m.get(id)).toMatchObject({ state: 'error', error: 'falhou' });
    expect(m.get(id)!.approval).toBeUndefined();
    expect(changes).toEqual([`${id}:running`, `${id}:waiting`, `${id}:running`, `${id}:error`]);
  });

  it('aprovar sem pedido pendente ou escolha fora da lista é recusado', async () => {
    const f = new FakeRuns();
    const m = new RunManager({ driver: f.driver(), retryMs: 1 });
    const id = await m.start(owner, 'x');
    await expect(m.approve(id, 'once')).rejects.toThrow(/aprovação/);
    f.push(id, { type: 'approval', approval: { command: 'rm x', choices: ['once', 'deny'] }, seq: 0 });
    await tick();
    await expect(m.approve(id, 'always')).rejects.toThrow(/escolha/);
    await expect(m.approve('run_x', 'once')).rejects.toThrow(/desconhecido/);
  });

  it('steer e stop vão para o driver; stop de run terminado é recusado', async () => {
    const f = new FakeRuns();
    const m = new RunManager({ driver: f.driver(), retryMs: 1 });
    const id = await m.start(owner, 'x');
    await m.steer(id, 'foco no teste');
    await m.stop(id);
    expect(f.calls.filter((c) => !c.startsWith('events'))).toEqual([`steer ${id} foco no teste`, `stop ${id}`]);
    f.push(id, { type: 'done', seq: 0 });
    await tick();
    await expect(m.stop(id)).rejects.toThrow(/terminou/);
  });

  it('uma sessão só tem um run ativo por vez', async () => {
    const f = new FakeRuns();
    const m = new RunManager({ driver: f.driver(), retryMs: 1 });
    const id = await m.start(owner, 'x');
    await expect(m.start(owner, 'y')).rejects.toThrow(/ocupad/);
    expect(m.active('s1')?.runId).toBe(id);
    f.push(id, { type: 'done', seq: 0 });
    await tick();
    expect(m.active('s1')).toBeUndefined();
    await m.start(owner, 'y');
  });

  it('conexão perdida: reconecta do último seq', async () => {
    const f = new FakeRuns();
    const m = new RunManager({ driver: f.driver(), retryMs: 1 });
    const id = await m.start(owner, 'x');
    f.push(id, { type: 'delta', text: 'a', seq: 0 });
    await tick();
    f.drops = 2;
    // derruba a assinatura atual: o próximo runEvents falha duas vezes e depois volta
    f.queues.get(id)!.events.push({ type: 'delta', text: 'b', seq: 1 });
    m['reconnect'](id);
    await tick();
    await tick();
    f.push(id, { type: 'done', seq: 2 });
    await tick();
    expect(m.get(id)).toMatchObject({ state: 'done', text: 'ab' });
    expect(f.calls.filter((c) => c.startsWith('events')).slice(-1)[0]).toBe(`events ${id} 0`);
  });

  it('run que sumiu do framework vira interrompido', async () => {
    const f = new FakeRuns();
    const m = new RunManager({ driver: f.driver(), retryMs: 1 });
    const id = await m.start(owner, 'x');
    f.status.delete(id);
    m['reconnect'](id);
    await tick();
    expect(m.get(id)).toMatchObject({ state: 'interrupted' });
  });

  it('persiste em arquivo (0600) e retoma os ativos ao reiniciar', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runs-'));
    const file = join(dir, 'runs.json');
    const f = new FakeRuns();
    const m1 = new RunManager({ driver: f.driver(), file, retryMs: 1 });
    const id = await m1.start(owner, 'x');
    f.push(id, { type: 'delta', text: 'meio ', seq: 0 });
    await tick();
    m1.close();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const m2 = new RunManager({ driver: f.driver(), file, retryMs: 1 });
    m2.resume();
    await tick();
    expect(f.calls.slice(-1)[0]).toBe(`events ${id} 0`);
    f.push(id, { type: 'delta', text: 'fim', seq: 1 }, { type: 'done', seq: 2 });
    await tick();
    expect(m2.get(id)).toMatchObject({ state: 'done', text: 'meio fim' });
    expect(await take(m2.subscribe(id, new AbortController().signal))).toEqual([{ type: 'delta', text: 'meio ' }, { type: 'delta', text: 'fim' }, { type: 'done' }]);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.runs[0]).toMatchObject({ runId: id, state: 'done', text: 'meio fim' });
  });

  it('arquivo inválido é ignorado; mantém só os 200 mais recentes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runs-'));
    const file = join(dir, 'runs.json');
    writeFileSync(file, '{lixo');
    const f = new FakeRuns();
    const m = new RunManager({ driver: f.driver(), file, retryMs: 1 });
    expect(m.list()).toEqual([]);
    for (let i = 0; i < 205; i++) {
      const id = await m.start({ ...owner, sessionId: `s${i}` }, 'x');
      f.push(id, { type: 'done', seq: 0 });
    }
    await tick();
    expect(m.list()).toHaveLength(200);
  });
});
