import { afterEach, expect, it, vi } from 'vitest';
import { ScheduleSection } from './schedules';

// Construct the actual section and use its actual load/create/act/render/say.
// Minimal DOM and deferred HTTP only; remote operations are never cancelled.
vi.mock('./dom', async original => ({
  ...await original<typeof import('./dom')>(),
  h: (_tag: string, props: Record<string, any> = {}, ...children: unknown[]) => {
    const classes = new Set<string>();
    return { children, value: props.attrs?.value ?? '', checked: props.attrs?.checked !== undefined,
      textContent: props.text ?? '', hidden: !!props.hidden,
      append(...items: unknown[]) { this.children.push(...items); },
      replaceChildren(...items: unknown[]) { this.children = items; },
      addEventListener() {},
      classList: { toggle: (s: string, on: boolean) => on ? classes.add(s) : classes.delete(s), contains: (s: string) => classes.has(s) },
    };
  },
}));
interface Seam {
  cardId: string; text: { value: string }; kind: { value: string };
  every: { value: string }; unit: { value: string };
  msg: { textContent: string; classList: { contains(s: string): boolean } };
  list: { children: unknown[] }; tz: { textContent: string };
  create(): Promise<void>; act(method: string, path: string, body: unknown, ok?: string): Promise<void>;
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function pending() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
}
function setup() {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response({ schedules: [], timeZone: 'Current' })));
  vi.stubGlobal('fetch', fetchMock);
  const section = new ScheduleSection();
  const seam = section as unknown as Seam;
  seam.kind.value = 'every'; seam.every.value = '1'; seam.unit.value = 'h';
  return { section, seam, fetchMock };
}
const actions = {
  create: (s: Seam) => s.create(),
  pause: (s: Seam) => s.act('PATCH', 'schedule-a', { enabled: false }),
  run: (s: Seam) => s.act('POST', 'schedule-a/run', {}, 'Sent A'),
  delete: (s: Seam) => s.act('DELETE', 'schedule-a', {}),
};
afterEach(() => vi.unstubAllGlobals());
for (const [name, action] of Object.entries(actions)) {
  for (const success of [true, false]) {
    for (const returnToA of [false, true]) {
      it(`${name} late ${success ? 'success' : 'error'} cannot change ${returnToA ? 'new A after A→B→A' : 'B'} or reload it`, async () => {
        const { section, seam, fetchMock } = setup();
        await section.load('ca');
        seam.text.value = 'Create A';
        const late = pending();
        fetchMock.mockImplementationOnce(() => late.promise);
        const mutation = action(seam);
        const mutationInit = fetchMock.mock.calls.at(-1)![1]!;
        expect(mutationInit.signal).toBeUndefined();
        if (name === 'create') expect(JSON.parse(String(mutationInit.body)).cardId).toBe('ca');
        await section.load('cb');
        if (returnToA) await section.load('ca');
        const target = returnToA ? 'ca' : 'cb';
        seam.text.value = `Draft ${target}`;
        seam.msg.textContent = `Message ${target}`;
        const list = seam.list.children;
        const tz = seam.tz.textContent;
        const count = fetchMock.mock.calls.length;
        late.resolve(response(success ? { last: { result: 'busy' } } : { error: 'Failure A' }, success ? 200 : 409));
        await mutation;
        expect(seam.text.value).toBe(`Draft ${target}`);
        expect(seam.msg.textContent).toBe(`Message ${target}`);
        expect(seam.msg.classList.contains('is-error')).toBe(false);
        expect(seam.list.children).toBe(list);
        expect(seam.tz.textContent).toBe(tz);
        expect(seam.cardId).toBe(target);
        expect(fetchMock).toHaveBeenCalledTimes(count);
        expect(mutationInit.signal).toBeUndefined();
        expect(fetchMock.mock.calls.some(([url]) => url.includes('/stop') || url.includes('/executor'))).toBe(false);
      });
    }
  }
}
for (const [name, action] of Object.entries(actions)) {
  for (const success of [true, false]) {
    it(`${name} current ${success ? 'success' : 'error'} still updates only A with its original reload semantics`, async () => {
      const { section, seam, fetchMock } = setup();
      await section.load('ca');
      seam.text.value = 'Create A';
      fetchMock.mockResolvedValueOnce(response(success ? {} : { error: 'Failure A' }, success ? 200 : 409));
      await action(seam);
      expect(seam.cardId).toBe('ca');
      expect(seam.text.value).toBe(name === 'create' && success ? '' : 'Create A');
      expect(seam.msg.textContent).toBe(!success ? 'Failure A' : name === 'create' ? 'Agenda criada.' : name === 'run' ? 'Sent A' : '');
      expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/schedules?')).map(([url]) => url)).toEqual(
        name === 'create' && !success ? ['/api/schedules?card=ca'] : ['/api/schedules?card=ca', '/api/schedules?card=ca']);
    });
  }
}
