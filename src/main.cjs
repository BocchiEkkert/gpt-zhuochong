'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, clipboard, dialog, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Store } = require('./store.cjs');
const { validateSettings } = require('./model.cjs');
const { createBridge } = require('./bridge.cjs');
const { DesktopMonitor } = require('./monitor.cjs');
const { CodexService } = require('./codex-service.cjs');
const { SessionActivity } = require('./session-activity.cjs');
const { composeView } = require('./view-state.cjs');
const ROOT = path.join(__dirname, '..');
app.setName('Mori GPT Pet');
if (process.env.MORI_TEST_DATA_DIR) app.setPath('userData', process.env.MORI_TEST_DATA_DIR);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let pet, settingsWindow, tray, store, server, monitor, codex, activity, quitting = false, drag = null;
  let dismissed = process.argv.includes('--background'), previousRunning = null, savedPositionTimer;
  const integration = { port: 47831, ready: false, error: null, lastEventAt: null };
  const rendererURL = name => pathToFileURL(path.join(ROOT, 'renderer', name)).href;
  function snapshot() {
    return { ...composeView(store.read(), codex.state, activity.state, monitor.state),
      codex: codex.state, activity: activity.state, monitor: monitor.state, integration,
      platform: process.platform, warning: store.warning, packaged: app.isPackaged };
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
  function placePet(reposition = false) {
    const settings = store.read().settings;
    const current = pet?.getBounds(), preferred = settings.position;
    const area = screen.getDisplayNearestPoint(preferred || screen.getCursorScreenPoint()).workArea;
    const offset = settings.avatar === 'chibi' ? 294 : 264;
    const width = Math.min(390, area.width), height = Math.min(Math.ceil(410 + offset * settings.scale), area.height);
    const x = reposition && current ? current.x + current.width - width : preferred?.x ?? area.x + area.width - width - 24;
    const y = reposition && current ? current.y + current.height - height : preferred?.y ?? area.y + area.height - height - 16;
    pet.setBounds({ x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height });
  }
  function showPet() {
    dismissed = false;
    if (!pet || pet.isDestroyed()) return;
    pet.webContents.send('pet:hidden'); pet.setIgnoreMouseEvents(true, { forward: true }); pet.showInactive(); broadcast();
  }
  function hideToTray() {
    dismissed = true;
    if (pet && !pet.isDestroyed()) { pet.webContents.send('pet:hidden'); pet.hide(); }
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
  }
  function observeVisibility() {
    if (!store || !pet || !activity || !monitor) return;
    const localRunning = activity.state.task?.status === 'running';
    const reliable = (monitor.state.supported && !!monitor.state.checkedAt) || !!activity.state.task;
    if (!reliable) { broadcast(); return; }
    const running = monitor.state.running || localRunning;
    if (store.read().settings.followCodex) {
      if (running && previousRunning !== true) showPet();
      if (!running && previousRunning === true) { pet.webContents.send('pet:hidden'); pet.hide(); dismissed = false; }
      if (!running && previousRunning === null && process.argv.includes('--background')) pet.hide();
    }
    previousRunning = running; broadcast();
  }
  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
    settingsWindow = new BrowserWindow({ width: 1000, height: 800, minWidth: 740, minHeight: 620,
      title: 'Mori · Codex 桌宠设置', backgroundColor: store.read().settings.theme === 'dark' ? '#151920' : '#f6f7f3', autoHideMenuBar: true,
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
    if ('scale' in patch || 'avatar' in patch) {
      placePet(true); const { x, y } = pet.getBounds(); store.settings({ position: { x, y } });
    }
    if ('theme' in patch) settingsWindow?.setBackgroundColor(patch.theme === 'dark' ? '#151920' : '#f6f7f3');
    if (patch.followCodex === false) showPet();
    if (patch.followCodex === true && previousRunning === false) pet.hide();
    if ('dataSource' in patch || 'codexExecutable' in patch) startCodex();
    broadcast(); return snapshot();
  }
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
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
    pet.once('ready-to-show', () => { if (!dismissed) showPet(); });
    pet.on('close', event => { if (!quitting) { event.preventDefault(); hideToTray(); } });
    tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')));
    tray.setToolTip('Mori · Codex 桌面伙伴');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 Mori', click: showPet }, { label: '设置…', click: openSettings }, { type: 'separator' },
      { label: '退出桌宠', click: () => app.quit() },
    ]));
    tray.on('click', showPet); tray.on('double-click', showPet);
    server = createBridge({ token: store.token, onUpdate(input) {
      store.update(input, 'connector'); integration.lastEventAt = new Date().toISOString(); broadcast();
    }, onError(error) { integration.error = error.code === 'EADDRINUSE' ? '本机接口端口 47831 已被占用。其他功能可继续使用。' : '本机接口启动失败。'; integration.ready = false; broadcast(); } });
    server.on('listening', () => { integration.ready = true; broadcast(); });
    ipcMain.handle('state:get', event => { trusted(event); return snapshot(); });
    ipcMain.handle('settings:save', (event, patch) => { trusted(event, true); return applySettings(patch); });
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
      else if (action === 'reset-position') { store.settings({ position: null }); placePet(); showPet(); }
      else throw new Error('Unknown action');
    });
    ipcMain.on('pet:interactive', (event, value) => {
      trusted(event); if (event.sender === pet.webContents) pet.setIgnoreMouseEvents(value !== true, { forward: true });
    });
    ipcMain.on('pet:drag', (event, input) => {
      trusted(event); if (event.sender !== pet.webContents || !input || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
      if (input.phase === 'start') drag = { x: input.x, y: input.y, bounds: pet.getBounds() };
      else if (input.phase === 'move' && drag) {
        const area = screen.getDisplayNearestPoint({ x: input.x, y: input.y }).workArea, bounds = pet.getBounds();
        pet.setPosition(Math.round(Math.max(area.x, Math.min(drag.bounds.x + input.x - drag.x, area.x + area.width - bounds.width))),
          Math.round(Math.max(area.y, Math.min(drag.bounds.y + input.y - drag.y, area.y + area.height - bounds.height))));
      } else if (input.phase === 'end') {
        drag = null; clearTimeout(savedPositionTimer); savedPositionTimer = setTimeout(() => {
          const { x, y } = pet.getBounds(); try { store.settings({ position: { x, y } }); } catch { /* Keep the application running if the position cannot be saved. */ }
        }, 200);
      }
    });
    screen.on('display-metrics-changed', () => placePet(true)); screen.on('display-removed', () => placePet(true));
    monitor.start(); activity.start(); startCodex(); setInterval(broadcast, 15000).unref();
    if (store.warning) openSettings();
  }).catch(error => { console.error('Mori 启动失败：', error.message); app.quit(); });
  app.on('second-instance', showPet); app.on('activate', showPet); app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; clearTimeout(savedPositionTimer); codex?.stop(); activity?.stop(); monitor?.stop(); server?.close(); tray?.destroy(); });
}
