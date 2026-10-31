import { describe, expect, it } from 'vitest';
import { runPrompt, runReply, runsOfAgent, runStateLabel, type RunView } from './runs-model';

function run(p: Partial<RunView> & { runId: string }): RunView {
  return { state: 'done', text: '', at: 1, owner: { kind: 'card', id: 'c1', sessionId: 's1' }, ...p };
}

describe('runsOfAgent', () => {
  const runs: RunView[] = [
    run({ runId: 'r1', at: 10, prompt: 'revise o README', text: 'Feito' }),
    run({ runId: 'r2', at: 30, prompt: 'e os testes?', text: 'Rodando', state: 'running' }),
    run({ runId: 'r3', at: 20, prompt: 'outro agente', text: 'oi', owner: { kind: 'consult', id: 'k9', sessionId: 's9' } }),
  ];

  it('traz só os turnos do agente, do mais recente ao mais antigo', () => {
    expect(runsOfAgent(runs, { id: 'x', sessionId: 's1' }).map((r) => r.runId)).toEqual(['r2', 'r1']);
  });

  it('casa pela ficha quando o agente não tem sessão viva (dorminhoco)', () => {
    expect(runsOfAgent(runs, { id: 'card:c1' }).map((r) => r.runId)).toEqual(['r2', 'r1']);
    expect(runsOfAgent(runs, { id: 'card:c2' })).toEqual([]);
  });

  it('respeita o limite', () => {
    expect(runsOfAgent(runs, { id: 'x', sessionId: 's1' }, 1).map((r) => r.runId)).toEqual(['r2']);
  });
});

describe('runPrompt e runReply', () => {
  it('corta o pedido e a resposta sem quebrar em pedaços muito longos', () => {
    const longo = run({ runId: 'r1', prompt: 'p'.repeat(400), text: 't'.repeat(400) });
    expect(runPrompt(longo)).toHaveLength(161);
    expect(runReply(longo)).toHaveLength(281);
    expect(runPrompt(longo).endsWith('…')).toBe(true);
  });

  it('registro antigo sem pedido fica sem pedido (não inventa)', () => {
    expect(runPrompt(run({ runId: 'r1' }))).toBe('');
  });

  it('no erro, o que aparece é o motivo', () => {
    expect(runReply(run({ runId: 'r1', state: 'error', error: 'quebrou', text: 'parcial' }))).toBe('quebrou');
  });
});

describe('runStateLabel', () => {
  it('rotula os estados', () => {
    expect(['running', 'waiting', 'done', 'error', 'interrupted'].map((s) => runStateLabel(s as RunView['state']))).toEqual([
      'Rodando',
      'Esperando você',
      'Concluído',
      'Erro',
      'Interrompido',
    ]);
  });
});
