import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Scheduler, type SchedulerOptions } from './scheduler';

const H = 3_600_000;
const T0 = new Date(2026, 10, 2, 8, 0).getTime(); // segunda, 08:00 local

function make(over: Partial<SchedulerOptions> = {}) {
  let now = T0;
  const start = vi.fn(async (_card: string, _text: string, _sched: string) => `run-${start.mock.calls.length}`);
  const cards = new Set(['c1', 'c2']);
  const s = new Scheduler({ now: () => now, start, cardExists: (id) => cards.has(id), tickMs: 0, ...over });
  return { s, start, cards, set: (t: number) => (now = t), get now() { return now; } };
}

describe('Scheduler', () => {
  it('cria com próxima execução e dispara na hora', async () => {
    const t = make();
    const a = t.s.create({ cardId: 'c1', text: 'bom dia', rule: { kind: 'weekly', days: [1], time: '09:00' } });
    expect(a.next).toBe(T0 + H);
    await t.s.tick();
    expect(t.start).not.toHaveBeenCalled();
    t.set(T0 + H + 1000);
    await t.s.tick();
    expect(t.start).toHaveBeenCalledWith('c1', 'bom dia', a.id);
    const b = t.s.get(a.id)!;
    expect(b.last).toMatchObject({ result: 'started', runId: 'run-1' });
    expect(b.next).toBe(T0 + H + 7 * 24 * H);
  });

  it('ficha ocupada: pula a vez e segue', async () => {
    const t = make({ start: vi.fn(async () => Promise.reject(Object.assign(new Error('agente ocupado'), { code: 'busy' }))) });
    const a = t.s.create({ cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 30 } });
    t.set(a.next!);
    await t.s.tick();
    expect(t.s.get(a.id)!.last).toMatchObject({ result: 'busy' });
    expect(t.s.get(a.id)!.next).toBe(a.next! + 30 * 60_000);
  });

  it('erro do driver fica registrado', async () => {
    const t = make({ start: vi.fn(async () => Promise.reject(new Error('Hermes fora'))) });
    const a = t.s.create({ cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 30 } });
    t.set(a.next!);
    await t.s.tick();
    expect(t.s.get(a.id)!.last).toMatchObject({ result: 'error', error: 'Hermes fora' });
  });

  it('uma vez: desliga depois de rodar', async () => {
    const t = make();
    const a = t.s.create({ cardId: 'c1', text: 'x', rule: { kind: 'once', at: T0 + 60_000 } });
    t.set(T0 + 60_000);
    await t.s.tick();
    const b = t.s.get(a.id)!;
    expect(b.enabled).toBe(false);
    expect(b.next).toBeUndefined();
  });

  it('pausada não dispara; retomar recalcula', async () => {
    const t = make();
    const a = t.s.create({ cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 30 } });
    t.s.update(a.id, { enabled: false });
    expect(t.s.get(a.id)!.next).toBeUndefined();
    t.set(T0 + 2 * H);
    await t.s.tick();
    expect(t.start).not.toHaveBeenCalled();
    expect(t.s.update(a.id, { enabled: true }).next).toBe(T0 + 2 * H + 30 * 60_000);
  });

  it('rodar agora não muda a próxima', async () => {
    const t = make();
    const a = t.s.create({ cardId: 'c1', text: 'x', rule: { kind: 'weekly', days: [1], time: '09:00' } });
    await t.s.runNow(a.id);
    expect(t.start).toHaveBeenCalledOnce();
    expect(t.s.get(a.id)!.next).toBe(a.next);
  });

  it('valida ficha, texto e regra', () => {
    const t = make();
    expect(() => t.s.create({ cardId: 'zz', text: 'x', rule: { kind: 'every', minutes: 30 } })).toThrow();
    expect(() => t.s.create({ cardId: 'c1', text: '  ', rule: { kind: 'every', minutes: 30 } })).toThrow();
    expect(() => t.s.create({ cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 1 } })).toThrow();
  });

  it('apagar a ficha apaga as agendas dela', () => {
    const t = make();
    t.s.create({ cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 30 } });
    const b = t.s.create({ cardId: 'c2', text: 'y', rule: { kind: 'every', minutes: 30 } });
    t.cards.delete('c1');
    t.s.prune();
    expect(t.s.list().map((x) => x.id)).toEqual([b.id]);
    expect(t.s.list('c2')).toHaveLength(1);
  });

  it('grava em arquivo 0600 e, ao voltar, roda a perdida recente uma vez e marca a antiga', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sched-')), 'schedules.json');
    const t = make({ file });
    const a = t.s.create({ cardId: 'c1', text: 'recente', rule: { kind: 'every', minutes: 60 } });
    const b = t.s.create({ cardId: 'c2', text: 'antiga', rule: { kind: 'once', at: T0 + 30 * 60_000 } });
    t.s.close();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).schedules).toHaveLength(2);

    // volta 7 h depois: a de 1 h atrasou 6 h (dentro do limite), a "uma vez" atrasou 6,5 h (perdida)
    const start = vi.fn(async () => 'run-x');
    const s2 = new Scheduler({ file, now: () => T0 + 7 * H, start, cardExists: () => true, tickMs: 0 });
    await s2.tick();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('c1', 'recente', a.id);
    expect(s2.get(a.id)!.next).toBe(T0 + 8 * H);
    expect(s2.get(b.id)).toMatchObject({ enabled: false, last: { result: 'missed' } });
  });

  it('fechado não dispara; próxima corrompida no arquivo é recalculada', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sched-')), 'schedules.json');
    const t = make({ file });
    const a = t.s.create({ cardId: 'c1', text: 'x', rule: { kind: 'every', minutes: 30 } });
    t.s.close();
    t.set(a.next!);
    await t.s.tick();
    expect(t.start).not.toHaveBeenCalled();
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.schedules[0].next = 'lixo';
    writeFileSync(file, JSON.stringify(raw));
    const s2 = new Scheduler({ file, now: () => T0, start: vi.fn(async () => 'r'), cardExists: () => true, tickMs: 0 });
    expect(s2.get(a.id)!.next).toBe(T0 + 30 * 60_000);
  });
});
