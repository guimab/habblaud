// Gaveta de detalhes (direita): agente ou sala selecionados. Agente do Codex: selo "Codex", textos dele (onde
// responder, o terminal, a aprovação no lugar do modo de permissão, sem custo) e a dica dos hooks do Codex.
import type { Activity, AgentInfo, FeedItem, RoomInfo, ShellJob, TaskItem } from '../../../shared/types';
import { roomTheme } from '../art';
import { createAvatarPlaceholder, updateAvatar } from './avatar';
import { CharacterEditor } from './character-editor';
import { MessageComposer } from './composer';
import type { UiComponent, UiContext } from './context';
import { copyText, h, iconButton, KeyedList, setAttr, setHidden, setStyleVar, setText, setTitle, setVariant } from './dom';
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatElapsed,
  formatInt,
  formatTokens,
  formatUSD,
  permissionLabel,
  plural,
  prettyModel,
  relativeTime,
  shortPath,
} from './format';
import { ICONS } from './icons';
import {
  accountsOf,
  activityFallback,
  aggregateTasks,
  mergeHistory,
  roleLabel,
  shellBoxText,
  shellDoneKind,
  shellKindLabel,
  shellStage,
  shellWaitIn,
  sortByUrgency,
  statusLabel,
  taskProgress,
  visibleShells,
} from './model';
import { access } from '../net/access';
import { PermissionCard } from './permission';
import { canRenameRoom } from './roomrename';
import { ProjectSection } from './project';
import { CardSection, NewCardRow } from './card';
import { AgentTabs } from './agent-tabs';
import { ConsultPanel } from './consult';
import { panelRun, linkedRunAgent } from './agent-panel-routing-model';
import { openAgentPanel, type AgentPanelState } from './agent-panel-model';
import { runPrompt, runReply, runsOfAgent, runStateLabel, type RunView } from './runs-model';
import { pathsLabel } from './project-model';
import { accountChipLabel, accountProvider, CODEX_LIVE_HINT, codexApprovalLabel, providerOf } from './provider';
import { ptyControllable } from './ptyapi';
import { createAgentRow, updateAgentRow } from './rows';
import { SocialSection } from './social';
import { TERMINAL_UNAVAILABLE_HINT, type TerminalControl } from './terminal';
import { AGENT_PANEL_DEFAULT_WIDTH, AGENT_PANEL_MAX_WIDTH, clampPanelWidth } from './agent-panel-model';
import { INSET_GAP } from './viewport';
import type { PtyControl } from './pty';
import { richText } from './usage';
import {
  createAccountChip,
  createProgress,
  createProviderTag,
  createStatusDot,
  updateAccountChip,
  updateProgress,
  updateProviderTag,
  updateStatusDot,
} from './widgets';
import { tr } from '../../../shared/i18n';

/** Itens da linha do tempo mostrados de início; "Mostrar mais" acrescenta outro tanto. */
const TIMELINE_STEP = 15;
const ROOM_FEED_LIMIT = 15;

// ---------------------------------------------------------------- peças

function section(title: string, ...children: (Node | null)[]): { el: HTMLElement; title: HTMLElement; extra: HTMLElement } {
  const t = h('h3', { class: 'ui-sec__title', text: title });
  const extra = h('span', { class: 'ui-sec__extra' });
  const el = h('section', { class: 'ui-sec' }, h('div', { class: 'ui-sec__head' }, t, extra), ...children.filter((c): c is Node => !!c));
  return { el, title: t, extra };
}

function copyButton(getText: () => string, label: string): HTMLButtonElement {
  const b = iconButton(ICONS.copy, label, async () => {
    const ok = await copyText(getText());
    b.classList.toggle('is-done', ok);
    b.innerHTML = ok ? ICONS.check : ICONS.copy;
    setTitle(b, ok ? tr('Copiado!') : tr('Não foi possível copiar'));
    setTimeout(() => {
      b.classList.remove('is-done');
      b.innerHTML = ICONS.copy;
      setTitle(b, label);
    }, 1400);
  }, 'ui-icon-btn--sm');
  return b;
}

const TASK_MARK: Record<TaskItem['status'], string> = { completed: '✓', in_progress: '◐', pending: '○' };
const TASK_STATE: Record<TaskItem['status'], string> = { completed: tr('concluída'), in_progress: tr('em andamento'), pending: 'pendente' };

function createTaskItem(): HTMLElement {
  return h('li', { class: 'ui-task' }, h('span', { class: 'ui-task__mark', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'ui-task__text' }), h('span', { class: 'ui-task__owner' }));
}

function updateTaskItem(li: HTMLElement, t: TaskItem, owner?: string): void {
  const [mark, text, ownerEl] = li.children as unknown as HTMLElement[];
  setText(mark, TASK_MARK[t.status]);
  setText(text, t.status === 'in_progress' && t.activeForm ? t.activeForm : t.title);
  setText(ownerEl, owner ?? '');
  setHidden(ownerEl, !owner);
  setVariant(li, 'is-', t.status);
  setAttr(li, 'aria-label', `${t.title}: ${TASK_STATE[t.status]}`);
}

/**
 * Item da lista de conversas do agente: estado, quando, o pedido e a resposta (ver ui/runs-model.ts).
 * A hora é absoluta de propósito: a lista só é redesenhada quando os turnos mudam.
 */
function createRunItem(r: RunView): HTMLElement {
  const ask = runPrompt(r);
  const reply = runReply(r);
  const item = h(
    'li',
    { class: `ui-run ui-run--${r.state}` },
    h(
      'div',
      { class: 'ui-run__meta' },
      h('span', { class: 'ui-run__state', text: runStateLabel(r.state) }),
      h('time', { class: 'ui-run__when', text: formatClock(r.at), attrs: { datetime: new Date(r.at).toISOString() } }),
    ),
    h('p', { class: ask ? 'ui-run__ask' : 'ui-run__ask ui-muted', text: ask || tr('Registro antigo: o pedido não foi gravado.') }),
    reply ? h('p', { class: 'ui-run__reply', text: reply }) : null,
  );
  setTitle(item, `${formatDateTime(r.at)} · ${runStateLabel(r.state)}${ask ? `\n${ask}` : ''}`);
  return item;
}

function createTimelineItem(): HTMLElement {
  return h(
    'li',
    { class: 'ui-tl' },
    h('span', { class: 'ui-tl__icon', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'ui-tl__text' }),
    h('time', { class: 'ui-tl__time' }),
  );
}

function updateTimelineItem(li: HTMLElement, a: Activity, now: number, who?: string): void {
  const [icon, text, time] = li.children as unknown as HTMLElement[];
  setText(icon, a.icon);
  setText(text, who ? `${who}: ${a.text}` : a.text);
  setText(time, relativeTime(a.at, now));
  setAttr(time, 'datetime', new Date(a.at).toISOString());
  setTitle(li, `${formatClock(a.at)} · ${a.text}${a.detail ? `\n${a.detail}` : ''}`);
  li.classList.toggle('is-error', !!a.error);
  const done = shellDoneKind(a);
  li.classList.toggle('is-shell-ok', done === 'ok');
  li.classList.toggle('is-shell-fail', done === 'fail');
}

// ---------------------------------------------------------------- shells rodando

interface ShellRefs {
  icon: HTMLElement;
  label: HTMLElement;
  time: HTMLElement;
  badge: HTMLElement;
  since: HTMLElement;
  details: HTMLDetailsElement;
  command: HTMLElement;
}

const shellRefs = new WeakMap<HTMLElement, ShellRefs>();

const SHELL_KIND_VARIANT = (j: ShellJob): string => (j.kind === 'monitor' ? 'monitor' : j.background ? 'bg' : 'fg');

function createShellItem(): HTMLElement {
  const icon = h('span', { class: 'ui-shell__icon', attrs: { 'aria-hidden': 'true' } });
  const label = h('span', { class: 'ui-shell__label' });
  const time = h('time', { class: 'ui-shell__time' });
  const badge = h('span', { class: 'ui-shell__badge' });
  const since = h('span', { class: 'ui-shell__since' });
  const command = h('pre', { class: 'ui-mono' });
  const details = h(
    'details',
    { class: 'ui-shell__cmd' },
    h('summary', { text: tr('Comando') }),
    h('div', { class: 'ui-shell__cmd-body' }, command, copyButton(() => command.textContent ?? '', tr('Copiar comando'))),
  );
  const li = h('li', { class: 'ui-shell' }, h('div', { class: 'ui-shell__head' }, icon, label, time), h('div', { class: 'ui-shell__meta' }, badge, since), details);
  shellRefs.set(li, { icon, label, time, badge, since, details, command });
  return li;
}

