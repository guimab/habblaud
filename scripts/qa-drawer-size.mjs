// QA isolada do tamanho do painel. Só dados de demonstração, nunca API/credenciais reais.
// node scripts/qa-drawer-size.mjs http://127.0.0.1:4751
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://127.0.0.1:4751';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
const errors = [];
const measurements = [];
await page.addInitScript(() => localStorage.setItem('habblaud:locale', 'pt-BR'));
page.on('pageerror', (e) => errors.push(e.message));
// O modo mock não precisa de API; bloquear qualquer chamada incidental, sem proxy ao servidor real.
await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], runs: [], schedules: [], cards: [], projects: [], available: false }) }));
const open = async () => {
  await page.waitForFunction(() => window.habblaud?.store.snapshot?.agents.length > 0);
  const guarded = await page.evaluate(() => {
    const agent = window.habblaud.store.snapshot.agents.find((a) => a.kind === 'main');
    window.habblaud.world.select({ type: 'agent', id: agent.id });
    return { opening: document.querySelector('.ui-drawer').classList.contains('is-opening'), right: parseFloat(getComputedStyle(document.querySelector('.ui-root')).getPropertyValue('--free-right')) };
  });
  assert.equal(guarded.opening, true, 'single canvas selection begins double-click guard');
  assert.equal(guarded.right, 0, 'drawer does not move camera between clicks');
  await page.locator('.ui-drawer.is-open').waitFor();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.ui-drawer').evaluate((el) => el.classList.contains('is-opening')), false);
};
const measure = () => page.evaluate(() => {
  const drawer = document.querySelector('.ui-drawer');
  const box = drawer.getBoundingClientRect();
  const root = document.querySelector('.ui-root');
  const css = getComputedStyle(root);
  return { width: box.width, right: box.right, top: box.top, height: box.height,
    floating: drawer.classList.contains('is-floating'),
    free: innerWidth - parseFloat(css.getPropertyValue('--free-left') || '0') - parseFloat(css.getPropertyValue('--free-right') || '0'),
    overflow: document.documentElement.scrollWidth > innerWidth,
    savedWidth: JSON.parse(localStorage.getItem('habblaud:prefs') || '{}').agentPanelWidth };
});
try {
  await page.goto(base + '/?mock=1');
  await page.bringToFront();
  await open();
  const initial = await measure();
  assert.equal(initial.width, 560, 'desktop default 560 px');
  assert.equal(initial.floating, false);
  assert(initial.free >= 320);
  measurements.push({ scenario: 'desktop', ...initial });
  const handle = page.getByRole('separator', { name: 'Redimensionar painel de detalhes' });
  await handle.waitFor();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const dragged = await measure();
  assert.equal(dragged.width, 640);
  assert.equal(dragged.right, initial.right);
  assert.equal(dragged.floating, false);
  assert.equal(dragged.savedWidth, 640);
  measurements.push({ scenario: 'pointer', ...dragged });
  // Seleção pela lista mantém intenção de foco ao redimensionar por teclado.
  await page.locator('.ui-sidebar .ui-agent:visible').first().click();
  await page.evaluate(() => {
    const world = window.habblaud.world;
    const original = world.focusAgent.bind(world);
    window.__resizeFocusCalls = 0;
    world.focusAgent = (...args) => { window.__resizeFocusCalls++; return original(...args); };
  });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  assert(await page.evaluate(() => window.__resizeFocusCalls > 0), 'keyboard resize preserves selection focus');
  assert.equal((await measure()).width, 656);
  await page.keyboard.press('ArrowRight');
  assert.equal((await measure()).width, 640);
  // Teclas que navegam a câmera cancelam o foco mesmo com o separador focado.
  for (const key of ['ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd']) {
    await page.locator('.ui-sidebar .ui-agent:visible').first().click();
    await handle.focus();
    await page.keyboard.press(key);
    await page.evaluate(() => { window.__resizeFocusCalls = 0; });
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => window.__resizeFocusCalls), 0, `${key} cancels selection focus before resize`);
    await page.keyboard.press('ArrowRight');
    assert.equal((await measure()).width, 640);
  }
  // Cancelamento restaura a largura salva, sem persistir o arraste parcial.
  await handle.evaluate((el) => el.addEventListener('pointerdown', (e) => { window.__resizePointerId = e.pointerId; }, { once: true }));
  const cancelBox = await handle.boundingBox();
  await page.mouse.move(cancelBox.x + 5, cancelBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(cancelBox.x - 35, cancelBox.y + 100);
  assert.equal((await measure()).width, 680);
  await handle.dispatchEvent('pointercancel', { pointerId: await page.evaluate(() => window.__resizePointerId) });
  await page.mouse.up();
  assert.equal((await measure()).width, 640);
  assert.equal((await measure()).savedWidth, 640);
  for (const cancellation of ['lostpointercapture', 'viewport', 'close']) {
    await handle.evaluate((el) => el.addEventListener('pointerdown', (e) => { window.__resizePointerId = e.pointerId; }, { once: true }));
    const start = await handle.boundingBox();
    await page.mouse.move(start.x + 5, start.y + 100);
    await page.mouse.down();
    await page.mouse.move(start.x - 27, start.y + 100);
    assert.equal((await measure()).width, 672);
    if (cancellation === 'lostpointercapture') {
      await handle.evaluate((el) => el.releasePointerCapture(window.__resizePointerId));
      await page.mouse.move(start.x - 28, start.y + 100);
    } else if (cancellation === 'viewport') {
      await page.setViewportSize({ width: 1280, height: 900 });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(100);
    await page.mouse.up();
    assert.equal((await measure()).savedWidth, 640, `${cancellation} does not commit draft width`);
    if (cancellation === 'viewport') {
      assert.equal((await measure()).width, 620);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(100);
    }
    assert.equal((await measure()).width, 640);
    if (cancellation === 'close') {
      assert.equal(await page.locator('.ui-drawer').getAttribute('aria-hidden'), 'true');
      await open();
    }
  }
  // Um segundo toque não rouba o pointer ativo. Eventos de toque reais via CDP.
  const touchBox = await handle.boundingBox();
  const touch = await page.context().newCDPSession(page);
  const point = (id, x, y) => ({ id, x, y });
  const tx = touchBox.x + 5, ty = touchBox.y + 100;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, tx, ty)] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, tx - 32, ty)] });
  assert.equal((await measure()).width, 672);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, tx - 32, ty), point(2, tx - 32, ty + 30)] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, tx - 64, ty), point(2, tx - 32, ty + 30)] });
  await page.waitForTimeout(100); // CDP entrega touchMove no próximo frame composto.
  assert.equal((await measure()).width, 704, 'second touch does not replace active resize');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  assert.equal((await measure()).savedWidth, 704);
  await handle.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  assert.equal((await measure()).savedWidth, 640);
  // Barra não solta mais o painel, inclusive quando existe posição legada guardada.
  await page.evaluate(() => localStorage.setItem('habblaud.move.drawer', JSON.stringify({ x: 100, y: 100, w: 450, h: 400 })));
  await page.reload();
  await open();
  assert.equal((await measure()).width, 640);
  assert.equal((await measure()).floating, false);
  const bar = await page.locator('.ui-drawer__bar').boundingBox();
  await page.mouse.move(bar.x + 100, bar.y + 20);
  await page.mouse.down();
  await page.mouse.move(bar.x - 100, bar.y + 80);
  await page.mouse.up();
  assert.equal((await measure()).floating, false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
  const resized = await measure();
  assert(resized.free >= 320);
  assert.equal(resized.savedWidth, 640, 'viewport resize preserves desktop preference');
  measurements.push({ scenario: 'viewport', ...resized });
  // Um clique sem movimento na largura limitada não substitui a preferência desktop.
  const clippedHandle = await handle.boundingBox();
  await page.mouse.click(clippedHandle.x + 5, clippedHandle.y + 100);
  assert.equal((await measure()).savedWidth, 640, 'click without resize preserves preferred width');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal((await measure()).width, resized.width);
  assert.equal((await measure()).savedWidth, 640, 'key at viewport limit preserves preferred width');
  for (const [viewportWidth, panelWidth] of [[900, 562], [768, 430]]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await page.waitForTimeout(200);
    const tablet = await measure();
    assert.equal(tablet.width, panelWidth, 'narrow panel uses clamped preference, not legacy 400px');
    assert.equal(tablet.savedWidth, 640);
    assert.equal(tablet.overflow, false);
    assert.equal(await handle.isVisible(), false);
    measurements.push({ scenario: `narrow-${viewportWidth}`, ...tablet });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(450);
  const mobile = await measure();
  assert(mobile.width <= 390);
  assert.equal(mobile.overflow, false);
  assert.equal(mobile.savedWidth, 640);
  assert.equal(await handle.isVisible(), false);
  const close = page.locator('.ui-drawer__bar button');
  assert(await close.isVisible());
  await close.click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.ui-drawer').getAttribute('aria-hidden'), 'true');
  measurements.push({ scenario: 'mobile', ...mobile });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, measurements }, null, 2));
} finally {
  await browser.close();
}
