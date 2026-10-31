// Conversas de um agente (ui/drawer.ts): os turnos que ele já rodou, do mais recente ao mais antigo, com o pedido
// que os originou. Os runs vêm de GET /api/runs (um registro por turno; ver server/runs/manager.ts).
import { tr } from '../../../shared/i18n';

export type RunState = 'running' | 'waiting' | 'done' | 'error' | 'interrupted';

/** O que o painel usa de um run. */
export interface RunView {
  runId: string;
  state: RunState;
  /** O pedido que originou o turno (ausente nos registros antigos, de antes de o pedido ser gravado). */
  prompt?: string;
  /** Resposta acumulada. */
  text: string;
  /** Fim (ou última mudança) do turno. */
  at: number;
  error?: string;
  owner: { kind: 'card' | 'consult'; id: string; sessionId: string; title?: string };
}

/** Quanto do pedido aparece na lista antes de cortar. */
export const RUN_PROMPT_MAX = 160;
/** Quanto da resposta aparece na lista antes de cortar. */
export const RUN_REPLY_MAX = 280;

export function runPrompt(r: RunView): string {
  return cut((r.prompt ?? '').trim(), RUN_PROMPT_MAX);
}

export function runReply(r: RunView): string {
  const text = (r.state === 'error' || r.state === 'interrupted' ? r.error ?? '' : r.text).trim();
  return cut(text, RUN_REPLY_MAX);
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function runStateLabel(state: RunState): string {
  switch (state) {
    case 'running':
      return tr('Rodando');
    case 'waiting':
      return tr('Esperando você');
    case 'done':
      return tr('Concluído');
    case 'error':
      return tr('Erro');
    case 'interrupted':
      return tr('Interrompido');
  }
}

/** O run é deste agente? (pela sessão do driver ou pela ficha: o agente dorminhoco tem id `card:<cardId>`.) */
export function runBelongsTo(r: RunView, agent: { id: string; sessionId?: string; cardId?: string }): boolean {
  if (agent.sessionId && r.owner.sessionId === agent.sessionId) return true;
  const cardId = agent.cardId ?? (agent.id.startsWith('card:') ? agent.id.slice('card:'.length) : undefined);
  return !!cardId && r.owner.id === cardId;
}

/** Conversas do agente, da mais recente para a mais antiga (no máximo `limit`). */
export function runsOfAgent(runs: readonly RunView[], agent: { id: string; sessionId?: string; cardId?: string }, limit = 10): RunView[] {
  return runs
    .filter((r) => runBelongsTo(r, agent))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
