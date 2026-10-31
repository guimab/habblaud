// Seção "Projeto" na ficha da sala (ui/drawer.ts, RoomView). Sala de pasta solta: "Transformar em projeto" e
// "Juntar com…". Sala de projeto: pastas (acrescentar/tirar), contexto fixo, "Juntar com…" e "Desfazer projeto".
// Fala com /api/projects (server/projects/http.ts); o servidor muda os agentes de sala e o snapshot redesenha.
import { tr } from '../../../shared/i18n';
import type { RoomInfo } from '../../../shared/types';
import { access } from '../net/access';
import type { UiContext } from './context';
import { h, setHidden, setText } from './dom';
import { joinPlan, mergeTargets } from './project-model';

interface ProjectDto {
  id: string;
  name: string;
  paths: string[];
  context?: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body) });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? tr('erro {0}', [res.status]));
  return j;
}

export class ProjectSection {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly paths: HTMLElement;
  private readonly addPath: HTMLInputElement;
  private readonly addRow: HTMLElement;
  private readonly context: HTMLTextAreaElement;
  private readonly contextRow: HTMLElement;
  private readonly makeBtn: HTMLButtonElement;
  private readonly joinSel: HTMLSelectElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly msg: HTMLElement;
  private room: RoomInfo | null = null;
  private loadedContextFor = '';

