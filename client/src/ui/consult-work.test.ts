import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsultPanel } from './consult';
import type { ConsultEvent, ConsultView } from './consult-model';
import type { RunView } from '../../../shared/types';

interface ObservedPanel {
  view: ConsultView;
  options: { readRun: boolean; onRun: ReturnType<typeof vi.fn> };
  observedRun?: Pick<RunView, 'runId' | 'state' | 'prompt'>;
  render: ReturnType<typeof vi.fn>;
  apply(event: ConsultEvent): void;
}
function panel(): ObservedPanel {
  return Object.assign(Object.create(ConsultPanel.prototype), {
    view: { turns: [{ role: 'user', text: 'Real request' }, { role: 'assistant', text: '' }], busy: true },
    options: { readRun: true, onRun: vi.fn() }, render: vi.fn(),
  }) as ObservedPanel;
}
afterEach(() => vi.unstubAllGlobals());
describe('Work observes actual turn metadata', () => {
  it('the run event publishes the returned id and real request, without invented owner/session', () => {
    const p = panel();
    p.apply({ type: 'run', runId: 'returned-run-id' });
    expect(p.options.onRun).toHaveBeenLastCalledWith({ runId: 'returned-run-id', state: 'running', prompt: 'Real request' });
  });
  it('completion reads the authoritative terminal state rather than assuming success', async () => {
    const p = panel();
    Object.assign(p, { viewEpoch: 1 });
    Object.defineProperty(p, 'isOpen', { value: true });
    p.observedRun = { runId: 'run-a', state: 'running', prompt: 'Real request' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ runId: 'run-a', state: 'interrupted', prompt: 'Real request', text: '', updatedAt: 10, owner: { kind: 'card', id: 'card-a', sessionId: 'session-a' } })));
    vi.stubGlobal('fetch', fetchMock);
    p.apply({ type: 'done' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(p.options.onRun.mock.lastCall?.[0]?.state).toBe('interrupted'));
  });
  it('a real approval event exposes waiting state', () => {
    const p = panel();
    p.observedRun = { runId: 'run-a', state: 'running', prompt: 'Real request' };
    p.apply({ type: 'approval', approval: { command: 'echo hello', choices: ['once', 'deny'] } });
    expect(p.options.onRun).toHaveBeenLastCalledWith({ runId: 'run-a', state: 'waiting', prompt: 'Real request' });
  });
});
