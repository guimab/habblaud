import { describe, expect, it } from 'vitest';
import type { AgentInfo, RunView } from '../../../shared/types';
import { linkedRunAgent, panelRun } from './agent-panel-routing-model';
import { preferredRun } from './agent-panel-model';

function run(p: Partial<RunView> = {}): RunView {
  return { runId: 'r1', state: 'done', text: '', at: 1, owner: { kind: 'card', id: 'c1', sessionId: 's1' }, ...p };
}

function agent(p: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1', kind: 'main', roomId: 'room1', name: 'Marina', look: 'f', role: 'Agente principal',
    sessionId: 's1', account: 'hermes', status: 'working', recent: [], tasks: [], startedAt: 0,
    lastEventAt: 0, statusSince: 0, stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1, ...p,
  };
}

describe('normalized run keeps structured approval priority', () => {
  it('preserves a real approval before selecting the preferred run', () => {
    const waiting = panelRun({ ...run(), state: 'waiting', updatedAt: 1, approval: { command: 'command fixture', choices: ['once', 'deny'] } });
    const active = panelRun({ ...run({ runId: 'r-active', state: 'running', at: 99 }) });
    expect(preferredRun([waiting!, active!])?.runId).toBe('r1');
  });
});

describe('linkedRunAgent', () => {
  it('usa driverSession como identidade canônica do executor', () => {
    const a = agent({ sessionId: 'espelho-local', driverSession: 's1' });
    expect(linkedRunAgent(run(), [a])).toBe(a);
  });

  it('não associa o ID do espelho quando driverSession aponta para outra sessão', () => {
    const a = agent({ sessionId: 's1', driverSession: 'driver-diferente' });
    expect(linkedRunAgent(run(), [a])).toBeUndefined();
  });

  it('recusa ambiguidade entre driverSession e sessão nativa de outro agente', () => {
    const a = agent({ id: 'a-driver', sessionId: 'espelho', driverSession: 's1' });
    const b = agent({ id: 'a-native', sessionId: 's1' });
    expect(linkedRunAgent(run(), [a, b])).toBeUndefined();
  });

  it('associa pela ficha literal explícita', () => {
    const a = agent({ cardId: 'c1', sessionId: 'outra-sessão' });
    expect(linkedRunAgent(run(), [a])).toBe(a);
  });

  it('não vincula sem ficha ou sessão coincidente', () => {
    expect(linkedRunAgent(run(), [agent({ cardId: 'c2', sessionId: 's2' })])).toBeUndefined();
    expect(linkedRunAgent(run(), [])).toBeUndefined();
  });

  it('não confunde ID de consultor com cardId', () => {
    const r = run({ owner: { kind: 'consult', id: 'c1', sessionId: 's9' } });
    expect(linkedRunAgent(r, [agent({ cardId: 'c1' })])).toBeUndefined();
  });

  it.each(['card', 'consult'] as const)('associa dono %s pela sessão literal única', (kind) => {
    const a = agent();
    expect(linkedRunAgent(run({ owner: { kind, id: 'outro-dono', sessionId: 's1' } }), [a])).toBe(a);
  });

  it('prioriza ficha explícita sobre sessão de outro agente independentemente da ordem', () => {
    const byCard = agent({ id: 'a-card', cardId: 'c1', sessionId: 's2' });
    const bySession = agent({ id: 'a-session', sessionId: 's1' });
    expect(linkedRunAgent(run(), [bySession, byCard])).toBe(byCard);
    expect(linkedRunAgent(run(), [byCard, bySession])).toBe(byCard);
  });

  it('não usa sessão para desempatar duas fichas coincidentes', () => {
    const a = agent({ cardId: 'c1' });
    const b = agent({ id: 'a2', cardId: 'c1', sessionId: 's2' });
    expect(linkedRunAgent(run(), [a, b])).toBeUndefined();
    expect(linkedRunAgent(run(), [b, a])).toBeUndefined();
  });

  it('recusa sessão ambígua entre dois agentes inclusive subagente', () => {
    const a = agent();
    const b = agent({ id: 'sub1', kind: 'sub', parentId: 'a1' });
    expect(linkedRunAgent(run(), [a, b])).toBeUndefined();
    expect(linkedRunAgent(run(), [b, a])).toBeUndefined();
  });

  it('ficha única vence sessão ambígua', () => {
    const byCard = agent({ id: 'a-card', cardId: 'c1', sessionId: 's2' });
    expect(linkedRunAgent(run(), [agent(), agent({ id: 'a2' }), byCard])).toBe(byCard);
  });

  it('não deriva ficha do prefixo card: nem de nome, título, ID de agente ou driverSession', () => {
    for (const a of [
      agent({ id: 'card:c1', sessionId: '' }),
      agent({ id: 'c1', sessionId: 's2' }),
      agent({ name: 'c1', title: 'c1', driverSession: 'c1', sessionId: 's2' }),
    ]) expect(linkedRunAgent(run(), [a])).toBeUndefined();
  });

  it('associa ficha dormindo só por cardId explícito', () => {
    const a = agent({ id: 'card:c1', cardId: 'c1', status: 'sleeping', sessionId: '' });
    expect(linkedRunAgent(run(), [a])).toBe(a);
  });

  it('não normaliza ficha ou sessão para fazer coincidirem', () => {
    expect(linkedRunAgent(run(), [agent({ cardId: ' c1 ', sessionId: ' s1 ' })])).toBeUndefined();
    const a = agent({ cardId: ' c1 ', sessionId: ' s1 ' });
    const r = run({ owner: { kind: 'card', id: ' c1 ', sessionId: ' s1 ' } });
    expect(linkedRunAgent(r, [a])).toBe(a);
    expect(linkedRunAgent(run({ owner: { kind: 'consult', id: 'c1', sessionId: ' s1 ' } }), [a])).toBe(a);
  });

  it.each(['', ' \n\t '])('não confia em IDs vazios: %j', (id) => {
    const r = run({ owner: { kind: 'card', id, sessionId: id } });
    expect(linkedRunAgent(r, [agent({ cardId: id, sessionId: id })])).toBeUndefined();
  });

  it('preserva objetos e coleção readonly sem reordenar', () => {
    const r = Object.freeze(run());
    const a = Object.freeze(agent({ cardId: 'c1' }));
    const b = Object.freeze(agent({ id: 'a2', sessionId: 's2' }));
    const agents = Object.freeze([b, a]);
    expect(linkedRunAgent(r, agents)).toBe(a);
    expect(agents).toEqual([b, a]);
  });
});

