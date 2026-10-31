// Runs em segundo plano: o turno roda no framework (driver.startRun) e o Habblaud consome os eventos no servidor,
// sem depender de alguém com o painel aberto. Quem abre a conversa assina o run e recebe o histórico mais os próximos
// eventos; fechar só desassina. Os registros vão para um arquivo (0600) e os runs ativos são retomados do último seq
// ao reiniciar. Run que o framework não conhece mais vira "interrompido".
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentDriver, ApprovalChoice, ApprovalRequest, ChatEvent, ChatOptions, RunEvent } from '../drivers/contract';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';

export type RunState = 'running' | 'waiting' | 'done' | 'error' | 'interrupted';

export interface RunOwner {
  kind: 'card' | 'consult';
  /** Id da ficha ou da consulta. */
  id: string;
  sessionId: string;
  title?: string;
  /** Run disparado por uma agenda (entrega 5). */
  scheduleId?: string;
}

export interface RunRecord {
  runId: string;
  owner: RunOwner;
  state: RunState;
  /** Texto da resposta acumulado. */
  text: string;
  /** Último seq recebido do framework (-1 = nenhum). */
  lastSeq: number;
  startedAt: number;
  updatedAt: number;
  approval?: ApprovalRequest;
  error?: string;
  /** Alguém acompanhou o run até o fim (a resposta não vai para a Inbox). */
  seen?: boolean;
}

export class RunError extends Error {
  constructor(
    readonly code: 'unknown' | 'busy' | 'unsupported' | 'state',
    message: string,
  ) {
    super(message);
  }
}

export interface RunManagerOptions {
  driver: AgentDriver;
  file?: string;
  /** Espera base entre reconexões (ms). */
  retryMs?: number;
  /** Tentativas seguidas sem sucesso antes de desistir (o run fica como está até reiniciar). */
  maxRetries?: number;
  now?: () => number;
  /** Quantos registros guardar (os ativos nunca saem). */
  keep?: number;
}

const ACTIVE: ReadonlySet<RunState> = new Set(['running', 'waiting']);
const SAVE_DELAY_MS = 2000;

interface Live {
  rec: RunRecord;
  buf: ChatEvent[];
  wake: Set<() => void>;
  gen: number;
  ctrl?: AbortController;
}

export class RunManager {
  private readonly runs = new Map<string, Live>();
  private readonly listeners = new Set<(r: RunRecord) => void>();
  private readonly retryMs: number;
  private readonly maxRetries: number;
  private readonly keep: number;
  private readonly now: () => number;
  private saveTimer?: NodeJS.Timeout;
  private closed = false;
  /** Sessões com start em andamento (evita dois runs na mesma sessão em chamadas simultâneas). */
  private readonly starting = new Set<string>();

  constructor(private readonly opts: RunManagerOptions) {
    this.retryMs = opts.retryMs ?? 1000;
    this.maxRetries = opts.maxRetries ?? 30;
    this.keep = opts.keep ?? 200;
    this.now = opts.now ?? Date.now;
    this.load();
  }

  /** Inicia um turno na sessão do dono. Uma sessão só tem um run ativo por vez. */
  async start(owner: RunOwner, message: string, chat?: ChatOptions): Promise<string> {
    const d = this.opts.driver;
    if (!d.startRun || !d.runEvents) throw new RunError('unsupported', tr('o driver não suporta runs'));
    if (this.active(owner.sessionId) || this.starting.has(owner.sessionId)) throw new RunError('busy', tr('agente ocupado: espere a resposta, redirecione ou pare'));
    this.starting.add(owner.sessionId);
    let runId: string;
    try {
      runId = await d.startRun(owner.sessionId, message, chat);
    } finally {
      this.starting.delete(owner.sessionId);
    }
    const at = this.now();
    const live: Live = { rec: { runId, owner: { ...owner }, state: 'running', text: '', lastSeq: -1, startedAt: at, updatedAt: at }, buf: [], wake: new Set(), gen: 0 };
    this.runs.set(runId, live);
    this.prune();
    this.changed(live, true);
    this.follow(live);
    return runId;
  }

  /** Retoma (do último seq) os runs ativos gravados no arquivo. */
  resume(): void {
    for (const l of this.runs.values()) if (ACTIVE.has(l.rec.state)) this.follow(l);
  }

  get(runId: string): RunRecord | undefined {
    const l = this.runs.get(runId);
    return l ? structuredClone(l.rec) : undefined;
  }