function updateShellItem(li: HTMLElement, j: ShellJob, now: number): void {
  const r = shellRefs.get(li)!;
  setText(r.icon, j.kind === 'monitor' ? '📡' : '💻');
  setText(r.label, j.label);
  setTitle(r.label, j.label);
  const elapsed = Math.max(0, now - j.startedAt);
  setText(r.time, formatElapsed(elapsed));
  setAttr(r.time, 'datetime', new Date(j.startedAt).toISOString());
  setTitle(r.time, tr('Rodando há {0} (desde {1})', [formatDuration(elapsed), formatClock(j.startedAt)]));
  setText(r.badge, shellKindLabel(j));
  setVariant(r.badge, 'ui-shell__badge--', SHELL_KIND_VARIANT(j));
  setText(r.since, tr('desde {0}', [formatClock(j.startedAt, false)]));
  setTitle(r.since, tr('Iniciado em {0} · id {1}', [formatDateTime(j.startedAt), j.id]));
  setHidden(r.details, !j.command);
  setText(r.command, j.command ?? '');
  setAttr(li, 'aria-label', tr('{0}, {1}, rodando há {2}', [j.label, shellKindLabel(j), formatDuration(elapsed)]));
}


// ---------------------------------------------------------------- visão do agente

/** Copied primitives: snapshots may mutate AgentInfo in place without changing its id. */
type AgentTargetIdentity = Readonly<{ agentId: string; sessionId?: string; cardId?: string }>;

function agentTargetIdentity(id: string, a?: AgentInfo): AgentTargetIdentity {
  return { agentId: id, sessionId: a?.driverSession ?? a?.sessionId, cardId: a?.cardId };
}

function sameAgentTarget(a: AgentTargetIdentity | undefined, b: AgentTargetIdentity): boolean {
  return !!a && a.agentId === b.agentId && a.sessionId === b.sessionId && a.cardId === b.cardId;
}

class AgentView {
  readonly el: HTMLElement;
  private id = '';
  private targetIdentity?: AgentTargetIdentity;
  private last: AgentInfo | null = null;
  private active = false;
  private panelState: AgentPanelState = { target: null, tab: 'work', detailsOpen: false };
  private readonly tabs = new AgentTabs(tab => {
    this.panelState = { ...this.panelState, tab };
    if (tab === 'work' && this.ctx.selection()?.id === this.id && (this.ctx.agent(this.id)?.cardId || this.panelState.target?.kind === 'run')) this.conversation?.show();
    else this.conversation?.hide();
  });
  private readonly conversation: ConsultPanel;
  private readonly work: HTMLElement;
  private readonly liveWork: HTMLElement;
  private readonly liveHeader: HTMLElement;
  private history: Activity[] = [];
  private historyReq = 0;
  /** Sobe ao trocar ao vivo ↔ replay ou ao retroceder: a resposta da geração anterior não entra. */
  private historyGen = 0;
  /** Fonte e instante da última linha do tempo (para perceber troca e retrocesso). */
  private historyReplay = false;
  private historyAt = 0;
  private historyBound = false;

  private avatar: HTMLElement;
  private name: HTMLElement;
  private role: HTMLElement;
  private title: HTMLElement;
  private accChip: HTMLElement;
  private accName: HTMLElement;
  private accProv: HTMLElement;
  private accEmail: HTMLElement;
  /** Dica dos hooks do Codex (ao vivo e aprovar pelo escritório), na gaveta de um agente do Codex. */
  private codexHint: HTMLElement;
  private roomBtn: HTMLButtonElement;
  private roomName: HTMLElement;
  private gone: HTMLElement;
  private dot: HTMLElement;
  private statusText: HTMLElement;
  private statusSince: HTMLElement;
  private followBtn: HTMLButtonElement;
  private termBtn: HTMLButtonElement;
  private readonly cardSec: CardSection;
  private termLabel: HTMLElement;
  /** Por que o terminal não abre: no celular não há hover para ler o title, então o toque mostra o motivo aqui. */
  private termWhy: HTMLElement;
  private termWhyTimer: ReturnType<typeof setTimeout> | null = null;
  private alert: HTMLElement;
  private alertText: HTMLElement;
  /**
   * Perguntas e opções do AskUserQuestion pendente, só para leitura: com o pedido no escritório (hook de
   * permissão), quem aparece é o cartão de resposta, no lugar do alerta.
   */
  private alertQuestions: HTMLElement;
  private alertQuestionsKey = '';
  /** Dica de como responder as perguntas por aqui (o plugin de permissões). */
  private alertAnswerHint: HTMLElement;
  /** Pedido de permissão (ou pergunta) para responder por aqui (substitui o alerta genérico enquanto existe). */
  private perm: PermissionCard;
  private shellBox: HTMLElement;
  private shellText: HTMLElement;
  private shellMood: HTMLElement;
  private shellNext: HTMLElement;
  private shellsSec: ReturnType<typeof section>;
  private shells: KeyedList<ShellJob>;
  private actIcon: HTMLElement;
  private actText: HTMLElement;
  private actTime: HTMLElement;
  private actDetails: HTMLDetailsElement;
  private actDetail: HTMLElement;
  /** Mandar mensagem ao agente principal pelo Habblaud (plugin habblaud-mensagens). */
  private composer: MessageComposer;
  private msgSec: ReturnType<typeof section>;
  private tasksSec: ReturnType<typeof section>;
  private tasksBar: HTMLElement;
  private tasks: KeyedList<TaskItem>;
  private teamSec: ReturnType<typeof section>;
  private team: KeyedList<AgentInfo>;
  private teamEmpty: HTMLElement;
  private timeline: KeyedList<Activity>;
  private timelineSec: ReturnType<typeof section>;
  private timelineMore: HTMLButtonElement;
  private timelineLess: HTMLButtonElement;
  /** Conversas do agente: os turnos que ele rodou, do mais recente ao mais antigo (GET /api/runs). */
  private runsList: HTMLElement;
  private runsEmpty: HTMLElement;
  private runsSec: ReturnType<typeof section>;
  private runs: RunView[] = [];
  /** Normalized /api/runs list as fetched; `runs` is re-derived from it against each snapshot. */
  private rawRuns: RunView[] = [];
  /** Chave do que está desenhado na lista de conversas (evita redesenhar a cada quadro). */
  private runsKey = '';
  private runsReq = 0;
  private runsController?: AbortController;
  /** Quantos itens da linha do tempo aparecem agora. */
  private timelineShown = TIMELINE_STEP;
  private stats: KvList<StatKey>;
  private social: SocialSection;
  readonly character: CharacterEditor;
  private sessionValue: HTMLElement;
  private linesPlus: HTMLElement;
  private linesMinus: HTMLElement;
  private termRo: HTMLElement;

