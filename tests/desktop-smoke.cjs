'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { localDay } = require('../src/model.cjs');
async function waitForState(page, predicate) {
  const deadline = Date.now() + 15000;
  do {
    const state = await page.evaluate(() => window.mori.getState());
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error('Expected desktop state did not arrive');
}
async function waitForVisibility(instance, file, expected) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const visible = await instance.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/' + file)).isVisible(), file);
    if (visible === expected) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Window visibility did not settle: ' + file + ' expected ' + expected);
}
async function waitForPage(instance, file) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const page = instance.windows().find(page => page.url().endsWith('/' + file));
    if (page) { await page.waitForFunction(() => Boolean(window.mori)); return page; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Window not loaded: ' + file);
}
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-desktop-'));
  const root = path.join(__dirname, '..'); let instance;
  const options = { executablePath: process.env.MIKO_TEST_EXECUTABLE || require('electron'),
    args: [...(process.env.MORI_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), ...(process.env.MIKO_TEST_EXECUTABLE ? [] : [root])],
    env: { ...process.env, MORI_TEST_DATA_DIR: directory }, timeout: 30000 };
  const errors = [];
  const petVisible = app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/pet.html')).isVisible());
  try {
    instance = await electron.launch(options); const pet = await waitForPage(instance, 'pet.html');
    pet.on('pageerror', error => errors.push(error.message));
    await pet.waitForFunction(() => Boolean(window.mori));
    await waitForState(pet, state => state.integration.ready);
    assert.equal(await pet.evaluate(() => window.mori.getState().then(s => s.usage.todayTokens)), null);
    assert.equal(await pet.evaluate(() => typeof require), 'undefined');
    await pet.evaluate(() => window.mori.action('settings'));
    const panel = await waitForPage(instance, 'panel.html');
    const speech = await waitForPage(instance, 'speech.html');
    const settings = await waitForPage(instance, 'settings.html'); settings.on('pageerror', error => errors.push(error.message));
    await settings.waitForFunction(() => Boolean(window.mori));
    await settings.evaluate(() => window.mori.saveSettings({ scale: 1.3, reduceMotion: true, avatar: 'original', theme: 'dark' }));
    await pet.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.avatar === 'original');
    await pet.locator('#character img').evaluate(img => img.decode());
    await settings.evaluate(() => window.mori.saveSettings({ avatar: 'chibi' }));
    await pet.waitForFunction(() => document.getElementById('character').querySelector('img').src.endsWith('dragon-chibi.png'));
    await pet.locator('#character img').evaluate(img => img.decode());
    // Test a real wheel event at the maximum and native character movement to every edge.
    await settings.evaluate(() => window.mori.saveSettings({ scale: 2.95 }));
    await waitForState(pet, state => state.settings.scale === 2.95);
    await pet.locator('#character').hover(); await pet.mouse.wheel(0, -100);
    await waitForState(pet, state => state.settings.scale === 3);
    await pet.waitForFunction(() => document.getElementById('character').getBoundingClientRect().width === 630);
    await assert.rejects(() => pet.evaluate(() => mori.scalePet(99)), /缩放步数无效/);
    await settings.evaluate(() => mori.saveSettings({ scale: .65 }));
    await waitForState(pet, state => state.settings.scale === .65);
    const desktop = await instance.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
    const size = { width: 210 * .65, height: 270 * .65 };
    for (const x of [desktop.x, desktop.x + desktop.width - size.width]) for (const y of [desktop.y, desktop.y + desktop.height - size.height]) {
      const initial = await pet.evaluate(() => mori.getState().then(state => state.layout.character));
      const start = { x: initial.x + size.width / 2, y: initial.y + size.height / 2 };
      const target = { x: start.x + x - initial.x, y: start.y + y - initial.y };
      await pet.evaluate(({ start, target }) => { mori.drag({ phase: 'start', ...start }); mori.drag({ phase: 'move', ...target }); mori.drag({ phase: 'end', ...target }); }, { start, target });
      await waitForState(pet, state => Math.abs(state.layout.character.x - x) < .1 && Math.abs(state.layout.character.y - y) < .1);
      const native = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/pet.html')).getBounds());
      const visible = await pet.locator('#character').boundingBox();
      assert.ok(Math.abs(native.x + visible.x - x) <= 1); assert.ok(Math.abs(native.y + visible.y - y) <= 1);
    }
    await settings.evaluate(() => mori.saveSettings({ scale: 3 }));
    await waitForState(pet, state => state.settings.scale === 3);
    await settings.evaluate(day => window.mori.saveUsage({ day, todayTokens: 1234, weekly: { remainingPercent: 37 } }), localDay());
    await panel.waitForFunction(() => document.getElementById('today-tokens').textContent === '1,234');
    await assert.rejects(() => pet.evaluate(() => window.mori.saveSettings({ scale: 1.1 })), /Untrusted renderer/);
    await assert.rejects(() => pet.evaluate(() => window.mori.action('quit')), /Untrusted renderer/);
    await settings.evaluate(() => window.mori.saveSettings({ dataSource: 'connector' }));
    const token = fs.readFileSync(path.join(directory, 'bridge-token'), 'utf8');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const response = await fetch('http://127.0.0.1:47831/v1/state', { method: 'POST', headers, body: JSON.stringify({ task: { status: 'running', label: '真实接口冒烟测试' } }) });
    assert.equal(response.status, 200); await panel.waitForFunction(() => document.getElementById('task-label').textContent === '真实接口冒烟测试');
    // Native file dialogs are stubbed only inside this isolated test instance.
    const imported = path.join(directory, 'copy.txt'), exported = path.join(directory, 'copy.json');
    fs.writeFileSync(imported, '在这里趴一会儿。\n分你一颗小糖。\n在这里趴一会儿。');
    await instance.evaluate(({ dialog }, files) => {
      globalThis.mikoTestDialogs = { open: dialog.showOpenDialog, save: dialog.showSaveDialog };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.imported] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.exported });
    }, { imported, exported });
    await assert.rejects(() => pet.evaluate(() => mori.phraseFile({ action: 'export', category: 'idle' })), /Untrusted renderer/);
    await settings.evaluate(() => mori.phraseFile({ action: 'import', category: 'idle' }));
    assert.deepEqual(await pet.evaluate(() => mori.getState().then(state => state.settings.phraseBanks.idle)), ['在这里趴一会儿。', '分你一颗小糖。']);
    await settings.evaluate(() => mori.phraseFile({ action: 'export', category: 'idle' }));
    const copy = JSON.parse(fs.readFileSync(exported, 'utf8'));
    assert.equal(copy.version, 1); assert.equal(Object.keys(copy.phraseBanks).length, 6); assert.equal(copy.phraseBanks.click.length, 20);
    assert.deepEqual(Object.keys(copy), ['version', 'phraseBanks']);
    fs.writeFileSync(imported, 'x'.repeat(1024 * 1024 + 1));
    await assert.rejects(() => settings.evaluate(() => mori.phraseFile({ action: 'import', category: 'idle' })), /1 MB/);
    assert.equal(await pet.evaluate(() => mori.getState().then(state => state.settings.phraseBanks.idle.length)), 2);
    await instance.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.mikoTestDialogs.open; dialog.showSaveDialog = globalThis.mikoTestDialogs.save; });
    // Use a visible panel to verify native keyboard focus; offscreen placement is tested separately.
    await settings.evaluate(() => mori.saveSettings({ scale: .65 })); await pet.evaluate(() => mori.action('reset-position'));
    // Each close/Escape affects only the corresponding auxiliary window; the pet stays visible.
    await pet.evaluate(() => mori.panel({ action: 'toggle' }));
    const visible = file => instance.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/' + file)).isVisible(), file);
    assert.equal(await visible('panel.html'), true);
    const anchor = await pet.evaluate(() => mori.getState().then(state => state.layout.character));
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/panel.html')).close());
    assert.equal(await visible('panel.html'), false); assert.equal(await petVisible(instance), true);
    assert.deepEqual(await pet.evaluate(() => mori.getState().then(state => state.layout.character)), anchor);
    assert.equal((await fetch('http://127.0.0.1:47831/v1/health', { headers })).status, 200);
    await pet.evaluate(() => mori.panel({ action: 'toggle' }));
    await panel.waitForFunction(() => document.hasFocus()); await panel.keyboard.press('Escape');
    await waitForVisibility(instance, 'panel.html', false);
    assert.equal(await visible('panel.html'), false); assert.equal(await petVisible(instance), true);
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/settings.html')).close());
    assert.equal(settings.isClosed(), false); assert.equal(await visible('settings.html'), false); assert.equal(await petVisible(instance), true);
    await pet.evaluate(() => mori.panel({ action: 'toggle' }));
    await pet.evaluate(() => mori.action('settings')); await settings.waitForFunction(() => document.hasFocus());
    await settings.keyboard.press('Escape');
    await waitForVisibility(instance, 'settings.html', false);
    assert.equal(await visible('settings.html'), false); assert.equal(await visible('panel.html'), true); assert.equal(await petVisible(instance), true);
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/pet.html')).close());
    assert.equal(await visible('panel.html'), false); assert.equal(await petVisible(instance), true);
    // Negative panel/speech coordinates do not move a character placed at the top edge.
    await settings.evaluate(() => mori.saveSettings({ scale: .65, phraseBanks: { click: ['戳到小龙啦。', '分你小饼干。'] }, speechFrequency: 'quiet', speechSeconds: 3, speechOrder: 'sequential' }));
    const current = await pet.evaluate(() => mori.getState().then(state => state.layout.character));
    await pet.evaluate(({ x, y }) => { mori.drag({ phase: 'start', x, y }); mori.drag({ phase: 'move', x, y: y - 10000 }); mori.drag({ phase: 'end', x, y: y - 10000 }); }, { x: current.x, y: current.y });
    await waitForState(pet, state => state.layout.character.y === desktop.y);
    await pet.evaluate(() => mori.panel({ action: 'toggle' }));
    const topBounds = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/panel.html')).getBounds());
    assert.ok(topBounds.y < desktop.y); assert.equal(await petVisible(instance), true);
    await pet.evaluate(() => mori.panel({ action: 'close' })); await pet.evaluate(() => mori.action('touch'));
    await waitForState(pet, state => Boolean(state.speech));
    assert.equal(await visible('speech.html'), true);
    assert.equal(await speech.evaluate(() => document.getElementById('speech').textContent), '戳到小龙啦。');
    const firstSpeech = await pet.evaluate(() => mori.getState().then(state => state.speech));
    await pet.evaluate(() => { for (let i = 0; i < 5; i++) mori.action('touch'); });
    assert.deepEqual(await pet.evaluate(() => mori.getState().then(state => state.speech)), firstSpeech, 'rapid clicks are coalesced');
    await waitForState(pet, state => !state.speech); assert.equal(await visible('speech.html'), false);
    await settings.evaluate(() => mori.saveSettings({ scale: 3 }));
    await settings.evaluate(() => window.mori.saveSettings({ dataSource: 'manual' }));
    await instance.close(); instance = null;
    instance = await electron.launch(options); const restored = await waitForPage(instance, 'pet.html');
    await restored.waitForFunction(() => Boolean(window.mori)); const state = await restored.evaluate(() => window.mori.getState());
    assert.equal(state.settings.scale, 3); assert.equal(state.settings.reduceMotion, true);
    assert.equal(state.settings.theme, 'dark'); assert.equal(state.settings.avatar, 'chibi');
    assert.equal(state.usage.todayTokens, 1234); assert.equal(state.usage.weekly.remainingPercent, 37);
    assert.equal(state.task.status, 'unknown'); assert.equal(state.settings.speechFrequency, 'quiet'); assert.equal(state.settings.phraseBanks.click.length, 2); assert.deepEqual(errors, []);
    // The explicit settings exit button must terminate both the app and its background bridge.
    await restored.evaluate(() => mori.action('settings'));
    const exitSettings = await waitForPage(instance, 'settings.html'); await exitSettings.waitForFunction(() => Boolean(window.mori));
    const closed = instance.waitForEvent('close', { timeout: 15000 }); await exitSettings.locator('#exit-pet').click(); await closed; instance = null;
    await assert.rejects(() => fetch('http://127.0.0.1:47831/v1/health', { headers, signal: AbortSignal.timeout(3000) }));
    console.log('PASS Electron: real wheel to 300%, four desktop corners, persistent scale, independent offscreen panels and speech, close/Escape keep pet visible, click cooldown, settings Exit terminates process and bridge.');
  } finally { await instance?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
