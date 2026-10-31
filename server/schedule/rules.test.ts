import { describe, expect, it } from 'vitest';
import { MIN_EVERY_MIN, nextRun, validateRule, type ScheduleRule } from './rules';

// Horários locais (o processo de teste roda com o TZ do sistema; as contas usam a hora local, como o servidor).
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('nextRun', () => {
  it('uma vez: a data, se ainda não passou; senão nada', () => {
    const r: ScheduleRule = { kind: 'once', at: at(2026, 11, 2, 9) };
    expect(nextRun(r, at(2026, 11, 1))).toBe(at(2026, 11, 2, 9));
    expect(nextRun(r, at(2026, 11, 2, 9))).toBeUndefined();
  });

  it('a cada N minutos: a partir da última, ou de agora', () => {
    const r: ScheduleRule = { kind: 'every', minutes: 120 };
    expect(nextRun(r, at(2026, 11, 1, 10), at(2026, 11, 1, 9))).toBe(at(2026, 11, 1, 11));
    expect(nextRun(r, at(2026, 11, 1, 10))).toBe(at(2026, 11, 1, 12));
    // última muito antiga: não acumula, próxima depois de agora
    expect(nextRun(r, at(2026, 11, 1, 10), at(2026, 11, 1, 1))).toBe(at(2026, 11, 1, 11));
  });

  it('dias da semana: hoje mais tarde, ou o próximo dia escolhido', () => {
    // 2026-10-30 é sexta (5); 2026-11-02 é segunda (1)
    const r: ScheduleRule = { kind: 'weekly', days: [1, 5], time: '09:00' };
    expect(nextRun(r, at(2026, 10, 30, 8))).toBe(at(2026, 10, 30, 9));
    expect(nextRun(r, at(2026, 10, 30, 9))).toBe(at(2026, 11, 2, 9));
    expect(nextRun({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '23:30' }, at(2026, 12, 31, 23, 45))).toBe(at(2027, 1, 1, 23, 30));
  });

  it('dias da semana sem dia: nunca', () => {
    expect(nextRun({ kind: 'weekly', days: [], time: '09:00' }, at(2026, 11, 1))).toBeUndefined();
  });
});

describe('validateRule', () => {
  it('aceita as três formas', () => {
    expect(validateRule({ kind: 'once', at: 1 })).toEqual({ kind: 'once', at: 1 });
    expect(validateRule({ kind: 'every', minutes: 30 })).toEqual({ kind: 'every', minutes: 30 });
    expect(validateRule({ kind: 'weekly', days: [5, 1, 1], time: '9:05' })).toEqual({ kind: 'weekly', days: [1, 5], time: '09:05' });
  });

  it('recusa o resto', () => {
    expect(() => validateRule({ kind: 'every', minutes: MIN_EVERY_MIN - 1 })).toThrow();
    expect(() => validateRule({ kind: 'weekly', days: [7], time: '09:00' })).toThrow();
    expect(() => validateRule({ kind: 'weekly', days: [1], time: '24:00' })).toThrow();
    expect(() => validateRule({ kind: 'weekly', days: [], time: '09:00' })).toThrow();
    expect(() => validateRule({ kind: 'once', at: 'x' })).toThrow();
    expect(() => validateRule({ kind: 'cron' })).toThrow();
    expect(() => validateRule(null)).toThrow();
  });
});
