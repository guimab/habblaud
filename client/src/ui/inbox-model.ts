// Estado puro da Inbox (ui/inbox.ts): itens vindos de GET /api/inbox, agrupados por projeto, com os rótulos das ações.
import { tr } from '../../../shared/i18n';
import type { ApprovalChoice, ApprovalView } from './consult-model';

export type InboxKind = 'approval' | 'permission' | 'question' | 'reply' | 'error' | 'interrupted';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  /** Pedido que originou o turno (o que você pediu ao agente). Ausente nos registros antigos. */
  prompt?: string;
  text: string;
  at: number;
  runId?: string;
  owner?: { kind: 'card' | 'consult'; id: string; sessionId: string; title?: string; scheduleId?: string };
  approval?: ApprovalView;
  permissionId?: string;
  agentId?: string;
}

export interface InboxGroup {
  /** Nome do projeto; vazio = sem projeto. */
  project: string;
  items: InboxItem[];
}

/** Agrupa por projeto (os com projeto em ordem alfabética, "sem projeto" no fim); a ordem dos itens é mantida. */
export function groupInbox(items: InboxItem[], projectOf: (item: InboxItem) => string | undefined): InboxGroup[] {
  const groups = new Map<string, InboxItem[]>();
  for (const it of items) {
    const p = projectOf(it) ?? '';
    const list = groups.get(p);
    if (list) list.push(it);
    else groups.set(p, [it]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([project, list]) => ({ project, items: list }));
}

/** Quantos pedem uma decisão sua (aprovação, pedido ou pergunta): é o que acende o selo. */
export function urgentCount(items: InboxItem[]): number {
  return items.filter((i) => i.kind === 'approval' || i.kind === 'permission' || i.kind === 'question').length;
}

export function kindLabel(kind: InboxKind): string {
  switch (kind) {
    case 'approval':
      return tr('Aprovação');
    case 'permission':
      return tr('Pedido de permissão');
    case 'question':
      return tr('Pergunta');
    case 'reply':
      return tr('Resposta pronta');
    case 'error':
      return tr('Erro');
    case 'interrupted':
      return tr('Interrompido');
  }
}

export function choiceLabel(choice: ApprovalChoice): string {
  switch (choice) {
    case 'once':
      return tr('Só desta vez');
    case 'session':
      return tr('Nesta sessão');
    case 'always':
      return tr('Sempre');
    case 'deny':
      return tr('Negar');
  }
}
