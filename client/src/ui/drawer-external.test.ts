import { afterEach, expect, it, vi } from 'vitest';
import { Drawer } from './drawer';
import type { UiContext } from './context';
import type { AgentInfo, OfficeSnapshot } from '../../../shared/types';
import { OfficeStore } from '../net/store';
import type { TerminalControl } from './terminal';
import type { PtyControl } from './pty';
import type { ConsultPanel } from './consult';
import { setAccess } from '../net/access';
import { h } from './dom';

// Minimal elements for constructing the real Drawer/AgentView/ConsultPanel;
// production setAttr/setHidden/setText and all lifecycle methods remain intact.
vi.mock('./dom', async importOriginal => ({
  ...await importOriginal<typeof import('./dom')>(),
  h: (tag: string, props: Record<string, any> = {}, ...children: any[]) => {
    const attrs = new Map<string, string>(); const classes = new Set<string>();
    const node: any = {
      tagName: tag.toUpperCase(), children: children.filter(x => x != null && x !== false), dataset: {},
      textContent: props.text ?? '', value: '', hidden: !!props.hidden, inert: false, disabled: false,
      classList: { add: (...s: string[]) => s.forEach(x => classes.add(x)), remove: (...s: string[]) => s.forEach(x => classes.delete(x)), contains: (s: string) => classes.has(s), toggle: (s: string, on: boolean) => on ? classes.add(s) : classes.delete(s) },
      style: { getPropertyValue: () => '', setProperty: vi.fn() },
      append(...items: any[]) { this.children.push(...items); }, prepend(...items: any[]) { this.children.unshift(...items); },
      replaceChildren(...items: any[]) { this.children = items; },
      setAttribute(name: string, value: string) { attrs.set(name, value); },
      hasAttribute: (name: string) => attrs.has(name), getAttribute: (name: string) => attrs.get(name) ?? null,
      removeAttribute: (name: string) => attrs.delete(name), addEventListener: vi.fn(), focus: vi.fn(),
      querySelectorAll: () => [],
    };
    for (const [name, value] of Object.entries(props.attrs ?? {})) if (value !== undefined) node.setAttribute(name, String(value));
    Object.defineProperty(node, 'childNodes', { get: () => node.children });
    return node;
  },
}));
vi.mock('./character-editor', () => ({ CharacterEditor: class { button = {}; el = {}; open = vi.fn(); close = vi.fn(); render = vi.fn(); } }));
vi.mock('./avatar', () => ({ createAvatarPlaceholder: () => ({ style: { getPropertyValue: () => '', setProperty: vi.fn() } }), updateAvatar: vi.fn() }));
vi.mock('./social', () => ({ SocialSection: class { el = {}; render = vi.fn(); } }));
vi.mock('./permission', () => ({ PermissionCard: class { el = {}; visible = false; render = vi.fn(); } }));
vi.mock('./composer', () => ({ MessageComposer: class { el = {}; render = vi.fn(); } }));
vi.mock('./project', () => ({ ProjectSection: class { el = {}; render = vi.fn(); } }));

