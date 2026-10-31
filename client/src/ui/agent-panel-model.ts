// Estado puro do painel único do agente: navegação sem DOM, rede ou mudanças no executor.
import type { RunView } from '../../../shared/types';
import type { ApprovalView } from './consult-model';

/** Aceita RunView e o JSON real da API, cuja recência vem em updatedAt/startedAt. */
export interface AgentPanelRun extends Omit<RunView, 'at'> {
  at?: number;
  updatedAt?: number;
  startedAt?: number;
  approval?: ApprovalView;
}

export type AgentTab = 'work' | 'history' | 'config';

export const AGENT_PANEL_DEFAULT_WIDTH = 560;
export const AGENT_PANEL_MIN_WIDTH = 400;
export const AGENT_PANEL_MAX_WIDTH = 720;
export const AGENT_PANEL_MIN_OFFICE_WIDTH = 320;

export type PanelTarget =
  | { kind: 'agent'; agentId: string }
  | { kind: 'run'; runId: string; agentId?: string };

export interface AgentPanelState {
  target: PanelTarget | null;
  tab: AgentTab;
  detailsOpen: boolean;
}

/** Largura em pixels; o hospedeiro decide docked/overlay e informa a lateral efetivamente ocupada. */
export function clampPanelWidth(width: number, viewportWidth: number, sidebarWidth: number): number {
  const viewport = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  const sidebar = Number.isFinite(sidebarWidth) ? Math.max(0, sidebarWidth) : 0;
  const available = Math.max(0, viewport - sidebar);
  const reserveOffice = available >= AGENT_PANEL_MIN_WIDTH + AGENT_PANEL_MIN_OFFICE_WIDTH;
  const max = Math.min(AGENT_PANEL_MAX_WIDTH, reserveOffice ? available - AGENT_PANEL_MIN_OFFICE_WIDTH : available);
  const requested = Number.isFinite(width) ? width : AGENT_PANEL_DEFAULT_WIDTH;
  return Math.min(max, Math.max(Math.min(AGENT_PANEL_MIN_WIDTH, max), requested));
}

/** Selecionar outro agente começa em Trabalho; não marca nada como lido/resolvido. */
export function openAgentPanel(agentId: string): AgentPanelState {
  return { target: { kind: 'agent', agentId }, tab: 'work', detailsOpen: false };
}

/** Recebe apenas os runs do alvo; não reordena nem modifica o array da store. */
export function preferredRun<T extends AgentPanelRun>(runs: readonly T[]): T | undefined {
  const priority = (run: T) => {
    if (run.state === 'waiting' && run.approval?.choices.length) return 2;
    return run.state === 'running' || run.state === 'waiting' ? 1 : 0;
  };
  const recency = (run: T) => [run.at, run.updatedAt, run.startedAt].find((at) => typeof at === 'number' && Number.isFinite(at)) ?? 0;
  return runs.reduce<T | undefined>((best, run) => {
    if (!best || priority(run) > priority(best)) return run;
    return priority(run) === priority(best) && recency(run) > recency(best) ? run : best;
  }, undefined);
}