  constructor(
    private ctx: UiContext,
    private terminal: TerminalControl,
    private pty: PtyControl,
    private readonly onTargetChange: () => void,
  ) {
    const record = h('p', { class: 'ui-agent-work__run' });
    this.conversation = new ConsultPanel(ctx, { embedded: true, readRun: true, onClose: () => ctx.select(null), onRun: run => {
      setAttr(this.work, 'data-run-id', run?.runId);
      const live = !run && this.panelState.target?.kind !== 'run';
      setHidden(this.liveWork, !live);
      setHidden(this.liveHeader, !live);
      setText(record, run ? `${runStateLabel(run.state)} · ${run.prompt ?? tr('Registro antigo: o pedido não foi gravado.')}` : '');
    } });
    this.work = h('div', { class: 'ui-agent-work' }, record, this.conversation.el);
    this.avatar = createAvatarPlaceholder('lg');
    this.name = h('h2', { class: 'ui-hero__name' });
    this.role = h('span', { class: 'ui-role' });
    this.title = h('p', { class: 'ui-hero__title' });
    this.accChip = createAccountChip('md');
    this.accName = h('span', { class: 'ui-hero__acc-name' });
    this.accProv = createProviderTag('ui-prov--xs');
    this.accEmail = h('span', { class: 'ui-hero__acc-email' });
    this.roomName = h('span');
    this.roomBtn = h('button', { class: 'ui-room-link', type: 'button', on: { click: () => this.last && ctx.select({ type: 'room', id: this.last.roomId }, { focus: true }) } }, this.roomName);
    this.character = new CharacterEditor(ctx);
    const heroText = h(
      'div',
      { class: 'ui-hero__text' },
      h('div', { class: 'ui-hero__line' }, this.name, this.role),
      h('div', { class: 'ui-hero__acc' }, this.accChip, this.accName, this.accProv, this.accEmail),
      h('div', { class: 'ui-hero__where' }, h('span', { class: 'ui-muted', text: tr('Sala') }), this.roomBtn),
    );
    this.gone = h('p', { class: 'ui-gone', text: tr('Este agente já saiu do escritório.'), hidden: true });

    this.dot = createStatusDot();
    this.statusText = h('span', { class: 'ui-status__text' });
    this.statusSince = h('span', { class: 'ui-status__since' });
    this.followBtn = h('button', { class: 'ui-btn', type: 'button', attrs: { 'aria-pressed': 'false' }, title: tr('Câmera acompanha o agente (F)'), on: { click: () => this.toggleFollow() } });
    this.followBtn.innerHTML = ICONS.follow;
    this.followBtn.append(h('span', { text: tr('Seguir') }));
    const centerBtn = h('button', { class: 'ui-btn', type: 'button', title: tr('Levar a câmera até o agente'), on: { click: () => ctx.focusSelection() } });
    centerBtn.innerHTML = ICONS.center;
    centerBtn.append(h('span', { text: tr('Centralizar') }));
    const statusRow = h(
      'div',
      { class: 'ui-status' },
      h('span', { class: 'ui-status__label' }, this.dot, this.statusText, this.statusSince),
      h('span', { class: 'ui-status__actions' }, this.followBtn, centerBtn),
    );

    // Terminal: a conversa da sessão como o Claude Code mostra, ao vivo (só com acesso local).
    this.cardSec = new CardSection(ctx);
    this.termLabel = h('span', { class: 'ui-term-cta__label', text: tr('Abrir terminal') });
    const termIcon = h('span', { class: 'ui-term-cta__icon', attrs: { 'aria-hidden': 'true' } });
    termIcon.innerHTML = ICONS.terminal;
    this.termBtn = h(
      'button',
      { class: 'ui-btn ui-term-cta', type: 'button', attrs: { 'aria-pressed': 'false' }, on: { click: () => this.toggleTerminal() } },
      termIcon,
      this.termLabel,
      (this.termRo = h('span', { class: 'ui-term-cta__ro', text: tr('ao vivo') })),
      h('kbd', { class: 'ui-kbd', text: 'T', attrs: { 'aria-hidden': 'true' } }),
    );

    this.termWhy = h('p', { class: 'ui-term-cta__why', hidden: true, attrs: { role: 'status' } });

    this.alertText = h('p', { class: 'ui-alert__text' });
    this.alertQuestions = h('div', { class: 'ui-ask', hidden: true });
    this.alertAnswerHint = h('p', { class: 'ui-ask__answer-hint', hidden: true, text: tr('Com o plugin habblaud-permissoes (npm run mod:install), dá para responder as perguntas por aqui.') });
    const alertIcon = h('span', { class: 'ui-alert__icon', attrs: { 'aria-hidden': 'true' } });
    alertIcon.innerHTML = ICONS.hand;
    this.alert = h(
      'div',
      { class: 'ui-alert', role: 'alert', hidden: true },
      alertIcon,
      h('div', {}, h('strong', { class: 'ui-alert__title', text: tr('Precisa de você') }), this.alertText, this.alertQuestions, this.alertAnswerHint),
    );

    // Esperando o shell: caixa de status (com a fase da espera no escritório) e a lista de comandos rodando.
    this.shellText = h('p', { class: 'ui-alert__text' });
    this.shellMood = h('span', { class: 'ui-shell-mood__text' });
    this.shellNext = h('span', { class: 'ui-shell-mood__next' });
    const shellIcon = h('span', { class: 'ui-alert__icon ui-hourglass', attrs: { 'aria-hidden': 'true' } });
    shellIcon.innerHTML = ICONS.hourglass;
    this.shellBox = h(
      'div',
      { class: 'ui-alert ui-alert--shell', hidden: true },
      shellIcon,
      h('div', {}, h('strong', { class: 'ui-alert__title', text: tr('Esperando o shell') }), this.shellText, h('p', { class: 'ui-shell-mood' }, this.shellMood, this.shellNext)),
    );
    const shellList = h('ul', { class: 'ui-shells' });
    this.shellsSec = section(tr('Shells rodando'), shellList);
    this.shells = new KeyedList<ShellJob>(shellList, { key: (j) => j.id, create: createShellItem, update: (li, j) => updateShellItem(li, j, ctx.now()) });

    this.actIcon = h('span', { class: 'ui-now__icon', attrs: { 'aria-hidden': 'true' } });
    this.actText = h('span', { class: 'ui-now__text' });
    this.actTime = h('span', { class: 'ui-now__time' });
    this.actDetail = h('pre', { class: 'ui-mono' });
    this.actDetails = h('details', { class: 'ui-now__details' }, h('summary', { text: tr('Detalhes') }), this.actDetail);
    const nowSec = section(tr('Agora'), h('div', { class: 'ui-now' }, this.actIcon, h('div', { class: 'ui-now__body' }, this.actText, this.actTime)), this.actDetails);
    this.composer = new MessageComposer(ctx, 'drawer');
    this.msgSec = section(tr('Mandar mensagem'), this.composer.el);
    // No celular a caixa fica presa no rodapé da gaveta enquanto a conversa rola (styles.css, .ui-sec--msg).
    this.msgSec.el.classList.add('ui-sec--msg');
    this.social = new SocialSection(ctx);
    this.perm = new PermissionCard(ctx);

    this.tasksBar = createProgress(tr('Progresso das tarefas'));
    const tasksList = h('ul', { class: 'ui-tasks' });
    this.tasksSec = section(tr('Tarefas'), this.tasksBar, tasksList);
    this.tasks = new KeyedList<TaskItem>(tasksList, { key: (t) => t.id, create: createTaskItem, update: (li, t) => updateTaskItem(li, t) });

    const teamList = h('div', { class: 'ui-team' });
    this.teamEmpty = h('p', { class: 'ui-muted ui-small', text: tr('Nenhum subagente no momento.') });
    this.teamSec = section(tr('Subagentes'), teamList, this.teamEmpty);
    this.team = new KeyedList<AgentInfo>(teamList, {
      key: (a) => a.id,
      create: (a) => createAgentRow(a, (id) => ctx.select({ type: 'agent', id }, { focus: true }), 'sm'),
      update: (row, a) => updateAgentRow(row, a, ctx.account(a.account), false, ctx.now(), ctx.store.snapshot?.agents),
    });

    const tl = h('ol', { class: 'ui-timeline' });
    this.timelineMore = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', on: { click: () => this.showTimeline(this.timelineShown + TIMELINE_STEP) } });
    this.timelineLess = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Mostrar menos'), on: { click: () => this.showTimeline(TIMELINE_STEP) } });
    this.timelineSec = section(tr('Linha do tempo'), tl, h('div', { class: 'ui-timeline__more' }, this.timelineMore, this.timelineLess));
    this.runsList = h('ul', { class: 'ui-runs' });
    this.runsEmpty = h('p', { class: 'ui-muted ui-small', text: tr('Nenhuma conversa registrada ainda.') });
    this.runsSec = section(tr('Conversas'), this.runsList, this.runsEmpty);
    this.timeline = new KeyedList<Activity>(tl, { key: (a) => a.id, create: createTimelineItem, update: (li, a) => updateTimelineItem(li, a, ctx.now()) });

    this.sessionValue = h('span', { class: 'ui-mono-inline' });
    this.linesPlus = h('span', { class: 'ui-plus' });
    this.linesMinus = h('span', { class: 'ui-minus' });
    this.stats = new KvList<StatKey>([
      ['tools', tr('Chamadas de ferramenta')],
      ['tokensIn', tr('Tokens de entrada')],
      ['tokensOut', tr('Tokens de saída')],
      ['cost', tr('Custo estimado')],
      ['lines', tr('Linhas'), h('span', { class: 'ui-lines' }, this.linesPlus, this.linesMinus)],
      ['subs', tr('Subagentes disparados')],
      ['model', tr('Modelo')],
      ['branch', 'Branch'],
      ['perm', tr('Permissões')],
      ['session', tr('Sessão'), h('span', { class: 'ui-copy-row' }, this.sessionValue, copyButton(() => this.last?.sessionId ?? '', tr('Copiar id da sessão')))],
      ['start', tr('Início')],
      ['duration', tr('Duração')],
      ['bg', tr('Execução')],
    ]);
    const statsSec = section(tr('Estatísticas'), this.stats.el);
    this.codexHint = h('p', { class: 'ui-codex-hint', hidden: true }, ...richText(CODEX_LIVE_HINT));
    this.liveHeader = h('div', { class: 'ui-agent-live-header' }, this.title, this.gone, statusRow);
    this.liveWork = h('div', { class: 'ui-agent-live-work' }, this.termBtn, this.termWhy, this.alert, this.perm.el, this.shellBox,
      this.shellsSec.el, nowSec.el, this.msgSec.el, this.tasksSec.el, this.teamSec.el, this.codexHint);

    this.el = h(
      'div',
      { class: 'ui-drawer__view ui-agent-view' },
      h('div', { class: 'ui-hero' }, this.avatar, heroText),
      this.liveHeader,
      this.tabs.el,
    );
    this.tabs.mount('work', h('div', {}, this.work, this.liveWork));
    this.tabs.mount('history', h('div', {}, this.runsSec.el, this.timelineSec.el, statsSec.el));
    this.tabs.mount('config', h('div', {}, this.character.button, this.character.el, this.cardSec.el, this.social.el));
  }

