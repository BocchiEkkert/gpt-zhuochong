'use strict';

const TASK_STATES = new Set(['unknown', 'idle', 'running', 'error']);
const DEFAULT_SETTINGS = Object.freeze({
  scale: 1, alwaysOnTop: true, followCodex: true,
  avatar: 'chibi', theme: 'light', dataSource: 'codex', codexExecutable: '',
  startAtLogin: false, reduceMotion: false, position: null,
});

function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function unknownQuota() {
  return { remainingPercent: null, resetsAt: null, updatedAt: null, source: 'unknown' };
}
function initialState(date = new Date()) {
  return {
    schemaVersion: 1,
    settings: { ...DEFAULT_SETTINGS },
    usage: { day: localDay(date), todayTokens: null, source: 'unknown', updatedAt: null,
      fiveHour: unknownQuota(), weekly: unknownQuota() },
    task: { status: 'unknown', label: '', source: 'unknown', updatedAt: null },
  };
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(message) { throw new TypeError(message); }
function onlyKeys(value, allowed, label) {
  if (!object(value)) fail(`${label} 必须是对象`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} 包含不支持的字段：${key}`);
}
function validateSettings(input) {
  onlyKeys(input, Object.keys(DEFAULT_SETTINGS), '设置');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'scale') {
      if (!Number.isFinite(value) || value < 0.65 || value > 3) fail('大小应在 65%–300% 之间');
    } else if (['avatar', 'theme', 'dataSource'].includes(key)) {
      const choices = { avatar: ['original', 'chibi'], theme: ['light', 'dark'], dataSource: ['codex', 'manual', 'connector'] };
      if (!choices[key].includes(value)) fail(`${key} 选项无效`);
    } else if (key === 'codexExecutable') {
      if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f]/.test(value)) fail('Codex 程序路径无效');
    } else if (key === 'position') {
      if (value !== null) {
        onlyKeys(value, ['x', 'y', 'anchor'], '窗口坐标');
        if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || (value.anchor !== undefined && value.anchor !== 'character')) fail('窗口坐标无效');
      }
    } else if (typeof value !== 'boolean') fail(`${key} 必须是布尔值`);
    out[key] = value;
  }
  return out;
}
function validateUpdate(input, date = new Date()) {
  onlyKeys(input, ['day', 'todayTokens', 'fiveHour', 'weekly', 'task'], '数据');
  if (Object.keys(input).length === 0) fail('没有需要更新的数据');
  const out = {};
  if ('todayTokens' in input) {
    if (input.day !== localDay(date)) fail('token 数据必须附带本机今天的 day（YYYY-MM-DD）');
    if (input.todayTokens !== null && (!Number.isSafeInteger(input.todayTokens) || input.todayTokens < 0)) fail('token 必须是非负安全整数或 null');
    out.day = input.day;
    out.todayTokens = input.todayTokens;
  } else if ('day' in input) fail('day 只能与 todayTokens 一起提交');
  for (const key of ['fiveHour', 'weekly']) {
    if (!(key in input)) continue;
    const quota = input[key];
    onlyKeys(quota, ['remainingPercent', 'resetsAt'], key);
    if (!('remainingPercent' in quota)) fail(`${key} 缺少 remainingPercent`);
    if (quota.remainingPercent !== null && (!Number.isFinite(quota.remainingPercent) || quota.remainingPercent < 0 || quota.remainingPercent > 100)) fail('剩余额度应在 0–100 之间或为 null');
    let resetsAt = null;
    if (quota.resetsAt !== null && quota.resetsAt !== undefined) {
      if (typeof quota.resetsAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(quota.resetsAt) || !Number.isFinite(Date.parse(quota.resetsAt))) fail('重置时间需要带时区的 ISO 日期');
      if (Date.parse(quota.resetsAt) <= date.getTime()) fail('重置时间必须晚于当前时间');
      resetsAt = new Date(quota.resetsAt).toISOString();
    }
    out[key] = { remainingPercent: quota.remainingPercent, resetsAt };
  }
  if ('task' in input) {
    onlyKeys(input.task, ['status', 'label'], 'task');
    if (!TASK_STATES.has(input.task.status)) fail('任务状态无效');
    if (input.task.label !== undefined && (typeof input.task.label !== 'string' || input.task.label.length > 100)) fail('任务说明不能超过 100 字');
    out.task = { status: input.task.status, label: input.task.label || '' };
  }
  return out;
}
function normalizeState(state, date = new Date()) {
  const next = structuredClone(state);
  if (next.usage.day !== localDay(date)) {
    next.usage.day = localDay(date);
    next.usage.todayTokens = null;
    next.usage.source = 'unknown';
    next.usage.updatedAt = null;
  }
  for (const key of ['fiveHour', 'weekly']) {
    const quota = next.usage[key];
    if (quota.resetsAt && Date.parse(quota.resetsAt) <= date.getTime()) next.usage[key] = unknownQuota();
  }
  return next;
}
function applyUpdate(state, input, source, date = new Date()) {
  const update = validateUpdate(input, date);
  const next = normalizeState(state, date);
  const now = date.toISOString();
  if ('todayTokens' in update) Object.assign(next.usage, {
    day: update.day, todayTokens: update.todayTokens,
    source: update.todayTokens === null ? 'unknown' : source, updatedAt: now,
  });
  for (const key of ['fiveHour', 'weekly']) if (key in update) {
    next.usage[key] = { ...update[key], source: update[key].remainingPercent === null ? 'unknown' : source, updatedAt: now };
  }
  if (update.task) next.task = { ...update.task, source, updatedAt: now };
  return next;
}
function taskForView(state, monitor, date = new Date()) {
  const task = state.task;
  if (task.source === 'manual' && task.status !== 'unknown') return task;
  if (task.source === 'connector' && date.getTime() - Date.parse(task.updatedAt) < 120_000) return task;
  if (monitor.running && monitor.status !== 'unknown') {
    return { status: monitor.status, label: '', source: 'accessibility', updatedAt: monitor.checkedAt };
  }
  return { status: 'unknown', label: '', source: 'unknown', updatedAt: null };
}
function migrateSettings(saved) {
  const settings = { ...saved };
  if ('followChatGPT' in settings) {
    if (!('followCodex' in settings)) settings.followCodex = settings.followChatGPT;
    delete settings.followChatGPT;
  }
  return validateSettings(settings);
}
module.exports = { DEFAULT_SETTINGS, unknownQuota, migrateSettings, localDay, initialState, validateSettings, validateUpdate, normalizeState, applyUpdate, taskForView };
