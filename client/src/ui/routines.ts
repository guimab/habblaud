// Agendas (botão na barra do topo): todas as rotinas do Habblaud e do Hermes numa lista, cada uma administrada na
// própria origem. Hermes: /api/routines/hermes/*; Habblaud: /api/schedules/* (a regra se edita na ficha). Falha de
// uma origem aparece como aviso, nunca como lista vazia. Textos e diff em routines-model.ts.
import { tr } from '../../../shared/i18n';
import type { UiContext } from './context';
import { h, iconButton, setText } from './dom';
import { ICONS } from './icons';
import { jobEditDiff, routineRows, runConfirm, scheduleInput, sourceNotices, type HermesJobDto, type RoutineRow, type RoutinesResponse } from './routines-model';
import { access } from '../net/access';
import { MOCK_ROUTINES } from './routines-mock';

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

const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

/** Linha em modo especial: confirmar exclusão, confirmar execução ou editar. */
type Mode = { key: string; kind: 'delete' | 'run' | 'edit' } | { key: 'new'; kind: 'new' } | undefined;

export class RoutinesPanel {
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly status: HTMLElement;
  private readonly newBtn: HTMLButtonElement;
  private data: RoutinesResponse | undefined;
  private cardNames = new Map<string, string>();
  private mode: Mode;
  private busy = false;