  get agentId(): string {
    return this.id;
  }

  open(id: string): void {
    this.bindTarget(id, this.ctx.agent(id));
  }

  /** One lifecycle for selection, reopening and in-place snapshot changes. */
  private bindTarget(id: string, a?: AgentInfo): void {
    // A session leaving the snapshot keeps its last readonly record, not a new empty target.
    const target = !a && this.id === id && this.targetIdentity ? this.targetIdentity : agentTargetIdentity(id, a);
    const unchanged = sameAgentTarget(this.targetIdentity, target);
    if (unchanged && this.active) return;
    this.cardSec.render(undefined);
    this.active = true;
    if (!unchanged) {
      this.onTargetChange();
      this.targetIdentity = target;
      this.panelState = openAgentPanel(id);
      // Clear even when the new session retains the same card: drafts belong to session + card.
      this.conversation.clearTarget();
    }
    this.tabs.setTab(this.panelState.tab);
    this.character.open(id);
    this.id = id;
    this.last = null;
    this.history = [];
    this.timelineShown = TIMELINE_STEP;
    this.timeline.clear();
    this.tasks.clear();
    this.team.clear();
    this.shells.clear();
    this.actDetails.open = false;
    this.runs = [];
    this.rawRuns = [];
    this.runsKey = '';
    this.loadHistory();
    this.loadRuns();
    if (unchanged && this.panelState.target?.kind === 'run') {
      if (this.panelState.tab === 'work') this.conversation.show();
    } else if (a?.cardId) this.chatCard({ id: a.cardId, name: a.name, refresh: unchanged });
    else this.conversation.clearTarget();
  }

  chatCard(card: { id: string; name: string; fresh?: boolean; refresh?: boolean }): void {
    this.tabs.setTab('work');
    this.conversation.openCard(card);
    this.conversation.show();
  }

  openRun(run: RunView): void {
    this.panelState = { target: { kind: 'run', runId: run.runId, agentId: this.id || undefined }, tab: 'work', detailsOpen: false };
    this.tabs.setTab('work');
    this.conversation.openRun(run.runId, run.owner);
    this.conversation.show();
  }

  close(): void {
    this.active = false;
    this.cardSec.render(undefined);
    this.runsReq++;
    this.runsController?.abort();
    this.conversation.hide();
  }

  /** Turnos deste agente (GET /api/runs), com o pedido ao lado da resposta. */
  private loadRuns(): void {
    const id = this.id;
    if (!id) return;
    const req = ++this.runsReq;
    this.runsController?.abort();
    const controller = this.runsController = new AbortController();
    this.ctx.store
      .runs(controller.signal)
      .then((all) => {
        if (req !== this.runsReq || controller.signal.aborted || this.id !== id) return;
        const a = this.ctx.agent(id);
        if (!a) return;
        this.rawRuns = all.map(panelRun).filter((r): r is RunView => !!r);
        this.runs = runsOfAgent(this.rawRuns, a, this.ctx.store.snapshot?.agents ?? []);
        this.ctx.invalidate();
      })
      .catch(() => {
        /* sem as conversas: a seção fica vazia, o resto da gaveta continua */
      });
  }

  /** Histórico longo do agente (o pedido mais recente vale; ver historyGen). */
  private loadHistory(): void {
    const id = this.id;
    if (!id) return;
    const req = ++this.historyReq;
    const gen = this.historyGen;
    this.ctx.store
      .agentHistory(id)
      .then((hist) => {
        // Outro agente (req) ou troca de fonte/retrocesso no meio do caminho (gen): a resposta não vale mais.
        if (req !== this.historyReq || gen !== this.historyGen) return;
        this.history = mergeHistory(hist, this.history, 200, this.ctx.store.replaying ? this.ctx.store.snapshot?.serverTime : undefined);
        this.ctx.invalidate();
      })
      .catch(() => {
        // Sem histórico longo: a linha do tempo usa as atividades recentes do snapshot.
      });
  }

  /**
   * No replay, a linha do tempo para no instante reproduzido. Trocar a fonte ou retroceder invalida
   * o pedido em curso; na troca, recomeça pelo snapshot (e, de volta ao vivo, busca o histórico de novo).
   */
  private historyUntil(): number | undefined {
    const replaying = this.ctx.store.replaying;
    const at = this.ctx.store.snapshot?.serverTime ?? 0;
    if (this.historyBound) {
      const sourceChanged = replaying !== this.historyReplay;
      const rewound = replaying && at < this.historyAt;
      if (sourceChanged || rewound) {
        this.historyGen++;
        if (sourceChanged) {
          this.history = [];
          if (!replaying) this.loadHistory();
        }
      }
    }
    this.historyBound = true;
    this.historyReplay = replaying;
    this.historyAt = at;
    return replaying ? at : undefined;
  }

  /** Abre (ou fecha) o terminal deste agente; desligado sem acesso local ou depois que ele saiu. */
  toggleTerminal(): void {
    if (!this.id) return;
    if (this.termBtn.getAttribute('aria-disabled') === 'true') {
      // No celular não há hover para ler a dica: o toque mostra o motivo embaixo do botão.
      const why = this.termBtn.title;
      setText(this.termWhy, why);
      setHidden(this.termWhy, false);
      this.ctx.announce(why);
      if (this.termWhyTimer) clearTimeout(this.termWhyTimer);
      this.termWhyTimer = setTimeout(() => setHidden(this.termWhy, true), 8_000);
      return;
    }
    setHidden(this.termWhy, true);
    if (this.ctx.terminals) this.ctx.terminals.toggle(this.id, this.termBtn);
    else this.terminal.toggle(this.id, this.termBtn);
  }

  private showTimeline(n: number): void {
    this.timelineShown = Math.max(TIMELINE_STEP, n);
    this.ctx.invalidate();
  }

  toggleFollow(): void {
    const follow = !this.ctx.world.getOptions().followSelected;
    this.ctx.world.setOptions({ followSelected: follow });
    // Foca de novo com a opção nova: ligar começa a seguir; desligar mantém o agente no centro, parado.
    if (this.id) this.ctx.focusSelection();
    this.ctx.invalidate();
  }