  constructor(private readonly ctx: UiContext) {
    this.title = h('h3', { class: 'ui-sec__title', text: tr('Projeto') });
    this.paths = h('ul', { class: 'ui-project__paths' });
    this.addPath = h('input', { class: 'ui-rename__input', type: 'text', attrs: { placeholder: tr('/caminho/da/pasta'), 'aria-label': tr('Acrescentar pasta') } });
    this.addPath.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void this.addFolder();
    });
    this.addRow = h('div', { class: 'ui-project__row' }, this.addPath, h('button', { class: 'ui-btn', type: 'button', text: tr('Acrescentar'), on: { click: () => void this.addFolder() } }));
    this.context = h('textarea', { class: 'ui-rename__input', attrs: { rows: 3, maxlength: 20000, placeholder: tr('Contexto fixo do projeto (usado pelos agentes do projeto)'), 'aria-label': tr('Contexto do projeto') } });
    this.context.addEventListener('keydown', (e) => e.stopPropagation());
    this.contextRow = h('div', { class: 'ui-project__ctx' }, this.context, h('button', { class: 'ui-btn', type: 'button', text: tr('Salvar contexto'), on: { click: () => void this.saveContext() } }));
    this.makeBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Transformar em projeto'), title: tr('A sala vira um projeto, que pode juntar várias pastas'), on: { click: () => void this.make() } });
    this.joinSel = h('select', { class: 'ui-select', attrs: { 'aria-label': tr('Juntar com…') } });
    this.joinSel.addEventListener('change', () => void this.join());
    this.undoBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Desfazer projeto'), title: tr('As pastas voltam a ser salas separadas'), on: { click: () => void this.undo() } });
    this.msg = h('p', { class: 'ui-actions__msg', role: 'status', hidden: true });
    this.el = h(
      'section',
      { class: 'ui-sec ui-project' },
      h('div', { class: 'ui-sec__head' }, this.title),
      this.paths,
      this.addRow,
      this.contextRow,
      h('div', { class: 'ui-project__row' }, this.makeBtn, this.joinSel, this.undoBtn),
      this.msg,
    );
  }

  private canEdit(): boolean {
    const s = this.ctx.store;
    return !!access().projects && !s.mock && !s.replaying;
  }

  render(room: RoomInfo | null, live: boolean): void {
    this.room = room;
    const show = !!room && live && this.canEdit() && !room.id.startsWith('demo');
    setHidden(this.el, !show);
    if (!show || !room) return;
    const isProject = !!room.project;
    setHidden(this.paths, !isProject);
    setHidden(this.addRow, !isProject);
    setHidden(this.contextRow, !isProject);
    setHidden(this.makeBtn, isProject);
    setHidden(this.undoBtn, !isProject);
    if (isProject) {
      const list = room.paths ?? [];
      this.paths.replaceChildren(
        ...(list.length
          ? list.map((p) => h('li', {}, h('code', { text: p }), h('button', { class: 'ui-btn ui-btn--link', type: 'button', text: tr('tirar'), on: { click: () => void this.removeFolder(p) } })))
          : [h('li', { class: 'ui-muted ui-small', text: tr('Sem pasta: só conversa.') })]),
      );
      if (this.loadedContextFor !== room.project) {
        this.loadedContextFor = room.project!;
        this.context.value = '';
        void call<ProjectDto>('GET', '/api/projects')
          .then((j) => {
            const p = (j as unknown as { projects: ProjectDto[] }).projects.find((x) => x.id === room.project);
            if (this.room?.project === p?.id) this.context.value = p?.context ?? '';
          })
          .catch(() => {});
      }
    }
    const targets = mergeTargets(room, (this.ctx.store.snapshot?.rooms ?? []).filter((r) => !r.id.startsWith('demo')));
    const opts = [h('option', { text: tr('Juntar com…'), attrs: { value: '' } }), ...targets.map((r) => h('option', { text: r.name, attrs: { value: r.id } }))];
    const sig = targets.map((r) => `${r.id}=${r.name}`).join('|');
    if (this.joinSel.dataset.sig !== sig) {
      this.joinSel.replaceChildren(...opts);
      this.joinSel.dataset.sig = sig;
    }
    setHidden(this.joinSel, !targets.length);
  }

  private async act(fn: () => Promise<unknown>): Promise<void> {
    setHidden(this.msg, true);
    try {
      await fn();
    } catch (err) {
      setText(this.msg, tr('Não deu: {0}', [err instanceof Error ? err.message : String(err)]));
      this.msg.classList.add('is-error');
      setHidden(this.msg, false);
    }
  }

  private make(): Promise<void> {
    const r = this.room;
    if (!r) return Promise.resolve();
    return this.act(async () => {
      const p = await call<ProjectDto>('POST', '/api/projects', { name: r.name.slice(0, 40), paths: r.path ? [r.path] : [] });
      this.goTo(`project:${p.id}`);
    });
  }

  private join(): Promise<void> {
    const from = this.room;
    const to = this.ctx.store.snapshot?.rooms.find((r) => r.id === this.joinSel.value);
    this.joinSel.value = '';
    if (!from || !to) return Promise.resolve();
    const plan = joinPlan(from, to);
    return this.act(async () => {
      if (plan.kind === 'create') {
        const p = await call<ProjectDto>('POST', '/api/projects', { name: plan.name.slice(0, 40), paths: plan.paths });
        return this.goTo(`project:${p.id}`);
      }
      if (plan.kind === 'add') await call('PATCH', `/api/projects/${encodeURIComponent(plan.projectId)}`, { addPaths: plan.paths });
      else {
        await call('DELETE', `/api/projects/${encodeURIComponent(plan.removeId)}`);
        await call('PATCH', `/api/projects/${encodeURIComponent(plan.projectId)}`, { addPaths: plan.paths });
      }
      this.goTo(`project:${plan.projectId}`);
    });
  }

  /** A sala nova só existe no próximo snapshot: espera um pouco e seleciona. */
  private goTo(target: string | ((rooms: readonly RoomInfo[]) => string | undefined)): void {
    let tries = 0;
    const tick = () => {
      const roomId = typeof target === 'string' ? target : target(this.ctx.store.snapshot?.rooms ?? []);
      if (roomId && this.ctx.store.room(roomId)) this.ctx.select({ type: 'room', id: roomId }, { focus: true });
      else if (++tries < 20) setTimeout(tick, 150);
    };
    tick();
  }

  private addFolder(): Promise<void> {
    const r = this.room;
    const p = this.addPath.value.trim();
    if (!r?.project || !p) return Promise.resolve();
    return this.act(async () => {
      await call('PATCH', `/api/projects/${encodeURIComponent(r.project!)}`, { addPaths: [p] });
      this.addPath.value = '';
    });
  }

  private removeFolder(path: string): Promise<void> {
    const r = this.room;
    if (!r?.project) return Promise.resolve();
    return this.act(() => call('PATCH', `/api/projects/${encodeURIComponent(r.project!)}`, { paths: (r.paths ?? []).filter((x) => x !== path) }));
  }

  private saveContext(): Promise<void> {
    const r = this.room;
    if (!r?.project) return Promise.resolve();
    return this.act(async () => {
      await call('PATCH', `/api/projects/${encodeURIComponent(r.project!)}`, { context: this.context.value });
      setText(this.msg, tr('Contexto salvo.'));
      this.msg.classList.remove('is-error');
      setHidden(this.msg, false);
    });
  }

  private undo(): Promise<void> {
    const r = this.room;
    if (!r?.project || !confirm(tr('Desfazer o projeto {0}? As pastas voltam a ser salas separadas.', [r.name]))) return Promise.resolve();
    const first = r.paths?.[0];
    return this.act(async () => {
      await call('DELETE', `/api/projects/${encodeURIComponent(r.project!)}`);
      if (first) this.goTo((rooms) => rooms.find((x) => !x.project && x.path.replace(/\/+$/, '').toLowerCase() === first.toLowerCase())?.id);
    });
  }
}
