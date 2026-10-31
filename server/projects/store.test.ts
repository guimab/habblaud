import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectError, ProjectStore } from './store';

const mem = () => new ProjectStore(null);

describe('ProjectStore', () => {
  it('cria, lista e casa o cwd pela pasta mais específica', () => {
    const s = mem();
    const a = s.create({ name: 'Base', paths: ['/srv/kb'] });
    const b = s.create({ name: 'Cluster', paths: ['/srv/kb/k8s', '/opt/ops/'] });
    expect(a.id).toMatch(/^p_[a-z0-9]{8}$/);
    expect(s.list().map((p) => p.name)).toEqual(['Base', 'Cluster']);
    expect(s.match('/srv/kb/docs')?.id).toBe(a.id);
    expect(s.match('/srv/kb/k8s/manifests')?.id).toBe(b.id);
    expect(s.match('/OPT/ops')?.id).toBe(b.id);
    expect(s.match('/srv/kbx')).toBeUndefined();
    expect(s.match('/home')).toBeUndefined();
    expect(b.paths).toEqual(['/srv/kb/k8s', '/opt/ops']);
  });

  it('aceita projeto sem pasta e guarda o contexto', () => {
    const p = mem().create({ name: 'Ideias', paths: [], context: '  só conversa  ' });
    expect(p.paths).toEqual([]);
    expect(p.context).toBe('só conversa');
  });

  it('valida nome, pastas relativas e pasta já usada', () => {
    const s = mem();
    s.create({ name: 'A', paths: ['/a'] });
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof ProjectError ? e.code : 'outro';
      }
      return 'ok';
    };
    expect(code(() => s.create({ name: ' ', paths: [] }))).toBe('invalid');
    expect(code(() => s.create({ name: 'x'.repeat(41), paths: [] }))).toBe('invalid');
    expect(code(() => s.create({ name: 'B', paths: ['rel/x'] }))).toBe('invalid');
    expect(code(() => s.create({ name: 'B', paths: ['/A/'] }))).toBe('conflict');
    expect(code(() => s.update('nada', { name: 'x' }))).toBe('unknown');
  });

  it('update, addPaths e remove', () => {
    const s = mem();
    const a = s.create({ name: 'A', paths: ['/a'] });
    const b = s.create({ name: 'B', paths: ['/b'] });
    expect(s.update(a.id, { name: 'A2', context: 'c' })).toMatchObject({ name: 'A2', context: 'c', paths: ['/a'] });
    expect(() => s.addPaths(a.id, ['/b'])).toThrow(ProjectError);
    s.update(b.id, { paths: [] });
    expect(s.addPaths(a.id, ['/b', '/a']).paths).toEqual(['/a', '/b']);
    expect(s.remove(b.id)).toBe(true);
    expect(s.remove(b.id)).toBe(false);
    expect(s.list().map((p) => p.id)).toEqual([a.id]);
  });

  it('persiste com permissão 600 e recarrega; ignora arquivo ilegível', () => {
    const dir = mkdtempSync(join(tmpdir(), 'proj-'));
    const file = join(dir, 'projects.json');
    const s = new ProjectStore(file);
    s.load();
    const p = s.create({ name: 'A', paths: ['/a'], context: 'ctx' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const again = new ProjectStore(file);
    again.load();
    expect(again.list()).toEqual([p]);
    expect(JSON.parse(readFileSync(file, 'utf8')).projects).toHaveLength(1);
    writeFileSync(file, '{oops');
    const broken = new ProjectStore(file);
    broken.load();
    expect(broken.list()).toEqual([]);
  });

  it('avisa quem escuta a cada mudança', () => {
    const s = mem();
    let n = 0;
    s.onChange(() => n++);
    const p = s.create({ name: 'A', paths: [] });
    s.update(p.id, { name: 'B' });
    s.remove(p.id);
    expect(n).toBe(3);
  });
});
