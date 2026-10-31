// Seção "Agendas" dentro da ficha do agente (ui/card.ts): lista (próxima, última vez), pausar/retomar, rodar agora,
// apagar e formulário de nova agenda (uma vez, a cada N, dias da semana). Fala com /api/schedules.
// A resposta de cada vez vai para a Inbox (⏰); o horário é o do servidor.
import { tr } from '../../../shared/i18n';
import { cardCall } from './card';
import { h, setHidden, setText } from './dom';
import { DAY_SHORT, lastLabel, ruleFromForm, ruleLabel, statusLabel, type ScheduleDto } from './schedule-model';

const stop = (el: HTMLElement) => el.addEventListener('keydown', (e) => e.stopPropagation());

export class ScheduleSection {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly form: HTMLElement;
  private readonly kind: HTMLSelectElement;
  private readonly text: HTMLTextAreaElement;
  private readonly at: HTMLInputElement;
  private readonly every: HTMLInputElement;
  private readonly unit: HTMLSelectElement;
  private readonly days: HTMLInputElement[];
  private readonly time: HTMLInputElement;
  private readonly onceBox: HTMLElement;
  private readonly everyBox: HTMLElement;
  private readonly weeklyBox: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly tz: HTMLElement;
  private cardId = '';

  constructor() {
    this.list = h('div', { class: 'ui-sched__list' });
    this.kind = h('select', { class: 'ui-select', attrs: { 'aria-label': tr('Quando') } });
    for (const [v, t] of [['weekly', tr('Dias da semana')], ['every', tr('A cada')], ['once', tr('Uma vez')]] as const) this.kind.append(h('option', { attrs: { value: v }, text: t }));
    this.kind.addEventListener('change', () => this.showKind());
    this.text = h('textarea', { class: 'ui-rename__input', attrs: { rows: 2, maxlength: 8000, placeholder: tr('Mensagem para o agente (ex.: veja o cluster e me resuma)') } });
    this.at = h('input', { class: 'ui-rename__input', type: 'datetime-local' });
    this.every = h('input', { class: 'ui-rename__input ui-sched__num', type: 'number', attrs: { min: 1, value: '1' } });
    this.unit = h('select', { class: 'ui-select' });
    for (const [v, t] of [['h', tr('horas')], ['min', tr('minutos')], ['d', tr('dias')]] as const) this.unit.append(h('option', { attrs: { value: v }, text: t }));
    const names = DAY_SHORT();
    this.days = [1, 2, 3, 4, 5, 6, 0].map((d) => h('input', { type: 'checkbox', attrs: { value: String(d), ...(d >= 1 && d <= 5 ? { checked: '' } : {}) } }));
    this.time = h('input', { class: 'ui-rename__input', type: 'time', attrs: { value: '09:00' } });
    for (const f of [this.text, this.at, this.every, this.time]) stop(f);
    this.onceBox = h('div', { class: 'ui-project__row' }, this.at);
    this.everyBox = h('div', { class: 'ui-project__row' }, this.every, this.unit);
    this.weeklyBox = h('div', { class: 'ui-sched__days' }, ...this.days.map((c) => h('label', { class: 'ui-sched__day' }, c, names[Number(c.value)]!)), this.time);
    this.msg = h('p', { class: 'ui-rename__hint', attrs: { role: 'status' } });
    this.tz = h('p', { class: 'ui-small ui-muted' });
    this.form = h(
      'div',
      { class: 'ui-sched__form' },
      this.text,
      this.kind,
      this.onceBox,
      this.everyBox,
      this.weeklyBox,
      h('div', { class: 'ui-project__row' }, h('button', { class: 'ui-btn', type: 'button', text: tr('Agendar'), on: { click: () => void this.create() } })),
    );
    const details = h('details', { class: 'ui-sched__new' }, h('summary', { text: tr('Nova agenda') }), this.form);
    this.el = h('div', { class: 'ui-sched' }, h('h4', { class: 'ui-sched__title', text: tr('Agendas') }), this.list, details, this.tz, this.msg);
    this.showKind();
  }

  async load(cardId: string): Promise<void> {
    this.cardId = cardId;
    try {
      const r = await cardCall<{ schedules: ScheduleDto[]; timeZone?: string }>('GET', `/api/schedules?card=${encodeURIComponent(cardId)}`);
      if (cardId !== this.cardId) return;
      this.renderList(r.schedules);
      setText(this.tz, r.timeZone ? tr('Horários no fuso do servidor ({0}). A resposta chega na Inbox.', [r.timeZone]) : '');
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  private showKind(): void {
    setHidden(this.onceBox, this.kind.value !== 'once');
    setHidden(this.everyBox, this.kind.value !== 'every');
    setHidden(this.weeklyBox, this.kind.value !== 'weekly');
  }

  private say(text: string, error = false): void {
    setText(this.msg, text);
    this.msg.classList.toggle('is-error', error);
  }

  private renderList(items: ScheduleDto[]): void {
    this.list.replaceChildren(
      ...(items.length
        ? items.map((s) => {
            const last = lastLabel(s.last);
            return h(
              'div',
              { class: `ui-sched__item${s.enabled ? '' : ' is-off'}` },
              h('div', { class: 'ui-inbox__meta' }, h('strong', { text: `⏰ ${ruleLabel(s.rule)}` }), h('span', { class: 'ui-inbox__when', text: statusLabel(s) })),
              h('p', { class: 'ui-inbox__text', text: s.text }),
              last ? h('p', { class: `ui-small ${s.last?.result === 'error' ? 'is-error' : 'ui-muted'}`, text: last }) : '',
              h(
                'div',
                { class: 'ui-consult__actions' },
                h('button', { class: 'ui-btn', type: 'button', text: s.enabled ? tr('Pausar') : tr('Retomar'), on: { click: () => void this.act('PATCH', s.id, { enabled: !s.enabled }) } }),
                h('button', { class: 'ui-btn', type: 'button', text: tr('Rodar agora'), on: { click: () => void this.act('POST', `${s.id}/run`, {}, tr('Enviado; a resposta chega na Inbox.')) } }),
                h('button', { class: 'ui-btn ui-btn--link', type: 'button', text: tr('Apagar'), on: { click: () => confirm(tr('Apagar esta agenda?')) && void this.act('DELETE', s.id, {}) } }),
              ),
            );
          })
        : [h('p', { class: 'ui-small ui-muted', text: tr('Nenhuma agenda.') })]),
    );
  }

  private async act(method: string, path: string, body: unknown, ok = ''): Promise<void> {
    try {
      const r = await cardCall<ScheduleDto>(method, `/api/schedules/${path.split('/').map(encodeURIComponent).join('/')}`, body);
      if (r?.last?.result === 'busy') this.say(tr('Agente ocupado agora; tente depois.'), true);
      else this.say(ok);
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
    await this.load(this.cardId);
  }

  private async create(): Promise<void> {
    try {
      const rule = ruleFromForm({
        kind: this.kind.value,
        at: this.at.value,
        every: Number(this.every.value),
        unit: this.unit.value as 'min' | 'h' | 'd',
        days: this.days.filter((c) => c.checked).map((c) => Number(c.value)),
        time: this.time.value,
      });
      await cardCall('POST', '/api/schedules', { cardId: this.cardId, text: this.text.value, rule });
      this.text.value = '';
      this.say(tr('Agenda criada.'));
      await this.load(this.cardId);
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }
}
