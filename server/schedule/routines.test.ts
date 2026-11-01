import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobsError, type HermesJob } from '../drivers/hermes/jobs';
import { createRoutineRoutes, type JobsApi } from './routines';
import { Scheduler } from './scheduler';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

function job(over: Partial<HermesJob> = {}): HermesJob {
  return { id: 'j1', name: 'Resumo', prompt: 'p', schedule: { kind: 'cron', display: '0 9 * * *', expr: '0 9 * * *' }, enabled: true, state: 'scheduled', deliver: 'local', repeat: { completed: 0 }, skills: [], ...over };
}

function fakeJobs(over: Partial<JobsApi> = {}): JobsApi & { calls: string[] } {
  const calls: string[] = [];
  const rec = <T>(name: string, v: T) => async (...args: unknown[]) => {
    calls.push(`${name} ${args.map((a) => JSON.stringify(a)).join(' ')}`.trim());
    return v;
  };
  return {
    calls,
    list: rec('list', [job()]),
    get: rec('get', job()),
    create: rec('create', job({ id: 'j2' })),
    update: rec('update', job()),
    pause: rec('pause', job({ enabled: false, state: 'paused' })),
    resume: rec('resume', job()),
    run: rec('run', job()),
    remove: rec('remove', undefined),
    ...over,
  } as JobsApi & { calls: string[] };
}

async function setup(opts: { jobs?: JobsApi; scheduler?: Scheduler | null; allowed?: boolean; sleep?: (ms: number) => Promise<void>; watchMs?: number } = {}) {
  const scheduler = opts.scheduler === null ? undefined : (opts.scheduler ?? new Scheduler({ start: vi.fn(async () => 'r'), cardExists: (id) => id === 'c1', tickMs: 0 }));
  const route = createRoutineRoutes({
    ...(scheduler ? { scheduler } : {}),
    ...(opts.jobs ? { jobs: opts.jobs } : {}),
    sleep: opts.sleep ?? (async () => {}),
    ...(opts.watchMs !== undefined ? { watchMs: opts.watchMs } : {}),
  });
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (!route(req, res, path, req.method ?? 'GET', opts.allowed ?? true)) {
      res.statusCode = 418;
      res.end();
    }
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) });
    return { status: r.status, body: await r.json() };
  };
  return { call, scheduler };
}

