'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function parseObservation(text) {
  const value = JSON.parse(text.replace(/^\uFEFF/, '').trim());
  if (typeof value.running !== 'boolean' || !['unknown', 'idle', 'running'].includes(value.status)) throw new Error('Invalid monitor output');
  return { running: value.running, status: value.running ? value.status : 'unknown', available: value.available === true, supported: true, checkedAt: new Date().toISOString(), error: null };
}
class ChatGPTMonitor {
  constructor(onChange, platform = process.platform, scriptPath = path.join(__dirname, 'windows', 'observe.ps1')) {
    this.onChange = onChange; this.platform = platform; this.scriptPath = scriptPath; this.busy = false; this.stopped = false;
    this.state = { running: false, status: 'unknown', available: false, supported: platform === 'win32', checkedAt: null, error: null };
  }
  start() {
    if (this.platform !== 'win32') { this.onChange(this.state); return; }
    this.poll(); this.timer = setInterval(() => this.poll(), 5000);
  }
  poll() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let script;
    try { script = fs.readFileSync(this.scriptPath, 'utf8').replace(/^\uFEFF/, ''); }
    catch { this.busy = false; this.state = { ...this.state, status: 'unknown', available: false, checkedAt: null, error: '状态探测脚本缺失，请重新安装 Mori。' }; this.onChange(this.state); return; }
    this.child = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => {
        this.busy = false; this.child = null;
        if (this.stopped) return;
        try {
          if (error) throw error;
          this.state = parseObservation(stdout);
        } catch {
          // A failed observation is unknown, never evidence that ChatGPT closed.
          this.state = { ...this.state, status: 'unknown', available: false, checkedAt: null, error: '无法探测 ChatGPT；请检查 Windows PowerShell 是否可用。' };
        }
        this.onChange(this.state);
      });
  }
  stop() { this.stopped = true; clearInterval(this.timer); this.child?.kill(); }
}
module.exports = { ChatGPTMonitor, parseObservation };
