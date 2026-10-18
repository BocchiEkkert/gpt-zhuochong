'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { localDay } = require('../src/model.cjs');
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
    await pet.waitForFunction(async () => (await window.mori.getState()).integration.ready);
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
    await settings.evaluate(day => window.mori.saveUsage({ day, todayTokens: 1234, weekly: { remainingPercent: 37 } }), localDay());
    await pet.waitForFunction(() => document.getElementById('today-tokens').textContent === '1,234');
    await assert.rejects(() => pet.evaluate(() => window.mori.saveSettings({ scale: 1.1 })), /Untrusted renderer/);
    await assert.rejects(() => pet.evaluate(() => window.mori.action('quit')), /Unknown action/);
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
    await settings.keyboard.press('Escape'); assert.equal(await petVisible(instance), false);
    assert.equal(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/settings.html')).isVisible()), false);
    await pet.evaluate(() => window.mori.action('show')); assert.equal(await petVisible(instance), true);
    await settings.evaluate(() => window.mori.saveSettings({ dataSource: 'manual' }));
    await instance.close(); instance = null;
    instance = await electron.launch(options); const restored = await instance.firstWindow();
    await restored.waitForFunction(() => Boolean(window.mori)); const state = await restored.evaluate(() => window.mori.getState());
    assert.equal(state.settings.scale, 1.3); assert.equal(state.settings.reduceMotion, true);
    assert.equal(state.settings.theme, 'dark'); assert.equal(state.settings.avatar, 'chibi');
    assert.equal(state.usage.todayTokens, 1234); assert.equal(state.usage.weekly.remainingPercent, 37);
    assert.equal(state.task.status, 'unknown'); assert.deepEqual(errors, []);
    console.log('PASS Electron: isolated IPC, both avatars, dark theme, authenticated bridge, native close and Escape to tray, live background service and restart persistence.');
  } finally { await instance?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
