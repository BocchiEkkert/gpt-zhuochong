'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { once } = require('node:events');
const { CodexClient } = require('../src/codex-client.cjs');
const { CodexService, emptyCodex } = require('../src/codex-service.cjs');
const { readRateLimits, readDailyUsage, codexUsageForView } = require('../src/codex-data.cjs');
const { initialState, localDay, migrateSettings, validateSettings, applyUpdate } = require('../src/model.cjs');
const { composeView } = require('../src/view-state.cjs');
const { parseActivity, recentSessionFiles, SessionActivity } = require('../src/session-activity.cjs');
const { nativeFromNpm } = require('../src/codex-discovery.cjs');
const fixture = path.join(__dirname, 'fixtures', 'codex-server.cjs');
const date = new Date(2026, 9, 18, 12, 0);
const future = Math.floor(date.getTime() / 1000) + 3600;
function rate(primary = 25, secondary = 60) { return { rateLimits: { limitId: 'codex', primary: { usedPercent: primary, windowDurationMins: 300, resetsAt: future }, secondary: { usedPercent: secondary, windowDurationMins: 10080, resetsAt: future + 86400 } } }; }
function fakeClient(scenario = 'normal') { return new CodexClient(process.execPath, { args: [fixture], timeout: 1000, env: { ...process.env, MORI_FAKE_SCENARIO: scenario } }); }