interface AgentSeam {
  open(id: string): void;
  close(): void;
  render(): void;
  openRun(run: import('./runs-model').RunView): void;
  conversation: ConsultPanel;
  cardSec: { render: (a?: AgentInfo) => void };
  liveHeader: { hidden: boolean };
  liveWork: { hidden: boolean };
  work: { hidden: boolean; getAttribute(name: string): string | null; children: { textContent: string }[] };
  actText: { textContent: string };
  title: { textContent: string };
  msgSec: { el: { hidden: boolean } };
}
function agent(id: string, cardId?: string): AgentInfo {
  return { id, cardId, driverSession: `session-${id}`, sessionId: `session-${id}`, name: id, title: `Task ${id}`, account: 'local', roomId: 'room', provider: 'claude', kind: 'main', role: 'Agent', status: 'working', statusSince: 1, startedAt: 1, lastEventAt: 1, seed: 1, look: 'm', tasks: [], recent: [], stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, activity: { id: 'activity', kind: 'read', icon: '⚙', text: `Activity ${id}`, at: 1 } } as AgentInfo;
}
function setup(agents = [agent('card:ca', 'ca'), agent('external')], runs: unknown[] = []) {
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('document', { createElement: (tag: keyof HTMLElementTagNameMap) => h(tag), createTextNode: (text: string) => ({ textContent: text }), createDocumentFragment: () => h('div') });
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  setAccess({ remote: false, local: true, permissions: false, messages: false, terminal: false, spawn: false, agents: true });
  const store = new OfficeStore({ search: '' });
  const snapshot = { agents, rooms: [], accounts: [], serverTime: 10, meta: {} } as unknown as OfficeSnapshot;
  store.pushReplay(snapshot);
  vi.spyOn(store, 'runs').mockResolvedValue(runs as Awaited<ReturnType<OfficeStore['runs']>>);
  vi.spyOn(store, 'agentHistory').mockResolvedValue([]);
  const ctx = { agent: (id: string) => store.agent(id), account: () => undefined, now: () => 10,
    selection: () => ({ type: 'agent', id: 'external' }), store,
    invalidate: vi.fn(), select: vi.fn(), announce: vi.fn(), world: { getOptions: () => ({ followSelected: false }) },
  } as unknown as UiContext;
  const drawer = new Drawer(ctx, {} as TerminalControl, { enabled: false } as PtyControl);
  store.on('snapshot', () => drawer.render());
  return Object.assign((drawer as unknown as { agentView: AgentSeam }).agentView, {
    drawer, ctx, publish: () => store.pushReplay(snapshot),
  });
}
afterEach(() => { setAccess(null); vi.unstubAllGlobals(); });

it('after observing run A, external session clears old run association and exposes real readonly activity', () => {
  const view = setup();
  view.open('card:ca'); view.render();
  const conversation = view.conversation as unknown as { view: { turns: { role: string; text: string }[] }; apply(e: unknown): void; card?: unknown; observedRun?: unknown };
  conversation.view.turns = [{ role: 'user', text: 'Request A' }];
  conversation.apply({ type: 'run', runId: 'run-a' });
  expect(view.liveHeader.hidden).toBe(true);
  expect(view.liveWork.hidden).toBe(true);
  view.open('external'); view.render();
  expect(view.liveHeader.hidden).toBe(false);
  expect(view.liveWork.hidden).toBe(false);
  expect(view.work.getAttribute('data-run-id')).toBeNull();
  expect(view.work.children[0]!.textContent).toBe('');
  expect(conversation.card).toBeUndefined();
  expect(conversation.observedRun).toBeUndefined();
  expect(conversation.view.turns).toEqual([]);
  expect(view.title.textContent).toBe('Task external');
  expect(view.actText.textContent).toBe('Activity external');
  expect(view.work.hidden).toBe(true);
  expect(view.conversation.el.hidden).toBe(true);
  expect(view.msgSec.el.hidden).toBe(true);
});

