'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { initialState, localDay, applyUpdate } = require('../src/model.cjs');
let browser, server, baseURL;
const output = path.join(__dirname, '..', 'test-results');
const executablePath = process.env.CHROMIUM_PATH || (process.platform === 'linux' ? '/usr/bin/chromium' : undefined);
before(async () => {
  fs.mkdirSync(output, { recursive: true });
  const root = path.join(__dirname, '..');
  server = http.createServer((req, res) => {
    const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!['renderer', 'assets'].some(dir => target.startsWith(path.join(root, dir) + path.sep))) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(target)] || 'application/octet-stream';
    fs.readFile(target, (error, data) => { res.writeHead(error ? 404 : 200, { 'Content-Type': type }); res.end(error ? '' : data); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [] });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); server?.close(); });
function fixture(data = initialState()) {
  return { ...data, task: { ...data.task }, monitor: { running: false, status: 'unknown', available: false, supported: true, checkedAt: new Date().toISOString(), error: null },
    integration: { port: 47831, ready: true, error: null, lastEventAt: null }, platform: 'win32', warning: null, packaged: true };
}
async function load(file, state = fixture(), viewport = { width: 950, height: 770 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(initial => {
    let current = initial;
    const callbacks = [];
    window.calls = [];
    window.mori = {
      getState: async () => current,
      onState: callback => { callbacks.push(callback); return () => {}; },
      onNotice: () => () => {},
      saveSettings: async patch => { window.calls.push(['settings', patch]); current.settings = { ...current.settings, ...patch }; return structuredClone(current); },
      saveUsage: async input => { window.calls.push(['usage', input]); return structuredClone(current); },
      copyToken: async () => { window.calls.push(['copy']); },
      action: async action => { window.calls.push(['action', action]); },
      interactive: value => window.calls.push(['interactive', value]),
      drag: value => window.calls.push(['drag', value]),
    };
    window.pushState = next => { current = next; for (const callback of callbacks) callback(next); };
  }, state);
  await page.goto(baseURL + '/renderer/' + file);
  await page.waitForFunction(() => document.readyState === 'complete');
  return { page, errors };
}
test('hover reveals unknown usage; minimize, settings and exit send the intended commands', async () => {
  const { page, errors } = await load('pet.html', fixture(), { width: 390, height: 585 });
  try {
    assert.equal(await page.locator('#popover').isVisible(), false);
    await page.locator('#character').hover();
    await page.waitForFunction(() => !document.getElementById('popover').hidden);
    assert.equal(await page.locator('#today-tokens').textContent(), '—');
    assert.equal(await page.locator('#five-value').textContent(), '未知');
    await page.locator('#settings').click();
    await page.locator('#quit').click();
    await page.locator('#minimize').click();
    const calls = await page.evaluate(() => calls.filter(call => call[0] === 'action'));
    assert.deepEqual(calls, [['action', 'settings'], ['action', 'quit'], ['action', 'minimize']]);
    assert.equal(await page.locator('#popover').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('quota labels retain manual source; largest pet keeps panel inside its window', async () => {
  const data = applyUpdate(initialState(), { day: localDay(), todayTokens: 18420, fiveHour: { remainingPercent: 72 }, weekly: { remainingPercent: 43 }, task: { status: 'running', label: '整理项目笔记' } }, 'manual');
  const state = fixture(data); state.settings.scale = 1.6;
  const { page, errors } = await load('pet.html', state, { width: 390, height: 708 });
  try {
    await page.locator('#nameplate').click();
    assert.equal(await page.locator('#today-tokens').textContent(), '18,420');
    assert.equal(await page.locator('#token-source').textContent(), '手动录入');
    assert.equal(await page.locator('#five-value').textContent(), '剩余 72%');
    assert.equal(await page.locator('#task-label').textContent(), '整理项目笔记');
    const bounds = await page.locator('#popover').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.y + bounds.height <= 708);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'pet-large.png'), omitBackground: true });
  } finally { await page.close(); }
});
test('settings persist size, topmost and reduced animation and preserve incoming data while editing', async () => {
  const { page, errors } = await load('settings.html');
  try {
    assert.equal(await page.locator('#follow').isChecked(), true);
    await page.locator('#topmost').uncheck();
    await page.locator('#motion').check();
    await page.locator('#scale').fill('130');
    await page.locator('#scale').dispatchEvent('input');
    await page.waitForTimeout(300);
    const settingsCalls = await page.evaluate(() => calls.filter(call => call[0] === 'settings'));
    assert.deepEqual(settingsCalls, [['settings', { alwaysOnTop: false }], ['settings', { reduceMotion: true }], ['settings', { scale: 1.3 }]]);
    await page.locator('#tokens').fill('12345');
    const next = fixture(); next.usage.todayTokens = 999;
    await page.evaluate(next => pushState(next), next);
    assert.equal(await page.locator('#tokens').inputValue(), '12345');
    await page.locator('#usage-form button[type="submit"]').click();
    assert.deepEqual(await page.evaluate(() => calls.find(call => call[0] === 'usage')[1]), { day: localDay(), todayTokens: 12345 });
    await page.locator('#copy-token').click();
    assert.ok(await page.evaluate(() => calls.some(call => call[0] === 'copy')));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('source preview leaves startup unavailable and interface fits a narrow settings window', async () => {
  const state = fixture(); state.packaged = false;
  const { page, errors } = await load('settings.html', state, { width: 740, height: 680 });
  try {
    assert.equal(await page.locator('#login').isEnabled(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.locator('#show-pet').click();
    await page.locator('#reset-position').click();
    await page.locator('#minimize-pet').click();
    assert.deepEqual(await page.evaluate(() => calls.filter(call => call[0] === 'action')), [['action', 'show'], ['action', 'reset-position'], ['action', 'minimize']]);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
test('save a screenshot of the original character and settings, without example usage', async () => {
  const { page, errors } = await load('settings.html');
  try {
    await page.screenshot({ path: path.join(output, 'settings.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
