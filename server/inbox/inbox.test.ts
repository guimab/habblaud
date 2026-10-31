import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PermissionRequestInfo } from '../../shared/types';
import type { RunRecord } from '../runs/manager';
import { Inbox, type InboxRuns } from './inbox';

// Inbox: o que espera você (aprovações, pedidos do Claude/Codex) e o que ficou pronto sem ninguém olhando.
function rec(p: Partial<RunRecord> & { runId: string }): RunRecord {
  return { owner: { kind: 'card', id: 'c1', sessionId: 's1', title: 'Revisora' }, state: 'done', text: '', lastSeq: 0, startedAt: 1, updatedAt: 2, ...p };
}

function fakeRuns(list: RunRecord[]) {
  const calls: string[] = [];
  const runs: InboxRuns = {
    list: () => list,
    approve: async (id, choice) => void calls.push(`approve ${id} ${choice}`),
  };
  return { runs, calls };
}

const perm = (id: string): PermissionRequestInfo => ({ id, tool: 'Bash', title: 'Rodar comando', text: 'npm test', icon: 'x', createdAt: 5, expiresAt: 99 });

describe('Inbox', () => {
  it('monta os itens: aprovação, pedido, pergunta, resposta, erro, interrompido; ignora ativos e vistos', () => {
    const { runs } = fakeRuns([
      rec({ runId: 'r1', state: 'waiting', approval: { command: 'rm x', description: 'apaga', choices: ['once', 'deny'] }, updatedAt: 10 }),
      rec({ runId: 'r2', state: 'done', text: 'x'.repeat(500) + ' Posso seguir? ', updatedAt: 20 }),
      rec({ runId: 'r3', state: 'done', text: 'Pronto.', updatedAt: 30, owner: { kind: 'consult', id: 'k1', sessionId: 's2', title: 'Consulta' } }),
      rec({ runId: 'r4', state: 'error', error: 'quebrou', updatedAt: 40 }),
      rec({ runId: 'r5', state: 'interrupted', error: 'sumiu', updatedAt: 50 }),
      rec({ runId: 'r6', state: 'running' }),
      rec({ runId: 'r7', state: 'done', text: 'visto', seen: true }),
    ]);
    const inbox = new Inbox({ runs, permissions: () => new Map([['agent-1', perm('p1')]]), agentName: (id) => (id === 'agent-1' ? 'Claude A' : undefined) });
    const items = inbox.items();
    expect(items.map((i) => [i.id, i.kind])).toEqual([
      ['run:r5', 'interrupted'],
      ['run:r4', 'error'],
      ['run:r3', 'reply'],
      ['run:r2', 'question'],
      ['run:r1', 'approval'],
      ['perm:p1', 'permission'],
    ]);
    expect(items.find((i) => i.id === 'run:r1')).toMatchObject({ title: 'Revisora', text: 'rm x', runId: 'r1', owner: { kind: 'card', id: 'c1' }, approval: { choices: ['once', 'deny'] } });
    expect(items.find((i) => i.id === 'run:r2')!.text.length).toBeLessThanOrEqual(301);
    expect(items.find((i) => i.id === 'run:r2')!.text.endsWith('Posso seguir?')).toBe(true);
    expect(items.find((i) => i.id === 'run:r4')!.text).toBe('quebrou');
    expect(items.find((i) => i.id === 'perm:p1')).toMatchObject({ title: 'Claude A', text: 'Rodar comando: npm test', permissionId: 'p1', agentId: 'agent-1', at: 5 });
    expect(inbox.count()).toBe(6);
  });

  it('dispensar tira o item e grava (0600); aprovação e pedido não se dispensam', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inbox-'));
    const file = join(dir, 'inbox.json');
    const { runs } = fakeRuns([rec({ runId: 'r1', text: 'ok' }), rec({ runId: 'r2', state: 'waiting', approval: { command: 'x', choices: ['once', 'deny'] } })]);
    const inbox = new Inbox({ runs, file });
    inbox.dismiss('run:r1');
    expect(inbox.items().map((i) => i.id)).toEqual(['run:r2']);
    expect(() => inbox.dismiss('run:r2')).toThrow(/aprov/);
    expect(() => inbox.dismiss('run:nada')).toThrow(/desconhecido/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, 'utf8')).dismissed).toEqual(['run:r1']);
    expect(new Inbox({ runs, file }).items().map((i) => i.id)).toEqual(['run:r2']);
  });

  it('dispensar tudo e esquecer ids de runs que não existem mais', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inbox-'));
    const file = join(dir, 'inbox.json');
    const list = [rec({ runId: 'r1', text: 'a' }), rec({ runId: 'r2', text: 'b' })];
    const { runs } = fakeRuns(list);
    const inbox = new Inbox({ runs, file });
    expect(inbox.dismissAll()).toBe(2);
    expect(inbox.count()).toBe(0);
    list.splice(0, 1);
    inbox.dismissAll();
    expect(JSON.parse(readFileSync(file, 'utf8')).dismissed).toEqual(['run:r2']);
  });

  it('aprovar pela Inbox repassa a escolha ao run', async () => {
    const { runs, calls } = fakeRuns([rec({ runId: 'r1', state: 'waiting', approval: { command: 'x', choices: ['once', 'session', 'deny'] } })]);
    const inbox = new Inbox({ runs });
    await inbox.approve('run:r1', 'session');
    expect(calls).toEqual(['approve r1 session']);
    await expect(inbox.approve('perm:p1', 'once')).rejects.toThrow(/aprovação/);
  });
});
