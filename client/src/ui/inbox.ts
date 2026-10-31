// Inbox (botão na barra do topo e atalho I): o que espera você e o que ficou pronto sem ninguém olhando. Lê
// GET /api/inbox a cada poucos segundos (com a aba visível); o selo do botão conta o que pede decisão. Aprovação do
// Hermes se responde aqui; pedido do Claude/Codex leva até o agente (UI de permissão que já existe); resposta,
// pergunta, erro ou interrompido abrem a conversa no painel do consultor. Estado puro em inbox-model.ts.
import { tr } from '../../../shared/i18n';
import type { UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { relativeTime } from './format';
import { ICONS } from './icons';
import { choiceLabel, groupInbox, kindLabel, urgentCount, type InboxItem } from './inbox-model';
import { focusPermission } from './permission';
import { access } from '../net/access';

const POLL_MS = 5000;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? tr('erro {0}', [res.status])), { status: res.status });
  return body;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export class InboxPanel {
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly clearBtn: HTMLButtonElement;
  private items: InboxItem[] = [];
  /** Ficha → projeto (de GET /api/cards), para agrupar. */
  private cardProject = new Map<string, string>();
  private timer?: number;
  private loading = false;

  constructor(private readonly ctx: UiContext) {
    this.badge = h('span', { class: 'ui-inbox__badge', hidden: true, attrs: { 'aria-hidden': 'true' } });
    this.button = iconButton(ICONS.inbox, tr('Inbox: aprovações, perguntas e respostas prontas (I)'), () => this.toggle(), 'ui-btn-inbox');
    this.button.append(this.badge);
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.hidden = true;
    this.list = h('div', { class: 'ui-inbox__list' });
    this.status = h('p', { class: 'ui-rename__hint', attrs: { role: 'status' } });
    this.clearBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Dispensar tudo'), title: tr('Tira da Inbox as respostas, erros e interrompidos (aprovações ficam)'), on: { click: () => void this.dismissAll() } });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-inbox', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Inbox'), id: 'ui-inbox', popover: 'manual' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Inbox') }), close),
      h('div', { class: 'ui-set-group ui-inbox__body' }, this.list, this.status, h('div', { class: 'ui-consult__actions' }, this.clearBtn)),
    );
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    });
    void this.refresh();
    this.timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, POLL_MS);
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(): void {
    if (this.button.hidden) return;
    if (this.isOpen) return this.hide();
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    this.button.setAttribute('aria-expanded', 'true');
    void this.refresh(true);
    this.el.focus();
  }

  hide(): void {
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
    this.button.setAttribute('aria-expanded', 'false');
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
  }

  /** Lê a Inbox; `cards` também relê ficha → projeto (ao abrir). */
  async refresh(cards = false): Promise<void> {
    if (this.loading || this.ctx.store.mock) return;
    this.loading = true;
    try {
      const { items } = await api<{ items: InboxItem[] }>('/api/inbox');
      this.items = items;
      this.button.hidden = false;
      if (cards || this.cardProject.size === 0) await this.loadCards();
      this.render();
    } catch (err) {
      // 404 = servidor sem driver (Inbox desligada): botão some.
      if ((err as { status?: number }).status === 404) {
        this.button.hidden = true;
        this.stop();
      }
    } finally {
      this.loading = false;
    }
  }

  private async loadCards(): Promise<void> {
    try {
      const { cards } = await api<{ cards: { id: string; projectId?: string }[] }>('/api/cards');
      this.cardProject = new Map(cards.filter((c) => c.projectId).map((c) => [c.id, c.projectId!]));
    } catch {
      /* sem fichas: agrupa tudo em "sem projeto" */
    }
  }

  private projectOf(item: InboxItem): string | undefined {
    const rooms = this.ctx.store.snapshot?.rooms ?? [];
    if (item.owner?.kind === 'card') {
      const p = this.cardProject.get(item.owner.id);
      return p ? rooms.find((r) => r.id === `project:${p}`)?.name : undefined;
    }
    if (item.agentId) {
      const a = this.ctx.agent(item.agentId);
      return a ? rooms.find((r) => r.id === a.roomId)?.name : undefined;
    }
    return undefined;
  }

  private async act(fn: () => Promise<unknown>): Promise<void> {
    setText(this.status, '');
    try {
      await fn();
    } catch (err) {
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
    await this.refresh();
  }

  private async dismissAll(): Promise<void> {
    await this.act(() => api('/api/inbox/dismiss-all', post({})));
  }

  private open(item: InboxItem): void {
    if (item.kind === 'permission' && item.agentId) {
      this.hide();
      focusPermission(this.ctx, item.agentId);
      return;
    }
    if (!item.runId || !item.owner) return;
    this.hide();
    this.ctx.openRun?.(item.runId, item.owner);
    // Abriu para ler: sai da Inbox (aprovação só sai ao responder).
    if (item.kind !== 'approval') void this.act(() => api(`/api/inbox/${encodeURIComponent(item.id)}`, post({ action: 'dismiss' })));
  }

  private row(item: InboxItem): HTMLElement {
    const can = access().agents === true;
    const actions: HTMLElement[] = [];
    if (item.kind === 'approval' && item.approval && can)
      for (const c of item.approval.choices)
        actions.push(
          h('button', {
            class: `ui-btn ui-perm__btn ${c === 'deny' ? 'ui-perm__btn--deny' : 'ui-perm__btn--allow'}`,
            type: 'button',
            text: choiceLabel(c),
            on: { click: () => void this.act(() => api(`/api/inbox/${encodeURIComponent(item.id)}`, post({ action: 'approve', choice: c }))) },
          }),
        );
    actions.push(h('button', { class: 'ui-btn', type: 'button', text: item.kind === 'permission' ? tr('Ir até o agente') : tr('Abrir conversa'), on: { click: () => this.open(item) } }));
    if (item.kind !== 'approval' && item.kind !== 'permission' && can)
      actions.push(h('button', { class: 'ui-btn', type: 'button', text: tr('Dispensar'), on: { click: () => void this.act(() => api(`/api/inbox/${encodeURIComponent(item.id)}`, post({ action: 'dismiss' }))) } }));
    return h(
      'div',
      { class: `ui-inbox__item ui-inbox__item--${item.kind}` },
      h('div', { class: 'ui-inbox__meta' }, h('strong', { text: item.owner?.scheduleId ? `⏰ ${item.title}` : item.title, title: item.owner?.scheduleId ? tr('Veio de uma agenda') : '' }), h('span', { class: 'ui-inbox__kind', text: kindLabel(item.kind) }), h('span', { class: 'ui-inbox__when', text: relativeTime(item.at, Date.now()) })),
      item.text ? h(item.kind === 'approval' ? 'pre' : 'p', { class: item.kind === 'approval' ? 'ui-consult__command' : 'ui-inbox__text', text: item.text }) : '',
      h('div', { class: 'ui-consult__actions' }, ...actions),
    );
  }

  private render(): void {
    const urgent = urgentCount(this.items);
    const total = this.items.length;
    setText(this.badge, urgent ? String(urgent) : total ? '•' : '');
    setHidden(this.badge, total === 0);
    this.badge.classList.toggle('is-urgent', urgent > 0);
    this.button.setAttribute('aria-label', total ? tr('Inbox: {0} itens, {1} pedem decisão (I)', [total, urgent]) : tr('Inbox: vazia (I)'));
    this.clearBtn.disabled = !this.items.some((i) => i.kind !== 'approval' && i.kind !== 'permission') || access().agents !== true;
    if (!total) {
      this.list.replaceChildren(h('p', { class: 'ui-rename__hint', text: tr('Nada esperando você.') }));
      return;
    }
    this.list.replaceChildren(
      ...groupInbox(this.items, (i) => this.projectOf(i)).flatMap((g) => [h('h3', { class: 'ui-inbox__group', text: g.project || tr('Sem projeto') }), ...g.items.map((i) => this.row(i))]),
    );
  }
}
