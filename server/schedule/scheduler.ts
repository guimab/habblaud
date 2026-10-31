// Agendas das fichas (entrega 5): na hora marcada, manda a mensagem para a ficha, que roda em segundo plano (run);
// a resposta cai na Inbox. Genérico: quem dispara é `start` (a ficha decide o driver). Ficha ocupada = vez pulada.
// Habblaud desligado na hora: ao voltar, roda uma vez se o atraso for de até 6 h; mais que isso, marca "perdida".
// Grava em <dataDir>/schedules.json (0600).
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';
import { nextRun, validateRule, type ScheduleRule } from './rules';

export type ScheduleResult = 'started' | 'busy' | 'error' | 'missed';

export interface Schedule {
  id: string;
  cardId: string;
  text: string;
  rule: ScheduleRule;
  enabled: boolean;
  createdAt: number;
  /** Próxima execução (sem: pausada ou terminada). */
  next?: number;
  last?: { at: number; result: ScheduleResult; runId?: string; error?: string };
}

export interface ScheduleInput {
  cardId?: string;
  text?: string;
  rule?: unknown;
  enabled?: boolean;
}

export class ScheduleError extends Error {
  constructor(
    readonly code: 'unknown' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

export interface SchedulerOptions {
  /** Manda a mensagem para a ficha em segundo plano; devolve o runId. Erro com code 'busy' = ficha ocupada. */
  start: (cardId: string, text: string, scheduleId: string) => Promise<string>;
  cardExists: (cardId: string) => boolean;
  file?: string;
  now?: () => number;
  /** Relógio (0 = sem relógio; os testes chamam tick()). */
  tickMs?: number;
  /** Atraso máximo para rodar uma vez perdida (padrão 6 h). */
  graceMs?: number;
}

const MAX_TEXT = 8000;

export class Scheduler {
  private items: Schedule[] = [];
  private readonly now: () => number;
  private readonly grace: number;
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private recovered = false;
  private closed = false;

  constructor(private readonly opts: SchedulerOptions) {
    this.now = opts.now ?? Date.now;
    this.grace = opts.graceMs ?? 6 * 3_600_000;
    this.load();
    const ms = opts.tickMs ?? 30_000;
    if (ms > 0) {
      this.timer = setInterval(() => void this.tick(), ms);
      this.timer.unref();
      void this.tick();
    }
  }

  list(cardId?: string): Schedule[] {
    return this.items.filter((s) => !cardId || s.cardId === cardId).map((s) => structuredClone(s));
  }

  get(id: string): Schedule | undefined {
    const s = this.items.find((x) => x.id === id);
    return s && structuredClone(s);
  }

  create(input: ScheduleInput): Schedule {
    if (!input.cardId || !this.opts.cardExists(input.cardId)) throw new ScheduleError('invalid', tr('agente desconhecido'));
    const s: Schedule = { id: `s_${randomBytes(5).toString('hex')}`, cardId: input.cardId, text: this.text(input.text), rule: this.rule(input.rule), enabled: input.enabled ?? true, createdAt: this.now() };
    this.plan(s);
    this.items.push(s);
    this.save();
    return structuredClone(s);
  }

  update(id: string, input: ScheduleInput): Schedule {
    const s = this.find(id);
    const ruleChanged = input.rule !== undefined;
    if (input.text !== undefined) s.text = this.text(input.text);
    if (ruleChanged) s.rule = this.rule(input.rule);
    const wasOn = s.enabled;
    if (input.enabled !== undefined) s.enabled = input.enabled;
    if (ruleChanged || s.enabled !== wasOn) this.plan(s);
    this.save();
    return structuredClone(s);
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  /** Tira as agendas de fichas que não existem mais. */
  prune(): void {
    const before = this.items.length;
    this.items = this.items.filter((s) => this.opts.cardExists(s.cardId));
    if (this.items.length !== before) this.save();
  }

  /** Roda já, sem mexer na próxima execução. */
  async runNow(id: string): Promise<Schedule> {
    const s = this.find(id);
    await this.fire(s);
    this.save();
    return structuredClone(s);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      const recovering = !this.recovered;
      this.recovered = true;
      let changed = false;
      for (const s of [...this.items]) {
        if (!s.enabled || s.next === undefined || s.next > now) continue;
        changed = true;
        const due = s.next;
        // Só ao voltar (atraso de quem ficou desligado): muito atrasada = perdida, sem rodar.
        if (recovering && now - due > this.grace) s.last = { at: now, result: 'missed' };
        else await this.fire(s);
        this.advance(s, due, now);
      }
      if (changed) this.save();
    } finally {
      this.ticking = false;
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.save();
  }

  // ------------------------------------------------------------------ interno

  private async fire(s: Schedule): Promise<void> {
    if (this.closed) return;
    const at = this.now();
    try {
      const runId = await this.opts.start(s.cardId, s.text, s.id);
      s.last = { at, result: 'started', runId };
    } catch (err) {
      const busy = (err as { code?: string }).code === 'busy';
      s.last = busy ? { at, result: 'busy' } : { at, result: 'error', error: errMsg(err) };
    }
  }

  /** Depois de uma vez (rodada, pulada ou perdida): calcula a próxima, ou desliga ("uma vez"). */
  private advance(s: Schedule, due: number, now: number): void {
    const n = nextRun(s.rule, now, s.rule.kind === 'every' ? due : undefined);
    if (n === undefined) {
      delete s.next;
      if (s.rule.kind === 'once') s.enabled = false;
    } else s.next = n;
  }

  private plan(s: Schedule): void {
    const n = s.enabled ? nextRun(s.rule, this.now()) : undefined;
    if (n === undefined) delete s.next;
    else s.next = n;
  }

  private find(id: string): Schedule {
    const s = this.items.find((x) => x.id === id);
    if (!s) throw new ScheduleError('unknown', tr('agenda desconhecida'));
    return s;
  }

  private text(v: unknown): string {
    const t = typeof v === 'string' ? v.trim() : '';
    if (!t) throw new ScheduleError('invalid', tr('escreva a mensagem da agenda'));
    if (t.length > MAX_TEXT) throw new ScheduleError('invalid', tr('mensagem longa demais (máx. {0} caracteres)', [MAX_TEXT]));
    return t;
  }

  private rule(v: unknown): ScheduleRule {
    try {
      return validateRule(v);
    } catch (err) {
      throw new ScheduleError('invalid', errMsg(err));
    }
  }

  private load(): void {
    if (!this.opts.file) return;
    let raw: string;
    try {
      raw = readFileSync(this.opts.file, 'utf8');
    } catch {
      return;
    }
    try {
      const d = JSON.parse(raw) as { schedules?: unknown };
      for (const x of Array.isArray(d.schedules) ? d.schedules : []) {
        const s = x as Schedule;
        try {
          if (typeof s.id !== 'string' || typeof s.cardId !== 'string' || typeof s.text !== 'string') throw new Error('campos');
          s.rule = validateRule(s.rule);
          s.enabled = s.enabled !== false;
          if (typeof s.createdAt !== 'number') s.createdAt = this.now();
          // Próxima corrompida (NaN dispararia sempre ou nunca): recalcula.
          if (s.next !== undefined && !Number.isFinite(s.next)) this.plan(s);
          this.items.push(s);
        } catch (err) {
          log.warn(tr('Ignorei {0} inválido: {1}', ['schedule', errMsg(err)]));
        }
      }
    } catch (err) {
      log.warn(tr('Ignorei {0} inválido: {1}', [this.opts.file, errMsg(err)]));
    }
  }

  private save(): void {
    const file = this.opts.file;
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, schedules: this.items }, null, 2), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    } catch (err) {
      log.warnOnce(`schedules:${errMsg(err)}`, tr('Não consegui gravar {0}: {1}', [file, errMsg(err)]));
    }
  }
}
