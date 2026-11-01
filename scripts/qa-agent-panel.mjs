// QA isolada do componente embutido; fixture HTTP/SSE própria, nunca executor real.
// node scripts/qa-agent-panel.mjs http://127.0.0.1:4751 [embedded|close|abort|all]
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://127.0.0.1:4751';
const scenario = process.argv[3] ?? 'all';
assert(['embedded', 'close', 'abort', 'pending', 'delayed', 'http-error', 'sse-race', 'all'].includes(scenario), `Unknown scenario: ${scenario}`);
const bundled = await build({ entryPoints: ['client/src/ui/consult.ts'], bundle: true, format: 'esm', platform: 'browser', write: false });
const calls = [], streams = new Set(), closed = [];
let deferredList, deferRuns = false, deferredCreation, deferCreation = false;
let partialError = false, errorStarted = false;
const frame = (res, data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    // Só assets/HTML vêm da página-base; toda API pertence exclusivamente à fixture.
    const target = new URL(req.url, base);
    if (req.method !== 'GET' || target.origin !== new URL(base).origin) { res.writeHead(405); return res.end(); }
    try {
      const upstream = await fetch(target, { redirect: 'error' });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream' });
      return res.end(body);
    } catch {
      res.writeHead(502); return res.end('QA static asset unavailable');
    }
  }
  calls.push({ method: req.method, path: url.pathname, contentType: req.headers['content-type'] });
  if (url.pathname === '/api/qa/consult.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(bundled.outputFiles[0].text);
  }
  if (url.pathname.endsWith('/events') || url.pathname.endsWith('/messages')) {
    if (partialError && req.method === 'GET') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.write('{"error":');
      streams.add(res);
      res.on('close', () => { streams.delete(res); closed.push(url.pathname); });
      errorStarted = true;
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    streams.add(res);
    if (req.method === 'POST') frame(res, { type: 'run', runId: 'r-send' });
    frame(res, { type: 'delta', text: url.pathname.includes('r-race') ? 'MARCADOR TARDIO' : '# Resposta parcial\n\nO trabalho continua no executor.' });
    const timer = setInterval(() => res.write(': keepalive\n\n'), 100);
    res.on('close', () => { clearInterval(timer); streams.delete(res); closed.push(url.pathname); });
    return;
  }
  if (url.pathname === '/api/runs' && deferRuns) { deferredList = res; return; }
  if (url.pathname === '/api/consult' && req.method === 'POST' && deferCreation) { deferredCreation = res; return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(url.pathname === '/api/runs' ? { runs: [] } : { agents: true, consult: true, available: true, items: [], projects: [], cards: [] }));
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('habblaud:locale', 'pt-BR'));
const mount = async (embedded = true) => {
  await page.goto(`http://127.0.0.1:${server.address().port}/?mock=1`);
  await page.bringToFront();
  await page.waitForFunction(() => window.habblaud?.store.snapshot?.agents.length > 0);
  await page.evaluate(() => {
    const agent = window.habblaud.store.snapshot.agents.find(a => a.kind === 'main');
    window.habblaud.world.select({ type: 'agent', id: agent.id });
  });
  await page.waitForTimeout(500);
  await page.evaluate(async (embedded) => {
    const { ConsultPanel } = await import('/api/qa/consult.js');
    const root = document.querySelector('.ui-root');
    const ctx = { root, store: window.habblaud.store, world: window.habblaud.world,
      selection: () => null, agent: () => undefined, announce: () => {} };
    window.__panel = new ConsultPanel(ctx, { embedded });
    const host = document.createElement('section');
    host.id = 'qa-work';
    host.dataset.tab = 'work';
    document.querySelector('.ui-drawer__body').replaceChildren(host);
    host.append(window.__panel.el);
    window.__panel.openCard({ id: 'c1', name: 'Agente de teste', fresh: true });
  }, embedded);
};
const waitClosed = async (previous) => {
  for (let i = 0; i < 30 && closed.length === previous; i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert(closed.length > previous, 'closing the view aborts its SSE subscription');
};
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  if (scenario === 'embedded' || scenario === 'all') {
    await mount();
    const actual = await page.evaluate(() => ({ popover: window.__panel.el.hasAttribute('popover'),
      floating: window.__panel.el.classList.contains('ui-popover'), role: window.__panel.el.getAttribute('role'),
      open: window.__panel.isOpen, visible: window.__panel.el.getBoundingClientRect().height > 0,
      inWork: !!window.__panel.el.closest('#qa-work') }));
    assert.equal(actual.popover, false, 'embeddedHasNoPopover');
    assert.equal(actual.floating, false);
    assert.equal(actual.role, 'region');
    assert.equal(actual.open, true);
    assert.equal(actual.visible, true);
    assert.equal(actual.inWork, true);
    const id = await page.locator('#qa-work .ui-consult__input').getAttribute('id');
    assert.notEqual(id, 'ui-consult-input', 'embedded input does not duplicate Advisor ID');
    await page.evaluate(() => window.__panel.toggle());
    assert.equal(await page.evaluate(() => window.__panel.isOpen), false);
    await page.evaluate(() => window.__panel.toggle());
    assert.equal(await page.evaluate(() => window.__panel.isOpen), true);
    await mount(false);
    assert.equal(await page.evaluate(() => window.__panel.el.hasAttribute('popover') && window.__panel.el.matches(':popover-open')), true, 'Advisor keeps native popover');
  }
  if (scenario === 'close' || scenario === 'all') {
    await mount();
    await page.evaluate(() => window.__panel.openRun('r1', { kind: 'card', id: 'c1', title: 'Agente de teste' }));
    await page.locator('#qa-work .ui-consult__turn--assistant .ui-md__h').waitFor();
    const previous = closed.length;
    await page.locator('#qa-work button[aria-label="Fechar"]').click();
    await waitClosed(previous);
    assert.equal(await page.evaluate(() => window.__panel.isOpen), false);
    assert.equal(calls.filter(c => c.path.endsWith('/stop')).length, 0, 'closeDoesNotStopRun');
    await page.evaluate(() => window.__panel.toggle());
    for (let i = 0; i < 30 && streams.size === 0; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(streams.size, 1, 'reopening resumes observation of the same run');
    const beforeDispose = closed.length;
    await page.evaluate(() => { window.__panel.disposeView(); window.__panel.disposeView(); });
    await waitClosed(beforeDispose);
    assert.equal(await page.locator('#qa-work .ui-consult__turn--assistant').count(), 1, 'replay does not duplicate partial answer');
  }
  if (scenario === 'abort' || scenario === 'all') {
    await mount();
    await page.evaluate(() => window.__panel.openRun('r-abort', { kind: 'card', id: 'c1' }));
    await page.locator('#qa-work .ui-consult__turn--assistant .ui-md__h').waitFor();
    const previous = closed.length;
    await page.locator('#qa-work .ui-consult__input').focus();
    await page.keyboard.press('Escape');
    await waitClosed(previous);
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#qa-work .ui-consult__status').textContent(), '', 'abortedViewIsNotRunError');
    assert.equal(await page.locator('#qa-work .ui-consult__status').evaluate(el => el.classList.contains('is-error')), false);
    assert.equal(calls.filter(c => c.path.endsWith('/stop')).length, 0);
    await page.evaluate(() => window.__panel.openCard({ id: 'c1', name: 'Agente de teste', fresh: true }));
    await page.locator('#qa-work .ui-consult__input').fill('Pedido da fixture');
    await page.locator('#qa-work .ui-consult__input').press('Control+Enter');
    await page.locator('#qa-work .ui-consult__turn--assistant .ui-md__h').waitFor();
    const sent = calls.find(c => c.method === 'POST' && c.path === '/api/cards/c1/messages');
    assert.equal(sent?.contentType, 'application/json');
    const beforeDispose = closed.length;
    await page.evaluate(() => window.__panel.disposeView());
    await waitClosed(beforeDispose);
    assert.equal(calls.filter(c => c.path.endsWith('/stop')).length, 0);
    assert.equal(await page.locator('#qa-work .ui-consult__status').textContent(), '');
  }
  if (scenario === 'sse-race' || scenario === 'all') {
    await mount();
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (!String(args[0]).includes('/r-race/events')) return response;
        const pipe = response.body.pipeThrough.bind(response.body);
        response.body.pipeThrough = (...pipeArgs) => {
          const decoded = pipe(...pipeArgs);
          const getReader = decoded.getReader.bind(decoded);
          decoded.getReader = (...readerArgs) => {
            const reader = getReader(...readerArgs);
            const read = reader.read.bind(reader);
            let injected = false;
            reader.read = async () => {
              const chunk = await read();
              // Falha injetada entre entrega do chunk real e continuação do consumidor.
              if (!injected && !chunk.done) {
                injected = true;
                window.__panel.hide();
                window.__panel.openRun('r-new', { kind: 'card', id: 'c1' });
              }
              return chunk;
            };
            return reader;
          };
          return decoded;
        };
        return response;
      };
      window.__panel.openRun('r-race', { kind: 'card', id: 'c1' });
    });
    await page.waitForFunction(() => document.querySelector('#qa-work .ui-consult__log').textContent.includes('Resposta parcial'));
    assert.equal((await page.locator('#qa-work .ui-consult__log').textContent()).includes('MARCADOR TARDIO'), false, 'delivered SSE chunk cannot contaminate reopened view');
    assert.equal(calls.filter(c => c.path.endsWith('/stop')).length, 0);
  }
  if (scenario === 'http-error' || scenario === 'all') {
    for (const reopen of [false, true]) {
      await mount();
      partialError = true;
      errorStarted = false;
      await page.evaluate(() => window.__panel.openRun('r-error', { kind: 'card', id: 'c1' }));
      for (let i = 0; i < 30 && !errorStarted; i++) await new Promise(resolve => setTimeout(resolve, 50));
      assert(errorStarted);
      await page.waitForTimeout(150);
      const previous = closed.length;
      partialError = false;
      await page.evaluate((reopen) => {
        window.__panel.hide();
        if (reopen) window.__panel.openRun('r-error', { kind: 'card', id: 'c1' });
      }, reopen);
      await waitClosed(previous);
      if (reopen) await page.locator('#qa-work .ui-consult__turn--assistant .ui-md__h').waitFor();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#qa-work .ui-consult__status').textContent(), '', 'abort during HTTP error body does not contaminate discarded or reopened view');
      assert.equal(calls.filter(c => c.path.endsWith('/stop')).length, 0);
    }
  }
  if (scenario === 'pending' || scenario === 'all') {
    await mount();
    await page.locator('#qa-work button').filter({ hasText: /^Nova consulta$/ }).click();
    deferCreation = true;
    await page.locator('#qa-work .ui-consult__input').fill('Pedido antes de fechar');
    await page.locator('#qa-work .ui-consult__input').press('Control+Enter');
    for (let i = 0; i < 30 && !deferredCreation; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert(deferredCreation);
    await page.evaluate(() => window.__panel.hide());
    const before = calls.filter(c => c.path.endsWith('/messages')).length;
    deferredCreation.writeHead(200, { 'Content-Type': 'application/json' });
    deferredCreation.end(JSON.stringify({ id: 'c-pending' }));
    await page.waitForTimeout(300);
    assert.equal(calls.filter(c => c.path.endsWith('/messages')).length, before, 'closed view does not send after late session creation');
    assert.equal(await page.locator('#qa-work .ui-consult__status').textContent(), '');
    deferCreation = false;
  }
  if (scenario === 'delayed' || scenario === 'all') {
    await mount();
    deferRuns = true;
    await page.evaluate(() => window.__panel.openCard({ id: 'c1', name: 'Agente de teste' }));
    for (let i = 0; i < 30 && !deferredList; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert(deferredList, 'resume discovery reached fixture');
    await page.evaluate(() => window.__panel.hide());
    const before = calls.filter(c => c.path.endsWith('/events')).length;
    deferredList.writeHead(200, { 'Content-Type': 'application/json' });
    deferredList.end(JSON.stringify({ runs: [{ runId: 'r-late', state: 'running', owner: { kind: 'card', id: 'c1' } }] }));
    await page.waitForTimeout(300);
    assert.equal(calls.filter(c => c.path.endsWith('/events')).length, before, 'closed view ignores late discovery');
    assert.equal(await page.evaluate(() => window.__panel.isOpen), false);
    deferRuns = false;
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, scenario, stopRequests: calls.filter(c => c.path.endsWith('/stop')).length, closedSubscriptions: closed.length }, null, 2));
} finally {
  await browser.close();
  for (const res of streams) res.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
