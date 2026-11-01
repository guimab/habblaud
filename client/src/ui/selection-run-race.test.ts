import { afterEach, expect, it, vi } from 'vitest';
import { createUI } from './index';
import { Drawer } from './drawer';
import { SoundControl } from './sound';
import { OfficeStore } from '../net/store';
import type { Selection, WorldApi } from '../world/api';
import type { UiContext } from './context';

// The real createUI context, Drawer.openRun and selectionChanged; no canvas,
// unrelated panels, executor or network. Rendering is outside this race seam.
vi.mock('./daystats-launcher');
vi.mock('./roomrename');
vi.mock('./feed');
vi.mock('./help');
vi.mock('./history');
vi.mock('./deliveries');
vi.mock('./hovertip');
vi.mock('./notify');
vi.mock('./overlays');
vi.mock('./settings');
vi.mock('./sidebar');
vi.mock('./sound');
vi.mock('./terminal');
vi.mock('./pty');
vi.mock('./timelapse');
vi.mock('./toasts');
vi.mock('./version');
vi.mock('./update');
vi.mock('./viewport');
vi.mock('./world/world-popups');
vi.mock('./world/world-chip');
vi.mock('./world/world-dialog');
vi.mock('./world/away-summary');
vi.mock('./topbar', () => ({ TopBar: class {
  panelGroup = { prepend() {} };
  addPanelButton() {} addStatus() {} render() {}
} }));
vi.mock('./drawer', async original => {
  const { Drawer: RealDrawer } = await original<typeof import('./drawer')>();
  return { Drawer: vi.fn(function (ctx: UiContext) {
    return Object.assign(Object.create(RealDrawer.prototype), {
      ctx, el: new ElementStub(), standaloneOpen: false,
      render: vi.fn(), syncLayout: vi.fn(), agentView: { openRun: vi.fn() },
    });
  }) };
});
class ElementStub extends EventTarget {
  textContent = ''; children: unknown[] = [];
  classList = { add() {}, toggle() {} };
  style = { getPropertyValue: () => '', setProperty() {} };
  append(...children: unknown[]) { this.children.push(...children); }
  setAttribute() {}
}
function setup() {
  vi.stubGlobal('document', { createElement: () => new ElementStub(), addEventListener() {} });
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('setInterval', vi.fn());
  let selection: Selection = null;
  let onSelect!: (sel: Selection) => void;
  const world = {
    getSelection: () => selection, onSelect: (cb: typeof onSelect) => { onSelect = cb; },
    select: (sel: Selection) => { selection = sel; onSelect(sel); }, setOptions() {},
  } as unknown as WorldApi;
  const store = new OfficeStore();
  Object.defineProperty(store, 'snapshot', { value: { agents: [
    { id: 'a', cardId: 'ca', driverSession: 'sa' }, { id: 'b', cardId: 'cb', driverSession: 'sb' },
  ], rooms: [], accounts: [], meta: {} } });
  createUI(new ElementStub() as unknown as HTMLElement, store, world);
  const ctx = vi.mocked(SoundControl).mock.calls.at(-1)![0];
  const drawer = vi.mocked(Drawer).mock.results.at(-1)!.value as { openRun(id: string): Promise<void>; selectionChanged(): void; agentView: { openRun: ReturnType<typeof vi.fn> } };
  return { ctx, drawer, world };
}
const run = { runId: 'r-a', state: 'done', prompt: 'A request', text: 'A answer', owner: { kind: 'card', id: 'ca', sessionId: 'sa' }, updatedAt: 1 };
function pending() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
for (const route of ['ctx', 'world'] as const) {
  for (const returnToA of [false, true]) {
  it(`${route} selection ${returnToA ? 'A→B→A' : 'B'} invalidates pending run A exactly once per change and rejects its late result`, async () => {
    const { ctx, drawer, world } = setup();
    const get = pending(); const fetchMock = vi.fn((_url: string, _init?: RequestInit) => get.promise);
    vi.stubGlobal('fetch', fetchMock);
    const changed = vi.spyOn(drawer, 'selectionChanged');
    const opening = drawer.openRun('r-a');
    const signal = fetchMock.mock.calls[0]![1]!.signal as AbortSignal;
    (route === 'ctx' ? ctx : world).select({ type: 'agent', id: 'b' });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
    if (returnToA) (route === 'ctx' ? ctx : world).select({ type: 'agent', id: 'a' });
    expect(changed).toHaveBeenCalledTimes(returnToA ? 2 : 1);
    get.resolve(new Response(JSON.stringify(run)));
    await opening;
    expect(ctx.selection()).toEqual({ type: 'agent', id: returnToA ? 'a' : 'b' });
    expect(drawer.agentView.openRun).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  }
}
it('a valid openRun selects its linked agent without aborting its own completed GET', async () => {
  const { ctx, drawer } = setup();
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(run))));
  vi.stubGlobal('fetch', fetchMock);
  const changed = vi.spyOn(drawer, 'selectionChanged');
  await drawer.openRun('r-a');
  expect(ctx.selection()).toEqual({ type: 'agent', id: 'a' });
  expect(drawer.agentView.openRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ runId: 'r-a' }));
  expect(changed).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  ctx.select({ type: 'agent', id: 'a' });
  expect(changed).toHaveBeenCalledTimes(1);
  ctx.select(null);
  expect(changed).toHaveBeenCalledTimes(2);
});
