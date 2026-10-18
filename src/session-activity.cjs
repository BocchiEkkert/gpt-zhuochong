'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
function parseActivity(text, now = new Date()) {
  let latest = null;
  for (const line of text.split('\n')) {
    // Parse only event metadata. Prompts, tool output and responses are not retained.
    if (!/"type"\s*:\s*"event_msg"/.test(line)) continue;
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== 'event_msg') continue;
    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 60000 || now.getTime() - timestamp > 120000) continue;
    const type = event.payload?.type;
    let status;
    if (['task_started', 'turn_started', 'token_count'].includes(type)) status = 'running';
    else if (['task_complete', 'turn_complete', 'turn_completed', 'turn_aborted', 'task_aborted'].includes(type)) status = 'idle';
    else if (type === 'error') status = 'error';
    else continue;
    if (!latest || timestamp >= Date.parse(latest.updatedAt)) latest = {
      status, label: status === 'running' ? '本机 Codex 任务运行中' : status === 'idle' ? '本机 Codex 任务已结束' : '本机 Codex 任务异常',
      source: 'codexLocal', updatedAt: new Date(timestamp).toISOString(),
    };
  }
  return latest;
}
async function recentSessionFiles(root, now = Date.now()) {
  const files = []; let entries = 0;
  async function visit(directory, depth) {
    if (depth > 4) return;
    let children; try { children = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const child of children) {
      if (++entries > 25000) throw new Error('Session directory too large');
      const full = path.join(directory, child.name);
      if (child.isDirectory()) await visit(full, depth + 1);
      else if (child.isFile() && child.name.endsWith('.jsonl')) {
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs < 180000) files.push({ path: full, mtime: stat.mtimeMs, size: stat.size });
      }
    }
  }
  await visit(root, 0);
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, 20);
}
class SessionActivity {
  constructor(onChange, options = {}) {
    this.onChange = onChange; this.defaultHome = options.home || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    this.home = this.defaultHome; this.state = { task: null, error: null }; this.busy = false; this.generation = 0;
  }
  start() { this.stop(); this.active = true; this.poll(); this.timer = setInterval(() => this.poll(), 10000); this.timer.unref?.(); }
  setHome(home) { if (typeof home === 'string' && path.isAbsolute(home) && home !== this.home) { this.home = home; this.generation++; this.busy = false; this.state = { task: null, error: null }; } }
  async poll() {
    if (this.busy || !this.active) return;
    this.busy = true; const generation = this.generation;
    try {
      const files = await recentSessionFiles(path.join(this.home, 'sessions'));
      let latest = null;
      for (const file of files) {
        const handle = await fs.open(file.path, 'r');
        let text;
        try {
          const length = Math.min(file.size, 256 * 1024); const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, file.size - length));
          text = buffer.subarray(0, bytesRead).toString('utf8');
        } finally { await handle.close(); }
        const task = parseActivity(text);
        // Any recent running task takes precedence over completed parallel sessions.
        if (task && (!latest || (task.status === 'running' && latest.status !== 'running') || ((task.status === 'running') === (latest.status === 'running') && task.updatedAt > latest.updatedAt))) latest = task;
      }
      if (this.active && generation === this.generation) { this.state = { task: latest, error: null }; this.onChange(this.state); }
    } catch {
      if (this.active && generation === this.generation) { this.state = { task: null, error: '本机任务事件暂时不可读' }; this.onChange(this.state); }
    } finally { if (generation === this.generation) this.busy = false; }
  }
  stop() { this.active = false; this.generation++; this.busy = false; clearInterval(this.timer); }
}
module.exports = { parseActivity, recentSessionFiles, SessionActivity };
