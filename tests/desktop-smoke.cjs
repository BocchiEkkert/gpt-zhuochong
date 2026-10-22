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
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-desktop-'));
  const root = path.join(__dirname, '..'); let instance;
  const options = { executablePath: require('electron'),
    args: [...(process.env.MORI_TEST_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), root],
    env: { ...process.env, MORI_TEST_DATA_DIR: directory }, timeout: 30000 };
  const errors = [];
  const petVisible = app => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/pet.html')).isVisible());
  try {
    instance = await electron.launch(options); const pet = await instance.firstWindow();
    pet.on('pageerror', error => errors.push(error.message));
    await pet.waitForFunction(() => Boolean(window.mori));
    await waitForState(pet, state => state.integration.ready);
    assert.equal(await pet.evaluate(() => window.mori.getState().then(s => s.usage.todayTokens)), null);
    assert.equal(await pet.evaluate(() => typeof require), 'undefined');
    const event = instance.waitForEvent('window'); await pet.evaluate(() => window.mori.action('settings'));
    const settings = await event; settings.on('pageerror', error => errors.push(error.message));
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
    await pet.waitForFunction(() => document.getElementById('today-tokens').textContent === '1,234');
    await assert.rejects(() => pet.evaluate(() => window.mori.saveSettings({ scale: 1.1 })), /Untrusted renderer/);
    await assert.rejects(() => pet.evaluate(() => window.mori.action('quit')), /Untrusted renderer/);
    await settings.evaluate(() => window.mori.saveSettings({ dataSource: 'connector' }));
    const token = fs.readFileSync(path.join(directory, 'bridge-token'), 'utf8');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const response = await fetch('http://127.0.0.1:47831/v1/state', { method: 'POST', headers, body: JSON.stringify({ task: { status: 'running', label: '真实接口冒烟测试' } }) });
    assert.equal(response.status, 200); await pet.waitForFunction(() => document.getElementById('task-label').textContent === '真实接口冒烟测试');
    // Closing either native window keeps the process and bridge alive in the tray.
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/pet.html')).close());
    assert.equal(await petVisible(instance), false); assert.equal(settings.isClosed(), false);
    assert.equal((await fetch('http://127.0.0.1:47831/v1/health', { headers })).status, 200);
    await pet.evaluate(() => window.mori.action('settings')); await settings.waitForFunction(() => document.hasFocus());
    await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/settings.html')).close());
    assert.equal(settings.isClosed(), false); assert.equal(await petVisible(instance), false);
    assert.equal((await fetch('http://127.0.0.1:47831/v1/health', { headers })).status, 200);
    await pet.evaluate(() => window.mori.action('settings')); await settings.waitForFunction(() => document.hasFocus());
    await settings.keyboard.press('Escape'); assert.equal(await petVisible(instance), false);
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/settings.html')).isVisible()), false);
    await pet.evaluate(() => window.mori.action('show')); assert.equal(await petVisible(instance), true);
    await settings.evaluate(() => window.mori.saveSettings({ dataSource: 'manual' }));
    await instance.close(); instance = null;
    instance = await electron.launch(options); const restored = await instance.firstWindow();
    await restored.waitForFunction(() => Boolean(window.mori)); const state = await restored.evaluate(() => window.mori.getState());
    assert.equal(state.settings.scale, 3); assert.equal(state.settings.reduceMotion, true);
    assert.equal(state.settings.theme, 'dark'); assert.equal(state.settings.avatar, 'chibi');
    assert.equal(state.usage.todayTokens, 1234); assert.equal(state.usage.weekly.remainingPercent, 37);
    assert.equal(state.task.status, 'unknown'); assert.deepEqual(errors, []);
    // The explicit settings exit button must terminate both the app and its background bridge.
    const reopened = instance.waitForEvent('window'); await restored.evaluate(() => mori.action('settings'));
    const exitSettings = await reopened; await exitSettings.waitForFunction(() => Boolean(window.mori));
    const closed = instance.waitForEvent('close', { timeout: 15000 }); await exitSettings.locator('#exit-pet').click(); await closed; instance = null;
    await assert.rejects(() => fetch('http://127.0.0.1:47831/v1/health', { headers, signal: AbortSignal.timeout(3000) }));
    console.log('PASS Electron: real wheel to 300%, four desktop corners, persistent scale, native close and Escape to tray, settings Exit terminates process and bridge.');
  } finally { await instance?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
