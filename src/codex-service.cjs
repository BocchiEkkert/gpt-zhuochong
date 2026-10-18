'use strict';
const { createHash } = require('node:crypto');
const { CodexClient } = require('./codex-client.cjs');
const { discoverCodex } = require('./codex-discovery.cjs');
const { readRateLimits, readDailyUsage } = require('./codex-data.cjs');
const { unknownQuota } = require('./model.cjs');
function emptyCodex() {
  return { status: 'disabled', message: 'Codex 自动读取未启用', executable: null, codexHome: null,
    quotaUpdatedAt: null, fiveHour: unknownQuota(), weekly: unknownQuota(), daily: null,
    dailyNote: '等待 Codex 日统计', plan: null, ordinaryUsageAllowed: null, quotaNote: null };
}
class CodexService {
  constructor(onChange, options = {}) {
    this.onChange = onChange; this.discover = options.discover || discoverCodex;
    this.createClient = options.createClient || (exe => new CodexClient(exe));
    this.state = emptyCodex(); this.generation = 0; this.accountEpoch = 0; this.enabled = false; this.busy = false;
  }
  emit() { this.onChange(this.state); }
  start(config = {}) {
    this.stop(); this.enabled = config.enabled !== false; this.config = config;
    this.state = emptyCodex(); this.dailyUnsupported = false; this.lastDaily = 0; this.accountKey = null; this.clientReady = false; this.refreshQueued = false;
    if (!this.enabled) { this.emit(); return; }
    this.timer = setInterval(() => this.refresh(), 30000); this.timer.unref?.();
    this.refresh();
  }
  async refresh() {
    if (!this.enabled || this.busy) return;
    this.busy = true; const generation = this.generation;
    const current = () => this.enabled && generation === this.generation;
    try {
      if (!this.client || this.client.closed) {
        this.state = { ...emptyCodex(), status: 'connecting', message: '正在寻找并连接本机 Codex…' }; this.emit();
        const executable = await this.discover(this.config.executable || '', this.config.desktopBinary);
        if (!current()) return;
        if (!executable) { this.state = { ...emptyCodex(), status: 'missing', message: '未找到 Codex CLI；可选择桌面版内置 codex.exe，或安装官方 Codex CLI 后重试。' }; this.emit(); return; }
        const client = this.createClient(executable); this.client = client; this.clientReady = false;
        client.on('disconnected', () => {
          if (!current()) return;
          this.state = { ...emptyCodex(), executable, status: 'error', message: 'Codex 连接已断开，将自动重试。' }; this.emit();
        });
        client.on('notification', method => {
          if (!current() || !['account/updated', 'account/rateLimits/updated'].includes(method)) return;
          if (method === 'account/updated') {
            this.accountEpoch++; this.refreshQueued = true;
            this.state = { ...this.state, daily: null, quotaUpdatedAt: null, fiveHour: unknownQuota(), weekly: unknownQuota() };
            this.lastDaily = 0; this.emit();
          }
          clearTimeout(this.notificationTimer); this.notificationTimer = setTimeout(() => this.refresh(), 350);
        });
        const initialized = await client.start();
        if (!current()) { client.stop(); return; }
        this.clientReady = true;
        this.state.executable = executable;
        this.state.codexHome = typeof initialized?.codexHome === 'string' ? initialized.codexHome : null;
      }
      const epoch = this.accountEpoch;
      const sameAccount = () => current() && epoch === this.accountEpoch;
      const accountResult = await this.client.request('account/read', { refreshToken: false });
      if (!sameAccount()) return;
      const account = accountResult?.account;
      if (!account) {
        this.state = { ...emptyCodex(), executable: this.state.executable, codexHome: this.state.codexHome,
          status: 'signedOut', message: '请先在 Codex 中使用 ChatGPT 账户登录，再点击刷新。' }; this.emit(); return;
      }
      if (account.type !== 'chatgpt') {
        this.state = { ...emptyCodex(), executable: this.state.executable, codexHome: this.state.codexHome,
          status: 'unsupported', message: '当前 Codex 使用 API Key 或其他提供商登录，没有 ChatGPT 订阅的五小时 / 周额度。' }; this.emit(); return;
      }
      const key = createHash('sha256').update(JSON.stringify([account.type, account.email, account.planType])).digest('hex');
      if (key !== this.accountKey) {
        this.accountKey = key; this.lastDaily = 0;
        this.state = { ...this.state, daily: null, quotaUpdatedAt: null, fiveHour: unknownQuota(), weekly: unknownQuota() };
      }
      const result = await this.client.request('account/rateLimits/read');
      if (!sameAccount()) return;
      if (result?.accountId && result.accountId !== this.accountId) { this.state.daily = null; this.lastDaily = 0; this.accountId = result.accountId; }
      const rate = readRateLimits(result);
      this.state = { ...this.state, ...rate, status: 'connected', message: rate.quotaNote || '已连接 Codex 官方账户额度 · 每 30 秒刷新' };
      this.emit();
      if (!this.dailyUnsupported && Date.now() - this.lastDaily >= 55000) {
        this.lastDaily = Date.now();
        try {
          const dailyResult = await this.client.request('account/usage/read');
          if (!sameAccount()) return;
          this.state.daily = readDailyUsage(dailyResult);
          this.state.dailyNote = this.state.daily ? '按 Codex 返回的日期统计，可能存在同步延迟。' : 'Codex 尚未返回今日账户 token 统计。';
        } catch (error) {
          if (!sameAccount()) return;
          if (error.code === -32601) this.dailyUnsupported = true;
          this.state.daily = null;
          this.state.dailyNote = this.dailyUnsupported ? '此 Codex 版本不支持账户日统计；可升级 Codex，或切换手动记录。' : '账户日统计读取失败，稍后重试。';
        }
        this.emit();
      }
    } catch (error) {
      if (!current()) return;
      this.state = { ...this.state, status: error.code === -32601 ? 'unsupported' : 'error', daily: null,
        quotaUpdatedAt: null, fiveHour: unknownQuota(), weekly: unknownQuota(),
        message: error.code === -32601 ? '此 Codex 版本不支持额度查询，请升级 Codex CLI。' : 'Codex 读取失败。请确认已登录、网络可用，或重新选择 Codex CLI。' };
      if (!this.clientReady || this.client?.closed) { this.client?.stop(); this.client = null; this.clientReady = false; }
      this.emit();
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        if (this.refreshQueued) { this.refreshQueued = false; clearTimeout(this.notificationTimer); this.notificationTimer = setTimeout(() => this.refresh(), 100); }
      }
    }
  }
  stop() {
    this.enabled = false; this.generation++; this.busy = false;
    clearInterval(this.timer); clearTimeout(this.notificationTimer);
    const client = this.client; this.client = null; client?.removeAllListeners(); client?.stop();
  }
}
module.exports = { CodexService, emptyCodex };
