// Inbox: um lugar só para o que espera você. Junta as aprovações dos runs (Hermes), os pedidos de permissão do
// Claude/Codex (PermissionRegistry) e o que ficou pronto sem ninguém olhando: resposta, pergunta (resposta que
// termina pedindo algo), erro ou run interrompido. Resposta vista ao vivo não entra. Os itens dispensados ficam em
// <dataDir>/inbox.json (0600). Aprovações e pedidos saem quando são respondidos, não por dispensa.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';
import type { PermissionRequestInfo } from '../../shared/types';
import type { ApprovalChoice, ApprovalRequest } from '../drivers/contract';
import { errMsg, log } from '../log';
import type { RunOwner, RunRecord } from '../runs/manager';

export type InboxKind = 'approval' | 'permission' | 'question' | 'reply' | 'error' | 'interrupted';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  /** Quem: nome da ficha/consulta ou do agente. */
  title: string;
  /** Pedido que originou o turno (o que você pediu ao agente), quando o registro tem. */
  prompt?: string;
  /** Resumo: comando a aprovar, fim da resposta ou motivo do erro. */
  text: string;
  at: number;
  runId?: string;
  owner?: RunOwner;
  approval?: ApprovalRequest;
  permissionId?: string;
  agentId?: string;
}

export class InboxError extends Error {
  constructor(
    readonly code: 'unknown' | 'state',
    message: string,
  ) {
    super(message);
  }
}

/** O que a Inbox usa do RunManager. */
export interface InboxRuns {
  list(): RunRecord[];
  approve(runId: string, choice: ApprovalChoice): Promise<void>;
}

export interface InboxOptions {
  runs: InboxRuns;
  /** Pedidos de permissão pendentes, por agente (PermissionRegistry.snapshot). */
  permissions?: () => Map<string, PermissionRequestInfo>;
  /** Nome do agente do escritório (para os pedidos do Claude/Codex). */
  agentName?: (agentId: string) => string | undefined;
  file?: string;
}

const PREVIEW = 300;
/** Quanto do pedido vai na Inbox (pedido longo é cortado no fim). */
const PROMPT_PREVIEW = 240;

function tail(text: string): string {
  const t = text.trim();
  return t.length > PREVIEW ? `…${t.slice(-PREVIEW)}` : t;
}

/** Início do texto, cortado com reticências (o pedido interessa pelo começo). */
function head(text: string): string {
  const t = text.trim();
  return t.length > PROMPT_PREVIEW ? `${t.slice(0, PROMPT_PREVIEW).trimEnd()}…` : t;
}

/** A resposta termina pedindo algo ao usuário. */
function asks(text: string): boolean {
  return /\?\s*$/.test(text.trim());
}

export class Inbox {
  private dismissed = new Set<string>();

  constructor(private readonly opts: InboxOptions) {
    this.load();
  }

  items(): InboxItem[] {
    const out: InboxItem[] = [];
    for (const r of this.opts.runs.list()) {
      const id = `run:${r.runId}`;
      const base = { id, title: r.owner.title || r.owner.id, ...(r.prompt?.trim() ? { prompt: head(r.prompt) } : {}), at: r.updatedAt, runId: r.runId, owner: r.owner };
      if (r.state === 'waiting' && r.approval) out.push({ ...base, kind: 'approval', text: r.approval.command, approval: r.approval });
      if (this.dismissed.has(id) || r.seen) continue;
      if (r.state === 'done') out.push({ ...base, kind: asks(r.text) ? 'question' : 'reply', text: tail(r.text) });
      else if (r.state === 'error') out.push({ ...base, kind: 'error', text: r.error ?? '' });
      else if (r.state === 'interrupted') out.push({ ...base, kind: 'interrupted', text: r.error ?? '' });
    }
    for (const [agentId, p] of this.opts.permissions?.() ?? []) {
      out.push({ id: `perm:${p.id}`, kind: 'permission', title: this.opts.agentName?.(agentId) ?? agentId, text: p.text ? `${p.title}: ${p.text}` : p.title, at: p.createdAt, permissionId: p.id, agentId });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  count(): number {
    return this.items().length;
  }

  dismiss(id: string): void {
    const item = this.items().find((i) => i.id === id);
    if (!item) throw new InboxError('unknown', tr('item desconhecido'));
    if (item.kind === 'approval' || item.kind === 'permission') throw new InboxError('state', tr('aprovações e pedidos saem ao responder'));
    this.dismissed.add(id);
    this.save();
  }

  /** Dispensa tudo o que é dispensável; devolve quantos saíram. */
  dismissAll(): number {
    const ids = this.items()
      .filter((i) => i.kind !== 'approval' && i.kind !== 'permission')
      .map((i) => i.id);
    for (const id of ids) this.dismissed.add(id);
    this.save();
    return ids.length;
  }

  async approve(id: string, choice: ApprovalChoice): Promise<void> {
    const item = this.items().find((i) => i.id === id);
    if (!item || item.kind !== 'approval' || !item.runId) throw new InboxError('unknown', tr('aprovação desconhecida'));
    await this.opts.runs.approve(item.runId, choice);
  }

  private load(): void {
    if (!this.opts.file) return;
    try {
      const d = JSON.parse(readFileSync(this.opts.file, 'utf8')) as { dismissed?: unknown };
      if (Array.isArray(d.dismissed)) this.dismissed = new Set(d.dismissed.filter((x): x is string => typeof x === 'string'));
    } catch {
      /* sem arquivo ou inválido: começa vazia */
    }
  }

  private save(): void {
    const file = this.opts.file;
    // Esquece ids de runs que o RunManager já descartou.
    const known = new Set(this.opts.runs.list().map((r) => `run:${r.runId}`));
    for (const id of this.dismissed) if (!known.has(id)) this.dismissed.delete(id);
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, dismissed: [...this.dismissed] }, null, 2), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [file, errMsg(err)]));
    }
  }
}
