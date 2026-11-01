// Tela "Agendas" (rotinas globais): textos, estados e diff de edição puros (testáveis sem DOM).
// Cada rotina é da sua origem (Habblaud ou Hermes) e é administrada lá; aqui só se descreve e se monta o pedido.
import { tr } from '../../../shared/i18n';
import { everyLabel, ruleLabel, shortWhen, statusLabel, lastLabel, type ScheduleDto } from './schedule-model';

export interface HermesScheduleDto {
  kind: string;
  display: string;
  expr?: string;
  minutes?: number;
  runAt?: string;
}

export interface HermesJobDto {
  id: string;
  name: string;
  prompt: string;
  schedule: HermesScheduleDto;
  enabled: boolean;
  state: string;
  pausedReason?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastError?: string;
  lastDeliveryError?: string;
  deliver: string;
  repeat: { times?: number; completed: number };
  skills: string[];
  model?: string;
  provider?: string;
  workdir?: string;
  script?: string;
  latest?: { status: string; startedAt?: string; finishedAt?: string; error?: string; deliveryOutcome?: string };
}

export type SourceState = { ok: true; timeZone?: string } | { ok: false; code: string; error: string };
export type RoutineSource = 'habblaud' | 'hermes';

export interface RoutinesResponse {
  sources: Record<RoutineSource, SourceState>;
  routines: Array<{ key: string; source: 'habblaud'; id: string; habblaud: ScheduleDto } | { key: string; source: 'hermes'; id: string; hermes: HermesJobDto }>;
}

export type StatusKind = 'active' | 'running' | 'paused' | 'done' | 'error';

export interface RoutineRow {
  key: string;
  source: RoutineSource;
  id: string;
  sourceLabel: string;
  title: string;
  rule: string;
  prompt: string;
  status: { kind: StatusKind; text: string };
  last: string;
  /** Campos que o Habblaud mostra mas não edita (o Hermes não aceita PATCH neles). */
  readOnly: Array<[string, string]>;
  /** Para ordenar: próxima execução (ms) ou infinito. */
  nextMs: number;
}

const when = (iso: string | undefined): string | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? shortWhen(t) : undefined;
};

export function hermesScheduleLabel(s: HermesScheduleDto): string {
  if (s.kind === 'interval' && s.minutes) return everyLabel(s.minutes);
  if (s.kind === 'cron' && s.expr) return `cron ${s.expr}`;
  if (s.kind === 'once' && when(s.runAt)) return tr('uma vez, {0}', [when(s.runAt)!]);
  return s.display;
}

export function hermesStatus(j: HermesJobDto): { kind: StatusKind; text: string } {
  const st = j.latest?.status;
  if (st === 'running' || st === 'claimed' || j.state === 'running') return { kind: 'running', text: tr('executando agora') };
  if (j.state === 'completed' || (!j.enabled && j.repeat.times !== undefined && j.repeat.completed >= j.repeat.times)) return { kind: 'done', text: tr('concluída') };
  if (!j.enabled) return { kind: 'paused', text: j.pausedReason ? tr('pausada: {0}', [j.pausedReason]) : tr('pausada') };
  const next = when(j.nextRunAt);
  const text = next ? tr('próxima: {0}', [next]) : tr('ativa');
  return { kind: j.lastStatus === 'error' ? 'error' : 'active', text };
}

export function hermesLastLabel(j: HermesJobDto): string {
  const parts: string[] = [];
  const l = j.latest;
  if (l) {
    const at = when(l.finishedAt ?? l.startedAt) ?? '';
    if (l.status === 'completed') parts.push(tr('concluída {0}', [at]));
    else if (l.status === 'running' || l.status === 'claimed') parts.push(tr('começou {0}', [at]));
    else parts.push(`${l.status} ${at}${l.error ? `: ${l.error}` : ''}`);
    if (l.deliveryOutcome === 'suppressed') parts.push(tr('entrega local'));
  } else if (j.lastStatus === 'error') {
    parts.push(tr('erro {0}: {1}', [when(j.lastRunAt) ?? '', j.lastError ?? '']));
  } else if (j.lastRunAt) {
    parts.push(tr('rodou {0}', [when(j.lastRunAt) ?? '']));
  } else return tr('ainda não executou');
  if (j.lastDeliveryError) parts.push(tr('falha na entrega: {0}', [j.lastDeliveryError]));
  parts.push(tr('resposta completa só no Hermes'));
  return parts.join(' · ');
}