describe('panelRun timestamps', () => {
  it.each([
    [{ at: 7, updatedAt: 9, startedAt: 11 }, 7],
    [{ at: 0, updatedAt: 9, startedAt: 11 }, 0],
    [{ at: -7, updatedAt: 9, startedAt: 11 }, -7],
    [{ at: undefined, updatedAt: 9, startedAt: 11 }, 9],
    [{ at: NaN, updatedAt: 9, startedAt: 11 }, 9],
    [{ at: Infinity, updatedAt: -Infinity, startedAt: 11 }, 11],
    [{ at: '7', updatedAt: '9', startedAt: 11 }, 11],
    [{ at: undefined, updatedAt: undefined, startedAt: 11 }, 11],
    [{ at: null, updatedAt: false, startedAt: '11' }, 0],
    [{ at: NaN, updatedAt: Infinity, startedAt: -Infinity }, 0],
    [{ at: undefined }, 0],
  ])('usa primeiro número finito em at/updatedAt/startedAt: %j → %s', (timestamps, expected) => {
    expect(panelRun({ ...run(), ...timestamps })?.at).toBe(expected);
  });
});

describe('panelRun', () => {
  it('preserva literalmente os IDs, pedido, resposta e metadados válidos', () => {
    const raw = run({
      runId: ' run:/á? ', prompt: '  pedido\n**completo**  ', text: '  resposta\n'.repeat(400), error: ' erro ',
      owner: { kind: 'card', id: ' card:/á? ', sessionId: ' session:/á? ', title: ' Título ', scheduleId: ' schedule:/á? ' },
    });
    expect(panelRun(raw)).toEqual(raw);
  });

  it.each([null, undefined, false, 1, 'run', [], {}].map((raw) => [raw]))('rejeita entrada não estruturada: %j', (raw) => {
    expect(panelRun(raw)).toBeNull();
  });

  it.each(['runId', 'id', 'sessionId'] as const)('rejeita %s que não seja ID literal não vazio', (field) => {
    for (const value of [undefined, null, 7, {}, [], '', ' \n\t ']) {
      const raw = field === 'runId' ? { ...run(), runId: value } : { ...run(), owner: { ...run().owner, [field]: value } };
      expect(panelRun(raw)).toBeNull();
    }
  });

  it.each([null, undefined, 'card', [], {}, { ...run().owner, kind: 'other' }].map((owner) => [owner]))('rejeita dono inválido: %j', (owner) => {
    expect(panelRun({ ...run(), owner })).toBeNull();
  });

  it.each([undefined, null, 1, '', 'active', 'DONE'])('rejeita estado desconhecido: %j', (state) => {
    expect(panelRun({ ...run(), state })).toBeNull();
  });

  it.each(['running', 'waiting', 'done', 'error', 'interrupted'] as const)('aceita o estado %s', (state) => {
    expect(panelRun(run({ state }))?.state).toBe(state);
  });

  it('aceita consultor sem converter o dono em ficha', () => {
    const raw = run({ owner: { kind: 'consult', id: 'c1', sessionId: 's1' } });
    expect(panelRun(raw)).toEqual(raw);
  });

  it('não fabrica pedido antigo e normaliza resposta não textual para vazio', () => {
    const parsed = panelRun({ ...run(), text: 42, prompt: false, error: {}, owner: { ...run().owner, title: 42, scheduleId: false } });
    expect(parsed).toEqual(run());
    expect(parsed).not.toHaveProperty('prompt');
  });

  it('preserva pedido, resposta e metadados textuais vazios sem mutar a entrada', () => {
    const owner = Object.freeze({ kind: 'card' as const, id: 'c1', sessionId: 's1', title: '', scheduleId: '' });
    const raw = Object.freeze(run({ prompt: '', text: '', error: '', owner }));
    expect(panelRun(raw)).toEqual(raw);
  });
});
