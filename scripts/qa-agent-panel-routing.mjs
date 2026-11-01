// Integrated QA: production app/createUI/Drawer routing; only HTTP API is fake.
// node scripts/qa-agent-panel-routing.mjs [http://127.0.0.1:4751] [scenario]
// Scenarios: tabs, routing, history, switch-get, pending, delayed-sse,
// close-get, close-sse, external-room, all. No production module imports/mounts.
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright-core';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4751');
const scenario = process.argv[3] ?? 'all';
const scenarios = ['tabs', 'routing', 'history', 'switch-get', 'pending', 'delayed-sse', 'close-get', 'close-sse', 'external-room', 'sleeping', 'no-run', 'inbox', 'api-times', 'record-isolation', 'orphan', 'tab-style', 'config-get', 'config-late-get', 'config-new-session', 'same-target-get', 'external-after-run', 'sidebar-get', 'sidebar-late-run', 'history-completed', 'schedule-create', 'schedule-act', 'schedule-error', 'automatic-read-send', 'automatic-discovery-send', 'history-owner-kind', 'history-canonical', 'history-ambiguous', 'release-same-id', 'rebind-same-id', 'rebind-late-get', 'rebind-a-b-a', 'adopt-same-id', 'rebind-destination'];
assert([...scenarios, 'all'].includes(scenario), `Unknown scenario: ${scenario}`);
assert(process.argv.length <= 4, 'Unexpected arguments');
assert(['http:', 'https:'].includes(base.protocol), 'Expected HTTP baseURL');
const cards = ['a', 'b', 's'].map(x => ({ id: `c${x}`, name: `Agente ${x.toUpperCase()}`, sessions: [`s${x}`], instructions: `Instruções ${x.toUpperCase()}` }));
const runs = ['a', 'b'].map(x => ({ runId: `r-${x}`, state: 'running', prompt: `Pedido ${x.toUpperCase()}`, text: `Texto ${x.toUpperCase()}`, at: Date.now(), owner: { kind: 'card', id: `c${x}`, sessionId: `s${x}`, title: `Agente ${x.toUpperCase()}` } }));
const calls = [], errors = [], streams = new Set(), closed = [], unexpected = [], completed = [];
const delayed = [];
const liveEntries = [];
let holdOldRun = false, association = '', finishedRuns = false;
const holdCards = new Set();
let holdSessions = false, holdRunA = false, oldHistory = false, fixtureSchedules = false, holdScheduleMutation = false, scheduleError = false;
const oldRun = { ...runs[0], runId: 'r-old', state: 'done', prompt: 'PEDIDO ANTIGO CONCLUÍDO', text: 'RESPOSTA ANTIGA CONCLUÍDA', at: runs[0].at - 60000, owner: { ...runs[0].owner, sessionId: 'sessao-antiga-a' } };
const scheduleFixtures = ['a', 'b'].map(x => ({ id: `sched-${x}`, cardId: `c${x}`, text: `Agenda ${x.toUpperCase()}`, rule: { kind: 'every', minutes: 60 }, enabled: true, createdAt: 1 }));
let holdRuns = false, holdMessages = false, holdAEvents = false, noActiveA = false, rawTimes = false, historical = false, orphan = false;
const wireRun = r => {
  const clocked = rawTimes ? { ...r, at: undefined, updatedAt: r.at, startedAt: r.at } : r;
  const value = finishedRuns ? { ...clocked, state: 'done' } : clocked;
  if (r.runId === 'r-a' && association) return { ...value, prompt: `HISTÓRICO ${association}`, owner: { kind: 'consult', id: association === 'history-owner-kind' ? 'ca' : 'consult-association', sessionId: association === 'history-owner-kind' ? 'sem-vinculo' : 'sa' } };
  return r.runId !== 'r-a' ? value : historical ? { ...value, state: 'done', prompt: 'Pedido histórico', text: 'Resposta histórica', owner: { ...r.owner, sessionId: 'sessao-antiga' } } : orphan ? { ...value, owner: { kind: 'consult', id: 'consult-sem-ficha', sessionId: 'sessao-sem-vinculo', title: 'Consulta isolada' } } : value;
};
const frame = (res, data) => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };
const track = (res, path, kind) => {
  streams.add(res);
  const entry = { res, path, kind, closed: false };
  liveEntries.push(entry);
  res.on('close', () => { entry.closed = true; streams.delete(res); closed.push(entry); });
  return entry;
};
const release = (entry) => {
  if (entry.res.destroyed || entry.res.writableEnded) return;
  if (entry.kind === 'runs') reply(entry.res, entry.payload ?? { runs });
  else if (entry.kind === 'card') reply(entry.res, cards.find(c => c.id === entry.path.split('/').at(-1)));
  else if (entry.kind === 'session') reply(entry.res, { sessionId: 's-new-a' });
  else if (entry.kind === 'run') reply(entry.res, wireRun(runs[0]));
  else if (entry.kind === 'old-run') reply(entry.res, oldRun);
  else if (entry.kind === 'schedule') reply(entry.res, entry.payload, entry.status ?? 200);
  else if (entry.kind === 'messages') {
    entry.res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    frame(entry.res, { type: 'run', runId: 'r-a' });
    frame(entry.res, { type: 'delta', text: 'Texto A TARDIO' });
  } else frame(entry.res, { type: 'delta', text: 'Texto A TARDIO' });
};
const reply = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    const target = new URL(req.url, base);
    if (req.method !== 'GET' || target.origin !== base.origin) return reply(res, { error: 'Only same-origin static GET allowed' }, 405);
    try {
      const upstream = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream' });
      res.end(body);
    } catch { reply(res, { error: 'QA static asset unavailable; start baseURL separately' }, 502); }
    return;
  }
  const call = { method: req.method, path: url.pathname, query: url.search, contentType: req.headers['content-type'] };
  calls.push(call);
  if (url.pathname === '/api/access' || url.pathname === '/api/status') return reply(res, { remote: false, local: true, agents: true, projects: true, consult: true, terminal: true, permissions: true, messages: true, spawn: false });
  if (url.pathname === '/api/cards' || url.pathname === '/api/cards/details') return reply(res, { cards });
  const card = /^\/api\/cards\/(ca|cb|cs)$/.exec(url.pathname);
  if (card && req.method === 'GET') {
    if (holdCards.has(card[1])) { delayed.push(track(res, url.pathname, 'card')); return; }
    return reply(res, cards.find(c => c.id === card[1]));
  }
  if (card && req.method === 'PATCH') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { call.body = JSON.parse(body); } catch { return reply(res, { error: 'Invalid fixture JSON' }, 400); }
    if (req.headers['content-type'] !== 'application/json') return reply(res, { error: 'JSON Content-Type required' }, 415);
    const dto = cards.find(c => c.id === card[1]);
    for (const key of ['name', 'role', 'projectId', 'model', 'instructions']) if (Object.hasOwn(call.body, key)) dto[key] = call.body[key];
    return reply(res, dto);
  }
  if (url.pathname === '/api/cards/ca/sessions' && req.method === 'POST') {
    if (req.headers['content-type'] !== 'application/json') return reply(res, { error: 'JSON Content-Type required' }, 415);
    if (holdSessions) { delayed.push(track(res, url.pathname, 'session')); return; }
    return reply(res, { sessionId: 's-new-a' });
  }
  if (url.pathname === '/api/runs' && req.method === 'GET') {
    if (holdRuns) { const entry = track(res, url.pathname, 'runs'); entry.payload = { runs: [...(noActiveA ? runs.filter(r => r.runId !== 'r-a') : runs).map(wireRun), ...(oldHistory ? [oldRun] : [])] }; delayed.push(entry); return; }
    return reply(res, { runs: [...(noActiveA ? runs.filter(r => r.runId !== 'r-a') : runs).map(wireRun), ...(oldHistory ? [oldRun] : [])] });
  }
  const messages = /^\/api\/cards\/(ca|cb)\/messages$/.exec(url.pathname);
  if (messages && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { call.body = JSON.parse(body); } catch { return reply(res, { error: 'Invalid fixture JSON' }, 400); }
    if (req.headers['content-type'] !== 'application/json') return reply(res, { error: 'JSON Content-Type required' }, 415);
    if (holdMessages) { delayed.push(track(res, url.pathname, 'messages')); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    track(res, url.pathname, 'messages');
    frame(res, { type: 'run', runId: messages[1] === 'ca' ? 'r-a' : 'r-b' });
    frame(res, { type: 'delta', text: messages[1] === 'ca' ? 'Texto A' : 'Texto B' });
    return;
  }
  const run = /^\/api\/runs\/(r-a|r-b|r-old)$/.exec(url.pathname);
  if (run && req.method === 'GET') {
    if (holdOldRun && run[1] === 'r-old') { delayed.push(track(res, url.pathname, 'old-run')); return; }
    if (holdRunA && run[1] === 'r-a') { delayed.push(track(res, url.pathname, 'run')); return; }
    return reply(res, run[1] === 'r-old' ? oldRun : wireRun(runs.find(r => r.runId === run[1])));
  }
  const events = /^\/api\/runs\/(r-a|r-b)\/events$/.exec(url.pathname);
  if (events && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const entry = track(res, url.pathname, 'events');
    if (holdAEvents && events[1] === 'r-a') {
      res.write(': fixture awaiting delayed A\n\n');
      delayed.push(entry);
    } else frame(res, { type: 'delta', text: events[1] === 'r-a' ? 'Texto A' : 'Texto B' });
    return;
  }
  if (url.pathname === '/api/schedules' && req.method === 'GET') return reply(res, { schedules: fixtureSchedules ? scheduleFixtures.filter(s => s.cardId === url.searchParams.get('card')) : [] });
  if ((url.pathname === '/api/schedules' || url.pathname === '/api/schedules/sched-a/run') && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { call.body = JSON.parse(body); } catch { return reply(res, { error: 'Invalid fixture JSON' }, 400); }
    if (req.headers['content-type'] !== 'application/json') return reply(res, { error: 'JSON Content-Type required' }, 415);
    const payload = scheduleError ? { error: 'ERRO A ATRASADO' } : url.pathname === '/api/schedules' ? { ...scheduleFixtures[0], ...call.body, id: 'sched-created' } : scheduleFixtures[0];
    if (holdScheduleMutation) { const entry = track(res, url.pathname, 'schedule'); entry.payload = payload; entry.status = scheduleError ? 500 : 200; delayed.push(entry); return; }
    return reply(res, payload, scheduleError ? 500 : 200);
  }
  if (url.pathname === '/api/inbox' && req.method === 'GET') return reply(res, { items: [{ id: 'run:r-a', kind: 'approval', title: 'Abrir A', runId: 'r-a', text: 'Texto A', at: runs[0].at, owner: runs[0].owner }] });
  if (['/api/inbox', '/api/projects', '/api/schedules', '/api/social', '/api/consult/status', '/api/host/spawn/status', '/api/dictation'].includes(url.pathname) && req.method === 'GET') return reply(res, { items: [], projects: [], schedules: [], cards: [], available: false, consult: true });
  unexpected.push(`${req.method} ${url.pathname}`);
  reply(res, { error: 'Unknown fixture API route' }, 404);
});
let browser;
try {
  // Fail closed if baseURL is down: never start Vite or a real Habblaud server.
  const probe = await fetch(base, { signal: AbortSignal.timeout(3_000) });
  assert(probe.ok, `baseURL unavailable: HTTP ${probe.status}`);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5_000);
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('habblaud:locale', 'pt-BR'));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const blocked = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
    return route.continue();
  });
  const drawer = page.locator('.ui-drawer');
  const work = page.locator('.ui-drawer .ui-agent-work');
  const input = page.locator('.ui-drawer .ui-agent-work .ui-consult__input');
  const tab = name => page.locator(`.ui-drawer [data-agent-tab="${name}"]`);
  const until = async (predicate, message) => {
    const deadline = Date.now() + 5_000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert(predicate(), message);
  };
  const select = async target => {
    await page.evaluate(target => {
      const q = window.__qa;
      window.habblaud.world.select(target === 'close' ? null : { type: target === 'room' ? 'room' : 'agent', id: q[target] });
    }, target);
    if (target !== 'close') await page.locator('.ui-drawer.is-open').waitFor();
  };
  const mount = async (target = 'a', caseName = '') => {
    holdRuns = holdMessages = holdAEvents = noActiveA = rawTimes = historical = orphan = false;
    holdCards.clear();
    holdSessions = holdRunA = oldHistory = holdScheduleMutation = scheduleError = false;
    fixtureSchedules = caseName.startsWith('schedule-');
    holdOldRun = finishedRuns = false; association = ''; liveEntries.length = 0;
    for (const res of streams) res.destroy();
    delayed.length = 0;
    await page.goto(`${origin}/?mock=1&seed=12&sessions=6`);
    await page.bringToFront();
    await page.waitForFunction(() => window.habblaud?.store.snapshot?.agents.filter(a => a.kind === 'main').length >= 3);
    await page.evaluate(() => {
      const { store } = window.habblaud;
      store.disconnect();
      const agents = store.snapshot.agents.filter(a => a.kind === 'main');
      for (const [i, a] of agents.slice(0, 2).entries()) {
        Object.assign(a, { cardId: i ? 'cb' : 'ca', driverSession: i ? 'sb' : 'sa', name: i ? 'Agente B' : 'Agente A', status: 'idle' });
      }
      delete agents[2].cardId;
      delete agents[2].driverSession;
      agents[2].name = 'Sessão externa';
      const sleeping = { ...agents[0], id: 'card:cs', cardId: 'cs', name: 'Agente S', status: 'sleeping', sessionId: '', driverSession: undefined, activity: undefined, recent: [], tasks: [], title: '', canMessage: false };
      store.snapshot.agents.push(sleeping);
      window.__qa = { sleeping: sleeping.id, a: agents[0].id, b: agents[1].id, room: agents[0].roomId, external: agents[2].id };
      // Mock store normally returns []; retain production consumer/filter/render.
      store.runs = async (signal) => (await (await fetch('/api/runs', { signal })).json()).runs;
      store.pushReplay(store.snapshot);
    });
    if (target) await select(target);
  };
  const assertB = async () => {
    await page.waitForFunction(() => {
      const el = document.querySelector('.ui-drawer .ui-agent-work');
      return el?.dataset.runId === 'r-b' && el.innerText.includes('Texto B');
    });
    assert.equal(await work.isVisible(), true);
    const text = await work.innerText();
    assert(text.includes('Pedido B'), 'B restores its own request');
    assert(!/Pedido A|Texto A|r-a|TARDIO/.test(text), 'late A cannot contaminate B');
    assert.equal(await input.isEnabled(), true, 'B input remains editable');
  };
  const assertTabs = async () => {
    const tabs = drawer.locator('.ui-agent-tabs [data-agent-tab]');
    await page.waitForTimeout(100);
    assert.equal(await tabs.count(), 3, 'AgentView must expose three integrated tabs (work/history/config)');
    assert.deepEqual(await tabs.evaluateAll(els => els.map(e => e.dataset.agentTab)), ['work', 'history', 'config']);
    assert.deepEqual(await tabs.allTextContents(), ['Trabalho', 'Histórico', 'Configuração']);
    assert.deepEqual(await tabs.evaluateAll(els => els.map(e => e.getAttribute('role'))), ['tab', 'tab', 'tab']);
    assert.equal(await tab('work').getAttribute('aria-selected'), 'true', 'Work is selected on agent selection');
    assert.equal(await drawer.locator('[role="tabpanel"]').count(), 3);
  };
  for (const name of scenario === 'all' ? scenarios : [scenario]) {
    await mount(['switch-get', 'close-get', 'pending', 'delayed-sse', 'api-times', 'record-isolation', 'orphan', 'config-get', 'config-late-get', 'history-completed', 'automatic-read-send', 'automatic-discovery-send', 'history-owner-kind', 'history-canonical', 'history-ambiguous', 'release-same-id', 'rebind-same-id', 'rebind-late-get', 'rebind-a-b-a', 'adopt-same-id', 'rebind-destination'].includes(name) ? null : 'a', name);
    if (name === 'tabs') await assertTabs();
    if (name === 'tab-style') {
      const selected = await tab('work').evaluate(el => getComputedStyle(el).backgroundColor);
      const other = await tab('history').evaluate(el => getComputedStyle(el).backgroundColor);
      assert.notEqual(selected, other, 'selected tab has a visible state');
    }
    if (name === 'record-isolation') {
      historical = true;
      await page.evaluate(() => {
        const a = window.habblaud.store.agent(window.__qa.a);
        a.title = 'TÍTULO OUTRA SESSÃO';
        a.activity = { ...a.activity, text: 'ATIVIDADE OUTRA SESSÃO', at: Date.now() };
      });
      await select('a');
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Resposta histórica'));
      const visible = await drawer.innerText();
      assert(!visible.includes('ATIVIDADE OUTRA SESSÃO'), 'historical run cannot borrow current session activity');
      assert(!visible.includes('TÍTULO OUTRA SESSÃO'), 'historical run cannot borrow current session title');
    }
    if (name === 'release-same-id' || name === 'rebind-same-id' || name === 'rebind-late-get' || name === 'rebind-a-b-a' || name === 'adopt-same-id' || name === 'rebind-destination') {
      finishedRuns = name !== 'release-same-id';
      holdRunA = name === 'rebind-late-get';
      noActiveA = name === 'rebind-a-b-a';
      holdMessages = name === 'rebind-a-b-a';
      const target = name === 'adopt-same-id' ? 'external' : 'a';
      await select(target);
      if (holdRunA) await until(() => delayed.some(e => e.kind === 'run'), 'old card GET is suspended');
      else if (!noActiveA && target === 'a') await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Pedido A'));
      if (target === 'a') await input.fill('RASCUNHO DA FICHA A');
      if (name === 'rebind-a-b-a') {
        await input.press('Control+Enter');
        await until(() => delayed.some(e => e.kind === 'messages'), 'old card creation/send is pending');
      }
      const old = delayed.slice();
      holdRunA = false;
      const change = async cardId => page.evaluate(({ target, cardId }) => {
        const { store } = window.habblaud;
        const a = store.agent(window.__qa[target]);
        if (cardId === null) { delete a.cardId; a.name = 'Sessão externa do mesmo ID'; }
        else { a.cardId = cardId; a.name = `Ficha ${cardId.toUpperCase()} do mesmo ID`; }
        a.activity = { ...a.activity, text: 'ATIVIDADE EXTERNA DO MESMO ID', at: Date.now() };
        if (cardId === 'cb') { const b = store.agent(window.__qa.b); delete b.cardId; delete b.driverSession; }
        store.pushReplay(store.snapshot); // Notify/render with the same mutable AgentInfo.id; no new selection/open.
      }, { target, cardId });
      await change(name === 'release-same-id' ? null : 'cb');
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.habblaud.world.getSelection().id), await page.evaluate(target => window.__qa[target], target), 'session identity is unchanged');
      if (name === 'release-same-id') {
        assert((await drawer.innerText()).includes('ATIVIDADE EXTERNA DO MESMO ID'), 'release restores visible readonly activity');
        const editable = await drawer.locator('textarea').evaluateAll(els => els.filter(e => !e.disabled && !e.readOnly && !e.closest('[hidden], [inert]') && e.getBoundingClientRect().height > 0).length);
        assert.equal(editable, 0, 'release removes the old card composer');
        await until(() => closed.some(e => e.path === '/api/runs/r-a/events'), 'release aborts local observation without stopping run');
      } else {
        await input.waitFor();
        if (name !== 'rebind-destination') assert.equal(await input.inputValue(), '', 'a different card on the same session clears the old draft');
        if (name === 'rebind-late-get') old.forEach(release);
        if (name === 'rebind-a-b-a') {
          await input.fill('RASCUNHO DA FICHA B');
          await change('ca');
          await page.waitForTimeout(200);
          await input.fill('NOVO RASCUNHO A');
          old.forEach(release);
          await page.waitForTimeout(200);
          assert.equal(await input.inputValue(), 'NOVO RASCUNHO A', 'old A cannot control fresh A after A→B→A');
          assert(!(await work.innerText()).includes('TARDIO'));
        } else {
          await input.fill('PEDIDO PARA A FICHA B');
          await input.press('Control+Enter');
          await until(() => calls.some(c => c.method === 'POST' && c.body?.text === 'PEDIDO PARA A FICHA B'), 'new card receives its own request');
          const sent = calls.findLast(c => c.method === 'POST' && c.body?.text === 'PEDIDO PARA A FICHA B');
          assert.equal(sent.path, '/api/cards/cb/messages', 'same session reassociation must rebind the exact message destination');
          await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('PEDIDO PARA A FICHA B'));
          assert(!(await work.innerText()).includes('Pedido A'), 'old card request does not remain in new card view');
        }
      }
    }
    if (name === 'automatic-read-send' || name === 'automatic-discovery-send') {
      noActiveA = true; oldHistory = true;
      holdOldRun = name === 'automatic-read-send';
      holdRuns = name === 'automatic-discovery-send';
      await select('a');
      await until(() => delayed.some(e => e.kind === (holdOldRun ? 'old-run' : 'runs')), 'automatic observation is pending before new send');
      const old = delayed.slice();
      await input.fill('NOVO PEDIDO DA FIXTURE');
      await input.press('Control+Enter');
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Texto A'));
      const fresh = liveEntries.findLast(e => e.kind === 'messages' && e.path === '/api/cards/ca/messages' && !e.closed);
      assert(fresh, 'new request has its own response stream');
      if (name === 'automatic-discovery-send') { frame(fresh.res, { type: 'delta', text: ' CAUDA NOVA' }); frame(fresh.res, { type: 'done' }); fresh.res.end(); }
      old.forEach(release);
      await page.waitForTimeout(150);
      if (name === 'automatic-read-send') frame(fresh.res, { type: 'delta', text: ' CAUDA NOVA' });
      await page.waitForTimeout(200);
      const text = await work.innerText();
      assert(text.includes('NOVO PEDIDO DA FIXTURE'), 'automatic old read cannot overwrite new request');
      assert(text.includes('Texto A') && text.includes('CAUDA NOVA'), 'new answer remains associated with new request');
      assert(!/PEDIDO ANTIGO|RESPOSTA ANTIGA/.test(text), 'old response never mixes with new stream');
      assert.equal(await work.getAttribute('data-run-id'), 'r-a');
    }
    if (name === 'history-owner-kind' || name === 'history-canonical' || name === 'history-ambiguous') {
      association = name;
      await page.evaluate(name => {
        const { store } = window.habblaud;
        const a = store.agent(window.__qa.a);
        a.sessionId = name === 'history-ambiguous' ? 'sa' : 'mirror';
        a.driverSession = 'sa';
        if (name === 'history-ambiguous') store.agent(window.__qa.b).driverSession = 'sa';
      }, name);
      await select('a');
      await tab('history').click();
      await page.waitForTimeout(250);
      const item = drawer.locator('.ui-run').filter({ hasText: `HISTÓRICO ${name}` });
      assert.equal(await item.count(), name === 'history-canonical' ? 1 : 0, 'history and router must agree on literal, canonical, unambiguous ownership');
    }
    if (name === 'sidebar-get' || name === 'sidebar-late-run') {
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Texto A'));
      holdRunA = true;
      await page.evaluate(() => { window.habblaud.store.mock = false; });
      await page.locator('.ui-btn-inbox').waitFor({ state: 'visible', timeout: 8000 });
      await page.locator('.ui-btn-inbox').click();
      await page.locator('#ui-inbox button').filter({ hasText: /^Abrir conversa$/ }).click();
      await until(() => delayed.some(e => e.kind === 'run'), 'Drawer openRun GET is pending');
      const old = delayed.filter(e => e.kind === 'run');
      const bid = await page.evaluate(() => window.__qa.b);
      await page.locator(`#ui-sidebar .ui-agent[data-id="${bid}"]`).click();
      await assertB();
      if (name === 'sidebar-get') await until(() => old.every(e => e.closed), 'sidebar selection aborts previous Drawer run GET');
      old.forEach(release);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.habblaud.world.getSelection()?.id), bid, 'late run A cannot undo sidebar selection B');
      await assertB();
    }
    if (name === 'history-completed') {
      oldHistory = true;
      await select('a');
      await tab('history').click();
      await drawer.locator('.ui-run').filter({ hasText: 'PEDIDO ANTIGO CONCLUÍDO' }).locator('.ui-run-open').click();
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('RESPOSTA ANTIGA CONCLUÍDA'));
      await input.fill('Rascunho do registro antigo');
      await tab('config').click();
      await tab('work').click();
      await page.waitForTimeout(250);
      assert.equal(await work.getAttribute('data-run-id'), 'r-old', 'tabs retain explicitly selected completed run, not preferred current run');
      const text = await work.innerText();
      assert(text.includes('PEDIDO ANTIGO CONCLUÍDO') && text.includes('RESPOSTA ANTIGA CONCLUÍDA'));
      assert(!/Pedido A|Texto A/.test(text), 'current run cannot replace historical request/answer');
      assert.equal(await input.inputValue(), 'Rascunho do registro antigo');
      assert.equal(await drawer.getByRole('button', { name: 'Parar', exact: true }).count(), 0, 'completed record offers no active-run Stop');
      assert.equal(calls.filter(c => c.path === '/api/runs/r-old/events').length, 0, 'completed record never subscribes as active');
    }
    if (name.startsWith('schedule-')) {
      await tab('config').click();
      await drawer.locator('.ui-sched__item').filter({ hasText: 'Agenda A' }).waitFor();
      const draft = drawer.locator('.ui-sched__form textarea');
      holdScheduleMutation = true;
      scheduleError = name === 'schedule-error';
      if (name === 'schedule-act') {
        await drawer.locator('.ui-sched__item').filter({ hasText: 'Agenda A' }).getByRole('button', { name: 'Rodar agora', exact: true }).click();
      } else {
        await drawer.locator('.ui-sched__new summary').click();
        await draft.fill('Pedido agendado A');
        await drawer.locator('.ui-sched__form').getByRole('button', { name: 'Agendar', exact: true }).click();
      }
      await until(() => delayed.some(e => e.kind === 'schedule'), 'schedule mutation A is pending');
      const old = delayed.filter(e => e.kind === 'schedule');
      await select('b');
      await tab('config').click();
      await drawer.locator('.ui-sched__item').filter({ hasText: 'Agenda B' }).waitFor();
      await drawer.locator('.ui-sched__new').evaluate(el => { el.open = true; });
      await draft.fill('Rascunho de agenda B');
      const before = calls.filter(c => c.method === 'GET' && c.path === '/api/schedules').length;
      old.forEach(release);
      await page.waitForTimeout(250);
      assert.equal(await draft.inputValue(), 'Rascunho de agenda B', 'late schedule A cannot erase B draft');
      assert.equal(await drawer.locator('.ui-sched [role="status"]').innerText(), '', 'late schedule A success/error cannot be displayed as B status');
      assert.equal(calls.filter(c => c.method === 'GET' && c.path === '/api/schedules').length, before, 'late schedule A cannot trigger reload of B');
      assert.equal(await drawer.locator('.ui-sched__item').filter({ hasText: 'Agenda B' }).count(), 1);
    }
    if (name === 'config-get' || name === 'config-late-get') {
      holdCards.add('ca'); holdCards.add('cb');
      await select('a');
      await tab('config').click();
      await until(() => delayed.some(e => e.kind === 'card' && e.path.endsWith('/ca')), 'A card GET reached held fixture');
      const oldA = delayed.filter(e => e.kind === 'card' && e.path.endsWith('/ca'));
      await select('b');
      await tab('config').click();
      await until(() => delayed.some(e => e.kind === 'card' && e.path.endsWith('/cb')), 'B card GET reached held fixture');
      const fields = drawer.locator('.ui-card__field input');
      const save = drawer.locator('.ui-card:has(.ui-card__field)').getByRole('button', { name: 'Salvar', exact: true, includeHidden: true });
      if (name === 'config-get') {
        assert.equal(await save.isDisabled(), true, 'cannot save an unloaded card with previous fields');
        assert.notEqual(await fields.nth(0).inputValue(), 'Agente A', 'B never exposes A fields while loading');
      }
      holdCards.delete('cb');
      delayed.filter(e => e.kind === 'card' && e.path.endsWith('/cb')).forEach(release);
      await page.waitForFunction(() => document.querySelector('.ui-drawer .ui-card__field input')?.value === 'Agente B');
      oldA.forEach(release);
      await page.waitForTimeout(250);
      assert.equal(await fields.nth(0).inputValue(), 'Agente B', 'late A GET cannot overwrite B name');
      assert.equal(await drawer.locator('.ui-card__field textarea').inputValue(), 'Instruções B', 'late A GET cannot overwrite B instructions');
      await save.click();
      await until(() => calls.some(c => c.method === 'PATCH' && c.path === '/api/cards/cb'), 'Save targets B');
      const saved = calls.findLast(c => c.method === 'PATCH' && c.path === '/api/cards/cb');
      assert.equal(saved.body.name, 'Agente B');
      assert.equal(saved.body.instructions, 'Instruções B');
      const stored = await (await fetch(`${origin}/api/cards/cb`)).json();
      assert.equal(stored.name, 'Agente B', 'fixture write read-back retains B data');
    }
    if (name === 'config-new-session') {
      await tab('config').click();
      await page.waitForFunction(() => document.querySelector('.ui-drawer .ui-card__field input')?.value === 'Agente A');
      holdSessions = true;
      await drawer.getByRole('button', { name: 'Nova conversa', exact: true }).click();
      await until(() => delayed.some(e => e.kind === 'session'), 'A new session POST reached held fixture');
      const old = delayed.filter(e => e.kind === 'session');
      await select('b');
      await tab('config').click();
      await page.waitForFunction(() => document.querySelector('.ui-drawer .ui-card__field input')?.value === 'Agente B');
      old.forEach(release);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.habblaud.world.getSelection()?.id), await page.evaluate(() => window.__qa.b), 'late A session creation must not navigate away from B');
      assert.equal(await tab('config').getAttribute('aria-selected'), 'true', 'late A continuation must not switch B tab');
      assert.equal(await drawer.locator('.ui-card__field input').first().inputValue(), 'Agente B');
    }
    if (name === 'same-target-get') {
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Texto A'));
      await input.fill('Rascunho A mantido');
      await tab('config').click();
      holdRunA = true;
      const before = calls.filter(c => c.path === '/api/runs/r-a').length;
      await drawer.locator('.ui-card-btn--chat').click();
      await until(() => delayed.some(e => e.kind === 'run'), 'resume GET is pending');
      await page.waitForTimeout(250);
      assert.equal(calls.filter(c => c.path === '/api/runs/r-a').length - before, 1, 'same-target explicit show must not restart pending GET');
      delayed.filter(e => e.kind === 'run').forEach(release);
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Texto A'));
      assert.equal(await input.inputValue(), 'Rascunho A mantido');
      assert(!(await work.innerText()).includes('o Habblaud não respondeu'));
      assert.equal(await drawer.locator('.ui-consult__turn--assistant').count(), 1, 'resume has one assistant response');
    }
    if (name === 'external-after-run') {
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Texto A'));
      await page.evaluate(() => {
        const a = window.habblaud.store.agent(window.__qa.external);
        a.title = 'TÍTULO EXTERNO FIXTURE';
        a.activity = { ...a.activity, icon: 'tool', text: 'ATIVIDADE EXTERNA FIXTURE', at: Date.now() };
        a.recent = [a.activity];
      });
      await select('external');
      await page.waitForTimeout(150);
      const visible = await drawer.innerText();
      assert(visible.includes('TÍTULO EXTERNO FIXTURE'), 'external session restores current header after run');
      assert(visible.includes('ATIVIDADE EXTERNA FIXTURE'), 'external session restores readonly current activity after run');
      assert.equal(await work.getAttribute('data-run-id'), null, 'external session clears previous run association');
      assert(!/Pedido A|Texto A/.test(visible), 'external session never retains old run metadata');
      const editable = await drawer.locator('textarea').evaluateAll(els => els.filter(e => !e.disabled && !e.readOnly && !e.closest('[hidden], [inert]') && e.getBoundingClientRect().height > 0).length);
      assert.equal(editable, 0, 'external session remains readonly');
    }
    if (name === 'routing') {
      await assertTabs();
      await input.fill('Rascunho sem envio');
      await tab('history').click();
      await tab('work').click();
      assert.equal(await input.inputValue(), 'Rascunho sem envio', 'same-target history/work preserves draft');
      await tab('config').click();
      assert.equal(await drawer.locator('.ui-agent-tabpanel--config .ui-char').count(), 1, 'character editor belongs to Configuration');
      await drawer.locator('.ui-card-btn--chat').click();
      assert.equal(await tab('work').getAttribute('aria-selected'), 'true', 'Config Chat routes to Work');
      assert.equal(await input.inputValue(), 'Rascunho sem envio', 'same-target Config Chat preserves draft');
      const embedded = drawer.locator('.ui-consult--embedded');
      assert.equal(await embedded.count(), 1);
      assert.equal(await embedded.isVisible(), true);
      assert.equal(await embedded.getAttribute('popover'), null);
      assert.equal(await embedded.evaluate(e => e.classList.contains('ui-popover')), false);
      const advisor = page.locator('#ui-consult');
      assert.equal(await advisor.count(), 1, 'Advisor remains a separate production component');
      assert.equal(await advisor.evaluate(e => !!e.closest('.ui-drawer')), false);
      assert.notEqual(await input.getAttribute('id'), 'ui-consult-input');
      assert.equal(await advisor.getAttribute('popover'), 'manual');
    }
    if (name === 'history' || name === 'api-times') {
      if (name === 'api-times') { rawTimes = true; await select('a'); }
      await tab('history').click();
      const item = drawer.locator('.ui-run').filter({ hasText: 'Pedido A' });
      await item.waitFor();
      assert.equal(await drawer.locator('.ui-run').filter({ hasText: 'Pedido B' }).count(), 0, 'history filters by owner');
      const status = await item.locator('.ui-run__state').innerText();
      assert.equal(Date.parse(await item.locator('time').getAttribute('datetime')), runs[0].at, 'history displays actual run timestamp');
      await item.locator('.ui-run-open').click();
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.dataset.runId === 'r-a');
      assert.equal(await tab('work').getAttribute('aria-selected'), 'true');
      assert.equal(await work.isVisible(), true);
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Pedido A'));
      assert((await work.innerText()).includes(status), 'Work restores the historical run status');
      assert.equal(await work.getAttribute('data-run-id'), 'r-a', 'history opens the same run, not a new turn');
    }
    if (name === 'switch-get' || name === 'close-get') {
      holdRuns = true;
      await select('a');
      await until(() => delayed.some(e => e.kind === 'runs'), 'A GET /runs reached delayed fixture');
      const old = delayed.filter(e => e.kind === 'runs');
      const before = calls.filter(c => c.path === '/api/runs/r-a/events').length;
      holdRuns = false;
      await select(name === 'switch-get' ? 'b' : 'close');
      if (name === 'close-get') await until(() => old.some(e => e.closed), 'closing Drawer aborts pending GET');
      for (const entry of old) release(entry);
      await page.waitForTimeout(250);
      assert.equal(calls.filter(c => c.path === '/api/runs/r-a/events').length, before, 'late discovery cannot attach A');
      if (name === 'switch-get') await assertB();
      else assert.equal(await drawer.getAttribute('aria-hidden'), 'true');
    }
    if (name === 'pending') {
      noActiveA = true;
      holdMessages = true;
      await select('a');
      await input.fill('Pedido A pendente');
      await input.press('Control+Enter');
      await until(() => delayed.some(e => e.kind === 'messages'), 'pending card send reached fixture');
      const old = delayed.filter(e => e.kind === 'messages');
      const sent = calls.findLast(c => c.path === '/api/cards/ca/messages');
      assert.equal(sent.contentType, 'application/json');
      assert.equal(sent.body.text, 'Pedido A pendente');
      await select('b');
      for (const entry of old) release(entry);
      await page.waitForTimeout(250);
      await assertB();
    }
    if (name === 'delayed-sse') {
      holdAEvents = true;
      await select('a');
      await until(() => delayed.some(e => e.kind === 'events'), 'A SSE subscribed before delayed chunk');
      const old = delayed.filter(e => e.kind === 'events');
      await select('b');
      for (const entry of old) release(entry);
      await until(() => old.every(e => e.closed), 'switch cancels A SSE observation');
      await page.waitForTimeout(250);
      await assertB();
    }
    if (name === 'close-sse') {
      await until(() => calls.some(c => c.path === '/api/runs/r-a/events'), 'A SSE subscribed');
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.innerText.includes('Texto A'));
      const before = closed.filter(e => e.path === '/api/runs/r-a/events').length;
      await drawer.locator('.ui-drawer__bar button[aria-label="Fechar detalhes (Esc)"]').click();
      await until(() => closed.filter(e => e.path === '/api/runs/r-a/events').length > before, 'Drawer close aborts SSE');
      assert.equal(await drawer.getAttribute('aria-hidden'), 'true');
    }
    if (name === 'sleeping' || name === 'no-run') {
      const before = calls.filter(c => c.method === 'POST').length;
      if (name === 'sleeping') await select('sleeping');
      else { noActiveA = true; await select('close'); await select('a'); }
      await input.waitFor();
      await page.waitForTimeout(250);
      assert.equal(await tab('work').getAttribute('aria-selected'), 'true');
      assert.equal(await input.isEnabled(), true, 'card without run opens composer');
      assert.equal(await work.getAttribute('data-run-id'), null, 'never manufactures a run');
      assert.equal(calls.filter(c => c.method === 'POST').length, before, 'opening card never executes automatically');
    }
    if (name === 'inbox' || name === 'orphan') {
      if (name === 'orphan') orphan = true;
      await select('b');
      await page.evaluate(() => { window.habblaud.store.mock = false; });
      const inbox = page.locator('.ui-btn-inbox');
      await inbox.waitFor({ state: 'visible', timeout: 8000 });
      await inbox.click();
      await page.locator('#ui-inbox button').filter({ hasText: /^Abrir conversa$/ }).click();
      await page.waitForFunction(() => document.querySelector('.ui-agent-work')?.dataset.runId === 'r-a');
      if (name === 'inbox') assert.equal(await tab('work').getAttribute('aria-selected'), 'true');
      else assert.equal(await page.evaluate(() => window.habblaud.world.getSelection()), null, 'unlinked run never invents an agent association');
      assert((await work.innerText()).includes('Pedido A'));
      assert(!(await work.innerText()).includes('Pedido B'));
      assert.equal(await page.locator('#ui-consult').evaluate(el => el.matches(':popover-open')), false, 'Inbox routes to Drawer, never Advisor');
      assert.equal(calls.filter(c => c.method === 'POST' && c.path.startsWith('/api/inbox/')).length, 0, 'opening an approval never resolves it');
      if (name === 'orphan') {
        await drawer.locator('.ui-drawer__bar button[aria-label="Fechar detalhes (Esc)"]').click();
        assert.equal(await drawer.getAttribute('aria-hidden'), 'true');
        assert.equal(await page.locator('.ui-root').evaluate(el => el.classList.contains('has-drawer')), false);
      }
    }
    if (name === 'external-room') {
      await select('external');
      const editable = await drawer.locator('textarea').evaluateAll(els => els.filter(e => !e.disabled && !e.readOnly && !e.closest('[hidden], [inert]') && e.getBoundingClientRect().height > 0).length);
      assert.equal(editable, 0, 'external session without card has no editable textarea');
      await select('room');
      assert.equal(await drawer.locator('.ui-room-view').isVisible(), true, 'room retains production RoomView');
      assert.equal(await drawer.locator('.ui-agent-tabs').count(), 0, 'room is not routed as an agent');
      assert.equal(await drawer.locator('.ui-consult--embedded').count(), 0);
    }
    assert.equal(calls.filter(c => c.path.endsWith('/stop')).length, 0, 'closing/switching views never stops executor');
    assert.deepEqual(errors, [], 'production app has no unhandled page errors');
    completed.push(name);
  }
  assert.deepEqual(blocked, [], 'app must not reach any other origin');
  assert.deepEqual(unexpected.filter(c => !c.startsWith('GET ')), [], 'no unplanned fixture mutation');
  console.log(JSON.stringify({ passed: true, scenario, completed, stopRequests: calls.filter(c => c.path.endsWith('/stop')).length, closedSubscriptions: closed.length, unexpected }, null, 2));
} catch (error) {
  console.error(`QA FAIL [${scenario}]: ${error.stack}`);
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) console.error(JSON.stringify(await failedPage.evaluate(() => [...document.querySelectorAll('.ui-card__field input')].map(el => ({ value: el.value, inDrawer: !!el.closest('.ui-drawer'), visible: el.getBoundingClientRect().height > 0, hiddenParent: !!el.closest('[hidden]') }))), null, 2));
  console.error(JSON.stringify({ pageErrors: errors, calls, unexpected }, null, 2));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    for (const res of streams) res.destroy();
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
}