  render(): void {
    const live = this.ctx.agent(this.id);
    if (this.active && live) this.bindTarget(this.id, live);
    if (live) this.last = live;
    const a = this.last;
    if (!a) return;
    const now = this.ctx.now();
    const account = this.ctx.account(a.account);
    const room = this.ctx.store.room(a.roomId);
    const provider = providerOf(a);
    const codex = provider === 'codex';

    updateAvatar(this.avatar, a, 'lg');
    setStyleVar(this.avatar, '--acc', account?.color ?? '#8b98b3');
    setText(this.name, a.name);
    this.character.render(a, !!live);
    setText(this.role, roleLabel(a));
    setVariant(this.role, 'ui-role--', a.kind);
    setText(this.title, a.title ?? '');
    setHidden(this.title, !a.title);
    setTitle(this.title, a.title ?? '');
    updateAccountChip(this.accChip, account, a.account, a.provider);
    setText(this.accName, account?.name ?? a.account);
    updateProviderTag(this.accProv, provider, account?.name ?? '');
    // E-mail (Claude Code) ou, no Codex (sem e-mail), o plano.
    const accSub = account?.email ?? (codex && account?.plan ? tr('plano {0}', [account.plan]) : '');
    setText(this.accEmail, accSub);
    setHidden(this.accEmail, !accSub);
    setText(this.roomName, room?.name ?? a.roomId);
    setTitle(this.roomBtn, room ? tr('{0}\nClique para ver a sala', [room.path]) : '');
    setHidden(this.gone, !!live);
    this.el.classList.toggle('is-gone', !live);

    // Status (quem está parado num comando longo aparece como "Esperando o shell", como no escritório).
    const wait = live ? shellWaitIn(a, this.ctx.store.snapshot?.agents ?? [], now) : null;
    const status = wait ? 'shell' : a.status;
    updateStatusDot(this.dot, status);
    setText(this.statusText, statusLabel(status));
    // Parado num comando longo: o "desde" é o início do comando (o status do servidor continua 'working').
    const since = wait?.foreground ? wait.since : a.statusSince;
    setText(this.statusSince, relativeTime(since, now));
    setTitle(this.statusSince, tr('Desde {0}', [formatClock(since)]));
    const following = this.ctx.world.getOptions().followSelected;
    setAttr(this.followBtn, 'aria-pressed', String(following));
    this.followBtn.classList.toggle('is-on', following);
    this.renderTerminalButton(!!live);

    // Alerta.
    const waiting = a.status === 'waiting' && !!live;
    this.perm.render(live);
    setHidden(this.alert, !waiting || this.perm.visible);
    if (waiting) {
      const accName = account?.name ?? a.account;
      // Codex: "Vá ao Codex (Conta X)"; sem repetir quando a conta já se chama "Codex".
      const where = codex ? tr('ao Codex{0}', [/codex/i.test(accName) ? '' : ` (${accName})`]) : tr('ao terminal da {0}', [accName]);
      setText(this.alertText, tr('Vá {0} em {1} para responder{2}', [where, room?.name ?? tr('seu projeto'), a.waitingFor ? `: ${a.waitingFor}` : '.']));
    }
    // Perguntas do AskUserQuestion (só leitura): o Codex não pergunta pelo escritório.
    const asking = waiting && !codex && a.activity?.kind === 'ask' ? a.activity : undefined;
    this.renderQuestions(asking);
    // Sem o pedido no escritório: dá para responder por aqui com o plugin (só com a trava local, como o cartão). O Codex
    // não responde perguntas pelo escritório.
    const answerable =
      !codex && !!asking?.questions?.length && !this.perm.visible && !this.ctx.store.mock && !!this.ctx.store.snapshot?.meta.terminal && access().permissions;
    setHidden(this.alertAnswerHint, !answerable);

    // Esperando o shell.
    setHidden(this.shellBox, !wait);
    if (wait) {
      setText(this.shellText, shellBoxText(wait));
      const stage = shellStage(now - wait.since);
      setText(this.shellMood, `${stage.emoji} ${stage.text}`);
      setText(this.shellNext, stage.nextIn !== null ? tr('Próxima fase em {0}', [formatDuration(Math.max(1_000, stage.nextIn))]) : '');
      setHidden(this.shellNext, stage.nextIn === null);
      setTitle(this.shellNext, tr('Quanto falta para o personagem mudar o que faz enquanto espera (veja a Ajuda)'));
    }
    // Sem shells próprios, mostra os que ele espera de um subagente.
    const own = live ? visibleShells(a, now) : [];
    const jobs = own.length || !wait ? own : wait.jobs;
    setHidden(this.shellsSec.el, jobs.length === 0);
    setText(this.shellsSec.extra, jobs.length > 1 ? String(jobs.length) : '');
    this.shells.sync(jobs);

    // Atividade atual.
    const act = a.activity;
    setText(this.actIcon, act?.icon ?? '·');
    setText(this.actText, act?.text ?? activityFallback(a));
    // A duração só entra quando o texto ainda não a traz ("Concluiu em 33s" já diz quanto levou).
    const showDuration = !!act?.durationMs && act.kind !== 'done' && !/\d\s?(?:ms|s|min|h)\b/.test(act.text);
    setText(this.actTime, act ? `${relativeTime(act.at, now)}${showDuration ? ` · levou ${formatDuration(act.durationMs!)}` : ''}` : '');
    this.actText.classList.toggle('is-error', !!act?.error);
    const detail = act?.detail ?? '';
    setHidden(this.actDetails, !detail);
    setText(this.actDetail, detail);

    // Mandar mensagem: só para principais presentes (com o recurso ligado e a página local; sem o plugin, a dica).
    // Ficha dormindo (sem sessão aberta): conversa pelo botão Conversar da ficha, não por terminal/mensagem.
    const sleeping = a.status === 'sleeping';
    setHidden(this.work, !a.cardId && this.panelState.target?.kind !== 'run');
    this.composer.render(live, this.id);
    setHidden(this.msgSec.el, true);
    setHidden(this.termBtn, sleeping);
    this.cardSec.render(live);

    // Vida social (personalidade, carteira, rodas): só de quem está no escritório.
    if (live) this.social.render(a.id, now);
    else setHidden(this.social.el, true);

    // Tarefas.
    const tp = taskProgress(a.tasks);
    setHidden(this.tasksSec.el, a.tasks.length === 0);
    updateProgress(this.tasksBar, tp.completed, tp.total, tp.inProgress);
    setText(this.tasksSec.extra, `${tp.completed}/${tp.total}`);
    this.tasks.sync(a.tasks);

    // Equipe: subagentes (principal) ou responsável (sub).
    if (a.kind === 'main') {
      const subs = sortByUrgency((this.ctx.store.snapshot?.agents ?? []).filter((s) => s.parentId === a.id));
      setText(this.teamSec.title, tr('Subagentes'));
      setText(this.teamSec.extra, subs.length ? String(subs.length) : '');
      setText(this.teamEmpty, a.stats.subagents ? tr('Nenhum ativo agora ({0} nesta sessão).', [plural(a.stats.subagents, tr('disparado'), tr('disparados'))]) : tr('Nenhum subagente disparado ainda.'));
      setHidden(this.teamEmpty, subs.length > 0);
      this.team.sync(subs);
    } else {
      const parent = a.parentId ? this.ctx.agent(a.parentId) : undefined;
      setText(this.teamSec.title, tr('Responsável'));
      setText(this.teamSec.extra, '');
      setText(this.teamEmpty, tr('O agente principal já não está no escritório.'));
      setHidden(this.teamEmpty, !!parent);
      this.team.sync(parent ? [parent] : []);
    }

    // Conversas deste agente: o pedido e a resposta de cada turno, para achar o que ele fez sem abrir o terminal.
    // Re-derived every render: other agents in the snapshot may make the link ambiguous (no new GET).
    const convs = this.runs = runsOfAgent(this.rawRuns, a, this.ctx.store.snapshot?.agents ?? []);
    setHidden(this.runsSec.el, convs.length === 0 && a.kind === 'sub');
    setText(this.runsSec.extra, convs.length ? String(convs.length) : '');
    setHidden(this.runsEmpty, convs.length > 0);
    const runsKey = `${a.id}|${convs.map((r) => `${r.runId}:${r.state}:${r.at}`).join(',')}`;
    if (this.runsKey !== runsKey) {
      this.runsKey = runsKey;
      this.runsList.replaceChildren(...convs.map(r => {
        const item = createRunItem(r);
        item.append(h('button', { class: 'ui-btn ui-run-open', type: 'button', text: tr('Abrir conversa'), on: { click: () => { this.tabs.setTab('work'); this.ctx.openRun?.(r.runId, r.owner); } } }));
        return item;
      }));
    }

    // Linha do tempo (mais recente primeiro). No replay, nada depois do instante reproduzido.
    const until = this.historyUntil();
    this.history = mergeHistory(this.history, a.recent, 200, until);
    const items = this.history.slice(-this.timelineShown).reverse();
    const hiddenCount = Math.max(0, this.history.length - this.timelineShown);
    setHidden(this.timelineMore, hiddenCount === 0);
    setText(this.timelineMore, tr('Mostrar mais {0}', [Math.min(TIMELINE_STEP, hiddenCount)]));
    setHidden(this.timelineLess, this.timelineShown <= TIMELINE_STEP || this.history.length <= TIMELINE_STEP);
    this.timeline.sync(items);
    setText(this.timelineSec.extra, this.history.length ? String(this.history.length) : '');

    this.renderStats(a, now);

    // Codex: como ter o ao vivo e as aprovações por aqui (o servidor ainda não diz se os hooks dele estão ligados).
    setHidden(this.codexHint, !codex || a.kind !== 'main' || !live || this.ctx.store.replaying);
  }

