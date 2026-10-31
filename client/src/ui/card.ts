// Fichas de agente na UI. CardSection fica na ficha do agente (ui/drawer.ts, AgentView):
//   - agente com ficha: editar nome/papel/projeto/modelo/instruções, Conversar, Soltar sessão, Apagar ficha;
//   - sessão do driver sem ficha: "Adotar em…" (ficha existente ou nova).
// NewCardRow fica na ficha da sala (RoomView): "Novo agente" no projeto da sala.
// Fala com /api/cards (server/agents/http.ts); o snapshot redesenha os agentes.
import { tr } from '../../../shared/i18n';
import type { AgentInfo, RoomInfo } from '../../../shared/types';
import { access } from '../net/access';
import type { UiContext } from './context';
import { h, setHidden, setText } from './dom';
import { ScheduleSection } from './schedules';

export interface CardDto {
  id: string;
  name: string;
  role?: string;
  projectId?: string;
  instructions?: string;
  model?: string;
  look?: 'f' | 'm';
  sessions: string[];
}

export async function cardCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? tr('erro {0}', [res.status]));
  return j;
}

const projectOf = (roomId: string | undefined): string | undefined => (roomId?.startsWith('project:') ? roomId.slice('project:'.length) : undefined);

function projectOptions(ctx: UiContext, sel: HTMLSelectElement, current?: string): void {
  const rooms = (ctx.store.snapshot?.rooms ?? []).filter((r) => r.id.startsWith('project:'));
  sel.replaceChildren(h('option', { attrs: { value: '' }, text: tr('Sem projeto') }), ...rooms.map((r) => h('option', { attrs: { value: projectOf(r.id)! }, text: r.name })));
  sel.value = current ?? '';
}

function stopKeys(el: HTMLElement): void {
  el.addEventListener('keydown', (e) => e.stopPropagation());
  el.addEventListener('keyup', (e) => e.stopPropagation());
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'ui-card__field' }, h('span', { class: 'ui-small ui-muted', text: label }), input);
}

export class CardSection {
  readonly el: HTMLElement;
  private readonly editBox: HTMLElement;
  private readonly adoptBox: HTMLElement;
  private readonly name: HTMLInputElement;
  private readonly role: HTMLInputElement;
  private readonly project: HTMLSelectElement;
  private readonly model: HTMLInputElement;
  private readonly instructions: HTMLTextAreaElement;
  private readonly releaseBtn: HTMLButtonElement;
  private readonly adoptSel: HTMLSelectElement;
  private readonly msg: HTMLElement;
  private agent?: AgentInfo;
  private loadedFor = '';
  private card?: CardDto;
  private readonly schedules = new ScheduleSection();

