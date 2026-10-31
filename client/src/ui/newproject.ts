// "Novo projeto" na barra lateral: nome do projeto, pasta (opcional) e o nome do primeiro agente. É o caminho para
// criar pela interface sem depender do "+" de agente (que exige pty e não existe no Docker) nem de uma sala que já
// exista: a primeira ficha é quem faz a sala nascer (sala sem ninguém é removida do escritório).
// Fala com /api/projects e /api/cards; a validação do formulário está em newproject-model.ts.
import { tr } from '../../../shared/i18n';
import { cardCall, type CardDto } from './card';
import type { UiContext } from './context';
import { h, setHidden, setText } from './dom';
import { fieldsProblem, projectPlan } from './newproject-model';

function stopKeys(el: HTMLElement): void {
  el.addEventListener('keydown', (e) => e.stopPropagation());
  el.addEventListener('keyup', (e) => e.stopPropagation());
}

function labeled(label: string, input: HTMLInputElement): HTMLElement {
  return h('label', { class: 'ui-card__field' }, h('span', { class: 'ui-small ui-muted', text: label }), input);
}

export class NewProjectRow {
  readonly el: HTMLElement;
  private readonly project: HTMLInputElement;
  private readonly folder: HTMLInputElement;
  private readonly agent: HTMLInputElement;
  private readonly createBtn: HTMLButtonElement;
  private readonly msg: HTMLElement;

  constructor(private readonly ctx: UiContext) {
    const campo = (placeholder: string, maxlength?: number): HTMLInputElement => {
      const i = h('input', { class: 'ui-rename__input', type: 'text', attrs: { placeholder, ...(maxlength ? { maxlength } : {}) } });
      stopKeys(i);
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void this.create();
      });
      return i;
    };
    this.project = campo(tr('Nome do projeto'), 40);
    this.folder = campo('/caminho/da/pasta');
    this.agent = campo(tr('Nome do primeiro agente'), 40);
    this.createBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Criar'), on: { click: () => void this.create() } });
    this.msg = h('p', { class: 'ui-rename__hint', attrs: { role: 'status' } });
    this.el = h(
      'div',
      { class: 'ui-card', hidden: true },
      labeled(tr('Nome do projeto'), this.project),
      labeled(tr('Pasta do projeto (opcional)'), this.folder),
      labeled(tr('Nome do primeiro agente'), this.agent),
      h('div', { class: 'ui-project__row' }, this.createBtn, h('button', { class: 'ui-link-btn', type: 'button', text: tr('Agora não'), on: { click: () => this.close() } })),
      this.msg,
    );
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    setHidden(this.el, false);
    this.project.focus();
  }

  close(): void {
    setHidden(this.el, true);
    setText(this.msg, '');
  }

  private reset(): void {
    this.project.value = '';
    this.folder.value = '';
    this.agent.value = '';
  }

  private async create(): Promise<void> {
    const fields = { project: this.project.value, folder: this.folder.value, agent: this.agent.value };
    const problem = fieldsProblem(fields);
    if (problem) {
      setText(this.msg, problem);
      return;
    }
    const plan = projectPlan(fields);
    setText(this.msg, tr('Criando…'));
    this.createBtn.disabled = true;
    try {
      const p = await cardCall<{ id: string; name: string }>('POST', '/api/projects', plan.project);
      try {
        const c = await cardCall<CardDto>('POST', '/api/cards', { ...plan.card, projectId: p.id });
        this.reset();
        setText(this.msg, tr('Projeto {0} criado com o agente {1}.', [p.name, c.name]));
        // O agente aparece no próximo snapshot; tenta selecionar logo e de novo um pouco depois.
        const go = () => this.ctx.agent(`card:${c.id}`) && this.ctx.select({ type: 'agent', id: `card:${c.id}` }, { focus: true });
        if (!go()) setTimeout(go, 1500);
      } catch (err) {
        // O projeto existe a partir daqui: dizer só "não deu" faria parecer que nada aconteceu.
        setText(this.msg, tr('Projeto {0} foi criado, mas o agente não: {1}', [p.name, err instanceof Error ? err.message : String(err)]));
      }
    } catch (err) {
      setText(this.msg, tr('Não deu para criar o projeto: {0}', [err instanceof Error ? err.message : String(err)]));
    } finally {
      this.createBtn.disabled = false;
    }
  }
}
