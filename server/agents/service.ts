// Conversa com uma ficha de agente: usa a sessão mais recente da ficha (cria uma se não houver) e manda as
// instruções (contexto do projeto + instruções da ficha) a cada turno. Não depende de framework: só o contrato do
// driver. Sessão nova pedida pelo usuário ("Nova conversa") vira a mais recente.
import { tr } from '../../shared/i18n';
import type { AgentDriver, ChatEvent } from '../drivers/contract';
import type { Project } from '../projects/store';
import type { RunManager } from '../runs/manager';
import { AgentError, type AgentCard, type AgentStore } from './store';

export interface CardServiceOptions {
  cards: AgentStore;
  driver: AgentDriver;
  projects?: { get(id: string): Project | undefined };
  /** Com runs, o turno roda em segundo plano e sobrevive ao painel fechado. */
  runs?: RunManager;
}

export class CardService {
  constructor(private readonly opts: CardServiceOptions) {}

  private card(id: string): AgentCard {
    const c = this.opts.cards.get(id);
    if (!c) throw new AgentError('unknown', tr('agente desconhecido'));
    return c;
  }

  /** Instruções do turno: contexto do projeto + instruções da ficha (vazio = nada). */
  system(c: AgentCard): string {
    const parts: string[] = [];
    const p = c.projectId ? this.opts.projects?.get(c.projectId) : undefined;
    parts.push(`Você é ${c.name}${c.role ? `, ${c.role}` : ''}.`);
    if (p) parts.push(`Projeto: ${p.name}${p.paths.length ? ` (pastas: ${p.paths.join(', ')})` : ''}.${p.context ? `\n\n${p.context}` : ''}`);
    if (c.instructions) parts.push(c.instructions);
    return parts.join('\n\n');
  }

  /** Abre uma sessão nova para a ficha e a liga a ela. */
  async newSession(id: string): Promise<string> {
    const c = this.card(id);
    const s = await this.opts.driver.createSession({ title: c.name, ...(c.model ? { model: c.model } : {}) });
    this.opts.cards.attachSession(c.id, s.id);
    return s.id;
  }

  /** Sessão atual da ficha (cria uma se não houver). */
  private async current(id: string): Promise<{ c: AgentCard; session: string }> {
    let c = this.card(id);
    if (!c.sessions.length) {
      await this.newSession(id);
      c = this.card(id);
    }
    return { c, session: c.sessions[c.sessions.length - 1]! };
  }

  /** Turno sem ninguém assistindo (agenda): só dispara o run; a resposta vai para a Inbox. */
  async background(id: string, text: string, scheduleId?: string): Promise<string> {
    const runs = this.opts.runs;
    if (!runs) throw new AgentError('invalid', tr('o driver não suporta runs'));
    const { c, session } = await this.current(id);
    return runs.start({ kind: 'card', id: c.id, sessionId: session, title: c.name, ...(scheduleId ? { scheduleId } : {}) }, text, { system: this.system(c) });
  }

  async *chat(id: string, text: string, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const { c, session } = await this.current(id);
    const runs = this.opts.runs;
    if (!runs) return yield* this.opts.driver.chat(session, text, signal, { system: this.system(c) });
    const runId = await runs.start({ kind: 'card', id: c.id, sessionId: session, title: c.name }, text, { system: this.system(c) });
    yield { type: 'run', runId };
    yield* runs.subscribe(runId, signal);
  }
}