function habblaudKind(s: ScheduleDto): StatusKind {
  if (s.enabled) return s.last?.result === 'error' ? 'error' : 'active';
  return s.rule.kind === 'once' && s.last ? 'done' : 'paused';
}

export function routineRows(resp: RoutinesResponse, cardName: (cardId: string) => string | undefined): RoutineRow[] {
  const rows: RoutineRow[] = resp.routines.map((r) => {
    if (r.source === 'habblaud') {
      const s = r.habblaud;
      return {
        key: r.key, source: 'habblaud', id: r.id, sourceLabel: 'Habblaud',
        title: cardName(s.cardId) ?? tr('ficha removida'),
        rule: ruleLabel(s.rule), prompt: s.text,
        status: { kind: habblaudKind(s), text: statusLabel(s) },
        last: lastLabel(s.last), readOnly: [], nextMs: s.enabled && s.next !== undefined ? s.next : Infinity,
      };
    }
    const j = r.hermes;
    const readOnly: Array<[string, string]> = [];
    if (j.model) readOnly.push([tr('modelo'), j.model]);
    if (j.provider) readOnly.push([tr('provedor'), j.provider]);
    if (j.workdir) readOnly.push([tr('pasta'), j.workdir]);
    if (j.script) readOnly.push([tr('script'), j.script]);
    const next = j.enabled && j.nextRunAt ? Date.parse(j.nextRunAt) : NaN;
    return {
      key: r.key, source: 'hermes', id: r.id, sourceLabel: 'Hermes', title: j.name,
      rule: hermesScheduleLabel(j.schedule), prompt: j.prompt, status: hermesStatus(j),
      last: hermesLastLabel(j), readOnly, nextMs: Number.isFinite(next) ? next : Infinity,
    };
  });
  return rows.sort((a, b) => a.nextMs - b.nextMs || a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
}

export interface SourceNotice {
  source: RoutineSource;
  kind: 'error' | 'off';
  text: string;
}

export function sourceNotices(sources: RoutinesResponse['sources']): SourceNotice[] {
  const out: SourceNotice[] = [];
  for (const source of ['habblaud', 'hermes'] as const) {
    const s = sources[source];
    if (!s || s.ok) continue;
    const label = source === 'hermes' ? 'Hermes' : 'Habblaud';
    if (s.code === 'off') out.push({ source, kind: 'off', text: `${label}: ${s.error}` });
    else out.push({ source, kind: 'error', text: tr('{0}: {1} — as rotinas do {0} não estão nesta lista', [label, s.error]) });
  }
  return out;
}

export interface JobForm {
  name: string;
  schedule: string;
  prompt: string;
  deliver: string;
  /** Separadas por vírgula. */
  skills: string;
}

export type JobPatchDto = Partial<{ name: string; schedule: string; prompt: string; deliver: string; skills: string[] }>;

/** Texto da regra como aparece no campo de edição. */
export function scheduleInput(s: HermesScheduleDto): string {
  return s.expr ?? s.display;
}

/** Só os campos alterados (o PATCH do Hermes não deve receber o registro inteiro). Nada mudou = null. */
export function jobEditDiff(j: HermesJobDto, f: JobForm): JobPatchDto | null {
  const name = f.name.trim();
  const schedule = f.schedule.trim();
  if (!name) throw new Error(tr('nome obrigatório'));
  if (!schedule) throw new Error(tr('regra obrigatória'));
  const out: JobPatchDto = {};
  if (name !== j.name) out.name = name;
  if (schedule !== scheduleInput(j.schedule).trim() && schedule !== j.schedule.display) out.schedule = schedule;
  if (f.prompt !== j.prompt) out.prompt = f.prompt;
  const deliver = f.deliver.trim() || 'local';
  if (deliver !== j.deliver) out.deliver = deliver;
  const skills = f.skills.split(',').map((s) => s.trim()).filter(Boolean);
  if (skills.join('\n') !== j.skills.join('\n')) out.skills = skills;
  return Object.keys(out).length ? out : null;
}

/** Executar agora numa rotina pausada a reativa no Hermes (sondado): a tela pergunta antes. */
export function runConfirm(j: HermesJobDto): { text: string; keepPausedLabel: string; reactivateLabel: string } | null {
  if (j.enabled) return null;
  return {
    text: tr('Esta rotina está pausada. Executar agora a reativa no Hermes.'),
    keepPausedLabel: tr('Executar e manter pausada'),
    reactivateLabel: tr('Executar e deixar ativa'),
  };
}