  /** Lista as perguntas pendentes com as opções, só para leitura (sem o pedido no escritório, a resposta é no Claude Code). */
  private renderQuestions(act: Activity | undefined): void {
    const qs = act?.questions ?? [];
    setHidden(this.alertQuestions, qs.length === 0);
    const key = qs.length ? `${act!.id}|${qs.length}` : '';
    if (key === this.alertQuestionsKey) return;
    this.alertQuestionsKey = key;
    this.alertQuestions.replaceChildren(
      ...qs.map((q) =>
        h(
          'div',
          { class: 'ui-ask__q' },
          q.header ? h('span', { class: 'ui-ask__tag', text: q.header }) : null,
          h('p', { class: 'ui-ask__question', text: q.question }),
          q.multiSelect ? h('p', { class: 'ui-ask__hint', text: tr('Pode escolher mais de uma') }) : null,
          h(
            'ol',
            { class: 'ui-ask__opts' },
            ...q.options.map((o) =>
              h('li', {}, h('strong', { text: o.label }), o.description ? h('span', { class: 'ui-ask__desc', text: o.description }) : null),
            ),
          ),
        ),
      ),
    );
  }

  private renderTerminalButton(live: boolean, provider = providerOf(this.last)): void {
    const router = this.ctx.terminals;
    const available = (router ? router.available : !!this.ctx.store.snapshot?.meta.terminal) && access().terminal;
    const open = (router ? router.openAgentId : this.terminal.agentId) === this.id;
    // Interativo: o Claude Code roda aqui (pty) ou roda noutro terminal e dá para assumir pela janela.
    const readOnly = !!this.ctx.store.snapshot?.meta.terminal;
    const kind = !this.id ? '' : router?.interactive(this.id) ? 'interativo' : !readOnly && this.pty.enabled && ptyControllable(this.last) ? 'em outro terminal' : 'ao vivo';
    setText(this.termRo, kind === 'interativo' ? tr('interativo') : kind === 'ao vivo' ? tr('ao vivo') : kind ? tr('em outro terminal') : '');
    // aria-disabled (e não disabled): o botão continua focável e a dica do porquê aparece no hover.
    const enabled = open || (available && live);
    if (enabled) setHidden(this.termWhy, true);
    setAttr(this.termBtn, 'aria-disabled', enabled ? null : 'true');
    this.termBtn.classList.toggle('is-disabled', !enabled);
    setAttr(this.termBtn, 'aria-pressed', String(open));
    this.termBtn.classList.toggle('is-on', open);
    setText(this.termLabel, open ? tr('Fechar terminal') : tr('Abrir terminal'));
    setTitle(
      this.termBtn,
      open
        ? tr('Fechar o terminal (T)')
        : !available
          ? this.ctx.store.replaying
            ? tr('Sem terminal no timelapse: a conversa é a de agora, não a do momento reproduzido.')
            : this.ctx.store.snapshot?.meta.terminal && access().remote
              ? tr('O terminal não está liberado no acesso remoto (HABBLAUD_REMOTE_ALLOW).')
              : TERMINAL_UNAVAILABLE_HINT
          : !live
            ? tr('O agente já saiu do escritório.')
            : kind === 'ao vivo'
              ? tr('Ver a conversa desta sessão como no {0}, ao vivo{1} (T)', [
                  provider === 'codex' ? 'Codex' : tr('terminal do Claude Code'),
                  this.pty.enabled && ptyControllable(this.last) ? tr('; "Assumir daqui" continua nela aqui') : '',
                ])
              : kind === 'interativo'
                ? tr('Abrir o terminal desta sessão, que roda aqui no Habblaud (T)')
                : tr('Abrir o terminal: a sessão roda em outro terminal; dá para assumir daqui (T)'),
    );
  }

  private renderStats(a: AgentInfo, now: number): void {
    const s = a.stats;
    const st = this.stats;
    st.set('tools', formatInt(s.toolCalls));
    st.set('tokensIn', formatTokens(s.tokensIn));
    st.set('tokensOut', formatTokens(s.tokensOut));
    st.set('cost', s.costUSD !== undefined ? formatUSD(s.costUSD) : null);
    const codex = providerOf(a) === 'codex';
    const hasLines = s.linesAdded !== undefined || s.linesRemoved !== undefined;
    st.show('lines', hasLines);
    setText(this.linesPlus, `+${formatInt(s.linesAdded ?? 0)}`);
    setText(this.linesMinus, `−${formatInt(s.linesRemoved ?? 0)}`);
    st.set('subs', a.kind === 'main' ? formatInt(s.subagents) : null);
    st.set('model', prettyModel(a.model));
    st.set('branch', a.gitBranch ?? null);
    // Codex: a política de aprovação (quando o servidor a manda) no lugar do modo de permissão do Claude Code.
    st.label('perm', codex ? tr('Aprovações') : tr('Permissões'));
    st.set('perm', a.kind !== 'main' ? null : codex ? (a.permissionMode ? codexApprovalLabel(a.permissionMode) : null) : permissionLabel(a.permissionMode));

    setText(this.sessionValue, a.sessionId);
    setTitle(this.sessionValue, a.sessionId);
    st.set('start', formatDateTime(a.startedAt));
    st.set('duration', formatDuration(now - a.startedAt));
    st.set('bg', a.background ? tr('Em segundo plano') : null);
  }
}

type StatKey = 'tools' | 'tokensIn' | 'tokensOut' | 'cost' | 'lines' | 'subs' | 'model' | 'branch' | 'perm' | 'session' | 'start' | 'duration' | 'bg';

/** Lista chave/valor de linhas fixas: cada linha é criada uma vez e só tem o texto/visibilidade atualizados. */
class KvList<K extends string> {
  readonly el: HTMLElement;
  private rows = new Map<K, { dt: HTMLElement; dd: HTMLElement }>();

  constructor(defs: readonly [K, string, Node?][]) {
    this.el = h('dl', { class: 'ui-kv ui-stats' });
    for (const [key, label, content] of defs) {
      const dt = h('dt', { text: label });
      const dd = h('dd');
      if (content) dd.append(content);
      this.rows.set(key, { dt, dd });
      this.el.append(dt, dd);
    }
  }

  /** Troca o rótulo da linha (ex.: "Aprovações" no Codex). */
  label(key: K, text: string): void {
    setText(this.rows.get(key)!.dt, text);
  }

  /** Define o texto da linha; `null` oculta a linha. */
  set(key: K, value: string | null): void {
    const r = this.rows.get(key)!;
    this.show(key, value !== null);
    if (value !== null) setText(r.dd, value);
  }

  show(key: K, visible: boolean): void {
    const r = this.rows.get(key)!;
    setHidden(r.dt, !visible);
    setHidden(r.dd, !visible);
  }
}

// ---------------------------------------------------------------- visão da sala

class RoomView {
  readonly el: HTMLElement;
  private id = '';
  private last: RoomInfo | null = null;
  private swatch: HTMLElement;
  private name: HTMLElement;
  private renameBtn: HTMLButtonElement;
  private path: HTMLElement;
  private gone: HTMLElement;
  private accs: KeyedList<string>;
  private agents: KeyedList<AgentInfo>;
  private agentsSec: ReturnType<typeof section>;
  private agentsEmpty: HTMLElement;
  private tasksSec: ReturnType<typeof section>;
  private tasksBar: HTMLElement;
  private tasks: KeyedList<{ task: TaskItem; owner: string; key: string }>;
  private feed: KeyedList<FeedItem>;
  private feedSec: ReturnType<typeof section>;
  private project: ProjectSection;
  private newCard: NewCardRow;
  private newBtn: HTMLButtonElement;
  private newMsg: HTMLElement;