  list(): RunRecord[] {
    return [...this.runs.values()].map((l) => structuredClone(l.rec)).sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Run ativo (running/waiting) da sessão, se houver. */
  active(sessionId: string): RunRecord | undefined {
    for (const l of this.runs.values()) if (l.rec.owner.sessionId === sessionId && ACTIVE.has(l.rec.state)) return structuredClone(l.rec);
    return undefined;
  }

  onChange(fn: (r: RunRecord) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Histórico do run e, se ainda ativo, os próximos eventos até o fim (ou até `signal` abortar). */
  async *subscribe(runId: string, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const l = this.live(runId);
    let i = 0;
    for (;;) {
      while (i < l.buf.length) {
        const e = l.buf[i++]!;
        yield e;
        if (e.type === 'done') {
          if (!l.rec.seen) {
            l.rec.seen = true;
            this.changed(l, true);
          }
          return;
        }
      }
      if (signal.aborted || !ACTIVE.has(l.rec.state)) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          l.wake.delete(done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        l.wake.add(done);
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }

  async approve(runId: string, choice: ApprovalChoice): Promise<void> {
    const l = this.live(runId);
    const a = l.rec.approval;
    if (l.rec.state !== 'waiting' || !a) throw new RunError('state', tr('não há aprovação pendente neste run'));
    if (!a.choices.includes(choice)) throw new RunError('state', tr('escolha não aceita: {0}', [choice]));
    if (!this.opts.driver.approve) throw new RunError('unsupported', tr('o driver não suporta aprovação'));
    await this.opts.driver.approve(runId, choice, a.requestId);
  }

  async steer(runId: string, text: string): Promise<void> {
    const l = this.activeLive(runId);
    if (!this.opts.driver.steer) throw new RunError('unsupported', tr('o driver não suporta redirecionar'));
    await this.opts.driver.steer(l.rec.runId, text);
  }

  async stop(runId: string): Promise<void> {
    const l = this.activeLive(runId);
    if (!this.opts.driver.stop) throw new RunError('unsupported', tr('o driver não suporta parar'));
    await this.opts.driver.stop(l.rec.runId);
  }

  /** Para de acompanhar (não para os runs no framework) e grava o arquivo. */
  close(): void {
    this.closed = true;
    for (const l of this.runs.values()) l.ctrl?.abort();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save();
  }

  private live(runId: string): Live {
    const l = this.runs.get(runId);
    if (!l) throw new RunError('unknown', tr('run desconhecido'));
    return l;
  }

  private activeLive(runId: string): Live {
    const l = this.live(runId);
    if (!ACTIVE.has(l.rec.state)) throw new RunError('state', tr('o run já terminou'));
    return l;
  }

  /** Derruba a assinatura atual e assina de novo (do último seq). */
  private reconnect(runId: string): void {
    const l = this.runs.get(runId);
    if (l && ACTIVE.has(l.rec.state)) this.follow(l);
  }

  private follow(l: Live): void {
    l.ctrl?.abort();
    const ctrl = new AbortController();
    const gen = ++l.gen;
    l.ctrl = ctrl;
    const mine = () => !ctrl.signal.aborted && l.gen === gen && !this.closed;
    void (async () => {
      let fails = 0;
      while (mine() && ACTIVE.has(l.rec.state)) {
        try {
          for await (const e of this.opts.driver.runEvents!(l.rec.runId, l.rec.lastSeq, ctrl.signal)) {
            if (!mine()) return;
            this.apply(l, e);
            fails = 0;
            if (!ACTIVE.has(l.rec.state)) return;
          }
        } catch (err) {
          if (!mine()) return;
          if ((err as { gone?: boolean }).gone) return this.interrupt(l, 'o framework não conhece mais este run');
        }
        if (!mine() || !ACTIVE.has(l.rec.state)) return;
        // O stream acabou sem fim de run (ou caiu): confere o status antes de tentar de novo.
        const st = await this.opts.driver.runStatus?.(l.rec.runId).catch(() => undefined);
        if (!mine()) return;
        if (st?.state === 'gone') return this.interrupt(l, 'o framework não conhece mais este run');
        if (st?.state === 'done') {
          if (!l.rec.text && st.output) this.apply(l, { type: 'delta', text: st.output });
          return this.apply(l, { type: 'done' });
        }
        if (st?.state === 'interrupted') return this.interrupt(l, st.error ?? 'interrompido');
        if (st?.state === 'error') {
          this.apply(l, { type: 'error', message: st.error ?? 'erro' });
          return this.apply(l, { type: 'done' });
        }
        if (++fails > this.maxRetries) {
          log.warn(tr('Run {0}: desisti de reconectar após {1} tentativas', [l.rec.runId, String(this.maxRetries)]));
          // Sem isso o run ficaria "ativo" para sempre (sessão ocupada, quem assiste pendurado).
          return this.interrupt(l, 'sem contato com o framework');
        }
        await new Promise((r) => setTimeout(r, this.retryMs * Math.min(fails, 30)));
      }
    })();
  }

  private interrupt(l: Live, why: string): void {
    l.rec.error = why;
    l.rec.state = 'interrupted';
    delete l.rec.approval;
    this.push(l, { type: 'error', message: why });
    this.push(l, { type: 'done' });
    this.changed(l, true);
  }

  private apply(l: Live, e: RunEvent): void {
    const { seq, ...ev } = e;
    if (typeof seq === 'number' && seq > l.rec.lastSeq) l.rec.lastSeq = seq;
    const before = l.rec.state;
    switch (ev.type) {
      case 'delta':
        l.rec.text += ev.text ?? '';
        break;
      case 'approval':
        if (ev.approval) l.rec.approval = ev.approval;
        l.rec.state = 'waiting';
        break;
      case 'approved':
        delete l.rec.approval;
        if (l.rec.state === 'waiting') l.rec.state = 'running';
        break;
      case 'error':
        l.rec.error = ev.message ?? 'erro';
        l.rec.state = ev.interrupted ? 'interrupted' : 'error';
        delete l.rec.approval;
        break;
      case 'done':
        if (ACTIVE.has(l.rec.state)) l.rec.state = 'done';
        delete l.rec.approval;
        break;
    }
    this.push(l, ev as ChatEvent);
    this.changed(l, l.rec.state !== before);
  }

  private push(l: Live, e: ChatEvent): void {
    l.buf.push(e);
    for (const w of [...l.wake]) w();
  }

  private changed(l: Live, stateChanged: boolean): void {
    l.rec.updatedAt = this.now();
    if (stateChanged) {
      for (const fn of this.listeners) {
        try {
          fn(structuredClone(l.rec));
        } catch (err) {
          log.warn(tr('Ouvinte de runs falhou: {0}', [errMsg(err)]));
        }
      }
      this.save();
    } else this.saveSoon();
  }

  private prune(): void {
    const done = [...this.runs.values()].filter((l) => !ACTIVE.has(l.rec.state)).sort((a, b) => a.rec.startedAt - b.rec.startedAt);
    let extra = this.runs.size - this.keep;
    for (const l of done) {
      if (extra-- <= 0) break;
      this.runs.delete(l.rec.runId);
    }
  }

  private load(): void {
    if (!this.opts.file) return;
    let raw: string;
    try {
      raw = readFileSync(this.opts.file, 'utf8');
    } catch {
      return;
    }
    try {
      const data = JSON.parse(raw) as { runs?: RunRecord[] };
      for (const r of Array.isArray(data.runs) ? data.runs : []) {
        if (!r || typeof r.runId !== 'string' || !r.owner || typeof r.owner.sessionId !== 'string') continue;
        const rec: RunRecord = { ...r, text: typeof r.text === 'string' ? r.text : '', lastSeq: typeof r.lastSeq === 'number' ? r.lastSeq : -1 };
        const buf: ChatEvent[] = rec.text ? [{ type: 'delta', text: rec.text }] : [];
        if (!ACTIVE.has(rec.state)) {
          if (rec.error) buf.push({ type: 'error', message: rec.error });
          buf.push({ type: 'done' });
        } else if (rec.state === 'waiting' && rec.approval) buf.push({ type: 'approval', approval: rec.approval });
        this.runs.set(rec.runId, { rec, buf, wake: new Set(), gen: 0 });
      }
      this.prune();
    } catch (err) {
      log.warn(tr('Ignorei {0} inválido: {1}', [this.opts.file, errMsg(err)]));
    }
  }

  private saveSoon(): void {
    if (!this.opts.file || this.saveTimer || this.closed) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }

  private save(): void {
    const file = this.opts.file;
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, runs: this.list() }, null, 2), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [file, errMsg(err)]));
    }
  }
}
