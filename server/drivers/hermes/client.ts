// Driver do Hermes: fala só com a API HTTP do gateway (API_SERVER_*). Nada de state.db.
import { tr } from '../../../shared/i18n';
import { APPROVAL_CHOICES, type AgentDriver, type ApprovalChoice, type ApprovalRequest, type ChatEvent, type ChatOptions, type CreateSessionOptions, type DriverCapability, type DriverSession, type RunEvent, type RunStatus } from '../contract';
import { parseSse } from './sse';

const TITLE_TRIES = 30;
const CAPABILITIES: ReadonlySet<DriverCapability> = new Set(['chat', 'create', 'approve', 'steer', 'stop']);

/** Limite das chamadas curtas ao Hermes (as de stream usam o sinal de quem assiste). */
const REQUEST_TIMEOUT_MS = 30_000;

export interface HermesDriverOptions {
  baseUrl: string;
  key: string;
  fetch?: typeof fetch;
}

export class HermesError extends Error {}

function titleInUse(status: number, body: unknown): boolean {
  if (status !== 400 && status !== 409) return false;
  return /invalid_title|already in use/i.test(JSON.stringify(body ?? ''));
}

function mapEvent(event: string | undefined, data: string): ChatEvent | null {
  let p: Record<string, unknown> = {};
  try {
    p = JSON.parse(data) as Record<string, unknown>;
  } catch {
    /* frame sem JSON: só o nome importa */
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  switch (event) {
    case 'assistant.delta':
      return { type: 'delta', text: str(p.delta) ?? '' };
    case 'tool.started':
    case 'tool.completed':
    case 'tool.failed': {
      const e: ChatEvent = { type: 'tool', tool: str(p.tool_name) ?? '' };
      if (str(p.preview)) e.preview = str(p.preview);
      return e;
    }
    case 'error':
      return { type: 'error', message: str(p.message) ?? 'erro no Hermes' };
    case 'done':
      return { type: 'done' };
    default:
      return null;
  }
}

/** Evento de /v1/runs/:id/events (`{event, seq, ...}`) no formato do Habblaud. Eventos sem uso viram lista vazia. */
function mapRunEvent(p: Record<string, unknown>): ChatEvent[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  switch (p.event) {
    case 'message.delta':
      return str(p.delta) ? [{ type: 'delta', text: str(p.delta)! }] : [];
    case 'tool.started':
    case 'tool.completed': {
      const e: ChatEvent = { type: 'tool', tool: str(p.tool) ?? '' };
      if (str(p.preview)) e.preview = str(p.preview);
      return [e];
    }
    case 'approval.request': {
      const choices = (Array.isArray(p.choices) ? p.choices : []).filter((c): c is ApprovalChoice => APPROVAL_CHOICES.includes(c as ApprovalChoice));
      const approval = {} as ApprovalRequest;
      const id = str(p.request_id);
      if (id) approval.requestId = id;
      approval.command = str(p.command) ?? '';
      if (str(p.description)) approval.description = str(p.description);
      approval.choices = choices.length ? choices : ['once', 'deny'];
      return [{ type: 'approval', approval }];
    }
    case 'approval.responded':
      return [{ type: 'approved' }];
    case 'run.completed':
      return [{ type: 'done' }];
    case 'run.failed':
      return [{ type: 'error', message: str(p.error) ?? 'o Hermes não concluiu a resposta' }, { type: 'done' }];
    case 'run.cancelled':
    case 'run.interrupted':
      return [{ type: 'error', message: str(p.error) ?? 'interrompido', interrupted: true }, { type: 'done' }];
    default:
      return [];
  }
}

export class HermesDriver implements AgentDriver {
  readonly id = 'hermes';
  private readonly base: string;
  private readonly key: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: HermesDriverOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.key = opts.key;
    this.fetchFn = opts.fetch ?? fetch;
  }

  async capabilities(): Promise<ReadonlySet<DriverCapability>> {
    return CAPABILITIES;
  }

  private clean(text: string): string {
    return this.key ? text.split(this.key).join('***') : text;
  }

  private async request(method: string, path: string, body?: unknown, signal?: AbortSignal, extra?: Record<string, string>): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json', ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Sem sinal (chamada curta): limite de tempo, para um Hermes travado não segurar quem chamou (ex.: agendas).
        signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if ((err as Error)?.name === 'TimeoutError') throw new HermesError(tr('o Hermes não respondeu em {0} s', [REQUEST_TIMEOUT_MS / 1000]));
      throw new HermesError(`Hermes fora do ar (${this.base})`);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new HermesError(tr('chave do Hermes inválida (HABBLAUD_HERMES_KEY)'));
    }
    return res;
  }

  private async fail(res: Response): Promise<never> {
    const text = await res.text().catch(() => '');
    throw new HermesError(this.clean(`Hermes respondeu ${res.status}: ${text.slice(0, 200)}`));
  }

  async createSession(opts: CreateSessionOptions): Promise<DriverSession> {
    for (let n = 1; n <= TITLE_TRIES; n++) {
      const title = n === 1 ? opts.title : `${opts.title} (${n})`;
      const req: Record<string, unknown> = { title, source: 'api_server' };
      if (opts.model?.trim()) req.model = opts.model.trim();
      const res = await this.request('POST', '/api/sessions', req);
      if (res.ok) {
        const b = (await res.json()) as { id?: unknown; session?: { id?: unknown } };
        const id = b.session?.id ?? b.id;
        if (!id) throw new HermesError(tr('o Hermes não devolveu o id da sessão'));
        return { id: String(id), title };
      }
      const body: unknown = await res.json().catch(() => null);
      if (!titleInUse(res.status, body)) throw new HermesError(this.clean(`Hermes respondeu ${res.status}: ${JSON.stringify(body).slice(0, 200)}`));
    }
    throw new HermesError(tr('nenhum título livre para "{0}"', [opts.title]));
  }

  async *chat(sessionId: string, message: string, signal: AbortSignal, opts: ChatOptions = {}): AsyncIterable<ChatEvent> {
    const body: Record<string, unknown> = { message };
    if (opts.system?.trim()) body.system_message = opts.system.trim();
    const res = await this.request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, body, signal);
    if (!res.ok) await this.fail(res);
    if (!res.body) throw new HermesError(tr('resposta do Hermes sem corpo'));
    // Falha do run (ex.: modelo que o provedor não tem): o Hermes manda o motivo no assistant.completed com
    // completed=false e depois run.failed; vira um evento error com esse texto.
    let failedText: string | undefined;
    for await (const f of parseSse(res.body)) {
      if (f.event === 'assistant.completed' || f.event === 'run.failed') {
        let p: { content?: unknown; completed?: unknown; error?: unknown } = {};
        try {
          p = JSON.parse(f.data) as typeof p;
        } catch {
          /* sem JSON */
        }
        if (f.event === 'assistant.completed') {
          if (p.completed === false && typeof p.content === 'string' && p.content.trim()) failedText = p.content.trim();
          continue;
        }
        yield { type: 'error', message: this.clean(failedText ?? ((typeof p.error === 'string' && p.error) || 'o Hermes não concluiu a resposta')) };
        continue;
      }
      const e = mapEvent(f.event, f.data);
      if (e?.type === 'error' && e.message) e.message = this.clean(e.message);
      if (e) yield e;
    }
  }

  async startRun(sessionId: string, message: string, opts: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = { input: message, session_id: sessionId };
    if (opts.system?.trim()) body.instructions = opts.system.trim();
    const res = await this.request('POST', '/v1/runs', body);
    if (!res.ok) await this.fail(res);
    const b = (await res.json().catch(() => ({}))) as { run_id?: unknown };
    if (typeof b.run_id !== 'string' || !b.run_id) throw new HermesError(tr('o Hermes não devolveu o id do run'));
    return b.run_id;
  }

  async *runEvents(runId: string, afterSeq: number, signal: AbortSignal): AsyncIterable<RunEvent> {
    const seq = String(Math.max(-1, Math.trunc(afterSeq)));
    const res = await this.request('GET', `/v1/runs/${encodeURIComponent(runId)}/events?last_seq=${seq}`, undefined, signal, { 'last-event-id': seq });
    if (res.status === 404) {
      await res.body?.cancel();
      throw Object.assign(new HermesError(tr('o Hermes não conhece mais este run')), { gone: true });
    }
    if (!res.ok) await this.fail(res);
    if (!res.body) throw new HermesError(tr('resposta do Hermes sem corpo'));
    for await (const f of parseSse(res.body)) {
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(f.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const s = typeof p.seq === 'number' ? { seq: p.seq } : {};
      for (const e of mapRunEvent(p)) {
        if (e.type === 'error' && e.message) e.message = this.clean(e.message);
        yield { ...e, ...s };
      }
    }
  }

  async runStatus(runId: string): Promise<RunStatus> {
    const res = await this.request('GET', `/v1/runs/${encodeURIComponent(runId)}`);
    if (res.status === 404) {
      await res.body?.cancel();
      return { state: 'gone' };
    }
    if (!res.ok) await this.fail(res);
    const b = (await res.json().catch(() => ({}))) as { status?: unknown; output?: unknown; error?: unknown };
    const st = String(b.status ?? '');
    if (st === 'completed') return typeof b.output === 'string' ? { state: 'done', output: b.output } : { state: 'done' };
    if (st === 'failed') return { state: 'error', error: this.clean(typeof b.error === 'string' ? b.error : 'falha no Hermes') };
    if (['cancelled', 'interrupted', 'stopped', 'expired'].includes(st)) return { state: 'interrupted', error: tr('interrompido') };
    if (st === 'waiting_for_approval') return { state: 'waiting' };
    return { state: 'running' };
  }

  private async runAction(runId: string, action: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.request('POST', `/v1/runs/${encodeURIComponent(runId)}/${action}`, body);
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as { error?: { message?: unknown } | string } | null;
      const msg = typeof b?.error === 'string' ? b.error : typeof b?.error?.message === 'string' ? b.error.message : `Hermes respondeu ${res.status}`;
      throw new HermesError(this.clean(msg));
    }
    await res.body?.cancel();
  }

  approve(runId: string, choice: ApprovalChoice, requestId?: string): Promise<void> {
    return this.runAction(runId, 'approval', requestId ? { choice, request_id: requestId } : { choice });
  }

  steer(runId: string, text: string): Promise<void> {
    return this.runAction(runId, 'steer', { text });
  }

  stop(runId: string): Promise<void> {
    return this.runAction(runId, 'stop', {});
  }

  async archive(sessionId: string): Promise<void> {
    const res = await this.request('PATCH', `/api/sessions/${encodeURIComponent(sessionId)}`, { archived: true });
    if (!res.ok) await this.fail(res);
    await res.body?.cancel();
  }
}
