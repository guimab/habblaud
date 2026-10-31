import { describe, expect, it } from 'vitest';
import { AgentStore } from '../agents/store';
import { setQuiet } from '../log';
import { ProjectStore } from '../projects/store';
import { NameStore } from './names';
import { Office } from './office';

setQuiet(true);

function setup() {
  const clock = 1_000_000;
  const projects = new ProjectStore(null);
  const agents = new AgentStore(null, (id) => !!projects.get(id));
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: clock,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    projects,
    agents,
    now: () => clock,
  });
  agents.onChange(() => office.relocate());
  projects.onChange(() => office.relocate());
  const add = (id: string, cwd: string, driverSession?: string) =>
    office.addMain({ id, account: 'acc', sessionId: `s-${id}`, cwd, role: 'Agente principal', startedAt: clock, status: 'working', ...(driverSession ? { driverSession } : {}) });
  const snap = () => office.commit().snapshot;
  return { office, projects, agents, add, snap };
}

describe('Office com fichas de agente', () => {
  it('ficha sem sessão viva aparece dormindo na sala do projeto', () => {
    const { projects, agents, snap } = setup();
    const p = projects.create({ name: 'Base', paths: ['/srv/kb'] });
    const c = agents.create({ name: 'Bibliotecária', role: 'busca', projectId: p.id, look: 'f' });
    const s = snap();
    const a = s.agents.find((x) => x.cardId === c.id);
    expect(a).toMatchObject({ id: `card:${c.id}`, name: 'Bibliotecária', look: 'f', role: 'busca', status: 'sleeping', roomId: `project:${p.id}`, kind: 'main' });
    expect(s.rooms.find((r) => r.id === `project:${p.id}`)).toMatchObject({ name: 'Base', project: p.id });
  });

  it('ficha sem projeto dorme na sala "Sem projeto"', () => {
    const { agents, snap } = setup();
    agents.create({ name: 'Solto' });
    const s = snap();
    expect(s.agents[0]!.roomId).toBe('agents:none');
    expect(s.rooms.find((r) => r.id === 'agents:none')?.name).toBeTruthy();
  });

  it('sessão ligada à ficha usa nome, aparência, papel e sala da ficha (não dorme mais)', () => {
    const { projects, agents, add, snap } = setup();
    const p = projects.create({ name: 'Ops', paths: [] });
    const c = agents.create({ name: 'Plantonista', role: 'k8s', projectId: p.id, look: 'm' });
    agents.attachSession(c.id, 'api_1');
    add('x', '/root', 'api_1');
    const s = snap();
    const live = s.agents.filter((a) => a.cardId === c.id);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ id: 'x', name: 'Plantonista', look: 'm', role: 'k8s', roomId: `project:${p.id}`, status: 'working', cwd: '/root' });
    expect(s.rooms.some((r) => r.id === '/root')).toBe(false);
  });

  it('adotar uma sessão viva depois muda nome e sala na hora; soltar devolve ao normal', () => {
    const { projects, agents, add, snap } = setup();
    const p = projects.create({ name: 'Ops', paths: [] });
    add('x', '/tmp/w', 'api_2');
    const before = snap().agents.find((a) => a.id === 'x')!;
    expect(before.roomId).toBe('/tmp/w');
    const c = agents.create({ name: 'Adotado', projectId: p.id });
    agents.attachSession(c.id, 'api_2');
    let a = snap().agents.find((x) => x.id === 'x')!;
    expect(a).toMatchObject({ name: 'Adotado', roomId: `project:${p.id}`, cardId: c.id });
    expect(snap().agents.some((x) => x.id === `card:${c.id}`)).toBe(false);
    agents.detachSession('api_2');
    a = snap().agents.find((x) => x.id === 'x')!;
    expect(a.cardId).toBeUndefined();
    expect(a.name).toBe(before.name);
    expect(a.roomId).toBe('/tmp/w');
    expect(snap().agents.find((x) => x.id === `card:${c.id}`)?.status).toBe('sleeping');
  });

  it('editar a ficha atualiza o agente vivo; apagar a ficha tira o dorminhoco', () => {
    const { agents, add, snap } = setup();
    const c = agents.create({ name: 'Ana' });
    agents.attachSession(c.id, 'api_3');
    add('y', '/w', 'api_3');
    agents.update(c.id, { name: 'Bia' });
    expect(snap().agents.find((x) => x.id === 'y')!.name).toBe('Bia');
    const d = agents.create({ name: 'Zé' });
    expect(snap().agents.some((x) => x.id === `card:${d.id}`)).toBe(true);
    agents.remove(d.id);
    expect(snap().agents.some((x) => x.id === `card:${d.id}`)).toBe(false);
  });
});
