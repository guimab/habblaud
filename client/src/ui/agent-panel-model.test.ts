import { describe, expect, it } from 'vitest';
import type { RunView } from '../../../shared/types';
import type { ApprovalView } from './consult-model';
import { clampPanelWidth, openAgentPanel, preferredRun } from './agent-panel-model';

function run(p: Partial<RunView> & { runId: string }): RunView {
  return { state: 'done', text: '', at: 1, owner: { kind: 'card', id: 'c1', sessionId: 's1' }, ...p };
}

describe('clampPanelWidth', () => {
  it('nunca devolve largura negativa ou não finita para geometria inválida', () => {
    expect(clampPanelWidth(560, Number.NaN, 314)).toBe(0);
    expect(clampPanelWidth(560, -1, 0)).toBe(0);
    expect(clampPanelWidth(560, 390, 500)).toBe(0);
    expect(clampPanelWidth(560, 1440, -100)).toBe(560);
    expect(clampPanelWidth(560, 1440, Number.NaN)).toBe(560);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('usa 560 px para preferência inválida %s', (width) => {
    expect(clampPanelWidth(width, 1440, 314)).toBe(560);
    expect(clampPanelWidth(width, 390, 0)).toBe(390);
  });
  it('cede para a área disponível quando painel e escritório mínimos não cabem', () => {
    expect(clampPanelWidth(560, 390, 0)).toBe(390);
    expect(clampPanelWidth(1000, 640, 0)).toBe(640);
    expect(clampPanelWidth(560, 950, 280)).toBe(560);
  });
  it('limita a largura no desktop preservando pelo menos 320 px do escritório', () => {
    expect(clampPanelWidth(560, 1440, 314)).toBe(560);
    expect(clampPanelWidth(100, 1440, 314)).toBe(400);
    expect(clampPanelWidth(1000, 1440, 314)).toBe(720);
    expect(clampPanelWidth(560, 1024, 280)).toBe(424);
  });
});

describe('openAgentPanel', () => {
  it('preserva o identificador literalmente e cria estado independente ao trocar o alvo', () => {
    const first = openAgentPanel(' card:c1 ');
    first.tab = 'history';
    first.detailsOpen = true;
    const second = openAgentPanel('card:c2');
    expect(first.target).toEqual({ kind: 'agent', agentId: ' card:c1 ' });
    expect(second).toEqual({ target: { kind: 'agent', agentId: 'card:c2' }, tab: 'work', detailsOpen: false });
    expect(second.target).not.toBe(first.target);
  });
  it('abre o agente em Trabalho, com os detalhes recolhidos', () => {
    expect(openAgentPanel('card:c1')).toEqual({
      target: { kind: 'agent', agentId: 'card:c1' },
      tab: 'work',
      detailsOpen: false,
    });
  });
});

describe('preferredRun', () => {
  it('não infere pendência pelo ponto de interrogação', () => {
    const question = run({ runId: 'question', at: 1, text: 'Precisa de ajuda?' });
    const latest = run({ runId: 'latest', at: 10, text: 'Concluído.' });
    expect(preferredRun([question, latest])).toBe(latest);
    expect(question.state).toBe('done');
  });
  it('retorna undefined quando não há run', () => {
    expect(preferredRun([])).toBeUndefined();
  });
  it('em empate mantém a ordem de origem sem alterar registros nem visto', () => {
    const first = Object.freeze({ ...run({ runId: 'first', at: 10 }), seen: false });
    const second = Object.freeze(run({ runId: 'second', at: 10 }));
    const runs = Object.freeze([first, second]);
    expect(preferredRun(runs)).toBe(first);
    expect(runs.map((r) => r.runId)).toEqual(['first', 'second']);
    expect(first.seen).toBe(false);
  });
  it('waiting sem aprovação confirmada não ganha prioridade sobre ativo mais recente', () => {
    const active = run({ runId: 'active', state: 'running', at: 10 });
    expect(preferredRun([run({ runId: 'waiting', state: 'waiting', at: 1 }), active])).toBe(active);
  });
  it('ignora aprovação antiga num run terminado', () => {
    const stale = { ...run({ runId: 'stale', state: 'done', at: 30 }), approval: { command: 'test', choices: ['deny'] } } satisfies RunView & { approval: ApprovalView };
    const active = run({ runId: 'active', state: 'running', at: 10 });
    expect(preferredRun([stale, active])).toBe(active);
  });
  it('aprovação sem escolhas não é uma decisão respondível confirmada', () => {
    const invalid = { ...run({ runId: 'invalid', state: 'waiting', at: 1 }), approval: { command: 'test', choices: [] } } satisfies RunView & { approval: ApprovalView };
    const active = run({ runId: 'active', state: 'running', at: 10 });
    expect(preferredRun([invalid, active])).toBe(active);
  });
  it('usa startedAt quando não há timestamp de atualização', () => {
    const { at: _at, ...old } = run({ runId: 'old' });
    const latest = { ...old, runId: 'latest', startedAt: 20 };
    expect(preferredRun([{ ...old, startedAt: 10 }, latest])).toBe(latest);
  });
  it('sem timestamps conhecidos não inventa recência', () => {
    const { at: _at, ...first } = run({ runId: 'first' });
    expect(preferredRun([first, { ...first, runId: 'second' }])).toBe(first);
  });
  it('escolhe a aprovação confirmada mais recente quando há várias', () => {
    const first = { ...run({ runId: 'first', state: 'waiting', at: 1 }), approval: { command: 'test', choices: ['deny'] } } satisfies RunView & { approval: ApprovalView };
    const latest = { ...first, runId: 'latest', at: 10 };
    expect(preferredRun([first, latest])).toBe(latest);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('ignora timestamp inválido %s e usa updatedAt', (at) => {
    const latest = { ...run({ runId: 'latest', at }), updatedAt: 20 };
    expect(preferredRun([run({ runId: 'old', at: 10 }), latest])).toBe(latest);
  });
  it('usa updatedAt do JSON real quando at não existe', () => {
    const { at: _oldAt, ...old } = run({ runId: 'old' });
    const { at: _newAt, ...latest } = run({ runId: 'latest' });
    const oldWire = { ...old, startedAt: 1, updatedAt: 10 };
    const latestWire = { ...latest, startedAt: 2, updatedAt: 20 };
    expect(preferredRun([oldWire, latestWire])).toBe(latestWire);
  });
  it('prefere aprovação confirmada a run ativo mais recente', () => {
    const waiting = { ...run({ runId: 'waiting', state: 'waiting', at: 1 }), approval: { command: 'test', choices: ['once', 'deny'] } } satisfies RunView & { approval: ApprovalView };
    expect(preferredRun([run({ runId: 'active', state: 'running', at: 10 }), waiting])).toBe(waiting);
  });
  it('prefere o run ativo mais recente a uma conclusão mais nova', () => {
    const active = run({ runId: 'active', state: 'running', at: 10 });
    expect(preferredRun([run({ runId: 'done', at: 30 }), active, run({ runId: 'old-active', state: 'running', at: 5 })])).toBe(active);
  });
  it('seleciona o run mais recente entre os terminados', () => {
    const oldest = run({ runId: 'old', at: 1 });
    const latest = run({ runId: 'latest', at: 3 });
    expect(preferredRun([oldest, latest, run({ runId: 'middle', at: 2 })])).toBe(latest);
  });
});
