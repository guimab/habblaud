// Formulário "Novo projeto" (barra lateral), parte pura: valida o que foi digitado e monta os corpos das duas
// chamadas — o projeto e a primeira ficha (é a ficha que faz a sala existir no escritório). Sem DOM e sem rede.
import { tr } from '../../../shared/i18n';

/** Os mesmos limites do servidor (server/projects/store.ts, server/agents/store.ts). */
export const PROJECT_NAME_MAX = 40;
export const AGENT_NAME_MAX = 40;

export interface NewProjectFields {
  /** Nome do projeto. */
  project: string;
  /** Pasta do projeto; vazia = projeto só de conversa. */
  folder: string;
  /** Nome do primeiro agente (a ficha que traz a sala à vida). */
  agent: string;
}

export interface NewProjectPlan {
  project: { name: string; paths: string[] };
  card: { name: string };
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Caminho no padrão do servidor: barras invertidas viram normais e a barra final sai. */
export function cleanFolder(raw: string): string {
  const t = raw.trim().replace(/\\/g, '/');
  return t.length > 1 ? t.replace(/\/+$/, '') || '/' : t;
}

export function isAbsoluteFolder(p: string): boolean {
  return p.startsWith('/') || /^[a-z]:\//i.test(p);
}

/** null quando está tudo certo; senão, a mensagem para mostrar na própria linha do formulário. */
export function fieldsProblem(fields: NewProjectFields): string | null {
  const name = collapse(fields.project);
  if (!name || name.length > PROJECT_NAME_MAX) return tr('o nome do projeto precisa ter de 1 a {0} letras', [PROJECT_NAME_MAX]);
  const agent = collapse(fields.agent);
  if (!agent || agent.length > AGENT_NAME_MAX) return tr('o nome do agente precisa ter de 1 a {0} letras', [AGENT_NAME_MAX]);
  const folder = cleanFolder(fields.folder);
  if (folder && !isAbsoluteFolder(folder)) return tr('a pasta precisa ser um caminho absoluto: {0}', [folder]);
  return null;
}

/** O que enviar: POST /api/projects e, com o id que voltar, POST /api/cards. */
export function projectPlan(fields: NewProjectFields): NewProjectPlan {
  const folder = cleanFolder(fields.folder);
  return {
    project: { name: collapse(fields.project), paths: folder ? [folder] : [] },
    card: { name: collapse(fields.agent) },
  };
}
