import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardSection, type CardDto } from './card';
import type { AgentInfo } from '../../../shared/types';
import { setAccess } from '../net/access';
import { ScheduleSection } from './schedules';

interface CardHarness {
  render(a?: AgentInfo): void;
  save(): Promise<void>;
  newSession(): Promise<void>;
  chat(): void;
  release(): Promise<void>;
  remove(): Promise<void>;
  adopt(): Promise<void>;
  adoptSel: { value: string };
  loadedFor: string;
  card?: CardDto;
  name: { value: string };
  role: { value: string };
  model: { value: string };
  instructions: { value: string };
  editBox: { hidden: boolean; inert: boolean; querySelectorAll(): { disabled: boolean }[] };
  schedules: { load: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> };
  say: ReturnType<typeof vi.fn>;
  ctx: { chatCard: ReturnType<typeof vi.fn> };
}
const agent = (id: string) => ({ id: `card:${id}`, cardId: id, name: id, driverSession: `session-${id}` }) as AgentInfo;
const dto = (id: string, name = id): CardDto => ({ id, name, sessions: [] });
const response = (body: unknown) => new Response(JSON.stringify(body));
function pending() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
}
function panel(): CardHarness {
  setAccess({ remote: false, local: true, permissions: true, messages: true, terminal: true, agents: true, spawn: false });
  return Object.assign(Object.create(CardSection.prototype), {
    loadedFor: '', generation: 0,
    el: { hidden: true }, editBox: { hidden: true, inert: false, querySelectorAll: vi.fn().mockReturnValue([{ disabled: false }]) }, adoptBox: { hidden: true }, releaseBtn: { hidden: true },
    name: { value: '' }, role: { value: '' }, model: { value: '' }, instructions: { value: '' },
    project: { value: '', replaceChildren: vi.fn() }, adoptSel: { value: '', replaceChildren: vi.fn() },
    schedules: { load: vi.fn(), invalidate: vi.fn() }, say: vi.fn(),
    ctx: { store: { snapshot: { rooms: [] } }, chatCard: vi.fn() },
  }) as CardHarness;
}
// Only option creation needs DOM; asynchronous lifecycle methods are production methods.
vi.mock('./dom', async importOriginal => ({ ...await importOriginal<typeof import('./dom')>(), h: vi.fn(() => ({})) }));
afterEach(() => { setAccess(null); vi.unstubAllGlobals(); });

it('a late GET for A cannot install A fields/card into B or overwrite B through Save', async () => {
  const a = pending(); const b = pending();
  const fetchMock = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  vi.stubGlobal('fetch', fetchMock);
  const p = panel();
  p.render(agent('ca'));
  p.render(agent('cb'));
  a.resolve(response(dto('ca', 'A')));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await new Promise(r => setTimeout(r, 0));
  expect(p.card).toBeUndefined();
  expect(p.name.value).toBe('');
  await p.save();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  b.resolve(response(dto('cb', 'B')));
  await vi.waitFor(() => expect(p.card?.id).toBe('cb'));
  expect(p.name.value).toBe('B');
  expect(p.schedules.load).toHaveBeenCalledExactlyOnceWith('cb');
});

const settle = () => new Promise(r => setTimeout(r, 0));
it('switching or hiding the card invalidates its pending schedules before the next card GET', () => {
  vi.stubGlobal('fetch', vi.fn(() => pending().promise));
  const p = panel();
  p.render(agent('ca'));
  p.schedules.invalidate.mockClear();
  p.render(agent('cb'));
  expect(p.schedules.invalidate).toHaveBeenCalledTimes(1);
  p.render(undefined);
  expect(p.schedules.invalidate).toHaveBeenCalledTimes(2);
});
for (const success of [true, false]) {
  it(`schedule load: an obsolete A ${success ? 'result' : 'error'} cannot update the new A generation`, async () => {
    const old = pending();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response({ schedules: [], timeZone: 'Current' })));
    const s = Object.assign(Object.create(ScheduleSection.prototype), {
      cardId: '', loadGeneration: 0, renderList: vi.fn(), say: vi.fn(), tz: { textContent: '' },
    });
    const loading = s.load('ca');
    await s.load('cb'); await s.load('ca');
    s.renderList.mockClear(); s.say.mockClear();
    old.resolve(new Response(JSON.stringify(success ? { schedules: [], timeZone: 'Old' } : { error: 'Old error' }), { status: success ? 200 : 409 }));
    await loading;
    expect(s.renderList).not.toHaveBeenCalled();
    expect(s.say).not.toHaveBeenCalled();
    expect(s.tz.textContent).not.toContain('Old');
  });
}
for (const action of ['save', 'newSession', 'release', 'remove', 'adopt'] as const) {
  for (const success of [true, false]) {
    it(`${action}: late ${success ? 'success' : 'error'} stays in A's generation, not B`, async () => {
      const late = pending();
      const fetchMock = vi.fn(async (url: string) => response(url === '/api/cards' ? { cards: [] } : dto('ca', 'A')));
      vi.stubGlobal('fetch', fetchMock);
      vi.stubGlobal('confirm', () => true);
      const p = panel();
      p.render(agent('ca'));
      await vi.waitFor(() => expect(p.card?.id).toBe('ca'));
      if (action === 'adopt') {
        p.render({ ...agent('ca'), cardId: undefined });
        await settle();
        p.adoptSel.value = 'ca';
      }
      fetchMock.mockImplementationOnce(() => late.promise);
      const operation = p[action]();
      fetchMock.mockResolvedValue(response(dto('cb', 'B')));
      p.render(agent('cb'));
      await settle();
      const cardB = p.card;
      p.name.value = 'Draft B';
      p.say.mockClear();
      late.resolve(new Response(JSON.stringify(success ? dto('ca', 'Saved A') : { error: 'Failure A' }), { status: success ? 200 : 409 }));
      await operation;
      expect(p.card).toBe(cardB);
      expect(p.loadedFor).toBe('cb');
      expect(p.name.value).toBe('Draft B');
      expect(p.say).not.toHaveBeenCalled();
      expect(p.ctx.chatCard).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/stop'))).toBe(false);
    });
  }
}

