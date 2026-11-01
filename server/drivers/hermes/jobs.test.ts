import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HermesJobs, JobsError } from './jobs';

interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  type: string | undefined;
  body: unknown;
}

let server: Server | undefined;

async function fake(handler: (req: Seen, res: ServerResponse) => void): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const s: Seen = { method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, type: req.headers['content-type'], body: raw ? JSON.parse(raw) : undefined };
      seen.push(s);
      handler(s, res);
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

/** Registro como o Hermes instalado devolve (campos observados na sonda de 2026-11-01). */
const RAW = {
  id: 'abc123def456',
  name: 'Resumo diário',
  prompt: 'Resuma o dia',
  schedule: { kind: 'cron', expr: '0 9 * * 1', display: '0 9 * * 1' },
  schedule_display: '0 9 * * 1',
  enabled: true,
  state: 'scheduled',
  paused_at: null,
  paused_reason: null,
  next_run_at: '2026-11-02T09:00:00-03:00',
  last_run_at: '2026-11-01T00:20:13.911773-03:00',
  last_status: 'ok',
  last_error: null,
  last_delivery_error: null,
  deliver: 'local',
  repeat: { times: null, completed: 1 },
  skills: ['a'],
  skill: null,
  model: null,
  provider: null,
  script: null,
  workdir: null,
  origin: { platform: 'api_server', chat_id: 'api', source_ip: '10.0.0.1', user_agent: 'x' },
  latest_execution: {
    id: 'e1', job_id: 'abc123def456', status: 'completed', claimed_at: 'c', started_at: '2026-11-01T00:20:08-03:00',
    finished_at: '2026-11-01T00:20:13-03:00', error: null, delivery_outcome: 'suppressed', pid: 99,
  },
};

