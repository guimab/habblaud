import { afterEach, expect, it, vi } from 'vitest';
import { ConsultPanel } from './consult';
import type { ConsultView } from './consult-model';

// Real lifecycle, action and render methods; only element creation/Markdown DOM
// are replaced. Every HTTP/SSE response is local and deterministic.
vi.mock('./dom', async original => ({
  ...await original<typeof import('./dom')>(),
  h: (_tag: string, props: Record<string, any> = {}, ...children: unknown[]) => element(props, children),
}));
vi.mock('./markdown', () => ({ renderMarkdown: (text: string) => ({ textContent: text }) }));
function element(props: Record<string, any> = {}, children: unknown[] = []): any {
  const attrs = new Map<string, string>();
  return { children, textContent: props.text ?? '', hidden: !!props.hidden, value: '', disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    append(...items: unknown[]) { this.children.push(...items); },
    replaceChildren(...items: unknown[]) { this.children = items; },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => attrs.set(name, value),
    addEventListener() {}, focus() {},
  };
}
interface Seam {
  view: ConsultView; input: { value: string }; stopBtn: { hidden: boolean };
  sendBtn: { textContent: string }; approvalBox: { hidden: boolean };
  observedRun?: { runId: string }; stopRun(): Promise<void>; steer(text: string): Promise<void>;
  answerApproval(choice: 'once'): Promise<void>; send(): Promise<void>;
}
const oldRun = { runId: 'old-run', state: 'done', prompt: 'Old request', text: 'Old answer', owner: { kind: 'card' as const, id: 'ca', sessionId: 'sa' }, updatedAt: 1,
  approval: { command: 'old command', choices: ['once'] } };
