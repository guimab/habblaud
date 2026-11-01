import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsultPanel } from './consult';
import type { ConsultView } from './consult-model';

// Exercise the real asynchronous methods without constructing unrelated DOM.
interface ActionPanel {
  viewEpoch: number;
  view: ConsultView;
  consultId?: string;
  card?: { id: string; name: string };
  input: { value: string };
  status: { textContent: string };
  ctx: { announce: ReturnType<typeof vi.fn> };
  apply: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  promoteName: { value: string };
  promoteProject: { value: string };
  promoteBox: { hidden: boolean };
  steer(text: string): Promise<void>;
  stopRun(): Promise<void>;
  answerApproval(choice: 'once'): Promise<void>;
  promote(): Promise<void>;
  archive(): Promise<void>;
}
function panel(): ActionPanel {
  return Object.assign(Object.create(ConsultPanel.prototype), {
    viewEpoch: 1, view: { turns: [], busy: true, runId: 'r-a' }, consultId: 'c-a',
    input: { value: 'Draft A' }, status: { textContent: '' }, ctx: { announce: vi.fn() },
    apply: vi.fn(), render: vi.fn(), reset: vi.fn(), promoteName: { value: 'A' },
    promoteProject: { value: '' }, promoteBox: { hidden: false },
  }) as ActionPanel;
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  vi.stubGlobal('fetch', vi.fn(() => promise));
  return resolve;
}
function switchToB(p: ActionPanel) {
  p.viewEpoch++;
  p.view = { turns: [], busy: true, runId: 'r-b' };
  p.consultId = 'c-b';
  p.card = { id: 'card-b', name: 'B' };
  p.input.value = 'Draft B';
  p.status.textContent = 'Status B';
}
afterEach(() => vi.unstubAllGlobals());

const actions = {
  steer: (p: ActionPanel) => p.steer('Orientation A'),
  stop: (p: ActionPanel) => p.stopRun(),
  approval: (p: ActionPanel) => p.answerApproval('once'),
  promote: (p: ActionPanel) => p.promote(),
  archive: (p: ActionPanel) => p.archive(),
};
describe('discarded view does not accept delayed mutation results', () => {
  for (const [name, action] of Object.entries(actions)) {
    for (const success of [true, false]) {
      it(`${name}: late ${success ? 'success' : 'error'} of A cannot mutate B`, async () => {
        const p = panel();
        const resolve = deferred();
        const request = action(p);
        switchToB(p);
        resolve(new Response(JSON.stringify(success ? { id: 'card-a', name: 'A' } : { error: 'Failure A' }), { status: success ? 200 : 409 }));
        await request;
        expect(p.input.value).toBe('Draft B');
        expect(p.status.textContent).toBe('Status B');
        expect(p.consultId).toBe('c-b');
        expect(p.card?.id).toBe('card-b');
        expect(p.apply).not.toHaveBeenCalled();
        expect(p.reset).not.toHaveBeenCalled();
        expect(p.render).not.toHaveBeenCalled();
        expect(p.ctx.announce).not.toHaveBeenCalled();
      });
    }
  }
});
