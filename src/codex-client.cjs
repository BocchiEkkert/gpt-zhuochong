'use strict';
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

class RpcError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
class CodexClient extends EventEmitter {
  constructor(executable, options = {}) {
    super(); this.executable = executable; this.args = options.args || ['app-server'];
    this.env = options.env || process.env; this.spawn = options.spawn || spawn;
    this.timeout = options.timeout || 15000; this.pending = new Map(); this.nextId = 1;
    this.buffer = ''; this.closed = false;
  }
  async start() {
    if (this.closed) throw new Error('连接已关闭');
    this.child = this.spawn(this.executable, this.args, { windowsHide: true, shell: false,
      stdio: ['pipe', 'pipe', 'pipe'], env: this.env });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receive(chunk));
    // Backend diagnostics can contain paths or account information; do not log them.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.fail(new Error('Codex 输入连接中断')));
    this.child.on('error', () => this.fail(new Error('无法启动 Codex 命令行程序')));
    this.child.on('exit', () => this.fail(new Error('Codex 连接已断开')));
    const initialized = await this.request('initialize', {
      clientInfo: { name: 'miko_desktop_pet', title: 'Miko desktop companion', version: '0.4.0' },
      capabilities: { experimentalApi: false },
    });
    this.notify('initialized');
    return initialized;
  }
  receive(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    // A read-only client never needs an unbounded response containing history.
    if (this.buffer.length > 4 * 1024 * 1024) { this.fail(new Error('Codex 响应超出大小限制')); this.stop(); return; }
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (!message || typeof message !== 'object') continue;
      if (Object.hasOwn(message, 'id') && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new RpcError(message.error.code, 'Codex 请求未成功'));
        else pending.resolve(message.result);
      } else if (message.method && Object.hasOwn(message, 'id')) {
        // Never approve tools, execute turns, provide secrets, or service agent requests.
        this.write({ id: message.id, error: { code: -32601, message: 'Read-only client' } });
      } else if (typeof message.method === 'string') this.emit('notification', message.method, message.params);
    }
  }
  write(message) {
    if (this.closed || !this.child?.stdin.writable) throw new Error('Codex 未连接');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params) {
    if (this.closed) return Promise.reject(new Error('Codex 未连接'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 请求超时')); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method) { this.write({ method }); }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear(); this.emit('disconnected');
  }
  stop() {
    this.fail(new Error('Codex 连接已关闭'));
    this.child?.stdin.destroy(); this.child?.kill();
    this.removeAllListeners();
  }
}
module.exports = { CodexClient, RpcError };
