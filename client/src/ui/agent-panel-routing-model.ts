import type { AgentInfo, RunView } from '../../../shared/types';
import type { ApprovalChoice, ApprovalView } from './consult-model';

/** Ficha explícita tem prioridade; qualquer empate no vínculo escolhido fica sem alvo. */
export function linkedRunAgent(run: RunView, agents: readonly AgentInfo[]): AgentInfo | undefined {
  if (run.owner.kind === 'card' && literalId(run.owner.id)) {
    const byCard = agents.filter((agent) => literalId(agent.cardId) && agent.cardId === run.owner.id);
    if (byCard.length > 0) return byCard.length === 1 ? byCard[0] : undefined;
  }
  if (!literalId(run.owner.sessionId)) return undefined;
  const bySession = agents.filter((agent) => {
    const session = literalId(agent.driverSession) ? agent.driverSession : agent.sessionId;
    return literalId(session) && session === run.owner.sessionId;
  });
  return bySession.length === 1 ? bySession[0] : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Só valida: nunca transforma um ID numa outra identidade. */
function literalId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function panelRun(raw: unknown): (RunView & { approval?: ApprovalView }) | null {
  if (!record(raw) || !record(raw.owner)) return null;
  const owner = raw.owner;
  if (!literalId(raw.runId) || !literalId(owner.id) || !literalId(owner.sessionId)) return null;
  if (owner.kind !== 'card' && owner.kind !== 'consult') return null;
  const state = raw.state;
  if (state !== 'running' && state !== 'waiting' && state !== 'done' && state !== 'error' && state !== 'interrupted') return null;

  const result: RunView & { approval?: ApprovalView } = {
    runId: raw.runId, state, text: typeof raw.text === 'string' ? raw.text : '',
    at: [raw.at, raw.updatedAt, raw.startedAt].find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? 0,
    owner: { kind: owner.kind, id: owner.id, sessionId: owner.sessionId },
  };
  const approval = raw.approval;
  if (record(approval) && typeof approval.command === 'string' && Array.isArray(approval.choices) &&
      approval.choices.every((choice): choice is ApprovalChoice => choice === 'once' || choice === 'session' || choice === 'always' || choice === 'deny')) {
    result.approval = { command: approval.command, choices: [...approval.choices] };
    if (typeof approval.description === 'string') result.approval.description = approval.description;
  }
  if (typeof raw.prompt === 'string') result.prompt = raw.prompt;
  if (typeof raw.error === 'string') result.error = raw.error;
  if (typeof owner.title === 'string') result.owner.title = owner.title;
  if (typeof owner.scheduleId === 'string') result.owner.scheduleId = owner.scheduleId;
  return result;
}
