'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseObservation, ChatGPTMonitor } = require('../src/monitor.cjs');
test('only valid process and button observations become task states', () => {
  assert.equal(parseObservation('\ufeff{"running":true,"status":"running","available":true}').status, 'running');
  assert.equal(parseObservation('{"running":false,"status":"idle","available":false}').status, 'unknown');
  assert.throws(() => parseObservation('{"running":"yes","status":"idle"}'));
  assert.throws(() => parseObservation('blocked'));
});
test('unsupported systems explicitly report unsupported without launching PowerShell', () => {
  let observed;
  const monitor = new ChatGPTMonitor(state => { observed = state; }, 'linux');
  monitor.start();
  assert.equal(observed.supported, false);
  assert.equal(observed.status, 'unknown');
  assert.equal(monitor.child, undefined);
  monitor.stop();
});
