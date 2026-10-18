'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { initialState, localDay, applyUpdate } = require('../src/model.cjs');
const { emptyCodex } = require('../src/codex-service.cjs');
let browser, server, baseURL;
const output = path.join(__dirname, '..', 'test-results');
const executablePath = process.env.CHROMIUM_PATH || (process.platform === 'linux' ? '/usr/bin/chromium' : undefined);
before(async () => {
  fs.mkdirSync(output, { recursive: true }); const root = path.join(__dirname, '..');
  server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!['renderer', 'assets'].some(dir => target.startsWith(path.join(root, dir) + path.sep))) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(target)] || 'application/octet-stream';
    fs.readFile(target, (error, data) => { res.writeHead(error ? 404 : 200, { 'Content-Type': type }); res.end(error ? '' : data); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); server?.close(); });
function fixture(data = initialState()) {
  return { ...data, manualUsage: structuredClone(data.usage), manualTask: structuredClone(data.task),
    codex: { ...emptyCodex(), status: 'missing', message: '未找到 Codex CLI' }, activity: { task: null, error: null },
    monitor: { running: false, status: 'unknown', supported: true, checkedAt: new Date().toISOString(), error: null },
    integration: { ready: true, error: null, lastEventAt: null }, platform: 'win32', warning: null, packaged: true };
}
async function load(file, state = fixture(), viewport = { width: 1000, height: 800 }) {
  const page = await browser.newPage({ viewport }); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(initial => {
    let current = initial; const callbacks = [], hidden = []; window.calls = [];
    window.mori = {
      getState: async () => structuredClone(current),
      onState: callback => { callbacks.push(callback); return () => {}; }, onNotice: () => () => {},
      onHidden: callback => { hidden.push(callback); return () => {}; },
      saveSettings: async patch => { calls.push(['settings', patch]); current.settings = { ...current.settings, ...patch }; return structuredClone(current); },
      saveUsage: async input => {
        calls.push(['usage', input]); current.settings.dataSource = 'manual';
        if ('todayTokens' in input) Object.assign(current.usage, { todayTokens: input.todayTokens, source: 'manual' });
        return structuredClone(current);
      },
      refreshCodex: async () => { calls.push(['refresh']); return structuredClone(current); },
      selectCodex: async () => { calls.push(['select']); return structuredClone(current); },
      copyToken: async () => { calls.push(['copy']); },
      action: async action => calls.push(['action', action]),
      interactive: value => calls.push(['interactive', value]), drag: value => calls.push(['drag', value]),
    };
    window.pushState = next => { current = next; for (const callback of callbacks) callback(structuredClone(next)); };
    window.pushHidden = () => { for (const callback of hidden) callback(); };
  }, state);
  await page.goto(baseURL + '/renderer/' + file); await page.waitForFunction(() => document.readyState === 'complete');
  return { page, errors };
}
test('hover shows unknown data; close and Escape go to tray, with no minimize or quit button', async () => {
  const { page, errors } = await load('pet.html', fixture(), { width: 390, height: 674 });
  try {
    assert.equal(await page.locator('#minimize').count(), 0); assert.equal(await page.locator('#quit').count(), 0);
    assert.equal(await page.locator('#popover').isVisible(), false);
    await page.locator('#character').hover(); await page.waitForFunction(() => !document.getElementById('popover').hidden);
    assert.equal(await page.locator('#today-tokens').textContent(), '—'); assert.equal(await page.locator('#five-value').textContent(), '未知');
    await page.locator('#settings').click(); await page.locator('#close-pet').click();
    assert.equal(await page.locator('#popover').isVisible(), false);
    await page.locator('#nameplate').click(); await page.keyboard.press('Escape');
    assert.deepEqual(await page.evaluate(() => calls.filter(call => call[0] === 'action')), [['action', 'settings'], ['action', 'hide'], ['action', 'hide']]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('both character images have transparent backgrounds and remain within narrow desktop windows at maximum size', async () => {
  const data = applyUpdate(initialState(), { day: localDay(), todayTokens: 18420, fiveHour: { remainingPercent: 72 }, weekly: { remainingPercent: 43 }, task: { status: 'running', label: '界面测试示例' } }, 'manual');
  data.settings.scale = 1.6; data.settings.reduceMotion = true; data.settings.dataSource = 'manual';
  const state = fixture(data); const { page, errors } = await load('pet.html', state, { width: 390, height: 851 });
  try {
    for (const avatar of ['original', 'chibi']) {
      const next = structuredClone(state); next.settings.avatar = avatar; await page.evaluate(next => pushState(next), next);
      await page.locator('#nameplate').click();
      const sprite = page.locator('#character img'); await sprite.evaluate(img => img.decode());
      const info = await sprite.evaluate(img => {
        const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const c = canvas.getContext('2d'); c.drawImage(img, 0, 0);
        return { file: new URL(img.src).pathname, corner: c.getImageData(0, 0, 1, 1).data[3],
          body: c.getImageData(Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight * .35), 1, 1).data[3] };
      });
      assert.equal(info.file, avatar === 'chibi' ? '/assets/dragon-chibi.png' : '/assets/dragon-girl.png');
      assert.equal(info.corner, 0); assert.ok(info.body > 240);
      for (const height of [851, 728]) {
        await page.setViewportSize({ width: 390, height });
        const panel = await page.locator('#popover').boundingBox(), character = await page.locator('#character').boundingBox();
        assert.ok(panel.x >= 0 && panel.y >= 0 && panel.y + panel.height <= height);
        assert.ok(character.x >= 0 && character.y >= 0 && character.x + character.width <= 390 && character.y + character.height <= height);
        const speech = await page.locator('#speech').boundingBox();
        assert.ok(panel.y + panel.height <= speech.y + 1, 'the character and speech must not obscure quota data');
      }
      await page.screenshot({ path: path.join(output, `pet-${avatar}.png`), omitBackground: true });
      await page.evaluate(() => pushHidden());
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('settings switch dark theme, both avatars and scale, and offer no minimize or exit button', async () => {
  const { page, errors } = await load('settings.html');
  try {
    await page.locator('#dark-theme').check(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.locator('#avatar-original').check();
    assert.ok((await page.locator('[data-character]').getAttribute('src')).endsWith('dragon-girl.png'));
    await page.locator('#avatar-chibi').check();
    assert.ok((await page.locator('[data-character]').getAttribute('src')).endsWith('dragon-chibi.png'));
    await page.locator('#scale').fill('130'); await page.locator('#scale').dispatchEvent('input'); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => calls.filter(call => call[0] === 'settings')), [['settings', { theme: 'dark' }], ['settings', { avatar: 'original' }], ['settings', { avatar: 'chibi' }], ['settings', { scale: 1.3 }]]);
    assert.equal(await page.locator('#minimize-pet').count(), 0); assert.equal(await page.locator('#exit-pet').count(), 0);
    await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('toast').hidden = true; });
    await page.screenshot({ path: path.join(output, 'settings-dark.png'), fullPage: true });
    await page.keyboard.press('Escape'); assert.ok(await page.evaluate(() => calls.some(call => call[0] === 'action' && call[1] === 'hide')));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('manual edits survive incoming state and saving changes switches explicitly to manual mode', async () => {
  const { page, errors } = await load('settings.html');
  try {
    await page.locator('#manual-details summary').click(); await page.locator('#tokens').fill('12345');
    const next = fixture(); next.manualUsage.todayTokens = 999; await page.evaluate(next => pushState(next), next);
    assert.equal(await page.locator('#tokens').inputValue(), '12345');
    await page.locator('#usage-form button[type="submit"]').click();
    assert.deepEqual(await page.evaluate(() => calls.find(call => call[0] === 'usage')[1]), { day: localDay(), todayTokens: 12345 });
    assert.equal(await page.locator('#data-source').inputValue(), 'manual'); assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('Codex connection diagnostics show signed-out and official data, and wire refresh and executable selection', async () => {
  const state = fixture(); state.codex.status = 'signedOut'; state.codex.message = '请先在 Codex 中登录';
  const { page, errors } = await load('settings.html', state);
  try {
    assert.equal(await page.locator('#codex-status').textContent(), '请先在 Codex 中登录');
    await page.locator('#refresh-codex').click(); await page.locator('#select-codex').click();
    assert.ok(await page.evaluate(() => calls.some(call => call[0] === 'refresh'))); assert.ok(await page.evaluate(() => calls.some(call => call[0] === 'select')));
    const next = fixture(); next.codex.status = 'connected'; next.codex.message = 'Codex 已连接';
    next.usage.fiveHour = { remainingPercent: 75, source: 'codex', updatedAt: new Date().toISOString(), resetsAt: null };
    await page.evaluate(next => pushState(next), next);
    assert.equal(await page.locator('#summary-five').textContent(), '75%'); assert.ok((await page.locator('#summary-five-reset').textContent()).includes('Codex 官方'));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('settings fit a narrow window, startup remains disabled in development, light theme preview is saved', async () => {
  const state = fixture(); state.packaged = false;
  const { page, errors } = await load('settings.html', state, { width: 740, height: 680 });
  try {
    assert.equal(await page.locator('#login').isEnabled(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.locator('#show-pet').click(); await page.locator('#reset-position').click();
    assert.deepEqual(await page.evaluate(() => calls.filter(call => call[0] === 'action')), [['action', 'show'], ['action', 'reset-position']]);
    assert.deepEqual(errors, []); await page.setViewportSize({ width: 1000, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'settings-light.png'), fullPage: true });
  } finally { await page.close(); }
});
