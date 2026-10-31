// Regras puras do painel de projeto da sala (ui/project.ts): para onde dá para juntar e o que cada junção faz.
import type { RoomInfo } from '../../../shared/types';

export type JoinPlan =
  | { kind: 'add'; projectId: string; paths: string[] }
  | { kind: 'create'; name: string; paths: string[] }
  | { kind: 'merge'; projectId: string; paths: string[]; removeId: string };

const roomPaths = (r: RoomInfo): string[] => (r.project ? (r.paths ?? []) : r.path ? [r.path] : []);

/** Salas com que `from` pode ser juntada: todas as outras. */
export function mergeTargets(from: RoomInfo, rooms: readonly RoomInfo[]): RoomInfo[] {
  return rooms.filter((r) => r.id !== from.id);
}

/**
 * Juntar `from` com `to`. Se um dos dois é projeto, ele fica (o alvo, quando os dois são) e recebe as pastas do
 * outro; dois projetos: o de origem é desfeito antes, para as pastas ficarem livres. Duas salas soltas: projeto novo
 * com o nome do alvo.
 */
export function joinPlan(from: RoomInfo, to: RoomInfo): JoinPlan {
  if (to.project && from.project) return { kind: 'merge', projectId: to.project, paths: roomPaths(from), removeId: from.project };
  if (to.project) return { kind: 'add', projectId: to.project, paths: roomPaths(from) };
  if (from.project) return { kind: 'add', projectId: from.project, paths: roomPaths(to) };
  return { kind: 'create', name: to.name, paths: [...roomPaths(to), ...roomPaths(from)] };
}

/** "/a" ou "/a +2" (projeto com mais pastas); vazio para projeto sem pasta. */
export function pathsLabel(r: RoomInfo): string {
  const ps = roomPaths(r);
  if (!ps.length) return '';
  return ps.length > 1 ? `${ps[0]} +${ps.length - 1}` : ps[0]!;
}