it.each([
  { name: 'consult id matching cardId is not a card owner', owner: { kind: 'consult', id: 'ca', sessionId: 'unlinked' }, others: [], expected: false },
  { name: 'canonical driver session links despite a different mirror', owner: { kind: 'consult', id: 'consult', sessionId: 'sa' }, others: [], expected: true },
  { name: 'mirror session does not override canonical driver', owner: { kind: 'consult', id: 'consult', sessionId: 'mirror' }, others: [], expected: false },
  { name: 'ambiguous canonical session across all agents has no link', owner: { kind: 'consult', id: 'consult', sessionId: 'sa' }, others: [{ ...agent('sub'), kind: 'sub' as const, driverSession: undefined, sessionId: 'sa' }], expected: false },
  { name: 'ambiguous native session fallback has no link', owner: { kind: 'consult', id: 'consult', sessionId: 'mirror' }, others: [{ ...agent('b'), driverSession: 'mirror' }], expected: false, native: true },
  { name: 'valid explicit card wins over another agent session', owner: { kind: 'card', id: 'ca', sessionId: 'sb' }, others: [{ ...agent('b'), driverSession: 'sb' }], expected: true },
  { name: 'two explicit card matches remain ambiguous despite unique session', owner: { kind: 'card', id: 'ca', sessionId: 'sa' }, others: [agent('b', 'ca')], expected: false },
  { name: 'literal card tokens are not normalized', owner: { kind: 'card', id: ' ca ', sessionId: 'unlinked' }, others: [], expected: false },
])('Drawer history: $name', async ({ owner, others, expected, native }) => {
  const a = { ...agent('card:ca', 'ca'), driverSession: native ? undefined : 'sa', sessionId: 'mirror' };
  const run = { runId: 'history-run', state: 'done', prompt: 'REQUEST', text: 'ANSWER', at: 1, owner };
  const view = setup([a, ...others], [run]);
  view.open(a.id);
  await new Promise(resolve => setTimeout(resolve, 0));
  view.render();
  const history = view as unknown as { runs: { runId: string }[]; runsList: { children: unknown[] } };
  expect(history.runs.map(r => r.runId)).toEqual(expected ? ['history-run'] : []);
  expect(history.runsList.children).toHaveLength(expected ? 1 : 0);
  view.close();
});

interface ConversationSeam {
  card?: { id: string; name: string };
  observedRun?: unknown;
  explicitRunId?: string;
  view: { turns: { role: string; text: string }[]; busy: boolean; error?: string; runId?: string };
  input: { value: string; disabled: boolean };
  sendBtn: { disabled: boolean };
  discovery?: AbortController;
  stream?: AbortController;
  send(): Promise<void>;
  apply(e: unknown): void;
}
function conversationOf(view: AgentSeam): ConversationSeam {
  return view.conversation as unknown as ConversationSeam;
}

it('in-place snapshot card A to B rebinds conversation and next POST to B through Drawer render', async () => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  view.publish();
  const conversation = conversationOf(view);
  conversation.input.value = 'Draft A';
  conversation.view.turns = [{ role: 'user', text: 'Request A' }];
  conversation.apply({ type: 'run', runId: 'run-a' });
  const oldDiscovery = conversation.discovery!.signal;
  const cardRender = vi.spyOn(view.cardSec, 'render');
  a.cardId = 'cb'; a.name = 'B';
  view.publish();
  expect(conversation.card).toEqual({ id: 'cb', name: 'B' });
  expect(conversation.input.value).toBe('');
  expect(conversation.view.turns).toEqual([]);
  expect(conversation.observedRun).toBeUndefined();
  expect(view.work.getAttribute('data-run-id')).toBeNull();
  expect(view.work.children[0]!.textContent).toBe('');
  expect(oldDiscovery.aborted).toBe(true);
  expect(cardRender).toHaveBeenCalledWith(undefined);
  expect(cardRender).toHaveBeenLastCalledWith(a);
  conversation.input.value = 'Question B';
  void conversation.send();
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url)).toEqual(['/api/cards/cb/messages']);
  view.close();
});

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
}
const response = (body: unknown) => new Response(JSON.stringify(body));
const runA = { runId: 'run-a', state: 'done' as const, prompt: 'Request A', text: 'Answer A', at: 1, owner: { kind: 'card' as const, id: 'ca', sessionId: 'session-external' } };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('in-place A to B to A invalidates pending Drawer openRun GET without selecting its stale target', async () => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  view.publish();
  const pending = pendingResponse();
  vi.mocked(fetch).mockImplementation(url => String(url) === '/api/runs/run-a' ? pending.promise : new Promise(() => {}));
  const opening = view.drawer.openRun('run-a');
  const signal = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/runs/run-a')![1]!.signal!;
  a.cardId = 'cb'; view.publish();
  a.cardId = 'ca'; view.publish();
  expect(signal.aborted).toBe(true);
  pending.resolve(response(runA));
  await opening;
  expect(view.ctx.select).not.toHaveBeenCalled();
  expect(conversationOf(view).explicitRunId).toBeUndefined();
  expect(view.ctx.announce).not.toHaveBeenCalled();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/stop'))).toBe(false);
  view.close();
});

