// Consultor (botão na barra do topo e atalho C): abre uma sessão nova no Hermes (POST /api/consult), com contexto
// opcional antes da primeira pergunta, e conversa em stream (POST /api/consult/:id/messages, SSE). Não ocupa sala;
// o servidor arquiva sozinho depois de 30 min sem uso (server/consult/service.ts). Estado puro em consult-model.ts.
// O mesmo painel conversa com uma ficha de agente (openCard: POST /api/cards/:id/messages) e promove a consulta
// aberta a agente (POST /api/cards {fromConsult}).
import { tr } from '../../../shared/i18n';
import { emptyConsult, parseSseChunk, reduceConsult, resumeStarted, sendStarted, type ApprovalChoice, type ConsultView } from './consult-model';
import { choiceLabel } from './inbox-model';
import type { UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { access } from '../net/access';
import { renderMarkdown } from './markdown';
import { panelRun } from './agent-panel-routing-model';
import { preferredRun } from './agent-panel-model';
import type { RunView } from '../../../shared/types';

const TEXT_MAX = 20_000;
let embeddedSequence = 0;

export interface ConsultPanelOptions {
  embedded?: boolean;
  readRun?: boolean;
  onRun?: (run: Pick<RunView, 'runId' | 'state' | 'prompt'> | null) => void;
  onClose?: () => void;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? tr('erro {0}', [res.status]));
  return body;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export class ConsultPanel {
  readonly el: HTMLElement;
  private readonly contextWrap: HTMLElement;
  private readonly context: HTMLTextAreaElement;
  private readonly screen: HTMLInputElement;
  private readonly log: HTMLElement;
  private readonly status: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly archiveBtn: HTMLButtonElement;
  private anchor?: HTMLElement;
  private consultId?: string;
  private card?: { id: string; name: string };
  private discoverCard = true;
  /** Identidade histórica explícita; não é permissão para ações de run ativo. */
  private explicitRunId?: string;
  private readonly heading: HTMLElement;
  private readonly promoteBtn: HTMLButtonElement;
  private readonly promoteBox: HTMLElement;
  private readonly promoteName: HTMLInputElement;
  private readonly promoteProject: HTMLSelectElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly approvalBox: HTMLElement;
  private view: ConsultView = emptyConsult();
  private stream?: AbortController;
  private viewEpoch = 0;
  private discovery?: AbortController;
  private observedRun?: Pick<RunView, 'runId' | 'state' | 'prompt'>;

  constructor(private readonly ctx: UiContext, private readonly options: ConsultPanelOptions = {}) {
    const id = options.embedded ? `ui-agent-consult-${++embeddedSequence}` : 'ui-consult';
    this.context = h('textarea', {
      class: 'ui-rename__input ui-consult__context',
      attrs: { id: `${id}-context`, rows: 3, maxlength: TEXT_MAX, placeholder: tr('Contexto (opcional): quem você é, o que está fazendo, o que importa') },
    });
    this.screen = h('input', { type: 'checkbox', attrs: { id: `${id}-screen` } });
    this.contextWrap = h(
      'div',
      { class: 'ui-consult__setup' },
      this.context,
      h('label', { class: 'ui-consult__check', attrs: { for: `${id}-screen` } }, this.screen, h('span', { text: tr('Incluir o que estou vendo (agente ou sala selecionados)') })),
    );
    this.log = h('div', { class: 'ui-consult__log', attrs: { 'aria-live': 'polite' } });
    this.status = h('p', { class: 'ui-rename__hint ui-consult__status', attrs: { role: 'status' } });
    this.input = h('textarea', {
      class: 'ui-rename__input ui-consult__input',
      attrs: { id: `${id}-input`, rows: 3, maxlength: TEXT_MAX, placeholder: tr('Pergunte (Ctrl+Enter envia)') },
    });
    for (const f of [this.context, this.input]) {
      f.addEventListener('keydown', (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void this.send();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (this.options.onClose) this.options.onClose();
          else this.hide();
        }
      });
      f.addEventListener('keyup', (e) => e.stopPropagation());
    }
    this.sendBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow', type: 'button', on: { click: () => void this.send() } }, tr('Enviar'));
    this.stopBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--deny', type: 'button', hidden: true, title: tr('Interrompe o agente'), on: { click: () => void this.stopRun() } }, tr('Parar'));
    this.approvalBox = h('div', { class: 'ui-consult__approval', hidden: true, role: 'group', attrs: { 'aria-label': tr('Aprovação') } });
    const newBtn = h('button', { class: 'ui-btn', type: 'button', hidden: options.readRun, on: { click: () => this.reset() } }, tr('Nova consulta'));
    this.archiveBtn = h('button', { class: 'ui-btn', type: 'button', on: { click: () => void this.archive() } }, tr('Arquivar'));
    this.promoteName = h('input', { class: 'ui-rename__input', type: 'text', attrs: { maxlength: 40, placeholder: tr('Nome do agente'), 'aria-label': tr('Nome do agente') } });
    this.promoteName.addEventListener('keydown', (e) => e.stopPropagation());
    this.promoteProject = h('select', { class: 'ui-select', attrs: { 'aria-label': tr('Projeto') } });
    this.promoteBox = h('div', { class: 'ui-project__row', hidden: true }, this.promoteName, this.promoteProject, h('button', { class: 'ui-btn', type: 'button', text: tr('Criar agente'), on: { click: () => void this.promote() } }));
    this.promoteBtn = h('button', { class: 'ui-btn', type: 'button', title: tr('A consulta vira um agente com ficha (nome, projeto, instruções)'), on: { click: () => this.togglePromote() } }, tr('Promover a agente…'));
    this.heading = h('h2', { text: tr('Consultor') });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.options.onClose ? this.options.onClose() : this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: options.embedded ? 'ui-consult ui-consult--embedded' : 'ui-popover ui-consult', role: options.embedded ? 'region' : 'dialog', hidden: options.embedded, tabIndex: -1, attrs: { 'aria-label': tr('Consultor'), id, popover: options.embedded ? undefined : 'manual' } },
      h('div', { class: 'ui-popover__head' }, this.heading, close),
      h('div', { class: 'ui-set-group ui-consult__body' }, this.contextWrap, this.log, this.status, this.approvalBox, this.input, this.promoteBox, h('div', { class: 'ui-consult__actions' }, newBtn, this.promoteBtn, this.archiveBtn, this.stopBtn, this.sendBtn)),
    );
    this.el.inert = !!options.embedded;
    this.render();
  }

  get isOpen(): boolean {
    if (this.options.embedded) return !this.el.hidden;
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(anchor?: HTMLElement): void {
    if (anchor) this.anchor = anchor;
    if (this.isOpen) return this.hide();
    this.show(anchor);
  }

  /** Retoma apenas a observação, inclusive ao voltar de outra aba. */
  show(anchor?: HTMLElement): void {
    if (anchor) this.anchor = anchor;
    if (this.options.embedded) { setHidden(this.el, false); this.el.inert = false; this.el.classList.add('is-open'); }
    else if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    this.anchor?.setAttribute('aria-expanded', 'true');
    // Discovery/record GET is already an observation, even before SSE exists.
    const id = this.explicitRunId ?? this.view.runId;
    if (id && !this.stream && !this.discovery) {
      // O SSE reproduz a resposta atual: substitui a cauda parcial, preservando pedidos e turnos anteriores.
      const turns = this.view.turns;
      this.view = { ...this.view, turns: turns.at(-1)?.role === 'assistant' ? turns.slice(0, -1) : turns };
      void this.attach(id);
    } else if (this.card && this.discoverCard && !this.explicitRunId && !this.view.runId && !this.view.busy && !this.stream && !this.discovery) {
      void this.resumeActive(this.card.id);
    }
    (this.consultId || this.card ? this.input : this.context).focus();
  }

  /** Conversa com a ficha (troca de alvo limpa a conversa na tela; `fresh` também). */
  openCard(card: { id: string; name: string; fresh?: boolean; refresh?: boolean }, anchor?: HTMLElement): void {
    if (card.fresh || card.refresh || this.card?.id !== card.id) {
      this.disposeView();
      if (card.fresh || this.card?.id !== card.id) this.input.value = '';
      setHidden(this.promoteBox, true);
      this.view = emptyConsult();
      this.explicitRunId = undefined;
      this.observedRun = undefined;
      this.options.onRun?.(null);
    }
    this.consultId = undefined;
    this.card = { id: card.id, name: card.name };
    this.discoverCard = !card.fresh;
    this.render();
    if (!this.isOpen) this.toggle(anchor);
    this.input.focus();
    if (!this.explicitRunId && !this.view.busy && !this.view.runId && !this.discovery && !this.stream && !card.fresh) void this.resumeActive(card.id);
  }

  /** Abre a conversa de um run (Inbox): mostra a resposta guardada e, se ainda roda, acompanha. */
  openRun(runId: string, owner: { kind: 'card' | 'consult'; id: string; title?: string }, anchor?: HTMLElement): void {
    this.disposeView();
    this.input.value = '';
    setHidden(this.promoteBox, true);
    this.view = emptyConsult();
    this.observedRun = undefined;
    this.explicitRunId = runId;
    this.discoverCard = false;
    if (owner.kind === 'card') {
      this.consultId = undefined;
      this.card = { id: owner.id, name: owner.title || owner.id };
    } else {
      this.card = undefined;
      this.consultId = owner.id;
    }
    this.render();
    if (!this.isOpen) this.toggle(anchor);
    else void this.attach(runId);
  }

  /** Ficha com run em andamento (painel fechado no meio): retoma a resposta. */
  private async resumeActive(cardId: string): Promise<void> {
    const epoch = this.viewEpoch;
    this.discovery?.abort();
    const controller = this.discovery = new AbortController();
    try {
      const { runs } = await api<{ runs: { runId: string; state: string; owner: { kind: string; id: string } }[] }>('/api/runs', { signal: controller.signal });
      const r = this.options.readRun
        ? preferredRun(runs.map(panelRun).filter((x): x is RunView => !!x && x.owner.kind === 'card' && x.owner.id === cardId))
        : runs.find(x => x.owner.kind === 'card' && x.owner.id === cardId && (x.state === 'running' || x.state === 'waiting'));
      if (r && !controller.signal.aborted && epoch === this.viewEpoch && this.isOpen && this.card?.id === cardId && !this.view.busy) await this.attach(r.runId);
    } catch {
      /* sem runs (driver desligado): nada a retomar */
    }
  }

  private async attach(runId: string): Promise<void> {
    const epoch = this.viewEpoch;
    try {
      if (this.options.readRun) {
        this.discovery?.abort();
        const controller = this.discovery = new AbortController();
        const run = panelRun(await api(`/api/runs/${encodeURIComponent(runId)}`, { signal: controller.signal }));
        if (epoch !== this.viewEpoch || controller.signal.aborted || !this.isOpen) return;
        if (!run || run.runId !== runId) throw new Error(tr('Registro de execução indisponível.'));
        this.observedRun = run;
        this.options.onRun?.(run);
        this.view = { turns: run.prompt ? [{ role: 'user', text: run.prompt }] : [], busy: false };
        if (run.state !== 'running' && run.state !== 'waiting') {
          if (run.text) this.view.turns.push({ role: 'assistant', text: run.text });
          if (run.error) this.view.error = run.error;
          this.render();
          return;
        }
      }
      this.view = resumeStarted(this.view, runId);
      this.render();
      await this.streamAnswer(`/api/runs/${encodeURIComponent(runId)}/events`, { method: 'GET' });
    } catch (err) {
      if (epoch !== this.viewEpoch || (err as Error)?.name === 'AbortError') return;
      this.apply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    if (epoch !== this.viewEpoch) return;
    if (this.view.busy && this.view.runId === runId) this.apply({ type: 'done' });
  }

  private async stopRun(): Promise<void> {
    const id = this.view.runId;
    if (!id) return;
    const epoch = this.viewEpoch;
    try {
      await api(`/api/runs/${encodeURIComponent(id)}/stop`, json({}));
    } catch (err) {
      if (epoch !== this.viewEpoch) return;
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
  }

  private async steer(text: string): Promise<void> {
    const id = this.view.runId;
    if (!id) return;
    const epoch = this.viewEpoch;
    try {
      await api(`/api/runs/${encodeURIComponent(id)}/steer`, json({ text }));
      if (epoch !== this.viewEpoch || id !== this.view.runId) return;
      this.input.value = '';
      this.ctx.announce(tr('Redirecionado: o agente recebe a orientação no próximo passo.'));
      setText(this.status, tr('Redirecionado: o agente recebe a orientação no próximo passo.'));
    } catch (err) {
      if (epoch !== this.viewEpoch) return;
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
  }

  private async answerApproval(choice: ApprovalChoice): Promise<void> {
    const id = this.view.runId;
    if (!id) return;
    const epoch = this.viewEpoch;
    try {
      await api(`/api/inbox/${encodeURIComponent(`run:${id}`)}`, json({ action: 'approve', choice }));
      if (epoch !== this.viewEpoch || id !== this.view.runId) return;
      this.apply({ type: 'approved' });
    } catch (err) {
      if (epoch !== this.viewEpoch) return;
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
  }

  private togglePromote(): void {
    const open = this.promoteBox.hidden;
    setHidden(this.promoteBox, !open);
    if (!open) return;
    const rooms = (this.ctx.store.snapshot?.rooms ?? []).filter((r) => r.id.startsWith('project:'));
    this.promoteProject.replaceChildren(h('option', { attrs: { value: '' }, text: tr('Sem projeto') }), ...rooms.map((r) => h('option', { attrs: { value: r.id.slice(8) }, text: r.name })));
    this.promoteName.focus();
  }

  private async promote(): Promise<void> {
    const name = this.promoteName.value.trim();
    if (!name || !this.consultId) return;
    const epoch = this.viewEpoch;
    const id = this.consultId;
    try {
      const projectId = this.promoteProject.value;
      const c = await api<{ id: string; name: string }>('/api/cards', json({ name, fromConsult: id, ...(projectId ? { projectId } : {}) }));
      if (epoch !== this.viewEpoch || id !== this.consultId) return;
      this.consultId = undefined;
      this.card = { id: c.id, name: c.name };
      this.promoteName.value = '';
      setHidden(this.promoteBox, true);
      this.render();
    } catch (err) {
      if (epoch !== this.viewEpoch) return;
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
  }

  /** Encerra somente a observação local; não pede Parar nem conclui o run do executor. */
  disposeView(): void {
    this.viewEpoch++;
    this.discovery?.abort();
    this.discovery = undefined;
    this.stream?.abort();
    this.stream = undefined;
    this.view = { ...this.view, busy: false };
    this.render();
  }

  /** Nenhuma conversa é atribuída à sessão externa; limpa só a observação local. */
  clearTarget(): void {
    this.hide();
    this.card = undefined;
    this.consultId = undefined;
    this.explicitRunId = undefined;
    this.observedRun = undefined;
    this.view = emptyConsult();
    this.input.value = '';
    this.options.onRun?.(null);
    this.render();
  }

  hide(): void {
    this.disposeView();
    if (this.options.embedded) { setHidden(this.el, true); this.el.inert = true; }
    else if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
  }

  private describeScreen(): string {
    const sel = this.ctx.selection();
    if (!sel) return '';
    if (sel.type === 'agent') {
      const a = this.ctx.agent(sel.id);
      if (!a) return '';
      const room = this.ctx.store.snapshot?.rooms.find((r) => r.id === a.roomId);
      return [tr('agente "{0}"', [a.name]), a.title ? tr('tarefa: {0}', [a.title]) : '', room ? tr('sala {0} ({1})', [room.name, room.path]) : ''].filter(Boolean).join('; ');
    }
    const room = this.ctx.store.snapshot?.rooms.find((r) => r.id === sel.id);
    return room ? tr('sala {0} ({1})', [room.name, room.path]) : '';
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (text && this.view.busy && this.view.runId) return this.steer(text);
    if (!text || this.view.busy) return;
    // Novo envio solta toda observação anterior, automática ou explícita, não o executor.
    this.disposeView();
    const epoch = this.viewEpoch;
    this.explicitRunId = undefined;
    this.observedRun = undefined;
    this.view = sendStarted(this.view, text);
    this.input.value = '';
    this.render();
    try {
      if (this.card) {
        await this.streamAnswer(`/api/cards/${encodeURIComponent(this.card.id)}/messages`, text);
        if (epoch === this.viewEpoch && this.view.busy) this.apply({ type: 'done' });
        return;
      }
      if (!this.consultId) {
        const c = await api<{ id: string }>('/api/consult', json({ context: this.context.value.trim() || undefined, screen: this.screen.checked ? this.describeScreen() || undefined : undefined }));
        if (epoch !== this.viewEpoch) return;
        this.consultId = c.id;
      }
      await this.streamAnswer(`/api/consult/${encodeURIComponent(this.consultId)}/messages`, text);
    } catch (err) {
      // Conversa trocada/limpa no meio da resposta: o erro do abort não é desta conversa.
      if (epoch !== this.viewEpoch || (err as Error)?.name === 'AbortError') return;
      this.apply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    if (epoch === this.viewEpoch && this.view.busy) this.apply({ type: 'done' });
  }

  private async streamAnswer(url: string, body: string | RequestInit): Promise<void> {
    this.stream?.abort();
    const epoch = this.viewEpoch;
    const controller = new AbortController();
    this.stream = controller;
    const ensureCurrent = (): void => {
      if (epoch !== this.viewEpoch || controller.signal.aborted) throw new DOMException('Stream cancelado', 'AbortError');
    };
    let res: Response;
    try {
      res = await fetch(url, { ...(typeof body === 'string' ? json({ text: body }) : body), credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      ensureCurrent();
      throw new Error(tr('o Habblaud não respondeu'));
    }
    ensureCurrent();
    if (!res.ok || !res.body) {
      const b = (await res.json().catch((err: unknown) => {
        if ((err as Error)?.name === 'AbortError') throw err;
        return {};
      })) as { error?: string };
      ensureCurrent();
      throw new Error(b.error ?? tr('erro {0}', [res.status]));
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let rest = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        ensureCurrent();
        if (done) break;
        const r = parseSseChunk(rest, value);
        rest = r.rest;
        for (const e of r.events) {
          ensureCurrent();
          this.apply(e);
        }
      }
      // Último evento sem a linha em branco final.
      if (rest.trim()) for (const e of parseSseChunk(rest, '\n\n').events) {
        ensureCurrent();
        this.apply(e);
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      ensureCurrent();
      throw err;
    } finally {
      reader.releaseLock();
    }
  }

  private apply(e: Parameters<typeof reduceConsult>[1]): void {
    if (e.type === 'run' && e.runId) {
      const prompt = this.view.turns.findLast(turn => turn.role === 'user')?.text;
      this.observedRun = { runId: e.runId, state: 'running', ...(prompt !== undefined ? { prompt } : {}) };
    } else if (this.observedRun) {
      if (e.type === 'approval') this.observedRun = { ...this.observedRun, state: 'waiting' };
      else if (e.type === 'approved') this.observedRun = { ...this.observedRun, state: 'running' };
    }
    if (this.observedRun) this.options.onRun?.(this.observedRun);
    this.view = reduceConsult(this.view, e);
    this.render();
    if (this.options.readRun && this.observedRun && (e.type === 'done' || e.type === 'error')) void this.refreshRun(this.observedRun.runId);
  }

  /** A cauda do SSE não distingue todos os desfechos; o registro é a autoridade. */
  private async refreshRun(runId: string): Promise<void> {
    const epoch = this.viewEpoch;
    this.discovery?.abort();
    const controller = this.discovery = new AbortController();
    try {
      const run = panelRun(await api(`/api/runs/${encodeURIComponent(runId)}`, { signal: controller.signal }));
      if (controller.signal.aborted || epoch !== this.viewEpoch || !this.isOpen || this.observedRun?.runId !== runId || run?.runId !== runId) return;
      this.observedRun = run;
      this.options.onRun?.(run);
    } catch { /* sem registro atualizado: não inventa um desfecho */ }
  }

  private reset(): void {
    this.disposeView();
    this.input.value = '';
    this.consultId = undefined;
    if (!this.options.readRun) this.card = undefined;
    this.explicitRunId = undefined;
    this.observedRun = undefined;
    this.options.onRun?.(null);
    setHidden(this.promoteBox, true);
    this.view = emptyConsult();
    this.context.value = '';
    this.render();
    this.context.focus();
  }

  private async archive(): Promise<void> {
    const id = this.consultId;
    if (!id) return this.reset();
    const epoch = this.viewEpoch;
    try {
      await api(`/api/consult/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (epoch !== this.viewEpoch || id !== this.consultId) return;
      this.reset();
    } catch (err) {
      if (epoch !== this.viewEpoch) return;
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
  }

  private render(): void {
    setText(this.heading, this.card ? this.card.name : tr('Consultor'));
    setHidden(this.contextWrap, !!this.card || !!this.consultId || this.view.turns.length > 0);
    setHidden(this.promoteBtn, !this.consultId || !!this.card || access().agents !== true);
    setHidden(this.archiveBtn, !!this.card);
    this.log.replaceChildren(
      ...this.view.turns.map((t) => {
        const el = h('div', { class: `ui-consult__turn ui-consult__turn--${t.role}` });
        if (t.role === 'assistant') el.append(t.text ? renderMarkdown(t.text) : h('span', { class: 'ui-consult__typing', text: '…' }));
        else el.textContent = t.text;
        return el;
      }),
    );
    this.log.scrollTop = this.log.scrollHeight;
    setText(this.status, this.view.error ? tr('Erro: {0}', [this.view.error]) : this.view.tool ? tr('Usando {0}…', [this.view.tool]) : '');
    this.status.classList.toggle('is-error', !!this.view.error);
    const running = this.view.busy && !!this.view.runId;
    setText(this.sendBtn, running ? tr('Redirecionar') : tr('Enviar'));
    this.sendBtn.title = running ? tr('Manda uma orientação ao agente sem esperar a resposta acabar') : '';
    this.sendBtn.disabled = this.view.busy && !running;
    this.input.disabled = this.view.busy && !running;
    this.input.placeholder = running ? tr('Redirecionar: nova orientação para o agente (Ctrl+Enter)') : tr('Pergunte (Ctrl+Enter envia)');
    setHidden(this.stopBtn, !running);
    const a = this.view.approval;
    setHidden(this.approvalBox, !a);
    if (a)
      this.approvalBox.replaceChildren(
        h('p', { class: 'ui-rename__hint', text: a.description ? tr('Aprovação pedida: {0}', [a.description]) : tr('Aprovação pedida') }),
        h('pre', { class: 'ui-consult__command', text: a.command }),
        h(
          'div',
          { class: 'ui-consult__actions' },
          ...a.choices.map((c) => h('button', { class: `ui-btn ui-perm__btn ${c === 'deny' ? 'ui-perm__btn--deny' : 'ui-perm__btn--allow'}`, type: 'button', text: choiceLabel(c), on: { click: () => void this.answerApproval(c) } })),
        ),
      );
    this.archiveBtn.disabled = !this.consultId || this.view.busy;
  }
}