  constructor(
    private ctx: UiContext,
    private pty: PtyControl,
  ) {
    this.newBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Nova sessão'), title: tr('Abre um Claude Code novo nesta pasta, num terminal interativo'), on: { click: () => this.newSession() } });
    this.newMsg = h('p', { class: 'ui-actions__msg is-error', role: 'status', hidden: true });
    this.swatch = h('span', { class: 'ui-room-hero__swatch', attrs: { 'aria-hidden': 'true' } });
    this.name = h('h2', { class: 'ui-hero__name' });
    // Lápis: o mesmo campo do botão direito na sala (ui/roomrename.ts), aberto embaixo do nome.
    this.renameBtn = iconButton(
      ICONS.pencil,
      tr('Renomear sala'),
      () => {
        const r = this.name.getBoundingClientRect();
        ctx.renameRoom?.(this.id, { x: r.left, y: r.bottom + 6 });
      },
      'ui-icon-btn--sm ui-room-hero__rename',
    );
    this.path = h('span', { class: 'ui-room-hero__path' });
    const centerBtn = h('button', { class: 'ui-btn', type: 'button', title: tr('Levar a câmera até a sala'), on: { click: () => ctx.focusSelection() } });
    centerBtn.innerHTML = ICONS.center;
    centerBtn.append(h('span', { text: tr('Centralizar') }));
    this.gone = h('p', { class: 'ui-gone', text: tr('Esta sala foi fechada: todos os agentes saíram.'), hidden: true });
    this.project = new ProjectSection(ctx);
    this.newCard = new NewCardRow(ctx);

    const accsEl = h('div', { class: 'ui-acc-list' });
    this.accs = new KeyedList<string>(accsEl, {
      animate: false,
      key: (id) => id,
      create: () => h('span', { class: 'ui-acc-item' }, createAccountChip('sm'), h('span')),
      update: (el, id) => {
        const acc = ctx.account(id);
        updateAccountChip(el.firstElementChild as HTMLElement, acc, id);
        // "Conta C · dev@x.com"; no Codex, "Codex · plano Team".
        setText(el.lastElementChild!, accountChipLabel(acc, id, accountProvider(acc, id)).replace(/ \((.+)\)$/, ' · $1'));
      },
    });

    const agentsList = h('div', { class: 'ui-team' });
    this.agentsEmpty = h('p', { class: 'ui-muted ui-small', text: tr('Ninguém na sala agora.') });
    this.agentsSec = section(tr('Agentes'), agentsList, this.agentsEmpty);
    this.agents = new KeyedList<AgentInfo>(agentsList, {
      key: (a) => a.id,
      create: (a) => createAgentRow(a, (id) => ctx.select({ type: 'agent', id }, { focus: true }), 'sm'),
      update: (row, a) => updateAgentRow(row, a, ctx.account(a.account), false, ctx.now(), ctx.store.snapshot?.agents),
    });

    this.tasksBar = createProgress(tr('Progresso das tarefas da sala'));
    const tasksList = h('ul', { class: 'ui-tasks' });
    this.tasksSec = section(tr('Tarefas'), this.tasksBar, tasksList);
    this.tasks = new KeyedList(tasksList, { key: (t) => t.key, create: createTaskItem, update: (li, t) => updateTaskItem(li, t.task, t.owner) });

    const feedList = h('ol', { class: 'ui-timeline' });
    this.feedSec = section(tr('Atividade recente'), feedList);
    this.feed = new KeyedList<FeedItem>(feedList, { key: (f) => f.id, create: createTimelineItem, update: (li, f) => updateTimelineItem(li, f.activity, ctx.now(), f.agentName) });

    this.el = h(
      'div',
      { class: 'ui-drawer__view ui-room-view' },
      h(
        'div',
        { class: 'ui-room-hero' },
        this.swatch,
        h('div', { class: 'ui-hero__text' }, h('div', { class: 'ui-room-hero__title' }, this.name, this.renameBtn), h('span', { class: 'ui-copy-row' }, this.path, copyButton(() => this.last?.path ?? '', tr('Copiar caminho')))),
      ),
      this.gone,
      h('div', { class: 'ui-status' }, accsEl, h('span', { class: 'ui-status__actions' }, this.newBtn, centerBtn)),
      this.newMsg,
      this.project.el,
      this.newCard.el,
      this.agentsSec.el,
      this.tasksSec.el,
      this.feedSec.el,
    );
  }

  get roomId(): string {
    return this.id;
  }

  /** Sessão nova na pasta da sala, na conta de quem estiver nela (ou na padrão). */
  private newSession(): void {
    const r = this.last;
    if (!r) return;
    // Só conta do Claude Code (nem Codex nem demo); sem nenhuma na sala, o servidor usa a padrão.
    const account = (this.ctx.store.snapshot?.agents ?? []).find((a) => a.roomId === r.id && ptyControllable(a))?.account;
    setHidden(this.newMsg, true);
    this.pty.newSession(r.path, account).catch((err: Error) => {
      setText(this.newMsg, tr('Não deu: {0}', [err.message]));
      setHidden(this.newMsg, false);
    });
  }

  open(id: string): void {
    if (this.id === id) return;
    this.id = id;
    this.last = null;
    this.agents.clear();
    this.tasks.clear();
    this.feed.clear();
  }

  render(): void {
    const live = this.ctx.store.room(this.id);
    if (live) this.last = live;
    const r = this.last;
    if (!r) return;
    setText(this.name, r.name);
    setText(this.path, r.project ? pathsLabel({ ...r, paths: (r.paths ?? []).map(shortPath) }) || tr('projeto sem pasta') : shortPath(r.path));
    setTitle(this.path, r.project ? (r.paths ?? []).join('\n') : r.path);
    this.project.render(r, !!live);
    this.newCard.render(r, !!live);
    try {
      setStyleVar(this.swatch, '--room', roomTheme(r.seed).accent);
    } catch {
      // Sem tema: cor padrão.
    }
    setHidden(this.gone, !!live);
    setHidden(this.renameBtn, !live || !canRenameRoom(this.ctx, r.id));
    setHidden(this.newBtn, !this.pty.enabled || !r.path);

    const snap = this.ctx.store.snapshot;
    const agents = (snap?.agents ?? []).filter((a) => a.roomId === r.id);
    this.accs.sync(accountsOf(agents, snap?.accounts ?? []));
    const ordered = sortByUrgency(agents);
    setText(this.agentsSec.extra, agents.length ? String(agents.length) : '');
    setHidden(this.agentsEmpty, agents.length > 0);
    this.agents.sync(ordered);

    const tp = aggregateTasks(agents);
    setHidden(this.tasksSec.el, tp.total === 0);
    updateProgress(this.tasksBar, tp.completed, tp.total, tp.inProgress);
    setText(this.tasksSec.extra, `${tp.completed}/${tp.total}`);
    this.tasks.sync(agents.flatMap((a) => a.tasks.map((task) => ({ task, owner: a.name, key: `${a.id}#${task.id}` }))));

    const feed = this.ctx.store.feed.filter((f) => f.roomId === r.id).slice(-ROOM_FEED_LIMIT).reverse();
    setHidden(this.feedSec.el, feed.length === 0);
    this.feed.sync(feed);
  }
}

// ---------------------------------------------------------------- gaveta

export class Drawer implements UiComponent {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private agentView: AgentView;
  private roomView: RoomView;
  private mode: 'agent' | 'room' | 'run' | null = null;
  private runRequest?: AbortController;
  private standalone?: { el: HTMLElement; panel: ConsultPanel };
  private standaloneOpen = false;
  private heading: HTMLElement;
  private resizeHandle: HTMLElement;
  private width = AGENT_PANEL_DEFAULT_WIDTH;
  private draftWidth: number | undefined;
  private resizing: { pointerId: number; x: number; width: number } | null = null;
  /** Avisado quando a largura muda (a área livre do escritório muda). */
  onLayoutChange: (() => void) | null = null;

