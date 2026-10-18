'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { createBridge } = require('../src/bridge.cjs');
const { initialState, localDay, applyUpdate } = require('../src/model.cjs');

test('local bridge authenticates, rejects websites and invalid data, and applies real updates', async t => {
  let state = initialState();
  const server = createBridge({ token: 'test-token', port: 0, onUpdate(input) { state = applyUpdate(state, input, 'connector'); } });
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' };
  assert.equal((await fetch(url + '/v1/health')).status, 401);
  assert.equal((await fetch(url + '/v1/health', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(url + '/v1/health', { headers })).status, 200);
  assert.equal((await fetch(url + '/v1/state', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const badHost = await new Promise((resolve, reject) => {
    const request = http.request(url + '/v1/state', { method: 'POST', headers: { ...headers, Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end('{}');
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(url + '/v1/state', { method: 'POST', headers: { Authorization: headers.Authorization }, body: '{}' })).status, 415);
  for (const body of ['{broken', '{}', JSON.stringify({ weekly: { remainingPercent: 101 } })]) {
    assert.equal((await fetch(url + '/v1/state', { method: 'POST', headers, body })).status, 400);
  }
  assert.equal((await fetch(url + '/v1/state', { method: 'POST', headers, body: 'x'.repeat(16385) })).status, 413);
  const input = { day: localDay(), todayTokens: 256, fiveHour: { remainingPercent: 75 }, weekly: { remainingPercent: 44 }, task: { status: 'running', label: '来自工具的任务' } };
  const response = await fetch(url + '/v1/state', { method: 'POST', headers, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(state.usage.todayTokens, 256);
  assert.equal(state.task.label, '来自工具的任务');
  assert.equal(state.usage.weekly.source, 'connector');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(url + '/unknown', { headers })).status, 404);
});
test('a storage failure does not claim an update succeeded', async t => {
  const server = createBridge({ token: 't', port: 0, onUpdate() { throw new Error('disk unavailable'); } });
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/state`, { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{"task":{"status":"idle"}}' });
  assert.equal(response.status, 500);
});
