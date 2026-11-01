import { afterEach, expect, it, vi } from 'vitest';
import { ConsultPanel } from './consult';
import type { ConsultView } from './consult-model';

interface Harness {
  view: ConsultView;
  viewEpoch: number;
  card?: { id: string; name: string };
  input: { value: string; focus: ReturnType<typeof vi.fn> };
  discovery?: AbortController;
  show(): void;
  hide(): void;
  disposeView(): void;
  openCard(card: { id: string; name: string; fresh?: boolean }): void;
}
function panel(): Harness {
  return Object.assign(Object.create(ConsultPanel.prototype), {
    viewEpoch: 0, view: { turns: [], busy: false },
    options: { embedded: true, readRun: true, onRun: vi.fn() },
    el: { hidden: true, inert: true, classList: { add: vi.fn(), remove: vi.fn() } },
    context: { focus: vi.fn() }, input: { value: 'Unsent draft', focus: vi.fn() },
    promoteBox: { hidden: true }, render: vi.fn(),
  }) as Harness;
}
function pending() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
}
const run = { runId: 'r-a', state: 'running', prompt: 'Real question', owner: { kind: 'card', id: 'ca', sessionId: 'session-a' }, updatedAt: 1 };
const response = (body: unknown) => new Response(JSON.stringify(body));
it('fresh card does not resume the previous run when shown', () => {
  const fetchMock = vi.fn(() => pending().promise);
  vi.stubGlobal('fetch', fetchMock);
  const p = panel();
  p.openCard({ id: 'ca', name: 'A', fresh: true });
  p.show();
  expect(fetchMock).not.toHaveBeenCalled();
});
afterEach(() => vi.unstubAllGlobals());

it('show is idempotent during attach GET and SSE, preserving draft and exactly one replayed partial', async () => {
  const get = pending();
  let events!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { events = c; } });
  const fetchMock = vi.fn((url: string) => url.endsWith('/events') ? Promise.resolve(new Response(body)) : get.promise);
  vi.stubGlobal('fetch', fetchMock);
  const p = panel();
  p.card = { id: 'ca', name: 'A' };
  p.view = { turns: [{ role: 'user', text: 'Real question' }, { role: 'assistant', text: 'Old partial' }], busy: false, runId: 'r-a' };
  p.show();
  const signal = p.discovery!.signal;
  p.show(); p.show();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  get.resolve(response(run));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  events.enqueue(new TextEncoder().encode('event: delta\ndata: {"type":"delta","text":"Replay partial"}\n\n'));
  await vi.waitFor(() => expect(p.view.turns.at(-1)?.text).toBe('Replay partial'));
  p.show(); p.show();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(p.view.turns).toEqual([{ role: 'user', text: 'Real question' }, { role: 'assistant', text: 'Replay partial' }]);
  expect(p.input.value).toBe('Unsent draft');
  expect(p.view.error).toBeUndefined();
  p.hide(); events.close();
  // Disposal aborts only local observation; reopening replays once, not append twice.
  const resumedGet = pending();
  const resumedBody = new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"Replay complete"}\n\n'));
  } });
  fetchMock.mockImplementation(url => url.endsWith('/events') ? Promise.resolve(new Response(resumedBody)) : resumedGet.promise);
  p.show(); p.show();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  resumedGet.resolve(response(run));
  await vi.waitFor(() => expect(p.view.turns.at(-1)?.text).toBe('Replay complete'));
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(p.view.turns).toEqual([{ role: 'user', text: 'Real question' }, { role: 'assistant', text: 'Replay complete' }]);
  expect(p.input.value).toBe('Unsent draft');
  p.hide();
});

it('same-card show/openCard during discovery does not restart it; show after dispose resumes discovery', async () => {
  const requests: ReturnType<typeof pending>[] = [];
  const fetchMock = vi.fn(() => { const request = pending(); requests.push(request); return request.promise; });
  vi.stubGlobal('fetch', fetchMock);
  const p = panel();
  const card = { id: 'ca', name: 'A' };
  p.openCard(card);
  p.input.value = 'Unsent draft';
  const signal = p.discovery!.signal;
  p.show(); p.openCard(card); p.show();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  p.hide();
  expect(signal.aborted).toBe(true);
  p.show();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  requests[0]!.resolve(response({ runs: [run] }));
  requests[1]!.resolve(response({ runs: [] }));
  await new Promise(r => setTimeout(r, 0));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(p.input.value).toBe('Unsent draft');
  expect(p.view.error).toBeUndefined();
});