  constructor(
    private ctx: UiContext,
    terminal: TerminalControl,
    pty: PtyControl,
  ) {
    this.agentView = new AgentView(ctx, terminal, pty, () => {
      // Snapshot rebinding is a selection change for pending record reads, even with the same id.
      this.runRequest?.abort();
      this.runRequest = undefined;
    });
    this.roomView = new RoomView(ctx, pty);
    this.heading = h('span', { class: 'ui-drawer__kind' });
    const close = iconButton(ICONS.close, tr('Fechar detalhes (Esc)'), () => { this.selectionChanged(); ctx.select(null); this.render(); this.onLayoutChange?.(); });
    this.body = h('div', { class: 'ui-drawer__body' });
    const bar = h('div', { class: 'ui-drawer__bar' }, this.heading, close);
    this.el = h(
      'aside',
      { class: 'ui-panel ui-drawer', attrs: { 'aria-label': tr('Detalhes'), id: 'ui-drawer', 'aria-hidden': 'true' } },
      bar,
      this.body,
    );
    // Só a borda redimensiona. A barra não solta o painel, nem restaura posições flutuantes antigas.
    this.resizeHandle = h('div', {
      class: 'ui-drawer__resize', role: 'separator', tabIndex: 0,
      attrs: { 'aria-label': tr('Redimensionar painel de detalhes'), 'aria-orientation': 'vertical', 'aria-controls': 'ui-drawer' },
    });
    this.el.prepend(this.resizeHandle);
    this.resizeHandle.addEventListener('pointerdown', (e) => {
      if (this.resizing || e.button !== 0 || !this.isOpen || ctx.isNarrow()) return;
      e.preventDefault();
      this.resizeHandle.focus({ preventScroll: true });
      this.resizing = { pointerId: e.pointerId, x: e.clientX, width: this.width };
      this.resizeHandle.setPointerCapture(e.pointerId);
    });
    this.resizeHandle.addEventListener('pointermove', (e) => {
      if (this.resizing?.pointerId !== e.pointerId) return;
      this.draftWidth = this.resizing.width + this.resizing.x - e.clientX;
      this.syncLayout();
      this.onLayoutChange?.();
    });
    this.resizeHandle.addEventListener('pointerup', (e) => this.endResize(e.pointerId, true));
    this.resizeHandle.addEventListener('pointercancel', (e) => this.endResize(e.pointerId, false));
    this.resizeHandle.addEventListener('lostpointercapture', (e) => this.endResize(e.pointerId, false));
    this.resizeHandle.addEventListener('keydown', (e) => {
      if (ctx.isNarrow() || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      e.stopPropagation();
      this.setWidth(this.width + (e.key === 'ArrowLeft' ? 16 : -16));
    });
    this.resizeHandle.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); }
    });
    addEventListener('resize', () => {
      if (this.resizing) this.endResize(this.resizing.pointerId, false);
      this.syncLayout();
      this.onLayoutChange?.();
    });
    this.el.inert = true;
  }

  get isOpen(): boolean {
    return this.mode !== null;
  }

  /** Compatibilidade com FreeArea: o painel de detalhes agora é sempre docked. */
  get floating(): boolean {
    return false;
  }

  /** Mede sem depender de transform de abertura; viewport resize nunca grava a preferência. */
  syncLayout(): void {
    const css = getComputedStyle(this.ctx.root);
    const gap = parseFloat(css.getPropertyValue('--gap')) || 0;
    const sidebar = this.ctx.root.querySelector<HTMLElement>('.ui-sidebar');
    const side = !this.ctx.isNarrow() && this.ctx.isPanelOpen('sidebar') && sidebar
      ? sidebar.offsetLeft + sidebar.offsetWidth + INSET_GAP : 0;
    const viewport = Math.max(0, innerWidth - gap - INSET_GAP);
    const requested = this.draftWidth ?? this.ctx.prefs.agentPanelWidth ?? AGENT_PANEL_DEFAULT_WIDTH;
    this.width = clampPanelWidth(requested, viewport, side);
    setStyleVar(this.ctx.root, '--drawer-w', `${this.width}px`);
    setHidden(this.resizeHandle, this.ctx.isNarrow());
    setAttr(this.resizeHandle, 'aria-valuenow', String(this.width));
    setAttr(this.resizeHandle, 'aria-valuemin', String(clampPanelWidth(0, viewport, side)));
    setAttr(this.resizeHandle, 'aria-valuemax', String(clampPanelWidth(AGENT_PANEL_MAX_WIDTH, viewport, side)));
  }

  private setWidth(width: number): void {
    const previous = this.width;
    this.draftWidth = width;
    this.syncLayout();
    if (this.width !== previous) this.ctx.updatePrefs({ agentPanelWidth: this.width });
    this.draftWidth = undefined;
    this.onLayoutChange?.();
  }

  private endResize(pointerId: number, save: boolean): void {
    if (this.resizing?.pointerId !== pointerId) return;
    const changed = this.width !== this.resizing.width;
    this.resizing = null;
    if (save && changed) this.ctx.updatePrefs({ agentPanelWidth: this.width });
    this.draftWidth = undefined;
    if (this.resizeHandle.hasPointerCapture(pointerId)) this.resizeHandle.releasePointerCapture(pointerId);
    this.syncLayout();
    this.onLayoutChange?.();
  }

  chatCard(card: { id: string; name: string; fresh?: boolean }): void {
    this.render();
    this.agentView.chatCard(card);
  }

  selectionChanged(): void {
    this.runRequest?.abort();
    this.runRequest = undefined;
    this.standaloneOpen = false;
    this.standalone?.panel.hide();
  }

  async openRun(runId: string): Promise<void> {
    this.runRequest?.abort();
    const controller = this.runRequest = new AbortController();
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error(tr('Registro de execução indisponível.'));
      const run = panelRun(await res.json());
      if (controller.signal.aborted || this.runRequest !== controller) return;
      if (!run || run.runId !== runId) throw new Error(tr('Registro de execução indisponível.'));
      // O GET terminou: a seleção legítima abaixo não cancela a própria abertura.
      this.runRequest = undefined;
      const agent = linkedRunAgent(run, this.ctx.store.snapshot?.agents ?? []);
      if (agent) {
        this.ctx.select({ type: 'agent', id: agent.id });
        this.render();
        this.agentView.openRun(run);
      } else {
        this.ctx.select(null);
        if (!this.standalone) {
          const record = h('p', { class: 'ui-agent-work__run' });
          const work = h('div', { class: 'ui-agent-work' }, record);
          const panel = new ConsultPanel(this.ctx, { embedded: true, readRun: true, onClose: () => { this.selectionChanged(); this.render(); this.onLayoutChange?.(); }, onRun: value => {
            work.dataset.runId = value?.runId ?? '';
            setText(record, value ? `${runStateLabel(value.state)} · ${value.prompt ?? tr('Registro antigo: o pedido não foi gravado.')}` : '');
          } });
          work.append(panel.el);
          this.standalone = { el: work, panel };
        }
        this.standaloneOpen = true;
        this.render();
        this.standalone.panel.openRun(run.runId, run.owner);
        this.standalone.panel.show();
        this.onLayoutChange?.();
      }
    } catch (error) {
      if (!controller.signal.aborted) this.ctx.announce(error instanceof Error ? error.message : String(error));
    }
  }

  toggleFollow(): void {
    if (this.mode === 'agent') this.agentView.toggleFollow();
  }

  render(): void {
    const sel = this.ctx.selection();
    const mode = this.standaloneOpen ? 'run' : sel?.type ?? null;
    if (mode !== this.mode) {
      // Gaveta fechada ou fora do agente: o editor fecha, e ao reabrir começa do estado atual do agente.
      if (this.mode === 'agent') { this.agentView.character.close(); this.agentView.close(); }
      this.mode = mode;
      if (mode === null && this.resizing) this.endResize(this.resizing.pointerId, false);
      this.body.replaceChildren(...(mode === 'agent' ? [this.agentView.el] : mode === 'room' ? [this.roomView.el] : mode === 'run' && this.standalone ? [this.standalone.el] : []));
      this.body.scrollTop = 0;
      this.el.classList.toggle('is-open', mode !== null);
      setAttr(this.el, 'aria-hidden', mode ? 'false' : 'true');
      this.el.inert = mode === null;
    }
    if (mode === 'run') { setText(this.heading, tr('Conversa')); return; }
    if (sel?.type === 'agent') {
      if (this.agentView.agentId !== sel.id) this.body.scrollTop = 0;
      this.agentView.open(sel.id);
      setText(this.heading, this.ctx.agent(sel.id)?.kind === 'sub' ? tr('Subagente') : tr('Agente'));
      this.agentView.render();
    } else if (sel?.type === 'room') {
      if (this.roomView.roomId !== sel.id) this.body.scrollTop = 0;
      this.roomView.open(sel.id);
      setText(this.heading, tr('Sala'));
      this.roomView.render();
    }
  }
}
