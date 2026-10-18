'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { initialState, localDay, applyUpdate, normalizeState, validateSettings, taskForView } = require('../src/model.cjs');
const { Store } = require('../src/store.cjs');
const date = new Date(2026, 9, 18, 12, 0);

test('new pet reports unknown values instead of fabricated usage', () => {
  const state = initialState(date);
  assert.equal(state.usage.todayTokens, null);
  assert.equal(state.usage.fiveHour.remainingPercent, null);
  assert.equal(state.usage.weekly.remainingPercent, null);
  assert.equal(state.task.status, 'unknown');
});
test('updates are atomic, labelled by source and do not add cumulative totals twice', () => {
  const input = { day: localDay(date), todayTokens: 1234, fiveHour: { remainingPercent: 62.5 }, task: { status: 'running', label: '测试任务' } };
  const before = initialState(date);
  const once = applyUpdate(before, input, 'connector', date);
  const twice = applyUpdate(once, input, 'connector', date);
  assert.equal(twice.usage.todayTokens, 1234);
  assert.equal(once.usage.source, 'connector');
  assert.equal(once.usage.fiveHour.remainingPercent, 62.5);
  assert.equal(once.task.label, '测试任务');
  assert.equal(before.usage.todayTokens, null);
  assert.throws(() => applyUpdate(once, { todayTokens: 100, day: localDay(date), weekly: { remainingPercent: 101 } }, 'manual', date));
  assert.equal(once.usage.todayTokens, 1234);
});
test('invalid, unexpected and nonfinite inputs are rejected', () => {
  const invalid = [null, [], {}, { todayTokens: 20 }, { day: '1999-01-01', todayTokens: 20 },
    { day: localDay(date), todayTokens: -1 }, { day: localDay(date), todayTokens: 1.5 },
    { day: localDay(date), todayTokens: Number.MAX_SAFE_INTEGER + 1 },
    { weekly: { remainingPercent: NaN } }, { weekly: { remainingPercent: 50, resetsAt: 'tomorrow' } },
    { weekly: { remainingPercent: 50, resetsAt: '2026-01-01T00:00:00Z' } },
    { task: { status: 'success' } }, { task: { status: 'idle', label: 'x'.repeat(101) } },
    { settings: { scale: 1 } }, { weekly: { remainingPercent: 50, secret: 'x' } }];
  for (const value of invalid) assert.throws(() => applyUpdate(initialState(date), value, 'connector', date));
  assert.throws(() => validateSettings({ scale: 2 }));
  assert.throws(() => validateSettings({ followChatGPT: 'yes' }));
  assert.throws(() => validateSettings({ position: { x: NaN, y: 10 } }));
});
test('new local day clears only daily tokens; elapsed quota resets become unknown', () => {
  const reset = new Date(date.getTime() + 3600_000).toISOString();
  const state = applyUpdate(initialState(date), { day: localDay(date), todayTokens: 999, fiveHour: { remainingPercent: 0, resetsAt: reset }, weekly: { remainingPercent: 40 } }, 'manual', date);
  const expired = normalizeState(state, new Date(date.getTime() + 3600_001));
  assert.equal(expired.usage.fiveHour.remainingPercent, null);
  assert.equal(expired.usage.weekly.remainingPercent, 40);
  const tomorrow = normalizeState(state, new Date(2026, 9, 19, 0, 0));
  assert.equal(tomorrow.usage.todayTokens, null);
  assert.equal(tomorrow.usage.source, 'unknown');
  assert.equal(tomorrow.usage.day, '2026-10-19');
});
test('stale connector tasks fall back to UI detection, auto mode clears manual override', () => {
  const state = applyUpdate(initialState(date), { task: { status: 'running' } }, 'connector', date);
  const monitor = { running: true, status: 'idle', checkedAt: date.toISOString() };
  assert.equal(taskForView(state, monitor, date).source, 'connector');
  assert.equal(taskForView(state, monitor, new Date(date.getTime() + 120001)).status, 'idle');
  const manual = applyUpdate(state, { task: { status: 'error' } }, 'manual', date);
  assert.equal(taskForView(manual, monitor, date).status, 'error');
  const auto = applyUpdate(manual, { task: { status: 'unknown' } }, 'manual', date);
  assert.equal(taskForView(auto, monitor, date).source, 'accessibility');
  assert.equal(taskForView(auto, { running: false, status: 'idle' }, date).status, 'unknown');
});
test('settings and usage survive restart; live tasks do not; malformed state is backed up', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mori-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = new Store(directory);
  first.settings({ scale: 1.3, position: { x: 20, y: 30 } });
  first.update({ day: localDay(), todayTokens: 45, weekly: { remainingPercent: 61 }, task: { status: 'running' } }, 'manual');
  const second = new Store(directory);
  assert.equal(second.token, first.token);
  assert.equal(second.read().settings.scale, 1.3);
  assert.equal(second.read().usage.todayTokens, 45);
  assert.equal(second.read().usage.source, 'manual');
  assert.equal(second.read().usage.weekly.source, 'manual');
  assert.equal(second.read().task.status, 'unknown');
  const saved = JSON.parse(fs.readFileSync(first.filename));
  saved.usage.day = '2000-01-01';
  fs.writeFileSync(first.filename, JSON.stringify(saved));
  const nextDay = new Store(directory);
  assert.equal(nextDay.read().usage.source, 'unknown');
  assert.equal(nextDay.read().usage.todayTokens, null);
  fs.writeFileSync(first.filename, '{broken');
  const recovered = new Store(directory);
  assert.ok(recovered.warning);
  assert.ok(fs.readdirSync(directory).some(file => file.includes('.invalid-')));
});