  constructor(private readonly ctx: UiContext) {
    this.name = h('input', { class: 'ui-rename__input', type: 'text', attrs: { maxlength: 40 } });
    this.role = h('input', { class: 'ui-rename__input', type: 'text', attrs: { maxlength: 60, placeholder: tr('ex.: pesquisa, revisão, operações') } });
    this.project = h('select', { class: 'ui-select' });
    this.model = h('input', { class: 'ui-rename__input', type: 'text', attrs: { maxlength: 120, placeholder: tr('padrão do driver') } });
    this.instructions = h('textarea', { class: 'ui-rename__input', attrs: { rows: 4, maxlength: 20000, placeholder: tr('Instruções fixas: o que este agente faz e como') } });
    for (const f of [this.name, this.role, this.model, this.instructions]) stopKeys(f);
    this.releaseBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Soltar sessão'), title: tr('A sessão continua no driver, mas deixa de ser deste agente'), on: { click: () => void this.release() } });
    this.editBox = h(
      'div',
      { class: 'ui-card' },
      h('div', { class: 'ui-project__row' }, h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow', type: 'button', text: tr('Conversar'), on: { click: () => this.chat() } }), h('button', { class: 'ui-btn', type: 'button', text: tr('Nova conversa'), title: tr('Abre uma sessão nova para este agente'), on: { click: () => void this.newSession() } })),
      field(tr('Nome'), this.name),
      field(tr('Papel'), this.role),
      field(tr('Projeto'), this.project),
      field(tr('Modelo'), this.model),
      field(tr('Instruções'), this.instructions),
      h('div', { class: 'ui-project__row' }, h('button', { class: 'ui-btn', type: 'button', text: tr('Salvar'), on: { click: () => void this.save() } }), this.releaseBtn, h('button', { class: 'ui-btn ui-btn--link', type: 'button', text: tr('Apagar ficha'), on: { click: () => void this.remove() } })),
      this.schedules.el,
    );
    this.adoptSel = h('select', { class: 'ui-select', attrs: { 'aria-label': tr('Adotar em…') } });
    this.adoptSel.addEventListener('change', () => void this.adopt());
    this.adoptBox = h('div', { class: 'ui-card' }, h('p', { class: 'ui-small ui-muted', text: tr('Esta sessão não é de nenhum agente. Adote para dar nome, papel e instruções fixas.') }), this.adoptSel);
    this.msg = h('p', { class: 'ui-rename__hint', attrs: { role: 'status' } });
    this.el = h('section', { class: 'ui-sec' }, h('h3', { class: 'ui-sec__title', text: tr('Ficha do agente') }), this.editBox, this.adoptBox, this.msg);
    setHidden(this.el, true);
  }

  render(a: AgentInfo | undefined): void {
    this.agent = a;
    const can = access().agents === true;
    const show = !!a && can && (!!a.cardId || !!a.driverSession);
    setHidden(this.el, !show);
    if (!show || !a) return;
    setHidden(this.editBox, !a.cardId);
    setHidden(this.adoptBox, !!a.cardId);
    if (a.cardId) {
      setHidden(this.releaseBtn, !a.driverSession);
      if (this.loadedFor !== a.cardId) {
        this.loadedFor = a.cardId;
        void this.load(a.cardId);
      }
    } else if (this.loadedFor !== `adopt:${a.id}`) {
      this.loadedFor = `adopt:${a.id}`;
      void this.loadAdopt();
    }
  }

  private say(text: string, error = false): void {
    setText(this.msg, text);
    this.msg.classList.toggle('is-error', error);
  }

  private async load(id: string): Promise<void> {
    try {
      const c = await cardCall<CardDto>('GET', `/api/cards/${encodeURIComponent(id)}`);
      this.card = c;
      this.name.value = c.name;
      this.role.value = c.role ?? '';
      projectOptions(this.ctx, this.project, c.projectId);
      this.model.value = c.model ?? '';
      this.instructions.value = c.instructions ?? '';
      void this.schedules.load(c.id);
      this.say('');
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  private async loadAdopt(): Promise<void> {
    try {
      const { cards } = await cardCall<{ cards: CardDto[] }>('GET', '/api/cards');
      this.adoptSel.replaceChildren(
        h('option', { attrs: { value: '' }, text: tr('Adotar em…') }),
        h('option', { attrs: { value: '+' }, text: tr('Novo agente') }),
        ...cards.map((c) => h('option', { attrs: { value: c.id }, text: c.name })),
      );
      this.say('');
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  private async save(): Promise<void> {
    const id = this.agent?.cardId;
    if (!id) return;
    try {
      this.card = await cardCall<CardDto>('PATCH', `/api/cards/${encodeURIComponent(id)}`, {
        name: this.name.value.trim(),
        role: this.role.value.trim() || null,
        projectId: this.project.value || null,
        model: this.model.value.trim() || null,
        instructions: this.instructions.value.trim() || null,
      });
      this.say(tr('Salvo.'));
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  private chat(): void {
    const id = this.agent?.cardId;
    if (id) this.ctx.chatCard?.({ id, name: this.card?.name ?? this.agent!.name });
  }

  private async newSession(): Promise<void> {
    const id = this.agent?.cardId;
    if (!id) return;
    try {
      await cardCall('POST', `/api/cards/${encodeURIComponent(id)}/sessions`);
      this.ctx.chatCard?.({ id, name: this.card?.name ?? this.agent!.name, fresh: true });
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  private async release(): Promise<void> {
    const a = this.agent;
    if (!a?.cardId || !a.driverSession) return;
    try {
      await cardCall('POST', `/api/cards/${encodeURIComponent(a.cardId)}/release`, { sessionId: a.driverSession });
      this.say(tr('Sessão solta.'));
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  private async remove(): Promise<void> {
    const id = this.agent?.cardId;
    if (!id || !confirm(tr('Apagar a ficha de {0}? As sessões continuam no driver.', [this.card?.name ?? this.agent!.name]))) return;
    try {
      await cardCall('DELETE', `/api/cards/${encodeURIComponent(id)}`);
      this.loadedFor = '';
      this.say(tr('Ficha apagada.'));
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  private async adopt(): Promise<void> {
    const a = this.agent;
    const v = this.adoptSel.value;
    this.adoptSel.value = '';
    if (!a?.driverSession || !v) return;
    try {
      let id = v;
      if (v === '+') {
        const name = prompt(tr('Nome do agente'), a.name)?.trim();
        if (!name) return;
        const projectId = projectOf(a.roomId);
        id = (await cardCall<CardDto>('POST', '/api/cards', { name, ...(projectId ? { projectId } : {}) })).id;
      }
      await cardCall('POST', `/api/cards/${encodeURIComponent(id)}/adopt`, { sessionId: a.driverSession });
      this.loadedFor = '';
      this.say(tr('Adotado.'));
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }
}

/** "Novo agente" na ficha da sala: cria a ficha no projeto da sala e seleciona o agente (dormindo). */
export class NewCardRow {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly msg: HTMLElement;
  private room?: RoomInfo;

  constructor(private readonly ctx: UiContext) {
    this.input = h('input', { class: 'ui-rename__input', type: 'text', attrs: { maxlength: 40, placeholder: tr('Nome do novo agente'), 'aria-label': tr('Novo agente') } });
    stopKeys(this.input);
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.create();
    });
    this.msg = h('p', { class: 'ui-rename__hint', attrs: { role: 'status' } });
    this.el = h('div', { class: 'ui-card' }, h('div', { class: 'ui-project__row' }, this.input, h('button', { class: 'ui-btn', type: 'button', text: tr('Novo agente'), on: { click: () => void this.create() } })), this.msg);
  }

  render(r: RoomInfo, live: boolean): void {
    this.room = r;
    setHidden(this.el, !live || access().agents !== true);
  }

  private async create(): Promise<void> {
    const name = this.input.value.trim();
    if (!name || !this.room) return;
    const projectId = projectOf(this.room.id);
    try {
      const c = await cardCall<CardDto>('POST', '/api/cards', { name, ...(projectId ? { projectId } : {}) });
      this.input.value = '';
      setText(this.msg, '');
      // O agente aparece no próximo snapshot; tenta selecionar logo e de novo um pouco depois.
      const go = () => this.ctx.agent(`card:${c.id}`) && this.ctx.select({ type: 'agent', id: `card:${c.id}` }, { focus: true });
      if (!go()) setTimeout(go, 1500);
    } catch (err) {
      setText(this.msg, err instanceof Error ? err.message : String(err));
    }
  }
}