it('in-place card removal restores external readonly header/activity and clears run/draft without Stop', () => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  view.publish();
  const conversation = conversationOf(view);
  conversation.input.value = 'Draft A';
  conversation.apply({ type: 'run', runId: 'run-a' });
  const old = conversation.discovery!.signal;
  delete a.cardId; a.title = 'External task'; a.activity!.text = 'External activity';
  view.publish();
  expect(old.aborted).toBe(true);
  expect(conversation.card).toBeUndefined();
  expect(conversation.observedRun).toBeUndefined();
  expect(conversation.explicitRunId).toBeUndefined();
  expect(conversation.view.turns).toEqual([]);
  expect(conversation.input.value).toBe('');
  expect(view.liveHeader.hidden).toBe(false);
  expect(view.liveWork.hidden).toBe(false);
  expect(view.work.getAttribute('data-run-id')).toBeNull();
  expect(view.work.children[0]!.textContent).toBe('');
  expect(view.title.textContent).toBe('External task');
  expect(view.actText.textContent).toBe('External activity');
  expect(view.work.hidden).toBe(true);
  expect(view.conversation.el.hidden).toBe(true);
  expect(view.msgSec.el.hidden).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  view.close();
});

it('in-place external adoption binds B without another select or open', () => {
  const a = agent('external');
  const view = setup([a]);
  view.publish();
  a.cardId = 'cb'; a.name = 'B';
  view.publish();
  expect(conversationOf(view).card).toEqual({ id: 'cb', name: 'B' });
  expect(view.work.hidden).toBe(false);
  expect(view.conversation.el.hidden).toBe(false);
  expect(view.ctx.select).not.toHaveBeenCalled();
  view.close();
});

it.each(['driverSession', 'sessionId'] as const)('direct AgentView render copies canonical %s identity and resets same-card draft', key => {
  const a = agent('external', 'ca');
  if (key === 'sessionId') delete a.driverSession;
  const view = setup([a]);
  view.publish();
  const conversation = conversationOf(view);
  conversation.input.value = 'Old session draft';
  conversation.apply({ type: 'run', runId: 'run-a' });
  const old = conversation.discovery!.signal;
  a[key] = 'new-session';
  view.render();
  expect(old.aborted).toBe(true);
  expect(conversation.card?.id).toBe('ca');
  expect(conversation.input.value).toBe('');
  expect(conversation.observedRun).toBeUndefined();
  expect(conversation.view.turns).toEqual([]);
  expect(view.work.getAttribute('data-run-id')).toBeNull();
  view.close();
});

it('equal target preserves draft and pending discovery across repeated snapshot renders and open', () => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  view.publish();
  const conversation = conversationOf(view);
  conversation.input.value = 'Keep draft';
  const signal = conversation.discovery!.signal;
  const calls = vi.mocked(fetch).mock.calls.length;
  a.name = 'Renamed'; a.sessionId = 'changed mirror, same canonical session';
  view.publish(); view.render(); view.open(a.id); view.publish();
  expect(signal.aborted).toBe(false);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
  expect(conversation.input.value).toBe('Keep draft');
  view.close();
});

