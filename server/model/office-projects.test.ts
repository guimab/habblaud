import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { ProjectStore } from '../projects/store';
import { NameStore } from './names';
import { Office, OFFLINE_GRACE_MS } from './office';

setQuiet(true);

function setup() {
  let clock = 1_000_000;
  const projects = new ProjectStore(null);
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: clock,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    projects,
    now: () => clock,
  });
  const add = (id: string, cwd: string) => office.addMain({ id, account: 'acc', sessionId: `s-${id}`, cwd, role: 'x', startedAt: clock, status: 'working' });
  const snap = () => office.commit().snapshot;
  return { office, projects, add, snap, advance: (ms: number) => (clock += ms) };
}

describe('Office com projetos', () => {
  it('agente em pasta de projeto entra na sala do projeto e guarda o próprio cwd', () => {
    const { projects, add, snap } = setup();
    const p = projects.create({ name: 'Base', paths: ['/srv/kb', '/srv/docs'] });
    add('a', '/srv/kb/x');
    add('b', '/srv/docs');
    add('c', '/home/solta');
    const s = snap();
    const room = s.rooms.find((r) => r.id === `project:${p.id}`);
    expect(room).toMatchObject({ name: 'Base', project: p.id, paths: ['/srv/kb', '/srv/docs'], path: '/srv/kb' });
    expect(s.agents.filter((a) => a.roomId === room!.id).map((a) => a.id).sort()).toEqual(['a', 'b']);
    expect(s.agents.find((a) => a.id === 'a')!.cwd).toBe('/srv/kb/x');
    expect(s.agents.find((a) => a.id === 'c')!.roomId).toBe('/home/solta');
    expect(s.rooms.find((r) => r.id === '/home/solta')!.project).toBeUndefined();
  });

  it('criar, renomear e desfazer projeto muda as salas dos agentes vivos (e dos subagentes)', () => {
    const { office, projects, add, snap } = setup();
    add('a', '/p/um');
    add('b', '/p/dois');
    office.addSub({ id: 'a/sub', parentId: 'a', sessionId: 's-a', role: 'sub', background: false, startedAt: 1 });
    expect(snap().rooms.map((r) => r.id).sort()).toEqual(['/p/dois', '/p/um']);

    const p = projects.create({ name: 'Junto', paths: ['/p/um', '/p/dois'] });
    office.relocate();
    let s = snap();
    expect(s.rooms.map((r) => r.id)).toEqual([`project:${p.id}`]);
    expect(new Set(s.agents.map((a) => a.roomId))).toEqual(new Set([`project:${p.id}`]));

    projects.update(p.id, { name: 'Novo nome' });
    office.relocate();
    expect(snap().rooms[0]!.name).toBe('Novo nome');

    projects.remove(p.id);
    office.relocate();
    s = snap();
    expect(s.rooms.map((r) => r.id).sort()).toEqual(['/p/dois', '/p/um']);
    expect(s.agents.find((a) => a.id === 'a/sub')!.roomId).toBe('/p/um');
  });

  it('sala de projeto some quando o último agente sai', () => {
    const { office, projects, add, snap, advance } = setup();
    projects.create({ name: 'X', paths: ['/x'] });
    add('a', '/x');
    expect(snap().rooms).toHaveLength(1);
    office.closeMain('a');
    advance(OFFLINE_GRACE_MS + 1);
    office.tick();
    expect(snap().rooms).toHaveLength(0);
  });

  it('roomPath da sala de projeto é a primeira pasta; projeto sem pasta não tem caminho', () => {
    const { office, projects, add } = setup();
    const p = projects.create({ name: 'X', paths: ['/x', '/y'] });
    add('a', '/y/z');
    expect(office.roomPath(`project:${p.id}`)).toBe('/x');
    expect(office.get('a')!.cwd).toBe('/y/z');
  });
});
