'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, clipboard, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { validateSettings } = require('./model.cjs');
const { createBridge } = require('./bridge.cjs');
const { DesktopMonitor } = require('./monitor.cjs');
const { CodexService } = require('./codex-service.cjs');
const { SessionActivity } = require('./session-activity.cjs');
const { composeView } = require('./view-state.cjs');
const geometry = require('../renderer/pet-layout.js');
const { followVisibility } = require('./follow-visibility.cjs');
const ROOT = path.join(__dirname, '..');
// Keep the existing profile and application ID so upgrading preserves settings and the instance lock.
const LEGACY_NAME = 'Mori GPT Pet';
const APP_NAME = 'Miko GPT Pet';
app.setName(APP_NAME);
const profileDirectory = process.env.MORI_TEST_DATA_DIR || path.join(app.getPath('appData'), LEGACY_NAME);
fs.mkdirSync(profileDirectory, { recursive: true });
app.setPath('userData', profileDirectory);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let pet, settingsWindow, tray, store, server, monitor, codex, activity, quitting = false, drag = null;
  let dismissed = false, previousRunning = null, savedPositionTimer, characterPosition = null, layout = null;
  const background = process.argv.includes('--background');
  const integration = { port: 47831, ready: false, error: null, lastEventAt: null };
  const rendererURL = name => pathToFileURL(path.join(ROOT, 'renderer', name)).href;
  function snapshot() {
    return { ...composeView(store.read(), codex.state, activity.state, monitor.state),
      codex: codex.state, activity: activity.state, monitor: monitor.state, integration,
      layout, platform: process.platform, warning: store.warning, packaged: app.isPackaged };
  }
  function broadcast() {
    if (!store || !codex || !activity || !monitor) return;
    for (const win of [pet, settingsWindow]) if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
  }
  function protect(win, file) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== rendererURL(file)) event.preventDefault(); });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); hideToTray(); }
    });
  }
  function trusted(event, settingsOnly = false) {
    const windows = settingsOnly ? [settingsWindow] : [pet, settingsWindow];
    const win = windows.find(item => item && !item.isDestroyed() && item.webContents === event.sender);
    if (!win || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted renderer');
  }
  function placePet(areaOverride = null) {
    const settings = store.read().settings;
    const preferred = characterPosition || settings.position || screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(preferred);
    const area = areaOverride || display.bounds;
    if (!characterPosition) characterPosition = geometry.restorePosition(settings, area);
    layout = geometry.calculate(settings, characterPosition, area);
    characterPosition = { x: layout.character.x, y: layout.character.y };
    pet.setBounds(layout.bounds);
  }
  function savePosition() {
    if (characterPosition) store.settings({ position: { ...characterPosition, anchor: 'character' } });
  }
  function showPet() {
    dismissed = false;
    if (!pet || pet.isDestroyed()) return;
    pet.webContents.send('pet:hidden'); pet.setIgnoreMouseEvents(true, { forward: true }); pet.showInactive(); broadcast();
  }
  function hideToTray() {
    dismissed = true; drag = null;
    if (pet && !pet.isDestroyed()) { pet.webContents.send('pet:hidden'); pet.hide(); }
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
  }
  function observeVisibility() {
    if (!store || !pet || !activity || !monitor) return;
    const localRunning = activity.state.task?.status === 'running';
    const reliable = (monitor.state.supported && !!monitor.state.checkedAt) || !!activity.state.task;
    if (!reliable) { broadcast(); return; }
    const running = monitor.state.running || localRunning;
    const visibility = followVisibility({ running, previousRunning, dismissed, background, enabled: store.read().settings.followCodex });
    if (visibility.show) showPet();
    if (visibility.hide) { pet.webContents.send('pet:hidden'); pet.hide(); }
    dismissed = visibility.dismissed;
    previousRunning = running; broadcast();
  }
  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
    settingsWindow = new BrowserWindow({ width: 1000, height: 800, minWidth: 740, minHeight: 620,
      title: 'Miko · Codex 桌宠设置', backgroundColor: store.read().settings.theme === 'dark' ? '#151920' : '#f6f7f3', autoHideMenuBar: true,
      icon: path.join(ROOT, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    protect(settingsWindow, 'settings.html'); settingsWindow.loadFile(path.join(ROOT, 'renderer', 'settings.html'));
    settingsWindow.on('close', event => { if (!quitting) { event.preventDefault(); hideToTray(); } });
    settingsWindow.on('closed', () => { settingsWindow = null; });
  }
  function startCodex() {
    codex.start({ enabled: store.read().settings.dataSource === 'codex' && !process.env.MORI_TEST_DATA_DIR,
      executable: store.read().settings.codexExecutable, desktopBinary: monitor.state.cliPath || null });
  }
  function setLoginPreference(enabled) {
    app.setLoginItemSettings({ name: APP_NAME, openAtLogin: enabled, path: process.execPath, args: ['--background'] });
    app.setLoginItemSettings({ name: LEGACY_NAME, openAtLogin: false });
  }
  function applySettings(patch, pivot = null) {
    validateSettings(patch);
    const previous = store.read().settings;
    if ('startAtLogin' in patch) {
      if (process.platform !== 'win32' || !app.isPackaged) throw new TypeError('开机待命需要运行打包后的 Windows 程序');
      setLoginPreference(patch.startAtLogin);
    }
    try { store.settings(patch); }
    catch (error) {
      if ('startAtLogin' in patch) setLoginPreference(previous.startAtLogin);
      throw error;
    }
    pet.setAlwaysOnTop(store.read().settings.alwaysOnTop);
    if ('scale' in patch || 'avatar' in patch) {
      if (characterPosition && layout) {
        const next = geometry.dimensions(store.read().settings);
        const old = layout.character;
        characterPosition = pivot ? geometry.scaleAround(characterPosition, previous.scale, patch.scale, pivot)
          : { x: old.x + (old.width - next.width) / 2, y: old.y + old.height - next.height };
      }
      placePet(layout?.area); savePosition();
    }
    if ('theme' in patch) settingsWindow?.setBackgroundColor(patch.theme === 'dark' ? '#151920' : '#f6f7f3');
    if (patch.followCodex === false) showPet();
    if (patch.followCodex === true && previousRunning === false) pet.hide();
    if ('dataSource' in patch || 'codexExecutable' in patch) startCodex();
    broadcast(); return snapshot();
  }
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    if (process.platform === 'win32' && app.isPackaged) {
      try { setLoginPreference(store.read().settings.startAtLogin); }
      catch { store.warning = [store.warning, '开机项更新失败，请在设置中重新切换开机待命。'].filter(Boolean).join(' '); }
    }
    activity = new SessionActivity(observeVisibility, process.env.MORI_TEST_DATA_DIR ? { home: path.join(app.getPath('userData'), 'test-codex-home') } : {});
    codex = new CodexService(state => { if (state.codexHome) activity.setHome(state.codexHome); broadcast(); });
    monitor = new DesktopMonitor(observation => {
      if (observation.cliPath && codex.config?.desktopBinary !== observation.cliPath && ['missing', 'error'].includes(codex.state.status)) startCodex();
      observeVisibility();
    }, process.platform, app.isPackaged ? path.join(process.resourcesPath, 'windows', 'observe.ps1') : path.join(__dirname, 'windows', 'observe.ps1'));
    pet = new BrowserWindow({ width: 390, height: 674, frame: false, transparent: true, resizable: false,
      maximizable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: store.read().settings.alwaysOnTop, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    placePet(); protect(pet, 'pet.html'); pet.loadFile(path.join(ROOT, 'renderer', 'pet.html'));
    pet.once('ready-to-show', () => { if (!dismissed && !background) showPet(); });
    pet.on('close', event => { if (!quitting) { event.preventDefault(); hideToTray(); } });
    tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')));
    tray.setToolTip('Miko · Codex 桌面伙伴');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 Miko', click: showPet }, { label: '设置…', click: openSettings }, { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ]));
    tray.on('click', showPet); tray.on('double-click', showPet);
    server = createBridge({ token: store.token, onUpdate(input) {
      store.update(input, 'connector'); integration.lastEventAt = new Date().toISOString(); broadcast();
    }, onError(error) { integration.error = error.code === 'EADDRINUSE' ? '本机接口端口 47831 已被占用。其他功能可继续使用。' : '本机接口启动失败。'; integration.ready = false; broadcast(); } });
    server.on('listening', () => { integration.ready = true; broadcast(); });
    ipcMain.handle('state:get', event => { trusted(event); return snapshot(); });
    ipcMain.handle('settings:save', (event, patch) => { trusted(event, true); return applySettings(patch); });
    ipcMain.handle('pet:scale', (event, steps) => {
      trusted(event);
      if (event.sender !== pet.webContents || !Number.isInteger(steps) || Math.abs(steps) > 10 || steps === 0) throw new TypeError('缩放步数无效');
      const current = store.read().settings.scale, scale = geometry.zoomScale(current, steps);
      return scale === current ? snapshot() : applySettings({ scale }, screen.getCursorScreenPoint());
    });
    ipcMain.handle('usage:save', (event, input) => {
      trusted(event, true);
      const { applyUpdate } = require('./model.cjs');
      const next = applyUpdate(store.read(), input, 'manual'); next.settings.dataSource = 'manual'; store.save(next);
      startCodex(); broadcast(); return snapshot();
    });
    ipcMain.handle('codex:refresh', async event => { trusted(event, true); await codex.refresh(); return snapshot(); });
    ipcMain.handle('codex:select', async event => {
      trusted(event, true);
      const result = await dialog.showOpenDialog(settingsWindow, { title: '选择官方 Codex CLI 程序', properties: ['openFile'],
        filters: process.platform === 'win32' ? [{ name: 'Codex CLI', extensions: ['exe'] }] : [{ name: 'Executable', extensions: ['*'] }] });
      if (!result.canceled && result.filePaths[0]) return applySettings({ codexExecutable: result.filePaths[0], dataSource: 'codex' });
      return snapshot();
    });
    ipcMain.handle('bridge:copy', event => { trusted(event, true); clipboard.writeText(store.token); return true; });
    ipcMain.handle('pet:action', (event, action) => {
      trusted(event);
      if (action === 'settings') openSettings();
      else if (action === 'hide') hideToTray();
      else if (action === 'show') showPet();
      else if (action === 'codex-help') shell.openExternal('https://developers.openai.com/codex/cli/');
      else if (action === 'reset-position') { store.settings({ position: null }); characterPosition = null; placePet(); savePosition(); showPet(); }
      else if (action === 'quit') { trusted(event, true); setImmediate(() => app.quit()); }
      else throw new Error('Unknown action');
    });
    ipcMain.on('pet:interactive', (event, value) => {
      trusted(event); if (event.sender === pet.webContents) pet.setIgnoreMouseEvents(value !== true, { forward: true });
    });
    ipcMain.on('pet:drag', (event, input) => {
      trusted(event); if (event.sender !== pet.webContents || !input || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
      if (input.phase === 'start') drag = { x: input.x, y: input.y, position: { ...characterPosition } };
      else if (input.phase === 'move' && drag) {
        const area = screen.getDisplayNearestPoint({ x: input.x, y: input.y }).bounds;
        characterPosition = geometry.clampCharacter({ x: drag.position.x + input.x - drag.x, y: drag.position.y + input.y - drag.y }, geometry.dimensions(store.read().settings), area);
        placePet(area); broadcast();
      } else if (input.phase === 'end') {
        drag = null; clearTimeout(savedPositionTimer); savedPositionTimer = setTimeout(() => {
          try { savePosition(); } catch { /* Keep the application running if the position cannot be saved. */ }
        }, 200);
      }
    });
    screen.on('display-metrics-changed', () => { placePet(); broadcast(); }); screen.on('display-removed', () => { placePet(); broadcast(); });
    monitor.start(); activity.start(); startCodex(); setInterval(broadcast, 15000).unref();
    if (store.warning) openSettings();
  }).catch(error => { console.error('Miko 启动失败：', error.message); app.quit(); });
  app.on('second-instance', showPet); app.on('activate', showPet); app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; clearTimeout(savedPositionTimer); try { if (store) savePosition(); } catch { /* Preserve normal quit if storage is unavailable. */ } codex?.stop(); activity?.stop(); monitor?.stop(); server?.close(); tray?.destroy(); });
}
