'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { initialState, validateSettings, migrateSettings, applyUpdate, normalizeState } = require('./model.cjs');

class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.filename = path.join(directory, 'state.json');
    this.state = initialState();
    this.warning = null;
    try {
      const saved = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
      if (saved.schemaVersion !== 1) throw new Error('不支持的存储版本');
      this.state.settings = { ...this.state.settings, ...migrateSettings(saved.settings) };
      // Validate persisted values before allowing them into renderer state.
      const input = {};
      if (saved.usage?.day === this.state.usage.day) {
        input.day = saved.usage.day; input.todayTokens = saved.usage.todayTokens;
      }
      for (const key of ['fiveHour', 'weekly']) {
        const q = saved.usage?.[key];
        if (q && (!q.resetsAt || Date.parse(q.resetsAt) > Date.now())) input[key] = { remainingPercent: q.remainingPercent, resetsAt: q.resetsAt };
      }
      if (Object.keys(input).length) {
        const restored = applyUpdate(this.state, input, 'unknown');
        if ('todayTokens' in input) for (const key of ['source', 'updatedAt']) restored.usage[key] = saved.usage[key];
        for (const key of ['fiveHour', 'weekly']) if (input[key]) {
          restored.usage[key].source = saved.usage[key].source;
          restored.usage[key].updatedAt = saved.usage[key].updatedAt;
        }
        this.state = restored;
      }
      // Task state describes live work, so it never survives an app restart.
    } catch (error) {
      if (error.code !== 'ENOENT') {
        fs.copyFileSync(this.filename, `${this.filename}.invalid-${Date.now()}`);
        this.warning = '旧配置无法读取，已保留备份并恢复默认设置。';
        this.state = initialState();
      }
    }
    const tokenPath = path.join(directory, 'bridge-token');
    try { this.token = fs.readFileSync(tokenPath, 'utf8').trim(); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!/^[a-f0-9]{64}$/.test(this.token || '')) {
      this.token = randomBytes(32).toString('hex');
      fs.writeFileSync(tokenPath, this.token, { mode: 0o600 });
    }
  }
  read() { return normalizeState(this.state); }
  save(next) {
    const temporary = `${this.filename}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filename);
    this.state = next;
  }
  settings(patch) {
    const next = this.read();
    Object.assign(next.settings, validateSettings(patch));
    this.save(next); return next;
  }
  update(input, source) {
    const next = applyUpdate(this.read(), input, source);
    this.save(next); return next;
  }
}
module.exports = { Store };
