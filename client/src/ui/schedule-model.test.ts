import { describe, expect, it } from 'vitest';
import { lastLabel, ruleFromForm, ruleLabel, statusLabel } from './schedule-model';

const at = new Date(2026, 9, 31, 14, 5).getTime();
const base = { at: '', every: 0, unit: 'min' as const, days: [], time: '' };

describe('schedule-model', () => {
  it('rótulos das regras', () => {
    expect(ruleLabel({ kind: 'once', at })).toBe('uma vez, 31/10 14:05');
    expect(ruleLabel({ kind: 'every', minutes: 30 })).toBe('a cada 30 min');
    expect(ruleLabel({ kind: 'every', minutes: 60 })).toBe('a cada hora');
    expect(ruleLabel({ kind: 'every', minutes: 180 })).toBe('a cada 3 h');
    expect(ruleLabel({ kind: 'every', minutes: 1440 })).toBe('todo dia');
    expect(ruleLabel({ kind: 'every', minutes: 2880 })).toBe('a cada 2 dias');
    expect(ruleLabel({ kind: 'weekly', days: [5, 1, 2, 3, 4], time: '09:00' })).toBe('dias úteis 09:00');
    expect(ruleLabel({ kind: 'weekly', days: [0, 6], time: '10:30' })).toBe('dom, sáb 10:30');
    expect(ruleLabel({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '08:00' })).toBe('todo dia 08:00');
  });

  it('última vez e estado', () => {
    expect(lastLabel(undefined)).toBe('');
    expect(lastLabel({ at, result: 'started' })).toBe('rodou 31/10 14:05');
    expect(lastLabel({ at, result: 'busy' })).toContain('ocupado');
    expect(lastLabel({ at, result: 'error', error: 'x' })).toBe('erro 31/10 14:05: x');
    const s = { id: 's', cardId: 'c', text: 't', createdAt: 0 };
    expect(statusLabel({ ...s, rule: { kind: 'every', minutes: 5 }, enabled: true, next: at })).toBe('próxima: 31/10 14:05');
    expect(statusLabel({ ...s, rule: { kind: 'every', minutes: 5 }, enabled: false })).toBe('pausada');
    expect(statusLabel({ ...s, rule: { kind: 'once', at }, enabled: false, last: { at, result: 'started' } })).toBe('concluída');
  });

  it('formulário → regra', () => {
    expect(ruleFromForm({ ...base, kind: 'once', at: '2026-10-31T14:05' })).toEqual({ kind: 'once', at });
    expect(() => ruleFromForm({ ...base, kind: 'once' })).toThrow();
    expect(ruleFromForm({ ...base, kind: 'every', every: 2, unit: 'h' })).toEqual({ kind: 'every', minutes: 120 });
    expect(ruleFromForm({ ...base, kind: 'every', every: 1, unit: 'd' })).toEqual({ kind: 'every', minutes: 1440 });
    expect(ruleFromForm({ ...base, kind: 'weekly', days: [3, 1], time: '09:00' })).toEqual({ kind: 'weekly', days: [1, 3], time: '09:00' });
  });
});
