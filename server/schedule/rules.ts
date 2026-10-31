// Regras de agenda (entrega 5): uma vez, a cada N minutos, ou em dias da semana num horário. Hora local do processo
// (o TZ do servidor). Puro: o relógio vem de fora.
import { tr } from '../../shared/i18n';

export const MIN_EVERY_MIN = 5;

export type ScheduleRule =
  | { kind: 'once'; at: number }
  | { kind: 'every'; minutes: number }
  /** days: 0 = domingo … 6 = sábado; time: "HH:MM". */
  | { kind: 'weekly'; days: number[]; time: string };

export class RuleError extends Error {}

/**
 * Próxima execução estritamente depois de `now`. `last` (a cada N): a contagem parte da última execução, mas nunca
 * volta para antes de agora (não acumula as vezes perdidas). Sem próxima: undefined.
 */
export function nextRun(rule: ScheduleRule, now: number, last?: number): number | undefined {
  switch (rule.kind) {
    case 'once':
      return rule.at > now ? rule.at : undefined;
    case 'every': {
      const step = rule.minutes * 60_000;
      if (last === undefined) return now + step;
      // Mantém o compasso da última execução: a primeira marca da grade depois de agora.
      return last > now ? last + step : last + (Math.floor((now - last) / step) + 1) * step;
    }
    case 'weekly': {
      if (!rule.days.length) return undefined;
      const [h, m] = rule.time.split(':').map(Number) as [number, number];
      const base = new Date(now);
      for (let i = 0; i <= 7; i++) {
        const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, h, m);
        if (rule.days.includes(d.getDay()) && d.getTime() > now) return d.getTime();
      }
      return undefined;
    }
  }
}

/** Valida e normaliza o que veio do cliente. */
export function validateRule(v: unknown): ScheduleRule {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  if (o?.kind === 'once' && typeof o.at === 'number' && Number.isFinite(o.at)) return { kind: 'once', at: o.at };
  if (o?.kind === 'every') {
    const n = o.minutes;
    if (typeof n === 'number' && Number.isInteger(n) && n >= MIN_EVERY_MIN && n <= 7 * 24 * 60) return { kind: 'every', minutes: n };
    throw new RuleError(tr('intervalo: de {0} minutos a 7 dias', [MIN_EVERY_MIN]));
  }
  if (o?.kind === 'weekly') {
    const days = Array.isArray(o.days) ? o.days : [];
    if (!days.length || !days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) throw new RuleError(tr('escolha ao menos um dia da semana'));
    const t = typeof o.time === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(o.time) : null;
    if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) throw new RuleError(tr('horário inválido (HH:MM)'));
    return { kind: 'weekly', days: [...new Set(days as number[])].sort((a, b) => a - b), time: `${t[1]!.padStart(2, '0')}:${t[2]}` };
  }
  throw new RuleError(tr('agenda inválida: uma vez, a cada N minutos ou dias da semana'));
}