it('equal target keeps explicitly completed historic run across renders and tabs instead of discovering latest', async () => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  view.publish();
  vi.mocked(fetch).mockClear();
  vi.mocked(fetch).mockImplementation(url => String(url) === '/api/runs/run-a' ? Promise.resolve(response(runA)) : new Promise(() => {}));
  view.openRun(runA);
  await settle();
  const conversation = conversationOf(view);
  conversation.input.value = 'History draft';
  view.publish();
  const tabs = (view as unknown as { tabs: { setTab(tab: string): void } }).tabs;
  tabs.setTab('config'); view.publish(); tabs.setTab('work'); view.publish();
  await settle();
  expect(conversation.explicitRunId).toBe('run-a');
  expect(conversation.view.turns).toEqual([{ role: 'user', text: 'Request A' }, { role: 'assistant', text: 'Answer A' }]);
  expect(conversation.input.value).toBe('History draft');
  expect(view.work.getAttribute('data-run-id')).toBe('run-a');
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/runs/run-a', '/api/runs/run-a']);
  view.close();
});

it.each(['discovery', 'record'] as const)('A to B to A rejects old conversation %s GET after in-place rebinding', async phase => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  const pending = pendingResponse();
  const fetchMock = vi.mocked(fetch);
  let captured = false;
  fetchMock.mockImplementation(url => {
    if (!captured && String(url) === (phase === 'discovery' ? '/api/runs' : '/api/runs/run-a')) {
      captured = true;
      return pending.promise;
    }
    return new Promise(() => {});
  });
  view.publish();
  if (phase === 'record') view.openRun(runA);
  const conversation = conversationOf(view);
  const old = conversation.discovery!.signal;
  a.cardId = 'cb'; view.publish(); a.cardId = 'ca'; view.publish();
  conversation.input.value = 'Current A draft';
  pending.resolve(response(phase === 'discovery' ? { runs: [runA] } : runA));
  await settle(); await settle();
  expect(old.aborted).toBe(true);
  expect(conversation.card?.id).toBe('ca');
  expect(conversation.observedRun).toBeUndefined();
  expect(conversation.explicitRunId).toBeUndefined();
  expect(conversation.view.turns).toEqual([]);
  expect(conversation.input.value).toBe('Current A draft');
  expect(view.work.getAttribute('data-run-id')).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/events') || String(url).endsWith('/stop'))).toBe(false);
  view.close();
});

it.each(['SSE', 'send response'] as const)('in-place A to B to A rejects stale %s while preserving current draft and executor', async phase => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  view.publish();
  const conversation = conversationOf(view);
  const pending = pendingResponse();
  let events!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { events = c; } });
  vi.mocked(fetch).mockImplementation(url => {
    if (String(url) === '/api/runs/run-a') return Promise.resolve(response({ ...runA, state: 'running' }));
    if (String(url).endsWith('/events')) return Promise.resolve(new Response(body));
    if (String(url) === '/api/cards/ca/messages') return pending.promise;
    return new Promise(() => {});
  });
  let sending: Promise<void> | undefined;
  if (phase === 'SSE') {
    view.openRun({ ...runA, state: 'running' });
    await vi.waitFor(() => expect(conversation.stream).toBeDefined());
  } else {
    conversation.input.value = 'Question A';
    sending = conversation.send();
  }
  const old = conversation.stream!.signal;
  a.cardId = 'cb'; view.publish();
  expect(conversation.card?.id).toBe('cb');
  expect(conversation.view.busy).toBe(false);
  expect(conversation.input.disabled).toBe(false);
  expect(conversation.sendBtn.disabled).toBe(false);
  expect(view.conversation.el.hidden).toBe(false);
  a.cardId = 'ca'; view.publish();
  conversation.input.value = 'Current A draft';
  expect(old.aborted).toBe(true);
  events.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"STALE A"}\n\ndata: {"type":"error","message":"STALE ERROR"}\n\ndata: {"type":"done"}\n\n'));
  events.close();
  if (phase === 'send response') pending.resolve(new Response(body));
  if (sending) await sending;
  await settle(); await settle();
  expect(conversation.card?.id).toBe('ca');
  expect(conversation.view.turns).toEqual([]);
  expect(conversation.view.busy).toBe(false);
  expect(conversation.view.error).toBeUndefined();
  expect(conversation.observedRun).toBeUndefined();
  expect(conversation.input.value).toBe('Current A draft');
  expect(view.work.getAttribute('data-run-id')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/stop'))).toBe(false);
  view.close();
});