describe('HermesJobs', () => {
  it('lista com include_disabled=true, Bearer, e normaliza sem vazar origem/pid', async () => {
    const { base, seen } = await fake((_r, res) => json(res, 200, { jobs: [RAW] }));
    const jobs = await new HermesJobs({ baseUrl: base, key: 'k1' }).list();
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/jobs?include_disabled=true', auth: 'Bearer k1' });
    expect(jobs).toEqual([{
      id: 'abc123def456', name: 'Resumo diário', prompt: 'Resuma o dia',
      schedule: { kind: 'cron', display: '0 9 * * 1', expr: '0 9 * * 1' },
      enabled: true, state: 'scheduled', nextRunAt: '2026-11-02T09:00:00-03:00',
      lastRunAt: '2026-11-01T00:20:13.911773-03:00', lastStatus: 'ok', deliver: 'local',
      repeat: { completed: 1 }, skills: ['a'],
      latest: { status: 'completed', startedAt: '2026-11-01T00:20:08-03:00', finishedAt: '2026-11-01T00:20:13-03:00', deliveryOutcome: 'suppressed' },
    }]);
    expect(JSON.stringify(jobs)).not.toMatch(/10\.0\.0\.1|user_agent|pid/);
  });

  it('pausada: state paused, motivo e campos só-leitura presentes quando o Hermes os tem', async () => {
    const raw = { ...RAW, enabled: false, state: 'paused', paused_reason: 'manutenção', next_run_at: null, model: 'm1', provider: 'p', workdir: '/w', script: 's.py', latest_execution: undefined, last_status: 'error', last_error: 'boom', last_delivery_error: 'tg off', repeat: { times: 3, completed: 1 }, schedule: { kind: 'interval', minutes: 1440, display: 'every 1440m' } };
    const { base } = await fake((_r, res) => json(res, 200, { jobs: [raw] }));
    const [j] = await new HermesJobs({ baseUrl: base, key: 'k' }).list();
    expect(j).toMatchObject({ enabled: false, state: 'paused', pausedReason: 'manutenção', lastStatus: 'error', lastError: 'boom', lastDeliveryError: 'tg off', model: 'm1', provider: 'p', workdir: '/w', script: 's.py', repeat: { times: 3, completed: 1 }, schedule: { kind: 'interval', display: 'every 1440m', minutes: 1440 } });
    expect(j).not.toHaveProperty('nextRunAt');
    expect(j).not.toHaveProperty('latest');
  });

  it('ignora entradas sem id e resposta sem array é erro, não lista vazia', async () => {
    const { base } = await fake((r, res) => (r.url.includes('include') ? json(res, 200, { jobs: [{ name: 'x' }, RAW] }) : json(res, 200, {})));
    const jobs = new HermesJobs({ baseUrl: base, key: 'k' });
    expect((await jobs.list()).map((j) => j.id)).toEqual(['abc123def456']);
  });

  it('lista sem campo jobs → JobsError (fonte inválida não vira vazio)', async () => {
    const { base } = await fake((_r, res) => json(res, 200, { nada: true }));
    await expect(new HermesJobs({ baseUrl: base, key: 'k' }).list()).rejects.toBeInstanceOf(JobsError);
  });

  it('get devolve um job; 404 "Job not found" vira notFound', async () => {
    const { base, seen } = await fake((r, res) => (r.url.endsWith('/abc123def456') ? json(res, 200, { job: RAW }) : json(res, 404, { error: 'Job not found' })));
    const jobs = new HermesJobs({ baseUrl: base, key: 'k' });
    expect((await jobs.get('abc123def456')).name).toBe('Resumo diário');
    await expect(jobs.get('zzz')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(seen.map((s) => s.url)).toEqual(['/api/jobs/abc123def456', '/api/jobs/zzz']);
  });

  it('id fora do formato é recusado sem chamar o Hermes', async () => {
    const { base, seen } = await fake((_r, res) => json(res, 200, { job: RAW }));
    const jobs = new HermesJobs({ baseUrl: base, key: 'k' });
    for (const bad of ['', '../x', 'a/b', 'a?b', 'x'.repeat(100)]) await expect(jobs.get(bad)).rejects.toMatchObject({ code: 'invalid' });
    expect(seen).toEqual([]);
  });

  it('create manda só os campos aceitos e devolve o job', async () => {
    const { base, seen } = await fake((_r, res) => json(res, 200, { job: { ...RAW, enabled: false, state: 'paused' } }));
    const j = await new HermesJobs({ baseUrl: base, key: 'k' }).create({ name: ' Novo ', schedule: 'every 2h', prompt: 'p', deliver: 'local', skills: ['a'], repeat: 2, paused: true, extra: 'x' } as never);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/jobs', type: 'application/json', body: { name: 'Novo', schedule: 'every 2h', prompt: 'p', deliver: 'local', skills: ['a'], repeat: 2, paused: true } });
    expect(seen[0]!.body).not.toHaveProperty('extra');
    expect(j.state).toBe('paused');
  });

  it('create sem nome ou regra é recusado localmente', async () => {
    const { base, seen } = await fake((_r, res) => json(res, 200, { job: RAW }));
    const jobs = new HermesJobs({ baseUrl: base, key: 'k' });
    await expect(jobs.create({ name: ' ', schedule: 'every 2h', prompt: '' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(jobs.create({ name: 'a', schedule: '', prompt: '' })).rejects.toMatchObject({ code: 'invalid' });
    expect(seen).toEqual([]);
  });

  it('update manda só a whitelist do PATCH e recusa patch vazio', async () => {
    const { base, seen } = await fake((_r, res) => json(res, 200, { job: RAW }));
    const jobs = new HermesJobs({ baseUrl: base, key: 'k' });
    await jobs.update('abc123def456', { prompt: 'novo', schedule: '0 8 * * *', model: 'x', timezone: 'UTC', workdir: '/x' } as never);
    expect(seen[0]).toMatchObject({ method: 'PATCH', url: '/api/jobs/abc123def456', body: { prompt: 'novo', schedule: '0 8 * * *' } });
    await expect(jobs.update('abc123def456', { model: 'x' } as never)).rejects.toMatchObject({ code: 'invalid' });
    expect(seen).toHaveLength(1);
  });

  it('regra inválida (Hermes responde 500 com texto) vira invalid com a mensagem do Hermes', async () => {
    const { base } = await fake((_r, res) => json(res, 500, { error: "Invalid schedule 'nunca'. Use:\n  - Interval: '30m'" }));
    await expect(new HermesJobs({ baseUrl: base, key: 'k' }).update('abc123def456', { schedule: 'nunca' })).rejects.toMatchObject({ code: 'invalid', status: 500, message: expect.stringContaining("Invalid schedule 'nunca'") });
  });

  it('pause/resume/run/delete usam POST/DELETE com corpo JSON', async () => {
    const { base, seen } = await fake((r, res) => (r.method === 'DELETE' ? json(res, 200, { ok: true }) : json(res, 200, { job: RAW })));
    const jobs = new HermesJobs({ baseUrl: base, key: 'k' });
    await jobs.pause('abc123def456');
    await jobs.resume('abc123def456');
    await jobs.run('abc123def456');
    await jobs.remove('abc123def456');
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      'POST /api/jobs/abc123def456/pause', 'POST /api/jobs/abc123def456/resume', 'POST /api/jobs/abc123def456/run', 'DELETE /api/jobs/abc123def456',
    ]);
    expect(seen.slice(0, 3).every((s) => s.type === 'application/json')).toBe(true);
  });

  it('delete de job inexistente: not_found', async () => {
    const { base } = await fake((_r, res) => json(res, 404, { error: 'Job not found' }));
    await expect(new HermesJobs({ baseUrl: base, key: 'k' }).remove('abc123def456')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('401/403 → auth; rota ausente (404 sem JSON) ou 501 → unavailable; chave nunca aparece no erro', async () => {
    let status = 401;
    let body = 'chave k-secreta inválida';
    const { base } = await fake((_r, res) => {
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(body);
    });
    const jobs = new HermesJobs({ baseUrl: base, key: 'k-secreta' });
    await expect(jobs.list()).rejects.toMatchObject({ code: 'auth' });
    status = 403;
    await expect(jobs.list()).rejects.toMatchObject({ code: 'auth' });
    status = 404;
    body = '404: Not Found';
    await expect(jobs.list()).rejects.toMatchObject({ code: 'unavailable' });
    status = 501;
    body = 'k-secreta not implemented';
    const err = (await jobs.list().catch((e: unknown) => e)) as JobsError;
    expect(err).toMatchObject({ code: 'unavailable' });
    expect(err.message).not.toContain('k-secreta');
  });

  it('Hermes fora do ar → unavailable', async () => {
    const jobs = new HermesJobs({ baseUrl: 'http://127.0.0.1:1', key: 'k' });
    await expect(jobs.list()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('timeout curto vira unavailable', async () => {
    const { base } = await fake(() => {
      /* nunca responde */
    });
    const jobs = new HermesJobs({ baseUrl: base, key: 'k', timeoutMs: 50 });
    await expect(jobs.list()).rejects.toMatchObject({ code: 'unavailable' });
  });
});
