// Driver do Hermes: fala só com a API HTTP do gateway (API_SERVER_*). Nada de state.db.
import type { AgentDriver, ChatEvent, DriverCapability, DriverSession } from '../contract';
import { parseSse } from './sse';

const TITLE_TRIES = 30;
const CAPABILITIES: ReadonlySet<DriverCapability> = new Set(['chat', 'create']);

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

  private async request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new HermesError(`Hermes fora do ar (${this.base})`);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new HermesError('chave do Hermes inválida (HABBLAUD_HERMES_KEY)');
    }
    return res;
  }

  private async fail(res: Response): Promise<never> {
    const text = await res.text().catch(() => '');
    throw new HermesError(this.clean(`Hermes respondeu ${res.status}: ${text.slice(0, 200)}`));
  }

  async createSession(opts: { title: string }): Promise<DriverSession> {
    for (let n = 1; n <= TITLE_TRIES; n++) {
      const title = n === 1 ? opts.title : `${opts.title} (${n})`;
      const res = await this.request('POST', '/api/sessions', { title, source: 'api_server' });
      if (res.ok) {
        const b = (await res.json()) as { id?: unknown; session?: { id?: unknown } };
        const id = b.session?.id ?? b.id;
        if (!id) throw new HermesError('o Hermes não devolveu o id da sessão');
        return { id: String(id), title };
      }
      const body: unknown = await res.json().catch(() => null);
      if (!titleInUse(res.status, body)) throw new HermesError(this.clean(`Hermes respondeu ${res.status}: ${JSON.stringify(body).slice(0, 200)}`));
    }
    throw new HermesError(`nenhum título livre para "${opts.title}"`);
  }

  async *chat(sessionId: string, message: string, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const res = await this.request('POST', `/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, { message }, signal);
    if (!res.ok) await this.fail(res);
    if (!res.body) throw new HermesError('resposta do Hermes sem corpo');
    for await (const f of parseSse(res.body)) {
      const e = mapEvent(f.event, f.data);
      if (e?.type === 'error' && e.message) e.message = this.clean(e.message);
      if (e) yield e;
    }
  }

  async archive(sessionId: string): Promise<void> {
    const res = await this.request('PATCH', `/api/sessions/${encodeURIComponent(sessionId)}`, { archived: true });
    if (!res.ok) await this.fail(res);
    await res.body?.cancel();
  }
}
