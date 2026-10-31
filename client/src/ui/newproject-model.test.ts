import { describe, expect, it } from 'vitest';
import { cleanFolder, fieldsProblem, isAbsoluteFolder, projectPlan, AGENT_NAME_MAX, PROJECT_NAME_MAX } from './newproject-model';

const ok = { project: 'meu-app', folder: '/root/projetos/meu-app', agent: 'Ana' };

describe('formulário de novo projeto', () => {
  it('nome do projeto: obrigatório, espaços colapsados e limite do servidor', () => {
    expect(fieldsProblem({ ...ok, project: '  meu   app ' })).toBeNull();
    expect(fieldsProblem({ ...ok, project: '   ' })).toBe(`o nome do projeto precisa ter de 1 a ${PROJECT_NAME_MAX} letras`);
    expect(fieldsProblem({ ...ok, project: 'x'.repeat(PROJECT_NAME_MAX + 1) })).toContain('o nome do projeto');
  });

  it('primeiro agente: obrigatório e com o mesmo limite das fichas', () => {
    expect(fieldsProblem({ ...ok, agent: ' Ana ' })).toBeNull();
    expect(fieldsProblem({ ...ok, agent: '' })).toBe(`o nome do agente precisa ter de 1 a ${AGENT_NAME_MAX} letras`);
    expect(fieldsProblem({ ...ok, agent: 'x'.repeat(AGENT_NAME_MAX + 1) })).toContain('o nome do agente');
  });

  it('pasta: vazia vale (projeto só de conversa) e relativa é recusada', () => {
    expect(fieldsProblem({ ...ok, folder: '' })).toBeNull();
    expect(fieldsProblem({ ...ok, folder: 'projetos/app' })).toBe('a pasta precisa ser um caminho absoluto: projetos/app');
    expect(fieldsProblem({ ...ok, folder: '/root/projetos/app' })).toBeNull();
    expect(fieldsProblem({ ...ok, folder: 'C:\\dev\\app' })).toBeNull();
  });

  it('normaliza a pasta como o servidor: barras invertidas e barra final', () => {
    expect(cleanFolder('/root/projetos/app/')).toBe('/root/projetos/app');
    expect(cleanFolder('  C:\\dev\\app  ')).toBe('C:/dev/app');
    expect(cleanFolder('/')).toBe('/');
    expect(isAbsoluteFolder('C:/dev')).toBe(true);
    expect(isAbsoluteFolder('~/dev')).toBe(false);
  });

  it('monta as duas chamadas: projeto (com as pastas) e primeira ficha', () => {
    expect(projectPlan({ project: '  meu   app ', folder: '/root/projetos/app/', agent: ' Ana ' })).toEqual({
      project: { name: 'meu app', paths: ['/root/projetos/app'] },
      card: { name: 'Ana' },
    });
    expect(projectPlan({ project: 'só conversa', folder: '', agent: 'Ana' })).toEqual({
      project: { name: 'só conversa', paths: [] },
      card: { name: 'Ana' },
    });
  });
});
