// Projetos do Habblaud (sala = projeto, com zero ou mais pastas), persistidos em <dataDir>/projects.json.
// Uma pasta pertence a no máximo um projeto; o cwd de um agente casa com o projeto da pasta mais específica que é
// prefixo dele. Pasta fora de projeto continua virando sala sozinha (model/office.ts). O contexto fica guardado para
// as fichas de agente (entrega 3).
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';
import { pathKey } from '../model/room-aliases';

export const PROJECT_NAME_MAX = 40;
export const PROJECT_CONTEXT_MAX = 20_000;
export const PROJECT_PATHS_MAX = 50;

export interface Project {
  id: string;
  name: string;
  paths: string[];
  context?: string;
}

export interface ProjectInput {
  name?: string;
  paths?: string[];
  context?: string;
}

export class ProjectError extends Error {
  constructor(
    readonly code: 'invalid' | 'conflict' | 'unknown',
    message: string,
  ) {
    super(message);
  }
}

const isAbsolute = (p: string): boolean => p.startsWith('/') || /^[a-z]:[\\/]/i.test(p);

function cleanPath(p: unknown): string {
  if (typeof p !== 'string') throw new ProjectError('invalid', tr('pasta inválida'));
  const s = p.trim().replace(/\\/g, '/').replace(/\/+$/, '') || (p.trim().startsWith('/') ? '/' : '');
  if (!s || !isAbsolute(s) || s.length > 1024) throw new ProjectError('invalid', tr('a pasta precisa ser um caminho absoluto: {0}', [String(p)]));
  return s;
}

function cleanName(n: unknown): string {
  const s = typeof n === 'string' ? n.replace(/\s+/g, ' ').trim() : '';
  if (!s || s.length > PROJECT_NAME_MAX) throw new ProjectError('invalid', tr('o nome do projeto precisa ter de 1 a {0} letras', [PROJECT_NAME_MAX]));
  return s;
}

function cleanContext(c: unknown): string | undefined {
  if (c === undefined || c === null) return undefined;
  if (typeof c !== 'string' || c.length > PROJECT_CONTEXT_MAX) throw new ProjectError('invalid', tr('contexto inválido'));
  return c.trim() || undefined;
}

const copy = (p: Project): Project => ({ ...p, paths: [...p.paths] });

export class ProjectStore {
  private projects: Project[] = [];
  private readonly listeners: (() => void)[] = [];

  /** `file` null = só em memória (testes). */
  constructor(private readonly file: string | null) {}

  load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { projects?: unknown[] };
      const out: Project[] = [];
      for (const raw of j.projects ?? []) {
        const r = raw as Partial<Project>;
        try {
          if (typeof r.id !== 'string' || !/^p_[a-z0-9]{8}$/.test(r.id)) continue;
          const p: Project = { id: r.id, name: cleanName(r.name), paths: this.uniquePaths((r.paths ?? []).map(cleanPath)) };
          const ctx = cleanContext(r.context);
          if (ctx) p.context = ctx;
          if (p.paths.some((x) => this.owner(x, out))) continue;
          out.push(p);
        } catch {
          /* projeto inválido: ignorado */
        }
      }
      this.projects = out;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('projects.json ilegível ({0}); sem projetos.', [errMsg(err)]));
    }
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  list(): Project[] {
    return this.projects.map(copy);
  }

  get(id: string): Project | undefined {
    const p = this.projects.find((x) => x.id === id);
    return p && copy(p);
  }

  /** Projeto da pasta mais específica que contém `cwd`. */
  match(cwd: string): Project | undefined {
    const k = pathKey(cwd);
    let best: { p: Project; len: number } | undefined;
    for (const p of this.projects)
      for (const path of p.paths) {
        const pk = pathKey(path);
        if ((k === pk || k.startsWith(pk === '/' ? '/' : `${pk}/`)) && (!best || pk.length > best.len)) best = { p, len: pk.length };
      }
    return best && copy(best.p);
  }

  create(input: ProjectInput): Project {
    const p: Project = { id: `p_${randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 8)}`, name: cleanName(input.name), paths: this.checkPaths(input.paths ?? [], undefined) };
    const ctx = cleanContext(input.context);
    if (ctx) p.context = ctx;
    this.projects.push(p);
    this.changed();
    return copy(p);
  }

  update(id: string, input: ProjectInput): Project {
    const p = this.find(id);
    const next: Project = { ...p, name: input.name === undefined ? p.name : cleanName(input.name), paths: input.paths === undefined ? p.paths : this.checkPaths(input.paths, id) };
    if (input.context !== undefined) {
      const ctx = cleanContext(input.context);
      if (ctx) next.context = ctx;
      else delete next.context;
    }
    this.projects = this.projects.map((x) => (x.id === id ? next : x));
    this.changed();
    return copy(next);
  }

  addPaths(id: string, paths: string[]): Project {
    return this.update(id, { paths: [...this.find(id).paths, ...paths] });
  }

  remove(id: string): boolean {
    const before = this.projects.length;
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.projects.length === before) return false;
    this.changed();
    return true;
  }

  private find(id: string): Project {
    const p = this.projects.find((x) => x.id === id);
    if (!p) throw new ProjectError('unknown', tr('projeto desconhecido'));
    return p;
  }

  private uniquePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    return paths.filter((p) => !seen.has(pathKey(p)) && seen.add(pathKey(p)));
  }

  private owner(path: string, among: Project[] = this.projects, except?: string): Project | undefined {
    const k = pathKey(path);
    return among.find((p) => p.id !== except && p.paths.some((x) => pathKey(x) === k));
  }

  private checkPaths(paths: unknown, self: string | undefined): string[] {
    if (!Array.isArray(paths) || paths.length > PROJECT_PATHS_MAX) throw new ProjectError('invalid', tr('lista de pastas inválida'));
    const clean = this.uniquePaths(paths.map(cleanPath));
    for (const path of clean) {
      const other = this.owner(path, this.projects, self);
      if (other) throw new ProjectError('conflict', tr('a pasta {0} já está no projeto {1}', [path, other.name]));
    }
    return clean;
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
      writeFileSync(tmp, JSON.stringify({ version: 1, projects: this.projects }, null, 2), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [this.file, errMsg(err)]));
    }
  }
}
