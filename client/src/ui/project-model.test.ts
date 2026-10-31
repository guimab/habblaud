import { describe, expect, it } from 'vitest';
import type { RoomInfo } from '../../../shared/types';
import { joinPlan, mergeTargets, pathsLabel } from './project-model';

const room = (id: string, name: string, path: string, project?: string, paths?: string[]): RoomInfo => ({ id, name, path, slot: 0, seed: 1, createdAt: 0, ...(project ? { project, paths } : {}) });

describe('project-model', () => {
  const solta = room('/a', 'a', '/a');
  const outra = room('/b', 'b', '/b');
  const proj = room('project:p_1', 'Base', '/x', 'p_1', ['/x', '/y']);

  it('alvos de "Juntar com…": as outras salas', () => {
    expect(mergeTargets(solta, [solta, outra, proj]).map((r) => r.id)).toEqual(['/b', 'project:p_1']);
  });

  it('juntar sala solta com projeto acrescenta a pasta; com outra sala solta cria projeto com as duas', () => {
    expect(joinPlan(solta, proj)).toEqual({ kind: 'add', projectId: 'p_1', paths: ['/a'] });
    expect(joinPlan(solta, outra)).toEqual({ kind: 'create', name: 'b', paths: ['/b', '/a'] });
  });

  it('juntar projeto com projeto: o alvo recebe as pastas e o de origem some', () => {
    const p2 = room('project:p_2', 'Ops', '/o', 'p_2', ['/o']);
    expect(joinPlan(p2, proj)).toEqual({ kind: 'merge', projectId: 'p_1', paths: ['/o'], removeId: 'p_2' });
    expect(joinPlan(proj, solta)).toEqual({ kind: 'add', projectId: 'p_1', paths: ['/a'] });
  });

  it('rótulo das pastas', () => {
    expect(pathsLabel(solta)).toBe('/a');
    expect(pathsLabel(proj)).toBe('/x +1');
    expect(pathsLabel(room('project:p_3', 'V', '', 'p_3', []))).toBe('');
  });
});
