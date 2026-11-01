import { tr } from '../../../shared/i18n';
import type { AgentTab } from './agent-panel-model';
import { h, setHidden } from './dom';

let sequence = 0;
const tabs: readonly AgentTab[] = ['work', 'history', 'config'];

/** Hospedeiro estável: trocar aba não recria campos nem perde rascunhos. */
export class AgentTabs {
  readonly el: HTMLElement;
  private current: AgentTab = 'work';
  private readonly buttons: Record<AgentTab, HTMLButtonElement>;
  private readonly panels: Record<AgentTab, HTMLElement>;

  constructor(private readonly changed?: (tab: AgentTab) => void) {
    const id = `ui-agent-tabs-${++sequence}`;
    const labels: Record<AgentTab, string> = { work: tr('Trabalho'), history: tr('Histórico'), config: tr('Configuração') };
    this.buttons = {} as Record<AgentTab, HTMLButtonElement>;
    this.panels = {} as Record<AgentTab, HTMLElement>;
    for (const tab of tabs) {
      this.buttons[tab] = h('button', { class: 'ui-btn ui-agent-tab', type: 'button', role: 'tab', text: labels[tab],
        attrs: { id: `${id}-${tab}-tab`, 'data-agent-tab': tab, 'aria-controls': `${id}-${tab}-panel` },
        on: { click: () => this.setTab(tab) } });
      this.panels[tab] = h('section', { class: `ui-agent-tabpanel ui-agent-tabpanel--${tab}`, role: 'tabpanel',
        attrs: { id: `${id}-${tab}-panel`, 'aria-labelledby': `${id}-${tab}-tab` } });
    }
    const list = h('div', { class: 'ui-agent-tablist', role: 'tablist', attrs: { 'aria-label': tr('Agente') } }, ...tabs.map(t => this.buttons[t]));
    list.addEventListener('keydown', e => {
      const index = tabs.indexOf(this.current);
      const next = e.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : undefined;
      if (!next) return;
      e.preventDefault(); e.stopPropagation();
      this.setTab(next);
      this.buttons[next].focus();
    });
    this.el = h('div', { class: 'ui-agent-tabs' }, list, ...tabs.map(t => this.panels[t]));
    this.sync();
  }

  get tab(): AgentTab { return this.current; }

  setTab(tab: AgentTab): void {
    if (this.current === tab) return;
    this.current = tab;
    this.sync();
    this.changed?.(tab);
  }

  mount(tab: AgentTab, node: HTMLElement): void { this.panels[tab].append(node); }

  private sync(): void {
    for (const tab of tabs) {
      const active = this.current === tab;
      this.buttons[tab].setAttribute('aria-selected', String(active));
      this.buttons[tab].classList.toggle('is-on', active);
      this.buttons[tab].tabIndex = active ? 0 : -1;
      setHidden(this.panels[tab], !active);
      this.panels[tab].inert = !active;
    }
  }
}
