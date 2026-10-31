// Consultas rápidas: uma sessão nova por consulta, contexto opcional só na primeira mensagem, arquivada sozinha
// depois de um tempo sem uso. Não depende de framework: usa só o contrato do driver.
import { tr } from '../../shared/i18n';
import { randomUUID } from 'node:crypto';
import type { RunManager } from '../runs/manager';
import type { AgentDriver, ChatEvent } from '../drivers/contract';
import { errMsg, log } from '../log';

export const CONSULT_IDLE_MS = 30 * 60_000;

export interface Consult {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  lastUsedAt: number;
  archived: boolean;
}

interface Entry extends Consult {
  /** Texto a anteceder a primeira mensagem; some depois de enviado. */
  preamble?: string;
}

export interface ConsultServiceOptions {
  driver: AgentDriver;
  now?: () => number;
  idleMs?: number;
  /** Com runs, o turno roda em segundo plano e sobrevive ao painel fechado. */
  runs?: RunManager;
}

export class ConsultError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown' | 'archived',
  ) {
    super(message);
  }
}

function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export class ConsultService {
  private readonly driver: AgentDriver;
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly entries = new Map<string, Entry>();

  private readonly runs?: RunManager;

  constructor(opts: ConsultServiceOptions) {
    this.driver = opts.driver;
    this.now = opts.now ?? Date.now;
    this.idleMs = opts.idleMs ?? CONSULT_IDLE_MS;
    this.runs = opts.runs;
  }

  async start(input: { context?: string; screen?: string }): Promise<Consult> {
    const at = this.now();
    const s = await this.driver.createSession({ title: `Consultor · ${hhmm(at)}` });
    const parts: string[] = [];
    if (input.context?.trim()) parts.push(`Contexto: ${input.context.trim()}`);
    if (input.screen?.trim()) parts.push(`Tela: ${input.screen.trim()}`);
    const e: Entry = { id: randomUUID(), sessionId: s.id, title: s.title, createdAt: at, lastUsedAt: at, archived: false };
    if (parts.length) e.preamble = parts.join('\n\n');
    this.entries.set(e.id, e);
    return this.view(e);
  }

  private get(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new ConsultError(tr('consulta desconhecida'), 'unknown');
    return e;
  }

  private view(e: Entry): Consult {
    const { preamble: _p, ...rest } = e;
    return { ...rest };
  }

  async *send(id: string, text: string, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const e = this.get(id);
    if (e.archived) throw new ConsultError(tr('consulta arquivada'), 'archived');
    const message = e.preamble ? `${e.preamble}\n\n${text}` : text;
    e.lastUsedAt = this.now();
    try {
      if (!this.runs) {
        e.preamble = undefined;
        yield* this.driver.chat(e.sessionId, message, signal);
      } else {
        const runId = await this.runs.start({ kind: 'consult', id: e.id, sessionId: e.sessionId, title: e.title }, message);
        // Só some depois que o turno começou: ocupado/Hermes fora não perde o contexto.
        e.preamble = undefined;
        yield { type: 'run', runId };
        yield* this.runs.subscribe(runId, signal);
      }
    } finally {
      e.lastUsedAt = this.now();
    }
  }

  /** Promover a agente: entrega a sessão a `attach`; só se der certo a consulta sai do consultor. */
  promote(id: string, attach: (sessionId: string) => void): void {
    const e = this.get(id);
    if (e.archived) throw new ConsultError(tr('consulta arquivada'), 'archived');
    attach(e.sessionId);
    this.entries.delete(id);
  }

  list(): Consult[] {
    return [...this.entries.values()].map((e) => this.view(e));
  }

  async archive(id: string): Promise<void> {
    const e = this.get(id);
    if (e.archived) return;
    await this.driver.archive(e.sessionId);
    e.archived = true;
  }

  /** Arquiva as consultas sem uso há mais de `idleMs`; devolve quantas. */
  async sweep(): Promise<number> {
    const limit = this.now() - this.idleMs;
    const idle = [...this.entries.values()].filter((e) => !e.archived && e.lastUsedAt < limit && !this.runs?.active(e.sessionId));
    let n = 0;
    for (const e of idle) {
      try {
        await this.driver.archive(e.sessionId);
        e.archived = true;
        n++;
      } catch (err) {
        log.warn(tr('Consultor: não consegui arquivar a sessão {0} (tento de novo depois): {1}', [e.sessionId, errMsg(err)]));
      }
    }
    return n;
  }
}
