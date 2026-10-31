import { describe, expect, it } from 'vitest';
import type { AgentDriver, ChatEvent, DriverCapability } from '../drivers/contract';
import { ConsultService } from './service';

class FakeDriver implements AgentDriver {
  readonly id = 'fake';
  created: string[] = [];
  sent: { id: string; msg: string }[] = [];
  archived: string[] = [];
  async capabilities(): Promise<ReadonlySet<DriverCapability>> {
    return new Set(['chat', 'create']);
  }
  async createSession(o: { title: string }) {
    this.created.push(o.title);
    return { id: `s${this.created.length}`, title: o.title };
  }
  async *chat(id: string, msg: string): AsyncIterable<ChatEvent> {
    this.sent.push({ id, msg });
    yield { type: 'delta', text: 'ok' };
    yield { type: 'done' };
  }
  async archive(id: string) {
    this.archived.push(id);
  }
}

async function drain(it: AsyncIterable<ChatEvent>) {
  const out: ChatEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const sig = () => new AbortController().signal;

describe('ConsultService', () => {
  it('cria sessão com título Consultor · HH:MM', async () => {
    const d = new FakeDriver();
    const at = new Date(2026, 9, 30, 14, 5).getTime();
    const c = await new ConsultService({ driver: d, now: () => at }).start({});
    expect(d.created).toEqual(['Consultor · 14:05']);
    expect(c).toMatchObject({ sessionId: 's1', title: 'Consultor · 14:05', archived: false, createdAt: at });
  });

  it('primeira mensagem leva contexto e tela; as seguintes não', async () => {
    const d = new FakeDriver();
    const svc = new ConsultService({ driver: d });
    const c = await svc.start({ context: 'sou do time de infra', screen: 'agente X na sala Y' });
    expect(await drain(svc.send(c.id, 'pergunta 1', sig()))).toEqual([{ type: 'delta', text: 'ok' }, { type: 'done' }]);
    await drain(svc.send(c.id, 'pergunta 2', sig()));
    expect(d.sent.map((s) => s.msg)).toEqual(['Contexto: sou do time de infra\n\nTela: agente X na sala Y\n\npergunta 1', 'pergunta 2']);
  });

  it('sem contexto, só a pergunta; contexto em branco é ignorado', async () => {
    const d = new FakeDriver();
    const svc = new ConsultService({ driver: d });
    const c = await svc.start({ context: '   ' });
    await drain(svc.send(c.id, 'oi', sig()));
    expect(d.sent[0]!.msg).toBe('oi');
  });

  it('sweep arquiva só as ociosas, uma vez', async () => {
    const d = new FakeDriver();
    let now = 0;
    const svc = new ConsultService({ driver: d, now: () => now, idleMs: 1000 });
    const a = await svc.start({});
    now = 800;
    const b = await svc.start({});
    now = 1500;
    expect(await svc.sweep()).toBe(1);
    expect(await svc.sweep()).toBe(0);
    expect(d.archived).toEqual([a.sessionId]);
    expect(svc.list().find((c) => c.id === b.id)?.archived).toBe(false);
  });

  it('usar a consulta adia o arquivamento', async () => {
    const d = new FakeDriver();
    let now = 0;
    const svc = new ConsultService({ driver: d, now: () => now, idleMs: 1000 });
    const c = await svc.start({});
    now = 900;
    await drain(svc.send(c.id, 'x', sig()));
    now = 1500;
    expect(await svc.sweep()).toBe(0);
  });

  it('arquivada ou desconhecida dá erro', async () => {
    const svc = new ConsultService({ driver: new FakeDriver() });
    const c = await svc.start({});
    await svc.archive(c.id);
    await expect(drain(svc.send(c.id, 'x', sig()))).rejects.toThrow('consulta arquivada');
    await expect(drain(svc.send('nada', 'x', sig()))).rejects.toThrow('consulta desconhecida');
    await expect(svc.archive('nada')).rejects.toThrow('consulta desconhecida');
  });
});
