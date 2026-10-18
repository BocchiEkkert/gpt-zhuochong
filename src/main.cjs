'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, shell, clipboard } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { taskForView, validateSettings } = require('./model.cjs');
const { createBridge } = require('./bridge.cjs');
const { ChatGPTMonitor } = require('./monitor.cjs');

const ROOT = path.join(__dirname, '..');
app.setName('Mori GPT Pet');
if (process.env.MORI_TEST_DATA_DIR) app.setPath('userData', process.env.MORI_TEST_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let pet, settingsWindow, tray, store, server, monitor, quitting = false, drag = null;
  let minimized = process.argv.includes('--background'), hasObserved = false, savedPositionTimer;
  const integration = { port: 47831, ready: false, error: null, lastEventAt: null };
  const rendererURL = name => pathToFileURL(path.join(ROOT, 'renderer', name)).href;
  function snapshot() {
    const state = store.read();
    return { ...state, task: taskForView(state, monitor.state), monitor: monitor.state,
      integration, platform: process.platform, warning: store.warning, packaged: app.isPackaged };
  }
  function broadcast() {
    for (const win of [pet, settingsWindow]) if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
  }
  function protect(win, file) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== rendererURL(file)) event.preventDefault(); });
  }
  function trusted(event, settingsOnly = false) {
    const windows = settingsOnly ? [settingsWindow] : [pet, settingsWindow];
    if (!windows.some(win => win && !win.isDestroyed() && win.webContents === event.sender)) throw new Error('Untrusted renderer');
  }
  function placePet(reposition = false) {
    const scale = store.read().settings.scale;
    const current = pet?.getBounds();
    const preferred = store.read().settings.position;
    const area = screen.getDisplayNearestPoint(preferred || screen.getCursorScreenPoint()).workArea;
    const width = Math.min(390, area.width), height = Math.min(Math.ceil(380 + 205 * scale), area.height);
    const x = reposition && current ? current.x + current.width - width : preferred?.x ?? area.x + area.width - width - 24;
    const y = reposition && current ? current.y + current.height - height : preferred?.y ?? area.y + area.height - height - 16;
    pet.setBounds({ x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height });
  }
  function showPet() {
    minimized = false;
    if (!pet || pet.isDestroyed()) return;
    pet.setIgnoreMouseEvents(true, { forward: true });
    pet.showInactive();
    broadcast();
  }
  function hidePet() { minimized = true; pet?.hide(); }
  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
    settingsWindow = new BrowserWindow({ width: 950, height: 770, minWidth: 740, minHeight: 620,
      title: 'Mori · 桌宠设置', backgroundColor: '#f5f6f2', autoHideMenuBar: true,
      icon: path.join(ROOT, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    protect(settingsWindow, 'settings.html');
    settingsWindow.loadFile(path.join(ROOT, 'renderer', 'settings.html'));
    settingsWindow.on('closed', () => { settingsWindow = null; });
  }
  function trayMenu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 Mori', click: showPet }, { label: '最小化到托盘', click: hidePet },
      { label: '设置与数据连接…', click: openSettings }, { type: 'separator' },
      { label: '打开 ChatGPT', click: () => shell.openExternal('chatgpt://').catch(() => {
        if (settingsWindow) settingsWindow.webContents.send('notice', '未找到 ChatGPT 协议，请从开始菜单打开 ChatGPT。');
      }) },
      { type: 'separator' }, { label: '退出 Mori', click: () => app.quit() },
    ]));
  }
  function applySettings(patch) {
    validateSettings(patch);
    const previous = store.read().settings;
    if ('startAtLogin' in patch) {
      if (process.platform !== 'win32' || !app.isPackaged) throw new TypeError('开机待命需要运行打包后的 Windows 程序');
      app.setLoginItemSettings({ name: 'Mori GPT Pet', openAtLogin: patch.startAtLogin, path: process.execPath, args: ['--background'] });
    }
    try { store.settings(patch); }
    catch (error) {
      if ('startAtLogin' in patch) app.setLoginItemSettings({ name: 'Mori GPT Pet', openAtLogin: previous.startAtLogin, path: process.execPath, args: ['--background'] });
      throw error;
    }
    pet.setAlwaysOnTop(store.read().settings.alwaysOnTop);
    if ('scale' in patch) { placePet(true); store.settings({ position: { x: pet.getBounds().x, y: pet.getBounds().y } }); }
    if (patch.followChatGPT === false) showPet();
    if (patch.followChatGPT === true && hasObserved && !monitor.state.running) pet.hide();
    broadcast();
    return snapshot();
  }
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    monitor = new ChatGPTMonitor(observation => {
      const wasRunning = monitor.previousRunning;
      if (observation.checkedAt && observation.supported) {
        if (store.read().settings.followChatGPT) {
          // An explicit tray minimize persists until the next ChatGPT launch.
          if (observation.running && wasRunning !== true) { minimized = false; showPet(); }
          if (!observation.running && wasRunning === true) { pet.hide(); minimized = false; }
          if (!hasObserved && !observation.running && process.argv.includes('--background')) pet.hide();
        }
        hasObserved = true;
        monitor.previousRunning = observation.running;
      }
      broadcast();
    }, process.platform, app.isPackaged ? path.join(process.resourcesPath, 'windows', 'observe.ps1') : path.join(__dirname, 'windows', 'observe.ps1'));
    pet = new BrowserWindow({ width: 390, height: 585, frame: false, transparent: true,
      resizable: false, maximizable: false, skipTaskbar: true, hasShadow: false,
      focusable: false, alwaysOnTop: store.read().settings.alwaysOnTop, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    placePet(); protect(pet, 'pet.html');
    pet.loadFile(path.join(ROOT, 'renderer', 'pet.html'));
    pet.once('ready-to-show', () => { if (!minimized) showPet(); });
    pet.on('close', event => { if (!quitting) { event.preventDefault(); hidePet(); } });
    tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')));
    tray.setToolTip('Mori · 你的 ChatGPT 桌面伙伴');
    trayMenu(); tray.on('double-click', showPet); tray.on('click', showPet);
    server = createBridge({ token: store.token, onUpdate(input) {
      store.update(input, 'connector'); integration.lastEventAt = new Date().toISOString(); broadcast();
    }, onError(error) { integration.error = error.code === 'EADDRINUSE' ? '本机接口端口 47831 已被占用。桌宠其他功能可继续使用。' : '本机接口启动失败。'; integration.ready = false; broadcast(); } });
    server.on('listening', () => { integration.ready = true; broadcast(); });
    ipcMain.handle('state:get', event => { trusted(event); return snapshot(); });
    ipcMain.handle('settings:save', (event, patch) => { trusted(event, true); return applySettings(patch); });
    ipcMain.handle('usage:save', (event, input) => { trusted(event, true); store.update(input, 'manual'); broadcast(); return snapshot(); });
    ipcMain.handle('bridge:copy', event => {
      trusted(event, true); clipboard.writeText(store.token); return true;
    });
    ipcMain.handle('pet:action', (event, action) => {
      trusted(event);
      if (action === 'settings') openSettings();
      else if (action === 'minimize') hidePet();
      else if (action === 'show') showPet();
      else if (action === 'quit') app.quit();
      else if (action === 'reset-position') { store.settings({ position: null }); placePet(); showPet(); }
      else throw new Error('Unknown action');
    });
    ipcMain.on('pet:interactive', (event, interactive) => {
      trusted(event); if (event.sender !== pet.webContents) return;
      pet.setIgnoreMouseEvents(interactive !== true, { forward: true });
    });
    ipcMain.on('pet:drag', (event, input) => {
      trusted(event); if (event.sender !== pet.webContents) return;
      if (!input || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
      if (input.phase === 'start') drag = { x: input.x, y: input.y, bounds: pet.getBounds() };
      else if (input.phase === 'move' && drag) {
        const area = screen.getDisplayNearestPoint({ x: input.x, y: input.y }).workArea;
        const bounds = pet.getBounds();
        pet.setPosition(Math.round(Math.max(area.x, Math.min(drag.bounds.x + input.x - drag.x, area.x + area.width - bounds.width))),
          Math.round(Math.max(area.y, Math.min(drag.bounds.y + input.y - drag.y, area.y + area.height - bounds.height))));
      } else if (input.phase === 'end') {
        drag = null;
        clearTimeout(savedPositionTimer);
        savedPositionTimer = setTimeout(() => {
          const { x, y } = pet.getBounds();
          try { store.settings({ position: { x, y } }); } catch { /* A position save must not end the app. */ }
        }, 200);
      }
    });
    screen.on('display-metrics-changed', () => placePet(true));
    screen.on('display-removed', () => placePet(true));
    monitor.start();
    setInterval(broadcast, 15_000).unref();
    if (store.warning) openSettings();
  }).catch(error => { console.error('Mori 启动失败：', error.message); app.quit(); });
  app.on('second-instance', showPet);
  app.on('activate', showPet);
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true; clearTimeout(savedPositionTimer); monitor?.stop(); server?.close(); tray?.destroy();
  });
}