describe('rotas /api/routines', () => {
  it('não reconhece outras rotas', async () => {
    await setup();
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/api/schedules`)).status).toBe(418);
    expect((await fetch(`${base}/api/routinesX`)).status).toBe(418);
  });

  it('lista as duas origens com chave origem:id, sem misturar', async () => {
    const jobs = fakeJobs();
    const { call, scheduler } = await setup({ jobs });
    const s = scheduler!.create({ cardId: 'c1', text: 'veja', rule: { kind: 'every', minutes: 60 } });
    const r = await call('GET', '/api/routines');
    expect(r.status).toBe(200);
    expect(r.body.sources).toEqual({ habblaud: { ok: true, timeZone: expect.any(String) }, hermes: { ok: true } });
    expect(r.body.routines).toEqual([
      { key: `habblaud:${s.id}`, source: 'habblaud', id: s.id, habblaud: expect.objectContaining({ id: s.id, cardId: 'c1' }) },
      { key: 'hermes:j1', source: 'hermes', id: 'j1', hermes: expect.objectContaining({ id: 'j1', name: 'Resumo' }) },
    ]);
    expect(jobs.calls).toEqual(['list']);
  });

  it('falha do Hermes vira erro da origem, nunca lista vazia silenciosa; Habblaud continua', async () => {
    const jobs = fakeJobs({ list: async () => { throw new JobsError('unavailable', 'Hermes fora do ar'); } });
    const { call, scheduler } = await setup({ jobs });
    scheduler!.create({ cardId: 'c1', text: 'veja', rule: { kind: 'every', minutes: 60 } });
    const r = await call('GET', '/api/routines');
    expect(r.status).toBe(200);
    expect(r.body.sources.hermes).toEqual({ ok: false, code: 'unavailable', error: 'Hermes fora do ar' });
    expect(r.body.routines.map((x: { source: string }) => x.source)).toEqual(['habblaud']);
  });

  it('sem Hermes configurado / sem agendador: origem desligada explícita', async () => {
    const { call } = await setup({ scheduler: null });
    const r = await call('GET', '/api/routines');
    expect(r.body.sources).toEqual({ habblaud: { ok: false, code: 'off', error: expect.any(String) }, hermes: { ok: false, code: 'off', error: expect.any(String) } });
    expect(r.body.routines).toEqual([]);
    expect((await call('PATCH', '/api/routines/hermes/j1', { name: 'x' })).status).toBe(503);
  });

  it('ações Hermes vão só ao Hermes, com o corpo filtrado', async () => {
    const jobs = fakeJobs();
    const { call } = await setup({ jobs });
    expect((await call('GET', '/api/routines/hermes/j1')).body).toMatchObject({ id: 'j1' });
    expect((await call('POST', '/api/routines/hermes', { name: 'n', schedule: 'every 2h', prompt: 'p', paused: true, model: 'x' })).status).toBe(201);
    expect((await call('PATCH', '/api/routines/hermes/j1', { prompt: 'novo', model: 'x' })).status).toBe(200);
    await call('POST', '/api/routines/hermes/j1/pause');
    await call('POST', '/api/routines/hermes/j1/resume');
    expect((await call('DELETE', '/api/routines/hermes/j1')).body).toEqual({ ok: true });
    expect(jobs.calls).toEqual([
      'get "j1"',
      'create {"name":"n","schedule":"every 2h","prompt":"p","paused":true}',
      'update "j1" {"prompt":"novo"}',
      'pause "j1"',
      'resume "j1"',
      'remove "j1"',
    ]);
  });

  it('erros do Hermes viram status HTTP coerentes com a mensagem', async () => {
    const make = (code: ConstructorParameters<typeof JobsError>[0]) => fakeJobs({ update: async () => { throw new JobsError(code, `msg ${code}`); } });
    for (const [code, status] of [['invalid', 400], ['not_found', 404], ['auth', 502], ['unavailable', 503], ['failed', 502]] as const) {
      const { call } = await setup({ jobs: make(code) });
      const r = await call('PATCH', '/api/routines/hermes/j1', { name: 'x' });
      expect([code, r.status, r.body]).toEqual([code, status, { error: `msg ${code}`, code }]);
      await new Promise((r2) => server!.close(r2));
      server = undefined;
    }
  });

  it('escrita sem a feature agents: 403 e nada chega ao Hermes; leitura liberada', async () => {
    const jobs = fakeJobs();
    const { call } = await setup({ jobs, allowed: false });
    expect((await call('GET', '/api/routines')).status).toBe(200);
    for (const [m, p] of [['POST', '/api/routines/hermes'], ['PATCH', '/api/routines/hermes/j1'], ['DELETE', '/api/routines/hermes/j1'], ['POST', '/api/routines/hermes/j1/run'], ['POST', '/api/routines/hermes/j1/pause']] as const) {
      expect((await call(m, p, {})).status).toBe(403);
    }
    expect(jobs.calls).toEqual(['list']);
  });

  it('métodos e rotas errados', async () => {
    const { call } = await setup({ jobs: fakeJobs() });
    expect((await call('PUT', '/api/routines')).status).toBe(405);
    expect((await call('GET', '/api/routines/hermes/j1/run')).status).toBe(405);
    expect((await call('GET', '/api/routines/hermes/j1/x')).status).toBe(404);
    expect((await call('GET', '/api/routines/outra/j1')).status).toBe(404);
    // Agendas do Habblaud continuam em /api/schedules (uma só porta de escrita por origem).
    expect((await call('PATCH', '/api/routines/habblaud/s1', {})).status).toBe(404);
  });

  it('executar agora: responde "disparado" com o job aceito', async () => {
    const jobs = fakeJobs();
    const { call } = await setup({ jobs });
    const r = await call('POST', '/api/routines/hermes/j1/run', {});
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ triggered: true, keepPaused: false, job: { id: 'j1' } });
    expect(jobs.calls).toEqual(['run "j1"']);
  });

  it('executar e manter pausada: só repausa depois que a execução começou', async () => {
    const before = job({ enabled: false, state: 'paused', latest: { status: 'completed', startedAt: 'T0' } });
    let lists = 0;
    const jobs = fakeJobs({
      get: async () => before,
      list: async () => {
        lists++;
        // 1ª volta: ainda não começou; 2ª: nova execução iniciada.
        return [lists < 2 ? job({ latest: { status: 'completed', startedAt: 'T0' } }) : job({ latest: { status: 'running', startedAt: 'T1' } })];
      },
    });
    const { call } = await setup({ jobs });
    const r = await call('POST', '/api/routines/hermes/j1/run', { keepPaused: true });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ triggered: true, keepPaused: 'pending' });
    await vi.waitFor(() => expect(jobs.calls.at(-1)).toBe('pause "j1"'));
    expect(lists).toBe(2);
    expect(jobs.calls.filter((c) => c.startsWith('pause'))).toHaveLength(1);
  });

  it('manter pausada em job já ativo não pausa nada', async () => {
    const jobs = fakeJobs({ get: async () => job() });
    const { call } = await setup({ jobs });
    const r = await call('POST', '/api/routines/hermes/j1/run', { keepPaused: true });
    expect(r.body).toMatchObject({ keepPaused: false });
    await new Promise((x) => setTimeout(x, 20));
    expect(jobs.calls.some((c) => c.startsWith('pause'))).toBe(false);
  });

  it('manter pausada: se a execução não começa no prazo, não pausa (para não cancelar o disparo)', async () => {
    const jobs = fakeJobs({ get: async () => job({ enabled: false, state: 'paused' }), list: async () => [job()] });
    const sleep = vi.fn(async () => {});
    const { call } = await setup({ jobs, sleep, watchMs: 30 });
    await call('POST', '/api/routines/hermes/j1/run', { keepPaused: true });
    await vi.waitFor(() => expect(sleep).toHaveBeenCalled());
    await new Promise((x) => setTimeout(x, 20));
    expect(jobs.calls.some((c) => c.startsWith('pause'))).toBe(false);
  });

  it('manter pausada: se a pessoa mexeu no job durante a espera (ficou pausado de novo), não pausa outra vez', async () => {
    let lists = 0;
    const jobs = fakeJobs({
      get: async () => job({ enabled: false, state: 'paused' }),
      list: async () => (++lists < 2 ? [job()] : [job({ enabled: false, state: 'paused', latest: { status: 'running', startedAt: 'T1' } })]),
    });
    const { call } = await setup({ jobs });
    await call('POST', '/api/routines/hermes/j1/run', { keepPaused: true });
    await vi.waitFor(() => expect(lists).toBe(2));
    await new Promise((x) => setTimeout(x, 20));
    expect(jobs.calls.some((c) => c.startsWith('pause'))).toBe(false);
  });
});
