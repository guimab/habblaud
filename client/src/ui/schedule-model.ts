// Agendas na gaveta da ficha (entrega 5): textos e conversões puras (testáveis sem DOM).
import { tr } from '../../../shared/i18n';

export type ScheduleRule = { kind: 'once'; at: number } | { kind: 'every'; minutes: number } | { kind: 'weekly'; days: number[]; time: string };

export interface ScheduleDto {
  id: string;
  cardId: string;
  text: string;
  rule: ScheduleRule;
  enabled: boolean;
  createdAt: number;
  next?: number;
  last?: { at: number; result: 'started' | 'busy' | 'error' | 'missed'; runId?: string; error?: string };
}

export const DAY_SHORT = (): string[] => [tr('dom'), tr('seg'), tr('ter'), tr('qua'), tr('qui'), tr('sex'), tr('sáb')];

const pad = (n: number) => String(n).padStart(2, '0');

/** "31/10 14:05" no fuso local. */
export function shortWhen(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function everyLabel(min: number): string {
  if (min % 1440 === 0) return min === 1440 ? tr('todo dia') : tr('a cada {0} dias', [min / 1440]);
  if (min % 60 === 0) return min === 60 ? tr('a cada hora') : tr('a cada {0} h', [min / 60]);
  return tr('a cada {0} min', [min]);
}

export function ruleLabel(r: ScheduleRule): string {
  if (r.kind === 'once') return tr('uma vez, {0}', [shortWhen(r.at)]);
  if (r.kind === 'every') return everyLabel(r.minutes);
  const days = [...r.days].sort((a, b) => a - b);
  const names = DAY_SHORT();
  const which = days.length === 7 ? tr('todo dia') : days.join() === '1,2,3,4,5' ? tr('dias úteis') : days.map((d) => names[d]).join(', ');
  return `${which} ${r.time}`;
}

export function lastLabel(l: ScheduleDto['last']): string {
  if (!l) return '';
  const when = shortWhen(l.at);
  if (l.result === 'started') return tr('rodou {0}', [when]);
  if (l.result === 'busy') return tr('pulou {0} (agente ocupado)', [when]);
  if (l.result === 'missed') return tr('perdida {0} (Habblaud desligado)', [when]);
  return tr('erro {0}: {1}', [when, l.error ?? '']);
}

export function statusLabel(s: ScheduleDto): string {
  if (s.enabled && s.next !== undefined) return tr('próxima: {0}', [shortWhen(s.next)]);
  return s.rule.kind === 'once' && !s.enabled && s.last ? tr('concluída') : tr('pausada');
}

export interface RuleForm {
  kind: string;
  /** datetime-local ("2026-10-31T14:05"). */
  at: string;
  every: number;
  unit: 'min' | 'h' | 'd';
  days: number[];
  time: string;
}

/** Monta a regra do formulário (a validação final é do servidor). */
export function ruleFromForm(f: RuleForm): ScheduleRule {
  if (f.kind === 'once') {
    const t = new Date(f.at).getTime();
    if (!f.at || !Number.isFinite(t)) throw new Error(tr('escolha data e hora'));
    return { kind: 'once', at: t };
  }
  if (f.kind === 'every') return { kind: 'every', minutes: Math.round(f.every * (f.unit === 'd' ? 1440 : f.unit === 'h' ? 60 : 1)) };
  return { kind: 'weekly', days: [...f.days].sort((a, b) => a - b), time: f.time };
}