test('Codex windows are matched by duration, use remaining percentage and expire to unknown', () => {
  const result = rate(100, 0); const old = result.rateLimits.primary; result.rateLimits.primary = result.rateLimits.secondary; result.rateLimits.secondary = old;
  const parsed = readRateLimits(result, date);
  assert.equal(parsed.fiveHour.remainingPercent, 0); assert.equal(parsed.weekly.remainingPercent, 100);
  assert.equal(parsed.fiveHour.source, 'codex');
  const state = { ...emptyCodex(), ...parsed, status: 'connected' };
  assert.equal(codexUsageForView(state, date).fiveHour.remainingPercent, 0);
  assert.equal(codexUsageForView(state, new Date(date.getTime() + 120001)).fiveHour.remainingPercent, null);
  assert.equal(codexUsageForView({ ...state, status: 'error' }, date).fiveHour.remainingPercent, null);
  result.rateLimits.secondary.resetsAt = Math.floor(date.getTime() / 1000) - 1;
  assert.equal(readRateLimits(result, date).fiveHour.remainingPercent, null);
});
test('other model buckets, unrecognized windows and invalid percentages never masquerade as Codex quota', () => {
  assert.throws(() => readRateLimits({ rateLimitsByLimitId: { other: rate().rateLimits } }, date));
  assert.throws(() => readRateLimits({ rateLimits: { ...rate().rateLimits, limitId: 'other' } }, date));
  for (const value of [-1, 101, NaN, '50']) assert.equal(readRateLimits(rate(value), date).fiveHour.remainingPercent, null);
  const limits = rate(); limits.rateLimits.primary.windowDurationMins = 60;
  assert.equal(readRateLimits(limits, date).fiveHour.remainingPercent, null);
  assert.equal(readRateLimits(limits, date).weekly.remainingPercent, 40);
});
test('daily usage uses an explicit matching day and never substitutes lifetime totals or missing data with zero', () => {
  assert.equal(readDailyUsage({ summary: { lifetimeTokens: 1000 } }, date), null);
  assert.equal(readDailyUsage({ dailyUsageBuckets: [{ startDate: '2000-01-01', tokens: 1000 }] }, date), null);
  assert.equal(readDailyUsage({ dailyUsageBuckets: [{ startDate: localDay(date), tokens: 0 }] }, date).todayTokens, 0);
  assert.equal(readDailyUsage({ dailyUsageBuckets: [{ startDate: localDay(date), tokens: -1 }] }, date), null);
});
test('settings migrate from prior versions and reject invalid theme, avatar and data mode', () => {
  assert.equal(migrateSettings({ followChatGPT: false, scale: 1.3 }).followCodex, false);
  assert.equal(initialState().settings.avatar, 'chibi');
  for (const patch of [{ theme: 'neon' }, { avatar: 'unknown' }, { dataSource: 'auto' }, { codexExecutable: 'x\ny' }]) assert.throws(() => validateSettings(patch));
});
test('auto data is isolated from old manual values and reports live sources accurately', () => {
  const state = applyUpdate(initialState(date), { day: localDay(date), todayTokens: 999, weekly: { remainingPercent: 99 }, task: { status: 'running' } }, 'manual', date);
  const monitor = { running: false, status: 'unknown' };
  const unknown = composeView(state, emptyCodex(), { task: null }, monitor, date);
  assert.equal(unknown.usage.todayTokens, null); assert.equal(unknown.usage.weekly.remainingPercent, null); assert.equal(unknown.task.status, 'unknown');
  assert.equal(unknown.manualUsage.todayTokens, 999);
  state.settings.dataSource = 'manual';
  assert.equal(composeView(state, emptyCodex(), { task: null }, monitor, date).usage.todayTokens, 999);
  state.settings.dataSource = 'connector';
  assert.equal(composeView(state, emptyCodex(), { task: null }, monitor, date).usage.todayTokens, null);
});
test('real stdio transport handles fragmented responses, request correlation, timeout and rejects approval requests', async t => {
  const client = fakeClient(); t.after(() => client.stop());
  assert.equal((await client.start()).userAgent, 'codex-fixture');
  const values = await Promise.all([client.request('test/echo', { n: 1 }), client.request('test/echo', { n: 2 })]);
  assert.deepEqual(values, [{ n: 1 }, { n: 2 }]);
  await assert.rejects(client.request('test/timeout'), /超时/);
  const denied = once(client, 'notification');
  await client.request('test/server-request');
  const [method, params] = await denied;
  assert.equal(method, 'test/denied'); assert.equal(params.code, -32601);
  client.stop(); await assert.rejects(client.request('test/echo'), /未连接/);
});
async function serviceScenario(t, scenario) {
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const service = new CodexService(state => {
    if (['signedOut', 'unsupported', 'missing', 'error'].includes(state.status) || (state.status === 'connected' && (state.daily || state.dailyNote.includes('不支持')))) finish();
  }, { discover: async () => process.execPath, createClient: () => fakeClient(scenario) });
  t.after(() => service.stop()); service.start();
  await Promise.race([done, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Service did not settle')), 4000); timer.unref(); })]);
  return service;
}
test('Codex service reads real RPC quota and optional daily totals without executing a turn', async t => {
  const service = await serviceScenario(t, 'normal');
  assert.equal(service.state.status, 'connected'); assert.equal(service.state.fiveHour.remainingPercent, 75);
  assert.equal(service.state.weekly.remainingPercent, 40); assert.equal(service.state.daily.todayTokens, 12500);
});
test('signed-out and API-key accounts expose actionable status and unknown subscription quotas', async t => {
  const signedOut = await serviceScenario(t, 'signedOut'); assert.equal(signedOut.state.status, 'signedOut'); assert.equal(signedOut.state.fiveHour.remainingPercent, null);
  const api = await serviceScenario(t, 'apiKey'); assert.equal(api.state.status, 'unsupported'); assert.equal(api.state.weekly.remainingPercent, null);
});
test('an older Codex daily API can be unavailable while quota still works', async t => {
  const service = await serviceScenario(t, 'dailyUnsupported');
  assert.equal(service.state.status, 'connected'); assert.equal(service.state.fiveHour.remainingPercent, 75);
  assert.equal(service.state.daily, null); assert.ok(service.state.dailyNote.includes('不支持'));
});
test('session metadata parses lifecycle events, ignores conversation text and expires stale activity', () => {
  const event = type => JSON.stringify({ timestamp: date.toISOString(), type: 'event_msg', payload: { type } });
  const secretText = JSON.stringify({ timestamp: date.toISOString(), type: 'response_item', payload: { type: 'message', content: 'private text' } });
  assert.equal(parseActivity(secretText, date), null);
  assert.equal(parseActivity(event('task_started'), date).status, 'running');
  assert.equal(parseActivity(event('task_started') + '\n' + event('task_complete'), date).status, 'idle');
  assert.equal(parseActivity(event('token_count'), new Date(date.getTime() + 120001)), null);
  assert.equal(parseActivity('partial invalid line\n' + event('error'), date).status, 'error');
});
test('session reader uses only recent JSONL files; npm native binary discovery supports Windows paths with spaces', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mori-codex-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const session = path.join(directory, 'sessions', '2026', '10', '18'); await fs.mkdir(session, { recursive: true });
  await fs.writeFile(path.join(session, 'rollout.jsonl'), JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_started' } }) + '\n');
  assert.equal((await recentSessionFiles(path.join(directory, 'sessions'))).length, 1);
  let update; const activity = new SessionActivity(state => { update = state; }, { home: directory });
  t.after(() => activity.stop()); activity.active = true; await activity.poll(); assert.equal(update.task.status, 'running');
  const root = path.join(directory, 'npm with spaces');
  const exe = path.join(root, '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe');
  await fs.mkdir(path.dirname(exe), { recursive: true }); await fs.writeFile(exe, 'fixture');
  assert.equal(await nativeFromNpm(root, 'win32', 'x64'), exe);
  const currentExe = path.join(root, '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  await fs.mkdir(path.dirname(currentExe), { recursive: true }); await fs.writeFile(currentExe, 'current-layout');
  assert.equal(await nativeFromNpm(root, 'win32', 'x64'), currentExe);
});