const latestRun = { ...oldRun, runId: 'latest-run', prompt: 'Latest request', text: 'Latest answer', updatedAt: 2 };
function setup() {
  vi.stubGlobal('document', { createElement: () => element(), createTextNode: (text: string) => ({ textContent: text }) });
  const fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(
    init?.method === 'POST' ? new Response('data: {"type":"done"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) :
    new Response(JSON.stringify(url === '/api/runs' ? { runs: [oldRun, latestRun] } : url.includes('old-run') ? oldRun : latestRun))));
  vi.stubGlobal('fetch', fetchMock);
  const panel = new ConsultPanel({ announce: vi.fn() } as never, { embedded: true, readRun: true });
  return { panel, seam: panel as unknown as Seam, fetchMock };
}
afterEach(() => vi.unstubAllGlobals());
it('explicit completed History run survives tab hide/show and same-card render, keeping its draft without active-run actions', async () => {
  const { panel, seam, fetchMock } = setup();
  panel.openCard({ id: 'ca', name: 'A', fresh: true });
  panel.openRun('old-run', oldRun.owner);
  await vi.waitFor(() => expect(seam.view.turns.at(-1)?.text).toBe('Old answer'));
  seam.input.value = 'Unsent draft';
  panel.hide();
  panel.show();
  panel.openCard({ id: 'ca', name: 'A' });
  await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
  await new Promise(r => setTimeout(r, 0));
  expect(seam.view.turns).toEqual([{ role: 'user', text: 'Old request' }, { role: 'assistant', text: 'Old answer' }]);
  expect(seam.observedRun?.runId).toBe('old-run');
  expect(seam.input.value).toBe('Unsent draft');
  expect(seam.view.runId).toBeUndefined();
  expect(seam.view.busy).toBe(false);
  expect(seam.stopBtn.hidden).toBe(true);
  expect(seam.approvalBox.hidden).toBe(true);
  expect(seam.sendBtn.textContent).toBe('Enviar');
  await seam.stopRun(); await seam.steer('Do not steer'); await seam.answerApproval('once');
  expect(fetchMock.mock.calls.every(([url, init]) => url === '/api/runs/old-run' && (!init?.method || init.method === 'GET'))).toBe(true);
  panel.hide();
});
it('a new message from a completed explicit run is a card message, not a run action', async () => {
  const { panel, seam, fetchMock } = setup();
  panel.openRun('old-run', oldRun.owner);
  await vi.waitFor(() => expect(seam.view.turns.at(-1)?.text).toBe('Old answer'));
  seam.input.value = 'New request';
  await seam.send();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
    ['/api/cards/ca/messages', { text: 'New request' }],
  ]);
  expect(seam.view.turns.some(t => t.text === 'New request')).toBe(true);
  panel.hide();
});
it('a late historical reattach cannot replace a legitimate new card message', async () => {
  const { panel, seam, fetchMock } = setup();
  panel.openRun('old-run', oldRun.owner);
  await vi.waitFor(() => expect(seam.view.turns.at(-1)?.text).toBe('Old answer'));
  let resolve!: (response: Response) => void;
  const late = new Promise<Response>(r => { resolve = r; });
  fetchMock.mockImplementationOnce(() => late);
  panel.hide(); panel.show();
  const signal = fetchMock.mock.calls.at(-1)![1]!.signal!;
  seam.input.value = 'New request';
  await seam.send();
  resolve(new Response(JSON.stringify(oldRun)));
  await new Promise(r => setTimeout(r, 0));
  expect(seam.view.turns.some(t => t.text === 'New request')).toBe(true);
  expect(signal.aborted).toBe(true);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url)).toEqual(['/api/cards/ca/messages']);
  panel.hide();
});
it('a pending automatic completed-run GET cannot overwrite a new request or mix its SSE deltas', async () => {
  const { panel, seam, fetchMock } = setup();
  let resolveOld!: (response: Response) => void;
  let newEvents!: ReadableStreamDefaultController<Uint8Array>;
  const pendingOld = new Promise<Response>(resolve => { resolveOld = resolve; });
  const body = new ReadableStream<Uint8Array>({ start(controller) { newEvents = controller; } });
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/runs') return Promise.resolve(new Response(JSON.stringify({ runs: [oldRun] })));
    if (url === '/api/runs/old-run') return pendingOld; // deliberately ignores abort, like an already received response
    if (url === '/api/cards/ca/messages' && init?.method === 'POST') return Promise.resolve(new Response(body));
    throw new Error(`Unexpected local request: ${url}`);
  });
  panel.openCard({ id: 'ca', name: 'A' });
  await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/runs/old-run')).toBe(true));
  const oldSignal = fetchMock.mock.calls.find(([url]) => url === '/api/runs/old-run')![1]!.signal!;
  seam.input.value = 'NEW REQUEST';
  const sending = seam.send();
  const event = (data: object) => newEvents.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  event({ type: 'run', runId: 'new-run' });
  event({ type: 'delta', text: 'NEW PARTIAL' });
  await vi.waitFor(() => expect(seam.view.turns.at(-1)?.text).toBe('NEW PARTIAL'));
  resolveOld(new Response(JSON.stringify({ ...oldRun, prompt: 'OLD REQUEST', text: 'OLD ANSWER' })));
  await new Promise(resolve => setTimeout(resolve, 0));
  event({ type: 'delta', text: ' NEW DELTA' });
  await vi.waitFor(() => expect(seam.view.turns.at(-1)?.text).toContain('NEW DELTA'));
  newEvents.close();
  await sending;
  expect(seam.view.turns).toEqual([{ role: 'user', text: 'NEW REQUEST' }, { role: 'assistant', text: 'NEW PARTIAL NEW DELTA' }]);
  expect(oldSignal.aborted).toBe(true);
  expect(seam.observedRun?.runId).toBe('new-run');
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
    ['/api/cards/ca/messages', { text: 'NEW REQUEST' }],
  ]);
  panel.hide();
});
it('a new send invalidates pending automatic discovery before it can attach an old run', async () => {
  const { panel, seam, fetchMock } = setup();
  let resolveList!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveList = resolve; }));
  fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('data: {"type":"delta","text":"NEW ANSWER"}\n\ndata: {"type":"done"}\n\n')));
  panel.openCard({ id: 'ca', name: 'A' });
  const signal = fetchMock.mock.calls[0]![1]!.signal!;
  seam.input.value = 'NEW REQUEST';
  await seam.send();
  seam.input.value = 'NEXT DRAFT';
  resolveList(new Response(JSON.stringify({ runs: [oldRun] })));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(signal.aborted).toBe(true);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/runs', '/api/cards/ca/messages']);
  expect(seam.view.turns.map(t => t.text)).toEqual(['NEW REQUEST', 'NEW ANSWER']);
  expect(seam.input.value).toBe('NEXT DRAFT');
  panel.hide();
});
it('sending orientation to a busy active run preserves its observation and subsequent SSE', async () => {
  const { panel, seam, fetchMock } = setup();
  let events!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { events = controller; } });
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/cards/ca/messages') return Promise.resolve(new Response(body));
    if (url === '/api/runs/new-run/steer' && init?.method === 'POST') return Promise.resolve(new Response('{}'));
    return Promise.resolve(new Response(JSON.stringify({ ...oldRun, runId: 'new-run' })));
  });
  panel.openCard({ id: 'ca', name: 'A', fresh: true });
  seam.input.value = 'NEW REQUEST';
  const sending = seam.send();
  const signal = fetchMock.mock.calls[0]![1]!.signal!;
  const event = (data: object) => events.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  event({ type: 'run', runId: 'new-run' });
  event({ type: 'delta', text: 'NEW PARTIAL' });
  await vi.waitFor(() => expect(seam.view.turns.at(-1)?.text).toBe('NEW PARTIAL'));
  seam.input.value = 'ORIENTATION';
  await seam.send();
  expect(signal.aborted).toBe(false);
  expect(seam.input.value).toBe('');
  event({ type: 'delta', text: ' NEW DELTA' });
  await vi.waitFor(() => expect(seam.view.turns.at(-1)?.text).toBe('NEW PARTIAL NEW DELTA'));
  events.close();
  await sending;
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
    ['/api/cards/ca/messages', { text: 'NEW REQUEST' }], ['/api/runs/new-run/steer', { text: 'ORIENTATION' }],
  ]);
  expect(seam.view.turns).toEqual([{ role: 'user', text: 'NEW REQUEST' }, { role: 'assistant', text: 'NEW PARTIAL NEW DELTA' }]);
  panel.hide();
});
it('Nova Conversa explicitly releases the old completed run identity and permits a fresh card message', async () => {
  const { panel, seam, fetchMock } = setup();
  panel.openRun('old-run', oldRun.owner);
  await vi.waitFor(() => expect(seam.view.turns.at(-1)?.text).toBe('Old answer'));
  panel.openCard({ id: 'ca', name: 'A', fresh: true });
  panel.hide(); panel.show();
  expect(seam.view.turns).toEqual([]);
  expect(seam.observedRun).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  seam.input.value = 'Fresh request';
  await seam.send();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url)).toEqual(['/api/cards/ca/messages']);
  panel.hide();
});