it('in-place A to B to A invalidates old card metadata GET before fields or schedules can be installed', async () => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  const pending = pendingResponse();
  let captured = false;
  vi.mocked(fetch).mockImplementation(url => {
    if (!captured && String(url) === '/api/cards/ca') { captured = true; return pending.promise; }
    return new Promise(() => {});
  });
  view.publish();
  a.cardId = 'cb'; view.publish(); a.cardId = 'ca'; view.publish();
  pending.resolve(response({ id: 'ca', name: 'STALE A', sessions: [] }));
  await settle();
  const config = view.cardSec as unknown as { card?: unknown; name: { value: string }; editBox: { hidden: boolean }; schedules: { load: (id: string) => Promise<void> } };
  expect(config.card).toBeUndefined();
  expect(config.name.value).toBe('');
  expect(config.editBox.hidden).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith('/api/schedules'))).toBe(false);
  view.close();
});

it('in-place A to B to A invalidates old run-list and timeline GETs', async () => {
  const a = agent('external', 'ca');
  const view = setup([a]);
  let resolveRuns!: (runs: unknown[]) => void;
  let resolveHistory!: (history: unknown[]) => void;
  const oldRuns = new Promise<unknown[]>(r => { resolveRuns = r; });
  const oldHistory = new Promise<unknown[]>(r => { resolveHistory = r; });
  vi.spyOn(view.ctx.store, 'runs').mockImplementationOnce(() => oldRuns as ReturnType<typeof view.ctx.store.runs>);
  vi.spyOn(view.ctx.store, 'agentHistory').mockImplementationOnce(() => oldHistory as ReturnType<typeof view.ctx.store.agentHistory>);
  view.publish();
  a.cardId = 'cb'; view.publish(); a.cardId = 'ca'; view.publish();
  await settle();
  resolveRuns([runA]);
  resolveHistory([{ id: 'stale', kind: 'read', icon: 'x', text: 'STALE A', at: 1 }]);
  await settle(); view.publish();
  const history = view as unknown as { history: { text: string }[]; runs: unknown[] };
  expect(history.runs).toEqual([]);
  expect(history.history.some(item => item.text === 'STALE A')).toBe(false);
  view.close();
});

it('closing AgentView invalidates CardSection continuations rather than only hiding conversation', () => {
  const view = setup();
  view.open('card:ca');
  const render = vi.spyOn(view.cardSec, 'render');
  view.close();
  expect(render).toHaveBeenCalledWith(undefined);
});

it('Drawer history revalidates runs when other snapshot agents change ambiguity without a new GET', async () => {
  const a = { ...agent('card:ca', 'ca'), driverSession: 'sa', sessionId: 'mirror' };
  const run = { runId: 'history-run', state: 'done', prompt: 'REQUEST', text: 'ANSWER', at: 1, owner: { kind: 'consult', id: 'consult', sessionId: 'sa' } };
  const agents: AgentInfo[] = [a];
  const view = setup(agents, [run]);
  const runsSpy = vi.mocked(view.ctx.store.runs);
  view.open(a.id);
  await new Promise(resolve => setTimeout(resolve, 0));
  view.render();
  const history = view as unknown as { runs: { runId: string }[]; runsList: { children: unknown[] } };
  expect(history.runs.map(r => r.runId)).toEqual(['history-run']);
  const gets = runsSpy.mock.calls.length;
  // Same array as the store snapshot: another agent appears in place (Drawer selection stays on A).
  agents.push({ ...agent('other'), sessionId: 'sa', driverSession: 'sa' });
  view.render();
  expect(history.runs).toEqual([]);
  expect(history.runsList.children).toHaveLength(0);
  agents.pop();
  view.render(); view.render();
  expect(history.runs.map(r => r.runId)).toEqual(['history-run']);
  expect(history.runsList.children).toHaveLength(1);
  expect(runsSpy.mock.calls.length).toBe(gets);
  view.close();
});
