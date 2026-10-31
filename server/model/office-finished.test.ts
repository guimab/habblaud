// Conclusão do turno no escritório: cada agente guarda quando terminou (e se terminou com erro) e o selo só
// desaparece quando alguém vê. Quem já viu fica gravado em <dataDir>/finished.json (0600).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { FinishedStore } from './finished';
import { NameStore } from './names';
import { Office } from './office';

setQuiet(true);

function makeOffice(finished?: FinishedStore) {
  let clock = 1_000_000;
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: clock,
    accounts: () => [],
    sources: () => [],
    accountName: () => 'Conta C',
    now: () => clock,
    ...(finished ? { finished } : {}),
  });
  const add = (id = 'acc:1') =>
    office.addMain({ id, account: 'acc', sessionId: `s-${id}`, cwd: '/p/a', role: 'Agente principal', startedAt: clock, status: 'working' });
  const snap = () => office.commit().snapshot;
  return { office, add, snap, advance: (ms: number) => (clock += ms), now: () => clock };
}

describe('FinishedStore', () => {
  it('guarda quem já viu e sobrevive ao reinício', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'dados', 'finished.json');
      const a = new FinishedStore(file);
      a.markSeen('acc:1', 1_000);
      expect(a.seenAt('acc:1')).toBe(1_000);
      expect(a.seenAt('acc:2')).toBeUndefined();
      expect(new FinishedStore(file).seenAt('acc:1')).toBe(1_000);
    } finally {
      tmp.cleanup();
    }
  });

  it('sem arquivo, guarda só na memória', () => {
    const s = new FinishedStore(null);
    s.markSeen('acc:1', 10);
    expect(s.seenAt('acc:1')).toBe(10);
  });
});

describe('Office: conclusão do turno', () => {
  it('marca quando o turno termina e só tira o selo quando alguém vê', () => {
    const { office, add, snap, advance, now } = makeOffice(new FinishedStore(null));
    add();
    expect(snap().agents[0].finishedAt).toBeUndefined();
    advance(5_000);
    office.setStatus('acc:1', 'idle');
    const done = snap().agents[0];
    expect(done.finishedAt).toBe(now());
    expect(done.finishedFailed).toBeUndefined();
    expect(done.finishedSeen).toBeUndefined();
    office.markFinishedSeen('acc:1');
    expect(snap().agents[0].finishedSeen).toBe(true);
  });

  it('turno que falhou aparece como falha, não como sucesso', () => {
    const { office, add, snap, now } = makeOffice(new FinishedStore(null));
    add();
    office.addActivity('acc:1', { id: 'e1', at: now(), kind: 'read', icon: '📖', text: 'Lendo x', error: true }, true);
    office.setStatus('acc:1', 'idle');
    expect(snap().agents[0].finishedFailed).toBe(true);
  });

  it('nova conclusão volta a valer como não vista', () => {
    const { office, add, snap, advance, now } = makeOffice(new FinishedStore(null));
    add();
    office.setStatus('acc:1', 'idle');
    office.markFinishedSeen('acc:1');
    expect(snap().agents[0].finishedSeen).toBe(true);
    // Novo turno que termina depois: o selo volta.
    advance(1_000);
    office.setStatus('acc:1', 'working');
    advance(1_000);
    office.setStatus('acc:1', 'idle');
    const a = snap().agents[0];
    expect(a.finishedAt).toBe(now());
    expect(a.finishedSeen).toBeUndefined();
  });

  it('sessão fechada também conta como conclusão', () => {
    const { office, add, snap, now } = makeOffice(new FinishedStore(null));
    add();
    office.setStatus('acc:1', 'offline');
    expect(snap().agents[0].finishedAt).toBe(now());
  });

  it('a marca de visto sobrevive ao reinício do escritório', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'finished.json');
      const seen = new FinishedStore(file);
      const first = makeOffice(seen);
      first.add();
      first.office.setStatus('acc:1', 'idle');
      first.office.markFinishedSeen('acc:1');
      const second = makeOffice(new FinishedStore(file));
      second.add();
      second.office.setStatus('acc:1', 'idle');
      // Mesmo agente e mesma hora de conclusão gravada: o selo não volta.
      const a = second.snap().agents[0];
      expect(a.finishedAt).toBe(first.now());
      expect(a.finishedSeen).toBe(true);
    } finally {
      tmp.cleanup();
    }
  });
});
