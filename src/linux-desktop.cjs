'use strict';
const fs = require('node:fs');
const path = require('node:path');
function observeLinux(proc = '/proc') {
  // Match actual desktop executables. Our read-only `codex app-server` helper is excluded.
  const names = new Set(['chatgpt', 'chatgpt-desktop', 'codex-desktop']);
  let running = false;
  for (const entry of fs.readdirSync(proc)) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const executable = path.basename(fs.readlinkSync(path.join(proc, entry, 'exe'))).toLowerCase();
      if (names.has(executable)) { running = true; break; }
    } catch { /* Processes can exit or belong to another user. */ }
  }
  return { running, status: 'unknown', available: false, supported: true,
    checkedAt: new Date().toISOString(), error: null, appName: running ? 'Linux 桌面客户端' : null };
}
function setAutostart(enabled, executable, configHome = process.env.XDG_CONFIG_HOME || path.join(require('node:os').homedir(), '.config')) {
  const directory = path.join(configHome, 'autostart'), target = path.join(directory, 'miko-gpt-pet.desktop');
  if (!enabled) { fs.rmSync(target, { force: true }); return; }
  if (/[\r\n\0]/.test(executable)) throw new TypeError('程序路径无效');
  fs.mkdirSync(directory, { recursive: true });
  const escaped = executable.replace(/(["`$\\])/g, '\\$1').replace(/%/g, '%%');
  const text = `[Desktop Entry]\nType=Application\nName=Miko GPT Pet\nExec="${escaped}" --background --ozone-platform=x11\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
  fs.writeFileSync(target + '.tmp', text, { mode: 0o600 }); fs.renameSync(target + '.tmp', target);
}
module.exports = { observeLinux, setAutostart };
