// Conversas de um agente (ui/drawer.ts): os turnos que ele já rodou, do mais recente ao mais antigo, com o pedido
// que os originou. Os runs vêm de GET /api/runs (um registro por turno; ver server/runs/manager.ts).
import type { AgentInfo, RunState, RunView } from '../../../shared/types';
import { linkedRunAgent } from './agent-panel-routing-model';
import { tr } from '../../../shared/i18n';

export type { RunState, RunView };

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

/** Mesma associação canônica do roteador, considerando todos os agentes para ambiguidades. */
export function runBelongsTo(r: RunView, agent: AgentInfo, agents: readonly AgentInfo[]): boolean {
  return linkedRunAgent(r, agents)?.id === agent.id;
}

/** Conversas do agente, da mais recente para a mais antiga (no máximo `limit`). */
export function runsOfAgent(runs: readonly RunView[], agent: AgentInfo, agents: readonly AgentInfo[], limit = 10): RunView[] {
  return runs
    .filter((r) => runBelongsTo(r, agent, agents))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
