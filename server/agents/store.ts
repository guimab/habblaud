// Fichas de agente: identidade fixa (nome, papel, projeto, instruções, modelo, aparência), persistida em
// <dataDir>/agents.json. A ficha existe sem sessão aberta ("dormindo"). Cada sessão do driver pertence a no máximo
// uma ficha; as sessões ligadas recebem o nome, a aparência e a sala do projeto da ficha (model/office.ts).
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';

export const AGENT_NAME_MAX = 40;
export const AGENT_ROLE_MAX = 60;
export const AGENT_INSTRUCTIONS_MAX = 20_000;
export const AGENT_MODEL_MAX = 120;
/** Sessões lembradas por ficha (as mais antigas saem). */
export const AGENT_SESSIONS_MAX = 50;

export interface AgentCard {
  id: string;
  name: string;
  role?: string;
  projectId?: string;
  instructions?: string;
  model?: string;
  look?: 'f' | 'm';
  /** Ids de sessão no driver, da mais antiga para a mais recente. */
  sessions: string[];
  /** Driver que roda a ficha (hoje só 'hermes'). */
  driver: string;
}

/** `null` limpa o campo opcional; `undefined` mantém. */
export interface AgentInput {
  name?: string;
  role?: string | null;
  projectId?: string | null;
  instructions?: string | null;
  model?: string | null;
  look?: 'f' | 'm' | null;
}

export class AgentError extends Error {
  constructor(
    readonly code: 'invalid' | 'conflict' | 'unknown',
    message: string,
  ) {
    super(message);
  }
}

function cleanName(n: unknown): string {
  const s = typeof n === 'string' ? n.replace(/\s+/g, ' ').trim() : '';
  if (!s || s.length > AGENT_NAME_MAX) throw new AgentError('invalid', tr('o nome do agente precisa ter de 1 a {0} letras', [AGENT_NAME_MAX]));
  return s;
}

function cleanText(v: unknown, max: number, label: string, oneLine: boolean): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw new AgentError('invalid', tr('{0} inválido', [label]));
  const s = oneLine ? v.replace(/\s+/g, ' ').trim() : v.trim();
  return s || undefined;
}

const copy = (a: AgentCard): AgentCard => ({ ...a, sessions: [...a.sessions] });
const newId = (): string => `a_${randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 8)}`;

export class AgentStore {
  private agents: AgentCard[] = [];
  private readonly listeners: (() => void)[] = [];

  /** `file` null = só em memória (testes). `projectExists` valida o projeto da ficha. */
  constructor(
    private readonly file: string | null,
    private readonly projectExists: (id: string) => boolean,
  ) {}

  load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { agents?: unknown[] };
      const out: AgentCard[] = [];
      const taken = new Set<string>();
      for (const raw of j.agents ?? []) {
        const r = (raw ?? {}) as Partial<AgentCard>;
        try {
          if (typeof r.id !== 'string' || !/^a_[a-z0-9]{8}$/.test(r.id) || out.some((x) => x.id === r.id)) continue;
          const a = this.build({ id: r.id, sessions: [], driver: typeof r.driver === 'string' ? r.driver : 'hermes', name: '' }, r as AgentInput, true);
          for (const s of Array.isArray(r.sessions) ? r.sessions : [])
            if (typeof s === 'string' && s && !taken.has(s)) {
              taken.add(s);
              a.sessions.push(s);
            }
          out.push(a);
        } catch {
          /* ficha inválida: ignorada */
        }
      }
      this.agents = out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('agents.json ilegível ({0}); sem fichas.', [errMsg(err)]));
    }
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  list(): AgentCard[] {
    return this.agents.map(copy);
  }

  get(id: string): AgentCard | undefined {
    const a = this.agents.find((x) => x.id === id);
    return a && copy(a);
  }

  bySession(sessionId: string): AgentCard | undefined {
    const a = this.agents.find((x) => x.sessions.includes(sessionId));
    return a && copy(a);
  }

  create(input: AgentInput): AgentCard {
    const a = this.build({ id: newId(), name: '', sessions: [], driver: 'hermes' }, { ...input, name: input.name ?? '' }, false);
    this.agents.push(a);
    this.changed();
    return copy(a);
  }

  update(id: string, input: AgentInput): AgentCard {
    const a = this.build(copy(this.find(id)), input, false);
    this.agents = this.agents.map((x) => (x.id === id ? a : x));
    this.changed();
    return copy(a);
  }

  remove(id: string): boolean {
    const before = this.agents.length;
    this.agents = this.agents.filter((a) => a.id !== id);
    if (this.agents.length === before) return false;
    this.changed();
    return true;
  }

  attachSession(id: string, sessionId: string): AgentCard {
    const a = this.find(id);
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new AgentError('invalid', tr('sessão inválida'));
    if (a.sessions.includes(sessionId)) return copy(a);
    const other = this.agents.find((x) => x.sessions.includes(sessionId));
    if (other) throw new AgentError('conflict', tr('a sessão já pertence ao agente {0}', [other.name]));
    a.sessions = [...a.sessions, sessionId].slice(-AGENT_SESSIONS_MAX);
    this.changed();
    return copy(a);
  }

  detachSession(sessionId: string): void {
    const a = this.agents.find((x) => x.sessions.includes(sessionId));
    if (!a) return;
    a.sessions = a.sessions.filter((s) => s !== sessionId);
    this.changed();
  }

  /** O projeto foi desfeito: as fichas dele ficam sem projeto. */
  forgetProject(projectId: string): void {
    let hit = false;
    for (const a of this.agents)
      if (a.projectId === projectId) {
        delete a.projectId;
        hit = true;
      }
    if (hit) this.changed();
  }

  private find(id: string): AgentCard {
    const a = this.agents.find((x) => x.id === id);
    if (!a) throw new AgentError('unknown', tr('agente desconhecido'));
    return a;
  }

  /** Aplica `input` em `a`. `loading` aceita projeto que não existe mais (fica sem projeto). */
  private build(a: AgentCard, input: AgentInput, loading: boolean): AgentCard {
    if (input.name !== undefined || loading) a.name = cleanName(input.name);
    const set = <K extends 'role' | 'instructions' | 'model'>(k: K, max: number, label: string, oneLine: boolean) => {
      if (input[k] === undefined) return;
      const v = cleanText(input[k], max, label, oneLine);
      if (v) a[k] = v;
      else delete a[k];
    };
    set('role', AGENT_ROLE_MAX, tr('papel'), true);
    set('instructions', AGENT_INSTRUCTIONS_MAX, tr('instruções'), false);
    set('model', AGENT_MODEL_MAX, tr('modelo'), true);
    if (input.look !== undefined) {
      if (input.look === null) delete a.look;
      else if (input.look === 'f' || input.look === 'm') a.look = input.look;
      else throw new AgentError('invalid', tr('{0} inválido', [tr('aparência')]));
    }
    if (input.projectId !== undefined) {
      if (input.projectId === null || input.projectId === '') delete a.projectId;
      else if (typeof input.projectId === 'string' && this.projectExists(input.projectId)) a.projectId = input.projectId;
      else if (loading) delete a.projectId;
      else throw new AgentError('invalid', tr('projeto desconhecido'));
    }
    return a;
  }

  private changed(): void {
    this.save();
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        log.warn(tr('Ouvinte falhou: {0}', [errMsg(err)]));
      }
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, agents: this.agents }, null, 2), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [this.file, errMsg(err)]));
    }
  }
}
