import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentError, AgentStore } from './store';

const projects = new Set(['p_aaaaaaaa']);
const mk = (file: string | null = null) => new AgentStore(file, (id) => projects.has(id));

describe('AgentStore', () => {
  it('cria, edita e apaga fichas com id a_xxxxxxxx', () => {
    const s = mk();
    const a = s.create({ name: '  Bibliotecária ', role: 'base de conhecimento', projectId: 'p_aaaaaaaa', instructions: 'Busque antes de responder.' });
    expect(a.id).toMatch(/^a_[a-z0-9]{8}$/);
    expect(a).toMatchObject({ name: 'Bibliotecária', role: 'base de conhecimento', projectId: 'p_aaaaaaaa', sessions: [], driver: 'hermes' });
    const b = s.update(a.id, { model: 'gpt-x', projectId: null, role: '' });
    expect(b.model).toBe('gpt-x');
    expect(b.projectId).toBeUndefined();
    expect(b.role).toBeUndefined();
    expect(s.remove(a.id)).toBe(true);
    expect(s.list()).toEqual([]);
    expect(s.remove(a.id)).toBe(false);
  });

  it('valida nome, instruções, projeto e look', () => {
    const s = mk();
    expect(() => s.create({ name: '' })).toThrow(AgentError);
    expect(() => s.create({ name: 'x'.repeat(41) })).toThrow(/1 a 40/);
    expect(() => s.create({ name: 'a', instructions: 'x'.repeat(20_001) })).toThrow(AgentError);
    try {
      s.create({ name: 'a', projectId: 'p_zzzzzzzz' });
    } catch (e) {
      expect((e as AgentError).code).toBe('invalid');
    }
    expect(() => s.create({ name: 'a', look: 'x' as 'f' })).toThrow(AgentError);
    expect(() => s.update('a_nonexist', { name: 'b' })).toThrow(expect.objectContaining({ code: 'unknown' }));
  });

  it('uma sessão pertence a no máximo uma ficha', () => {
    const s = mk();
    const a = s.create({ name: 'A' });
    const b = s.create({ name: 'B' });
    s.attachSession(a.id, 'api_1');
    s.attachSession(a.id, 'api_1'); // repetido não duplica
    expect(s.get(a.id)?.sessions).toEqual(['api_1']);
    expect(s.bySession('api_1')?.id).toBe(a.id);
    expect(() => s.attachSession(b.id, 'api_1')).toThrow(expect.objectContaining({ code: 'conflict' }));
    s.detachSession('api_1');
    expect(s.bySession('api_1')).toBeUndefined();
    s.attachSession(b.id, 'api_1');
    expect(s.bySession('api_1')?.name).toBe('B');
  });

  it('quando o projeto some, as fichas dele ficam sem projeto', () => {
    const s = mk();
    const a = s.create({ name: 'A', projectId: 'p_aaaaaaaa' });
    s.forgetProject('p_aaaaaaaa');
    expect(s.get(a.id)?.projectId).toBeUndefined();
  });

  it('avisa mudanças e grava em disco com permissão 600', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'agents-')), 'agents.json');
    const s = mk(file);
    let n = 0;
    s.onChange(() => n++);
    const a = s.create({ name: 'A', instructions: 'oi', look: 'f' });
    s.attachSession(a.id, 'api_2');
    expect(n).toBe(2);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).agents[0]).toMatchObject({ name: 'A', sessions: ['api_2'], look: 'f' });
    const t = mk(file);
    t.load();
    expect(t.list()).toEqual(s.list());
  });

  it('ao carregar ignora fichas inválidas e sessões repetidas', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'agents-')), 'agents.json');
    const s = mk(file);
    const a = s.create({ name: 'A' });
    s.attachSession(a.id, 's1');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.agents.push({ id: 'ruim', name: 'X' }, { id: 'a_bbbbbbbb', name: 'B', sessions: ['s1', 's2'] });
    writeFileSync(file, JSON.stringify(raw));
    const t = mk(file);
    t.load();
    expect(t.list().map((x) => [x.name, x.sessions])).toEqual([
      ['A', ['s1']],
      ['B', ['s2']],
    ]);
  });
});
