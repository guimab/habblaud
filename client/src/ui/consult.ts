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

const TEXT_MAX = 20_000;

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
  private readonly heading: HTMLElement;
  private readonly promoteBtn: HTMLButtonElement;
  private readonly promoteBox: HTMLElement;
  private readonly promoteName: HTMLInputElement;
  private readonly promoteProject: HTMLSelectElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly approvalBox: HTMLElement;
  private view: ConsultView = emptyConsult();
  private stream?: AbortController;

  constructor(private readonly ctx: UiContext) {
    this.context = h('textarea', {
      class: 'ui-rename__input ui-consult__context',
      attrs: { id: 'ui-consult-context', rows: 3, maxlength: TEXT_MAX, placeholder: tr('Contexto (opcional): quem você é, o que está fazendo, o que importa') },
    });
    this.screen = h('input', { type: 'checkbox', attrs: { id: 'ui-consult-screen' } });
    this.contextWrap = h(
      'div',
      { class: 'ui-consult__setup' },
      this.context,
      h('label', { class: 'ui-consult__check', attrs: { for: 'ui-consult-screen' } }, this.screen, h('span', { text: tr('Incluir o que estou vendo (agente ou sala selecionados)') })),
    );
    this.log = h('div', { class: 'ui-consult__log', attrs: { 'aria-live': 'polite' } });
    this.status = h('p', { class: 'ui-rename__hint ui-consult__status', attrs: { role: 'status' } });
    this.input = h('textarea', {
      class: 'ui-rename__input ui-consult__input',
      attrs: { id: 'ui-consult-input', rows: 3, maxlength: TEXT_MAX, placeholder: tr('Pergunte (Ctrl+Enter envia)') },
    });
    for (const f of [this.context, this.input]) {
      f.addEventListener('keydown', (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void this.send();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.hide();
        }
      });
      f.addEventListener('keyup', (e) => e.stopPropagation());
    }
    this.sendBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow', type: 'button', on: { click: () => void this.send() } }, tr('Enviar'));
    this.stopBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--deny', type: 'button', hidden: true, title: tr('Interrompe o agente'), on: { click: () => void this.stopRun() } }, tr('Parar'));
    this.approvalBox = h('div', { class: 'ui-consult__approval', hidden: true, role: 'group', attrs: { 'aria-label': tr('Aprovação') } });
    const newBtn = h('button', { class: 'ui-btn', type: 'button', on: { click: () => this.reset() } }, tr('Nova consulta'));
    this.archiveBtn = h('button', { class: 'ui-btn', type: 'button', on: { click: () => void this.archive() } }, tr('Arquivar'));
    this.promoteName = h('input', { class: 'ui-rename__input', type: 'text', attrs: { maxlength: 40, placeholder: tr('Nome do agente'), 'aria-label': tr('Nome do agente') } });
    this.promoteName.addEventListener('keydown', (e) => e.stopPropagation());
    this.promoteProject = h('select', { class: 'ui-select', attrs: { 'aria-label': tr('Projeto') } });
    this.promoteBox = h('div', { class: 'ui-project__row', hidden: true }, this.promoteName, this.promoteProject, h('button', { class: 'ui-btn', type: 'button', text: tr('Criar agente'), on: { click: () => void this.promote() } }));
    this.promoteBtn = h('button', { class: 'ui-btn', type: 'button', title: tr('A consulta vira um agente com ficha (nome, projeto, instruções)'), on: { click: () => this.togglePromote() } }, tr('Promover a agente…'));
    this.heading = h('h2', { text: tr('Consultor') });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-consult', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Consultor'), id: 'ui-consult', popover: 'manual' } },
      h('div', { class: 'ui-popover__head' }, this.heading, close),
      h('div', { class: 'ui-set-group ui-consult__body' }, this.contextWrap, this.log, this.status, this.approvalBox, this.input, this.promoteBox, h('div', { class: 'ui-consult__actions' }, newBtn, this.promoteBtn, this.archiveBtn, this.stopBtn, this.sendBtn)),
    );
    this.render();
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(anchor?: HTMLElement): void {
    if (anchor) this.anchor = anchor;
    if (this.isOpen) return this.hide();
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    this.anchor?.setAttribute('aria-expanded', 'true');
    (this.consultId || this.card ? this.input : this.context).focus();
  }

  /** Conversa com a ficha (troca de alvo limpa a conversa na tela; `fresh` também). */
  openCard(card: { id: string; name: string; fresh?: boolean }, anchor?: HTMLElement): void {
    if (card.fresh || this.card?.id !== card.id) {
      this.stream?.abort();
      this.view = emptyConsult();
    }
    this.consultId = undefined;
    this.card = { id: card.id, name: card.name };
    this.render();
    if (!this.isOpen) this.toggle(anchor);
    this.input.focus();
    if (!this.view.busy && !card.fresh) void this.resumeActive(card.id);
  }

  /** Abre a conversa de um run (Inbox): mostra a resposta guardada e, se ainda roda, acompanha. */
  openRun(runId: string, owner: { kind: 'card' | 'consult'; id: string; title?: string }, anchor?: HTMLElement): void {
    this.stream?.abort();
    this.view = emptyConsult();
    if (owner.kind === 'card') {
      this.consultId = undefined;
      this.card = { id: owner.id, name: owner.title || owner.id };
    } else {
      this.card = undefined;
      this.consultId = owner.id;
    }
    this.render();
    if (!this.isOpen) this.toggle(anchor);
    void this.attach(runId);
  }

  /** Ficha com run em andamento (painel fechado no meio): retoma a resposta. */
  private async resumeActive(cardId: string): Promise<void> {
    try {
      const { runs } = await api<{ runs: { runId: string; state: string; owner: { kind: string; id: string } }[] }>('/api/runs');
      const r = runs.find((x) => x.owner.kind === 'card' && x.owner.id === cardId && (x.state === 'running' || x.state === 'waiting'));
      if (r && this.card?.id === cardId && !this.view.busy) await this.attach(r.runId);
    } catch {
      /* sem runs (driver desligado): nada a retomar */
    }
  }

  private async attach(runId: string): Promise<void> {
    this.view = resumeStarted(this.view, runId);
    this.render();
    try {
      await this.streamAnswer(`/api/runs/${encodeURIComponent(runId)}/events`, { method: 'GET' });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      this.apply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    if (this.view.busy && this.view.runId === runId) this.apply({ type: 'done' });
  }

  private async stopRun(): Promise<void> {
    const id = this.view.runId;
    if (!id) return;
    try {
      await api(`/api/runs/${encodeURIComponent(id)}/stop`, json({}));
    } catch (err) {
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
  }

  private async steer(text: string): Promise<void> {
    const id = this.view.runId;
    if (!id) return;
    try {
      await api(`/api/runs/${encodeURIComponent(id)}/steer`, json({ text }));
      this.input.value = '';
      this.ctx.announce(tr('Redirecionado: o agente recebe a orientação no próximo passo.'));
      setText(this.status, tr('Redirecionado: o agente recebe a orientação no próximo passo.'));
    } catch (err) {
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
  }

  private async answerApproval(choice: ApprovalChoice): Promise<void> {
    const id = this.view.runId;
    if (!id) return;
    try {
      await api(`/api/inbox/${encodeURIComponent(`run:${id}`)}`, json({ action: 'approve', choice }));
      this.apply({ type: 'approved' });
    } catch (err) {
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
    try {
      const projectId = this.promoteProject.value;
      const c = await api<{ id: string; name: string }>('/api/cards', json({ name, fromConsult: this.consultId, ...(projectId ? { projectId } : {}) }));
      this.consultId = undefined;
      this.card = { id: c.id, name: c.name };
      this.promoteName.value = '';
      setHidden(this.promoteBox, true);
      this.render();
    } catch (err) {
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
  }

  hide(): void {
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
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
    this.view = sendStarted(this.view, text);
    this.input.value = '';
    this.render();
    try {
      if (this.card) {
        await this.streamAnswer(`/api/cards/${encodeURIComponent(this.card.id)}/messages`, text);
        if (this.view.busy) this.apply({ type: 'done' });
        return;
      }
      if (!this.consultId) {
        const c = await api<{ id: string }>('/api/consult', json({ context: this.context.value.trim() || undefined, screen: this.screen.checked ? this.describeScreen() || undefined : undefined }));
        this.consultId = c.id;
      }
      await this.streamAnswer(`/api/consult/${encodeURIComponent(this.consultId)}/messages`, text);
    } catch (err) {
      // Conversa trocada/limpa no meio da resposta: o erro do abort não é desta conversa.
      if ((err as Error)?.name === 'AbortError') return;
      this.apply({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    if (this.view.busy) this.apply({ type: 'done' });
  }

  private async streamAnswer(url: string, body: string | RequestInit): Promise<void> {
    this.stream?.abort();
    this.stream = new AbortController();
    let res: Response;
    try {
      res = await fetch(url, { ...(typeof body === 'string' ? json({ text: body }) : body), credentials: 'same-origin', cache: 'no-store', signal: this.stream.signal });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new Error(tr('o Habblaud não respondeu'));
    }
    if (!res.ok || !res.body) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b.error ?? tr('erro {0}', [res.status]));
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const r = parseSseChunk(rest, value);
      rest = r.rest;
      for (const e of r.events) this.apply(e);
    }
    // Último evento sem a linha em branco final.
    if (rest.trim()) for (const e of parseSseChunk(rest, '\n\n').events) this.apply(e);
  }

  private apply(e: Parameters<typeof reduceConsult>[1]): void {
    this.view = reduceConsult(this.view, e);
    this.render();
  }

  private reset(): void {
    this.stream?.abort();
    this.consultId = undefined;
    this.card = undefined;
    setHidden(this.promoteBox, true);
    this.view = emptyConsult();
    this.context.value = '';
    this.render();
    this.context.focus();
  }

  private async archive(): Promise<void> {
    const id = this.consultId;
    if (!id) return this.reset();
    try {
      await api(`/api/consult/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      this.reset();
    } catch (err) {
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