  constructor(private readonly ctx: UiContext) {
    this.button = iconButton(ICONS.clock, tr('Agendas: rotinas do Habblaud e do Hermes'), () => this.toggle(), 'ui-btn-routines');
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.list = h('div', { class: 'ui-inbox__list ui-routines__list' });
    this.notices = h('div', { class: 'ui-routines__notices' });
    this.status = h('p', { class: 'ui-rename__hint', attrs: { role: 'status' } });
    this.newBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Nova rotina no Hermes'), on: { click: () => this.setMode({ key: 'new', kind: 'new' }) } });
    const reload = h('button', { class: 'ui-btn', type: 'button', text: tr('Atualizar'), on: { click: () => void this.refresh() } });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-inbox ui-routines', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Agendas'), id: 'ui-routines', popover: 'manual' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Agendas') }), close),
      h(
        'div',
        { class: 'ui-set-group ui-inbox__body' },
        h('p', { class: 'ui-rename__hint', text: tr('Cada rotina é administrada na origem dela. Agendas do Habblaud se criam na ficha do agente.') }),
        this.notices,
        this.list,
        this.status,
        h('div', { class: 'ui-consult__actions' }, this.newBtn, reload),
      ),
    );
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (this.mode) this.setMode(undefined);
      else this.hide();
    });
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(): void {
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
    this.mode = undefined;
  }

  async refresh(cards = false): Promise<void> {
    try {
      if (this.ctx.store.mock) {
        this.data = MOCK_ROUTINES;
        this.cardNames = new Map([['c1', 'Ops']]);
      } else {
        this.data = await api<RoutinesResponse>('/api/routines');
        if (cards || !this.cardNames.size) await this.loadCards();
      }
    } catch (err) {
      setText(this.status, err instanceof Error ? err.message : String(err));
    }
    this.render();
  }

  private async loadCards(): Promise<void> {
    try {
      const { cards } = await api<{ cards: { id: string; name?: string }[] }>('/api/cards');
      this.cardNames = new Map(cards.filter((c) => c.name).map((c) => [c.id, c.name!]));
    } catch {
      /* sem fichas: a linha diz "ficha removida" só se o servidor também não a tem */
    }
  }

  private setMode(m: Mode): void {
    this.mode = m;
    setText(this.status, '');
    this.render();
  }

  /** Executa uma ação na origem e relê a lista; erro fica visível na tela. */
  private async act(label: string, fn: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    setText(this.status, `${label}…`);
    try {
      this.mode = undefined;
      if (this.ctx.store.mock) setText(this.status, tr('{0}: demonstração, nada foi alterado', [label]));
      else {
        await fn();
        setText(this.status, tr('{0}: feito', [label]));
      }
    } catch (err) {
      setText(this.status, `${label}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
    }
    await this.refresh();
  }

  private hermesPath(id: string, suffix = ''): string {
    return `/api/routines/hermes/${encodeURIComponent(id)}${suffix}`;
  }

  private habblaudPath(id: string, suffix = ''): string {
    return `/api/schedules/${encodeURIComponent(id)}${suffix}`;
  }

  private hermesJob(key: string): HermesJobDto | undefined {
    const r = this.data?.routines.find((x) => x.key === key);
    return r?.source === 'hermes' ? r.hermes : undefined;
  }

  private btn(text: string, onClick: () => void, extra = ''): HTMLButtonElement {
    return h('button', { class: `ui-btn ${extra}`.trim(), type: 'button', text, on: { click: onClick } });
  }

  private actions(r: RoutineRow): HTMLElement {
    const can = access().agents === true;
    if (!can) return h('p', { class: 'ui-rename__hint', text: tr('Só leitura neste acesso.') });
    const m = this.mode && this.mode.key === r.key ? this.mode : undefined;
    const cancel = this.btn(tr('Cancelar'), () => this.setMode(undefined));
    if (m?.kind === 'delete') {
      const path = r.source === 'hermes' ? this.hermesPath(r.id) : this.habblaudPath(r.id);
      return h(
        'div',
        { class: 'ui-consult__actions ui-routines__confirm', role: 'group' },
        h('span', { text: tr('Excluir "{0}" no {1}? Não dá para desfazer.', [r.title, r.sourceLabel]) }),
        this.btn(tr('Excluir'), () => void this.act(tr('Excluir'), () => api(path, { method: 'DELETE' })), 'ui-perm__btn--deny'),
        cancel,
      );
    }
    if (m?.kind === 'run') {
      const c = runConfirm(this.hermesJob(r.key)!)!;
      const run = (keepPaused: boolean) => void this.act(tr('Executar agora'), () => api(this.hermesPath(r.id, '/run'), send('POST', { keepPaused })));
      return h('div', { class: 'ui-consult__actions ui-routines__confirm', role: 'group' }, h('span', { text: c.text }), this.btn(c.keepPausedLabel, () => run(true)), this.btn(c.reactivateLabel, () => run(false)), cancel);
    }
    const paused = r.status.kind === 'paused' || r.status.kind === 'done';
    const out: HTMLElement[] = [];
    if (r.source === 'hermes') {
      out.push(this.btn(tr('Editar'), () => this.setMode({ key: r.key, kind: 'edit' })));
      out.push(this.btn(paused ? tr('Retomar') : tr('Pausar'), () => void this.act(paused ? tr('Retomar') : tr('Pausar'), () => api(this.hermesPath(r.id, paused ? '/resume' : '/pause'), send('POST')))));
      out.push(
        this.btn(tr('Executar agora'), () => {
          if (runConfirm(this.hermesJob(r.key)!)) this.setMode({ key: r.key, kind: 'run' });
          else void this.act(tr('Executar agora'), () => api(this.hermesPath(r.id, '/run'), send('POST', {})));
        }),
      );
    } else {
      out.push(this.btn(paused ? tr('Retomar') : tr('Pausar'), () => void this.act(paused ? tr('Retomar') : tr('Pausar'), () => api(this.habblaudPath(r.id), send('PATCH', { enabled: paused })))));
      out.push(this.btn(tr('Executar agora'), () => void this.act(tr('Executar agora'), () => api(this.habblaudPath(r.id, '/run'), send('POST')))));
    }
    out.push(this.btn(tr('Excluir'), () => this.setMode({ key: r.key, kind: 'delete' }), 'ui-perm__btn--deny'));
    return h('div', { class: 'ui-consult__actions' }, ...out);
  }

  /** Formulário do Hermes (novo ou edição). Edição manda só o que mudou. */
  private form(job: HermesJobDto | undefined): HTMLElement {
    const field = (label: string, input: HTMLInputElement | HTMLTextAreaElement) => h('label', { class: 'ui-routines__field' }, h('span', { text: label }), input);
    const name = h('input', { class: 'ui-input', attrs: { value: job?.name ?? '', 'aria-label': tr('Nome') } }) as HTMLInputElement;
    const schedule = h('input', { class: 'ui-input', attrs: { value: job ? scheduleInput(job.schedule) : '', placeholder: 'every 2h · 0 9 * * 1 · in 30m', 'aria-label': tr('Regra') } }) as HTMLInputElement;
    const prompt = h('textarea', { class: 'ui-input', attrs: { rows: '3', 'aria-label': tr('Pedido') } }) as HTMLTextAreaElement;
    prompt.value = job?.prompt ?? '';
    const deliver = h('input', { class: 'ui-input', attrs: { value: job?.deliver ?? 'local', 'aria-label': tr('Entrega') } }) as HTMLInputElement;
    const skills = h('input', { class: 'ui-input', attrs: { value: job?.skills.join(', ') ?? '', 'aria-label': tr('Skills') } }) as HTMLInputElement;
    const paused = h('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
    paused.checked = true;
    const err = h('p', { class: 'ui-rename__hint', attrs: { role: 'alert' } });
    const save = () => {
      const f = { name: name.value, schedule: schedule.value, prompt: prompt.value, deliver: deliver.value, skills: skills.value };
      try {
        if (job) {
          const diff = jobEditDiff(job, f);
          if (!diff) return setText(err, tr('Nada mudou.'));
          void this.act(tr('Salvar'), () => api(this.hermesPath(job.id), send('PATCH', diff)));
        } else {
          if (!f.name.trim()) throw new Error(tr('nome obrigatório'));
          if (!f.schedule.trim()) throw new Error(tr('regra obrigatória'));
          const sk = f.skills.split(',').map((s) => s.trim()).filter(Boolean);
          void this.act(tr('Criar'), () => api('/api/routines/hermes', send('POST', { name: f.name.trim(), schedule: f.schedule.trim(), prompt: f.prompt, deliver: f.deliver.trim() || 'local', ...(sk.length ? { skills: sk } : {}), paused: paused.checked })));
        }
      } catch (e) {
        setText(err, e instanceof Error ? e.message : String(e));
      }
    };
    return h(
      'div',
      { class: 'ui-routines__form' },
      field(tr('Nome'), name),
      field(tr('Regra (formato do Hermes)'), schedule),
      field(tr('Pedido'), prompt),
      field(tr('Entrega'), deliver),
      field(tr('Skills (separadas por vírgula)'), skills),
      job ? '' : h('label', { class: 'ui-routines__check' }, paused, h('span', { text: tr('Criar pausada') })),
      err,
      h('div', { class: 'ui-consult__actions' }, this.btn(job ? tr('Salvar') : tr('Criar'), save), this.btn(tr('Cancelar'), () => this.setMode(undefined))),
    );
  }

  private row(r: RoutineRow): HTMLElement {
    const editing = this.mode?.key === r.key && this.mode.kind === 'edit';
    return h(
      'div',
      { class: `ui-inbox__item ui-routines__item ui-routines__item--${r.status.kind}`, attrs: { 'data-key': r.key } },
      h('div', { class: 'ui-inbox__meta' }, h('span', { class: `ui-routines__source ui-routines__source--${r.source}`, text: r.sourceLabel }), h('strong', { text: r.title }), h('span', { class: 'ui-inbox__when', text: r.status.text })),
      h('p', { class: 'ui-inbox__text', text: tr('Quando: {0}', [r.rule]) }),
      r.prompt ? h('p', { class: 'ui-inbox__ask', text: tr('Pede: {0}', [r.prompt]) }) : '',
      r.last ? h('p', { class: 'ui-rename__hint', text: tr('Última: {0}', [r.last]) }) : '',
      r.readOnly.length ? h('p', { class: 'ui-rename__hint', text: tr('Só no Hermes: {0}', [r.readOnly.map(([k, v]) => `${k} ${v}`).join(' · ')]) }) : '',
      editing ? this.form(this.hermesJob(r.key)) : this.actions(r),
    );
  }

  private render(): void {
    const d = this.data;
    const notes = d ? sourceNotices(d.sources) : [];
    this.notices.replaceChildren(...notes.map((n) => h('p', { class: `ui-routines__notice ui-routines__notice--${n.kind}`, attrs: { role: n.kind === 'error' ? 'alert' : 'note' }, text: n.text })));
    this.newBtn.hidden = !d?.sources.hermes.ok || access().agents !== true;
    const rows = d ? routineRows(d, (id) => this.cardNames.get(id)) : [];
    const items: HTMLElement[] = [];
    if (this.mode?.kind === 'new') items.push(h('div', { class: 'ui-inbox__item ui-routines__item' }, h('strong', { text: tr('Nova rotina no Hermes') }), this.form(undefined)));
    items.push(...rows.map((r) => this.row(r)));
    if (!items.length) items.push(h('p', { class: 'ui-rename__hint', text: d ? tr('Nenhuma rotina.') : tr('Carregando…') }));
    this.list.replaceChildren(...items);
  }
}