it('same card preserves edits; changed target clears and blocks actions until its GET completes', async () => {
  const late = pending();
  const fetchMock = vi.fn().mockResolvedValueOnce(response(dto('ca', 'A'))).mockReturnValueOnce(late.promise);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('confirm', () => true);
  const p = panel();
  p.render(agent('ca'));
  await vi.waitFor(() => expect(p.card?.id).toBe('ca'));
  p.name.value = 'Edited A';
  p.render({ ...agent('ca'), name: 'snapshot A' });
  expect(p.name.value).toBe('Edited A');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  p.render(agent('cb'));
  expect(p.name.value).toBe('');
  expect(p.editBox.hidden || p.editBox.inert).toBe(true);
  expect(p.editBox.querySelectorAll()[0]!.disabled).toBe(true);
  p.chat(); await p.newSession(); await p.save(); await p.release(); await p.remove();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(p.ctx.chatCard).not.toHaveBeenCalled();
  late.resolve(response(dto('cb', 'B')));
  await vi.waitFor(() => expect(p.editBox.hidden).toBe(false));
});

for (const hide of [false, true]) {
  it(`${hide ? 'hide/reopen' : 'A→B→A'} rejects the original A GET and its late error`, async () => {
    const old = pending(); const current = pending();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(hide ? current.promise : Promise.resolve(response(dto('cb', 'B')))).mockReturnValueOnce(current.promise));
    const p = panel();
    p.render(agent('ca'));
    p.render(hide ? undefined : agent('cb'));
    p.render(agent('ca'));
    current.resolve(response(dto('ca', 'Current A')));
    await vi.waitFor(() => expect(p.name.value).toBe('Current A'));
    p.name.value = 'Edited current A'; p.say.mockClear();
    old.resolve(new Response(JSON.stringify({ error: 'Old A failed' }), { status: 409 }));
    await settle();
    expect(p.name.value).toBe('Edited current A');
    expect(p.say).not.toHaveBeenCalled();
  });
}

describe('adopt "Novo agente": captured session/target', () => {
  async function adoptNew() {
    const create = pending();
    const fetchMock = vi.fn(async (url: string) => response(url === '/api/cards' ? { cards: [] } : dto('x')));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('prompt', () => 'Novo');
    const p = panel();
    const a = { ...agent('ca'), cardId: undefined, roomId: 'room' } as AgentInfo;
    p.render(a);
    await settle();
    p.adoptSel.value = '+';
    fetchMock.mockImplementationOnce(() => create.promise);
    const op = p.adopt();
    return { p, a, fetchMock, create, op };
  }
  const adoptCalls = (m: ReturnType<typeof vi.fn>) => m.mock.calls.filter(([url]) => String(url).endsWith('/adopt'));

  it('obsolete generation with session mutated in place to B: no /adopt and no UI change', async () => {
    const { p, a, fetchMock, create, op } = await adoptNew();
    p.render(undefined);
    (a as { driverSession?: string }).driverSession = 'session-B';
    p.say.mockClear();
    create.resolve(response(dto('created-A')));
    await op;
    expect(adoptCalls(fetchMock)).toEqual([]);
    expect(p.say).not.toHaveBeenCalled();
  });

  it('same generation but session mutated in place: no /adopt', async () => {
    const { p, a, fetchMock, create, op } = await adoptNew();
    (a as { driverSession?: string }).driverSession = 'session-B';
    p.say.mockClear();
    create.resolve(response(dto('created-A')));
    await op;
    expect(adoptCalls(fetchMock)).toEqual([]);
    expect(p.say).not.toHaveBeenCalled();
  });

  it('legitimate adoption still posts /adopt with the original session', async () => {
    const { p, fetchMock, create, op } = await adoptNew();
    create.resolve(response(dto('created-A')));
    await op;
    const calls = adoptCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('/api/cards/created-A/adopt');
    expect(JSON.parse(String((calls[0]![1] as RequestInit).body))).toEqual({ sessionId: 'session-ca' });
    expect(p.say).toHaveBeenCalledWith(expect.stringContaining('Adotado'));
  });
});
