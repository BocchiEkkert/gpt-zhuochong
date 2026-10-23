'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, clipboard, dialog, shell, powerMonitor } = require('electron');
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
const { Companion, CATEGORIES } = require('./companion.cjs');
const defaultLines = require('../renderer/dialogue.js');
const geometry = require('../renderer/pet-layout.js');
const { followVisibility } = require('./follow-visibility.cjs');
const ROOT = path.join(__dirname, '..');
const LEGACY_NAME = 'Mori GPT Pet', APP_NAME = 'Miko GPT Pet';
// XWayland permits the explicit desktop positioning used by the companion windows.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'x11');
app.setName(APP_NAME);
const profileDirectory = process.env.MORI_TEST_DATA_DIR || path.join(app.getPath('appData'), LEGACY_NAME);
fs.mkdirSync(profileDirectory, { recursive: true }); app.setPath('userData', profileDirectory);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let pet, panelWindow, speechWindow, settingsWindow, tray, trayMenu, store, server, monitor, codex, activity, companion;
  let quitting = false, drag = null, suspended = false, locked = false;
  let dismissed = false, previousRunning = null, savedPositionTimer, characterPosition = null, layout = null;
  let panelPinned = false, panelHover = false, petHover = false, panelSuppressed = false, panelHideTimer;
  let speech = null, speechTimer, idleTimer, clickIndex = 0, currentMotion = 'idle';
  const background = process.argv.includes('--background');
  const integration = { port: 47831, ready: false, error: null, lastEventAt: null };
  const rendererURL = name => pathToFileURL(path.join(ROOT, 'renderer', name)).href;
  const windows = () => [pet, panelWindow, speechWindow, settingsWindow].filter(win => win && !win.isDestroyed());
  const webPreferences = () => ({ preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true });
  const rectangle = rect => Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value)]));
  function snapshot() {
    return { ...composeView(store.read(), codex.state, activity.state, monitor.state),
      codex: codex.state, activity: activity.state, monitor: monitor.state, integration, layout,
      panel: { open: !!panelWindow?.isVisible(), pinned: panelPinned }, speech, motion: currentMotion,
      platform: process.platform, warning: store.warning, packaged: app.isPackaged };
  }
  function broadcast() {
    if (!store || !codex || !activity || !monitor) return;
    const state = snapshot(); for (const win of windows()) win.webContents.send('state', state);
  }
  function trusted(event, settingsOnly = false) {
    const allowed = settingsOnly ? [settingsWindow] : windows();
    const win = allowed.find(item => item && !item.isDestroyed() && item.webContents === event.sender);
    if (!win || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted renderer');
    return win;
  }
  function clearSpeech() {
    clearTimeout(speechTimer); speech = null; speechWindow?.hide();
  }
  function hidePanel() {
    clearTimeout(panelHideTimer); panelPinned = false; panelHover = false; panelSuppressed = petHover;
    panelWindow?.hide(); broadcast();
  }
  function hideCurrent(win) {
    if (win === settingsWindow) win.hide();
    else { hidePanel(); clearSpeech(); broadcast(); }
  }
  function protect(win, file) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== rendererURL(file)) event.preventDefault(); });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); hideCurrent(win); }
    });
    win.on('close', event => { if (!quitting) { event.preventDefault(); hideCurrent(win); } });
  }
  function placePet(areaOverride = null) {
    const settings = store.read().settings;
    const preferred = characterPosition || settings.position || screen.getCursorScreenPoint();
    const area = areaOverride || screen.getDisplayNearestPoint(preferred).bounds;
    if (!characterPosition) characterPosition = geometry.restorePosition(settings, area);
    layout = geometry.calculate(settings, characterPosition, area);
    characterPosition = { x: layout.character.x, y: layout.character.y };
    pet.setBounds(rectangle(layout.bounds));
    // Align renderer coordinates with the actual native integer bounds.
    layout.bounds = pet.getBounds();
    panelWindow?.setBounds(rectangle(layout.popover)); speechWindow?.setBounds(rectangle(layout.speech));
  }
  function savePosition() {
    if (characterPosition) store.settings({ position: { ...characterPosition, anchor: 'character' } });
  }
  function motion(name) { currentMotion = name; pet?.webContents.send('pet:motion', name); }
  function showPet() {
    dismissed = false;
    if (!pet || pet.isDestroyed()) return;
    const wasVisible = pet.isVisible();
    pet.setIgnoreMouseEvents(true, { forward: true }); pet.showInactive();
    if (!wasVisible) { companion?.resetIdle(); motion('peek'); }
    broadcast();
  }
  function hideToTray() {
    dismissed = true; drag = null; petHover = false; panelSuppressed = false;
    hidePanel(); clearSpeech(); companion?.resetIdle();
    if (pet && !pet.isDestroyed()) { pet.webContents.send('pet:hidden'); pet.hide(); }
    settingsWindow?.hide();
  }
  function showPanel(pin = false) {
    clearTimeout(panelHideTimer);
    if (!pet.isVisible() || drag || (panelSuppressed && !pin)) return;
    panelPinned = pin || panelPinned; clearSpeech();
    panelWindow.setBounds(rectangle(layout.popover));
    if (pin) panelWindow.show(); else panelWindow.showInactive();
    broadcast();
  }
  function schedulePanelHide() {
    clearTimeout(panelHideTimer);
    panelHideTimer = setTimeout(() => { if (!panelPinned && !panelHover && !petHover) hidePanel(); }, 450);
  }
  function say(result) {
    if (!result || !pet.isVisible() || suspended || locked || drag) return;
    motion(result.motion);
    if (panelWindow.isVisible()) return;
    clearSpeech(); speech = { text: result.text, until: Date.now() + store.read().settings.speechSeconds * 1000 };
    speechWindow.setBounds(rectangle(layout.speech)); broadcast(); speechWindow.showInactive();
    speechTimer = setTimeout(() => { clearSpeech(); broadcast(); }, store.read().settings.speechSeconds * 1000);
  }
  function observeVisibility() {
    if (!store || !pet || !activity || !monitor) return;
    const localRunning = activity.state.task?.status === 'running';
    const reliable = (monitor.state.supported && !!monitor.state.checkedAt) || !!activity.state.task;
    if (!reliable) { broadcast(); return; }
    const running = monitor.state.running || localRunning;
    const visibility = followVisibility({ running, previousRunning, dismissed, background, enabled: store.read().settings.followCodex });
    if (visibility.show) showPet();
    if (visibility.hide) { hidePanel(); clearSpeech(); pet.webContents.send('pet:hidden'); pet.hide(); companion?.resetIdle(); }
    dismissed = visibility.dismissed; previousRunning = running; broadcast();
  }
  function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
    settingsWindow = new BrowserWindow({ width: 1000, height: 800, minWidth: 740, minHeight: 620,
      title: 'Miko · Codex 桌宠设置', backgroundColor: store.read().settings.theme === 'dark' ? '#151920' : '#f6f7f3', autoHideMenuBar: true,
      icon: path.join(ROOT, 'assets', 'icon.png'), webPreferences: webPreferences() });
    protect(settingsWindow, 'settings.html'); settingsWindow.loadFile(path.join(ROOT, 'renderer', 'settings.html'));
    settingsWindow.on('closed', () => { settingsWindow = null; });
  }
  function startCodex() {
    codex.start({ enabled: store.read().settings.dataSource === 'codex' && !process.env.MORI_TEST_DATA_DIR,
      executable: store.read().settings.codexExecutable, desktopBinary: monitor.state.cliPath || null });
  }
  function setLoginPreference(enabled) {
    if (process.platform === 'linux') return require('./linux-desktop.cjs').setAutostart(enabled, process.execPath);
    app.setLoginItemSettings({ name: APP_NAME, openAtLogin: enabled, path: process.execPath, args: ['--background'] });
    app.setLoginItemSettings({ name: LEGACY_NAME, openAtLogin: false });
  }
  function applySettings(patch) {
    validateSettings(patch); const previous = store.read().settings;
    if ('startAtLogin' in patch) {
      if (!['win32', 'linux'].includes(process.platform) || !app.isPackaged) throw new TypeError('开机待命需要运行打包后的 Windows / Ubuntu 程序');
      setLoginPreference(patch.startAtLogin);
    }
    try { store.settings(patch); }
    catch (error) { if ('startAtLogin' in patch) setLoginPreference(previous.startAtLogin); throw error; }
    const settings = store.read().settings;
    for (const win of [pet, panelWindow, speechWindow]) win?.setAlwaysOnTop(settings.alwaysOnTop);
    if ('scale' in patch || 'avatar' in patch) {
      if (characterPosition && layout) {
        const next = geometry.dimensions(settings), old = layout.character;
        characterPosition = { x: old.x + (old.width - next.width) / 2, y: old.y + old.height - next.height };
      }
      placePet(layout?.area); savePosition();
    }
    if ('theme' in patch) settingsWindow?.setBackgroundColor(patch.theme === 'dark' ? '#151920' : '#f6f7f3');
    if (trayMenu) trayMenu.getMenuItemById('pause-speech').checked = !settings.speechEnabled;
    if (patch.speechEnabled === false) { clearSpeech(); companion.resetIdle(); }
    if (patch.followCodex === false) showPet();
    if (patch.followCodex === true && previousRunning === false) { pet.hide(); hidePanel(); clearSpeech(); }
    if ('dataSource' in patch || 'codexExecutable' in patch) startCodex();
    broadcast(); return snapshot();
  }
  function recoverPet() {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
    characterPosition = geometry.restorePosition({ ...store.read().settings, position: null }, area);
    placePet(area); savePosition(); showPet();
  }
  function tick() {
    if (!companion || !pet) return;
    const idleSeconds = powerMonitor.getSystemIdleTime(), state = snapshot();
    const blocked = suspended || locked || !!drag || panelWindow.isVisible() || !!settingsWindow?.isVisible();
    const result = companion.tick(state.settings, { idleSeconds, visible: pet.isVisible(), blocked, running: state.task.status === 'running' });
    say(result);
    const next = idleSeconds >= 900 && state.task.status !== 'running' ? 'sleepy' : 'idle';
    if (next !== currentMotion && ['sleepy', 'idle'].includes(currentMotion)) motion(next);
  }
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    const historyPath = path.join(profileDirectory, 'speech-history.json'); let history = {};
    try {
      const saved = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      if (typeof saved.day === 'string' && Number.isInteger(saved.count) && saved.count >= 0 && Number.isFinite(saved.lastAt)) history = saved;
    } catch { /* No history on first launch. */ }
    companion = new Companion({ history, saveHistory(value) {
      try { fs.writeFileSync(historyPath + '.tmp', JSON.stringify(value), { mode: 0o600 }); fs.renameSync(historyPath + '.tmp', historyPath); }
      catch { /* A storage failure must not terminate the companion. */ }
    } });
    if (['win32', 'linux'].includes(process.platform) && app.isPackaged) {
      try { setLoginPreference(store.read().settings.startAtLogin); }
      catch { store.warning = [store.warning, '开机项更新失败，请在设置中重新切换开机待命。'].filter(Boolean).join(' '); }
    }
    activity = new SessionActivity(observeVisibility, process.env.MORI_TEST_DATA_DIR ? { home: path.join(profileDirectory, 'test-codex-home') } : {});
    codex = new CodexService(state => { if (state.codexHome) activity.setHome(state.codexHome); broadcast(); });
    monitor = new DesktopMonitor(observation => {
      if (observation.cliPath && codex.config?.desktopBinary !== observation.cliPath && ['missing', 'error'].includes(codex.state.status)) startCodex();
      observeVisibility();
    }, process.platform, app.isPackaged ? path.join(process.resourcesPath, 'windows', 'observe.ps1') : path.join(__dirname, 'windows', 'observe.ps1'));
    const options = { frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
      skipTaskbar: true, hasShadow: false, alwaysOnTop: store.read().settings.alwaysOnTop, show: false, webPreferences: webPreferences() };
    pet = new BrowserWindow({ ...options, width: 300, height: 400 });
    panelWindow = new BrowserWindow({ ...options, webPreferences: webPreferences(), width: 350, height: 330 });
    speechWindow = new BrowserWindow({ ...options, webPreferences: webPreferences(), width: 260, height: 58, focusable: false });
    placePet();
    for (const [win, file] of [[pet, 'pet.html'], [panelWindow, 'panel.html'], [speechWindow, 'speech.html']]) {
      protect(win, file); win.loadFile(path.join(ROOT, 'renderer', file));
    }
    speechWindow.setIgnoreMouseEvents(true);
    pet.once('ready-to-show', () => { if (!dismissed && !background) showPet(); });
    pet.on('hide', () => { hidePanel(); clearSpeech(); });
    tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png')));
    tray.setToolTip('Miko · Codex 桌面伙伴');
    trayMenu = Menu.buildFromTemplate([
      { label: '显示 Miko', click: showPet }, { label: '找回桌宠（当前屏幕）', click: recoverPet },
      { label: '设置…', click: openSettings }, { id: 'pause-speech', label: '暂停主动发言', type: 'checkbox', checked: !store.read().settings.speechEnabled,
        click: item => applySettings({ speechEnabled: !item.checked }) },
      { label: '收起桌宠到托盘', click: hideToTray }, { type: 'separator' }, { label: '退出桌宠', click: () => app.quit() },
    ]); tray.setContextMenu(trayMenu);
    tray.on('click', showPet); tray.on('double-click', showPet);
    server = createBridge({ token: store.token, onUpdate(input) {
      store.update(input, 'connector'); integration.lastEventAt = new Date().toISOString(); broadcast();
    }, onError(error) { integration.error = error.code === 'EADDRINUSE' ? '本机接口端口 47831 已被占用。其他功能可继续使用。' : '本机接口启动失败。'; integration.ready = false; broadcast(); } });
    server.on('listening', () => { integration.ready = true; broadcast(); });
    ipcMain.handle('state:get', event => { trusted(event); return snapshot(); });
    ipcMain.handle('settings:save', (event, patch) => { trusted(event, true); return applySettings(patch); });
    ipcMain.handle('pet:scale', (event, steps) => {
      const win = trusted(event);
      if (win !== pet || !Number.isInteger(steps) || Math.abs(steps) > 10 || steps === 0) throw new TypeError('缩放步数无效');
      const current = store.read().settings.scale, scale = geometry.zoomScale(current, steps);
      return scale === current ? snapshot() : applySettings({ scale });
    });
    ipcMain.handle('usage:save', (event, input) => {
      trusted(event, true); const { applyUpdate } = require('./model.cjs');
      const next = applyUpdate(store.read(), input, 'manual'); next.settings.dataSource = 'manual'; store.save(next);
      startCodex(); broadcast(); return snapshot();
    });
    ipcMain.handle('phrases:file', async (event, input) => {
      trusted(event, true);
      if (!input || !['import', 'export'].includes(input.action) || !CATEGORIES.includes(input.category)) throw new TypeError('文案操作无效');
      if (input.action === 'export') {
        const result = await dialog.showSaveDialog(settingsWindow, { title: '导出 Miko 文案', defaultPath: 'Miko-文案.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!result.canceled && result.filePath) {
          const banks = Object.fromEntries(CATEGORIES.map(key => [key, store.read().settings.phraseBanks[key] || defaultLines[key]]));
          await fs.promises.writeFile(result.filePath, JSON.stringify({ version: 1, phraseBanks: banks }, null, 2), { mode: 0o600 });
        }
      } else {
        const result = await dialog.showOpenDialog(settingsWindow, { title: '导入文案（TXT 导入当前分类）', properties: ['openFile'], filters: [{ name: '文案', extensions: ['json', 'txt'] }] });
        if (!result.canceled && result.filePaths[0]) {
          const handle = await fs.promises.open(result.filePaths[0], 'r'); let text;
          try {
            if ((await handle.stat()).size > 1024 * 1024) throw new TypeError('文案文件不能超过 1 MB');
            const buffer = Buffer.alloc(1024 * 1024 + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            if (bytesRead > 1024 * 1024) throw new TypeError('文案文件不能超过 1 MB');
            text = buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
          } finally { await handle.close(); }
          let banks;
          if (path.extname(result.filePaths[0]).toLowerCase() === '.txt') banks = { [input.category]: [...new Set(text.split(/\r?\n/).map(line => line.trim()).filter(Boolean))] };
          else {
            const parsed = JSON.parse(text);
            if (parsed.version !== 1 || !parsed.phraseBanks) throw new TypeError('请使用 Miko 导出的 version: 1 文案 JSON');
            banks = parsed.phraseBanks;
          }
          validateSettings({ phraseBanks: banks });
          return applySettings({ phraseBanks: { ...store.read().settings.phraseBanks, ...banks } });
        }
      }
      return snapshot();
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
    ipcMain.handle('pet:panel', (event, input) => {
      const win = trusted(event);
      if (![pet, panelWindow].includes(win) || !input || !['hover', 'toggle', 'pin', 'close'].includes(input.action)) throw new TypeError('面板操作无效');
      if (input.action === 'close') hidePanel();
      else if (input.action === 'pin') { panelSuppressed = false; showPanel(true); }
      else if (input.action === 'toggle') { if (panelPinned) hidePanel(); else { panelSuppressed = false; showPanel(true); } }
      else {
        if (typeof input.value !== 'boolean') throw new TypeError('悬停状态无效');
        if (win === pet) { petHover = input.value; if (!petHover) panelSuppressed = false; }
        else panelHover = input.value;
        if (input.value) { clearTimeout(panelHideTimer); if (win === pet) showPanel(); }
        else schedulePanelHide();
      }
      return snapshot();
    });
    ipcMain.handle('pet:action', (event, action) => {
      const win = trusted(event);
      if (action === 'settings') openSettings();
      else if (action === 'hide') hideCurrent(win);
      else if (action === 'show') showPet();
      else if (action === 'codex-help') shell.openExternal('https://developers.openai.com/codex/cli/');
      else if (action === 'reset-position') recoverPet();
      else if (action === 'touch') {
        if (win !== pet || drag) return;
        const category = ['click', 'affection', 'click', 'cheer'][clickIndex % 4];
        const result = companion.interact(store.read().settings, category);
        if (result) { clickIndex++; say(result); }
      } else if (typeof action === 'string' && action.startsWith('preview:') && CATEGORIES.includes(action.slice(8))) {
        trusted(event, true); showPet(); say(companion.choose(store.read().settings, action.slice(8)));
      } else if (action === 'quit') { trusted(event, true); setImmediate(() => app.quit()); }
      else throw new Error('Unknown action');
    });
    ipcMain.on('pet:interactive', (event, value) => {
      const win = trusted(event); if (win === pet) pet.setIgnoreMouseEvents(value !== true, { forward: true });
    });
    ipcMain.on('pet:motion-ended', event => {
      if (trusted(event) === pet) motion(powerMonitor.getSystemIdleTime() >= 900 ? 'sleepy' : 'idle');
    });
    ipcMain.on('pet:drag', (event, input) => {
      if (trusted(event) !== pet || !input || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
      if (input.phase === 'start') { drag = { x: input.x, y: input.y, position: { ...characterPosition } }; hidePanel(); clearSpeech(); motion('drag'); }
      else if (input.phase === 'move' && drag) {
        const area = screen.getDisplayNearestPoint({ x: input.x, y: input.y }).bounds;
        characterPosition = geometry.clampCharacter({ x: drag.position.x + input.x - drag.x, y: drag.position.y + input.y - drag.y }, geometry.dimensions(store.read().settings), area);
        placePet(area); broadcast();
      } else if (input.phase === 'end') {
        drag = null; motion('idle'); clearTimeout(savedPositionTimer);
        savedPositionTimer = setTimeout(() => { try { savePosition(); } catch { /* Keep running if storage is unavailable. */ } }, 200);
      }
    });
    const displayChanged = () => { placePet(); broadcast(); };
    screen.on('display-metrics-changed', displayChanged); screen.on('display-removed', displayChanged);
    powerMonitor.on('suspend', () => { suspended = true; hidePanel(); clearSpeech(); companion.resetIdle(); motion('paused'); });
    powerMonitor.on('resume', () => { suspended = false; companion.resetIdle(); motion('idle'); });
    powerMonitor.on('lock-screen', () => { locked = true; hidePanel(); clearSpeech(); companion.resetIdle(); motion('paused'); });
    powerMonitor.on('unlock-screen', () => { locked = false; companion.resetIdle(); motion('idle'); });
    monitor.start(); activity.start(); startCodex();
    idleTimer = setInterval(() => { tick(); broadcast(); }, 5000); idleTimer.unref();
    if (store.warning) openSettings();
  }).catch(error => { console.error('Miko 启动失败：', error.message); app.quit(); });
  app.on('second-instance', showPet); app.on('activate', showPet); app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true; clearTimeout(savedPositionTimer); clearTimeout(speechTimer); clearTimeout(panelHideTimer); clearInterval(idleTimer);
    try { if (store) savePosition(); } catch { /* Preserve quit if storage is unavailable. */ }
    codex?.stop(); activity?.stop(); monitor?.stop(); server?.close(); tray?.destroy();
  });
}
