'use strict';
const readline = require('node:readline');
const { localDay } = require('../../src/model.cjs');
const scenario = process.env.MORI_FAKE_SCENARIO || 'normal';
const lines = readline.createInterface({ input: process.stdin });
function reply(id, result) { process.stdout.write(JSON.stringify({ id, result }) + '\n'); }
lines.on('line', line => {
  const message = JSON.parse(line);
  if (!message.id) return;
  if (message.method === 'initialize') {
    process.stdout.write('backend diagnostic line\n');
    const text = JSON.stringify({ id: message.id, result: { userAgent: 'codex-fixture', codexHome: process.env.MORI_FAKE_HOME || '/not-a-real-user-home' } }) + '\n';
    process.stdout.write(text.slice(0, 11)); setTimeout(() => process.stdout.write(text.slice(11)), 5);
  } else if (message.method === 'account/read') reply(message.id, { account: scenario === 'signedOut' ? null : scenario === 'apiKey' ? { type: 'apiKey' } : { type: 'chatgpt', email: 'fixture@example.invalid', planType: 'plus' } });
  else if (message.method === 'account/rateLimits/read') reply(message.id, {
    ordinaryUsageAllowed: true, accountId: 'test-account', rateLimits: { limitId: 'codex', planType: 'plus',
      primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
      secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 86400 } },
  });
  else if (message.method === 'account/usage/read') {
    if (scenario === 'dailyUnsupported') process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unavailable' } }) + '\n');
    else reply(message.id, { summary: {}, dailyUsageBuckets: [{ startDate: localDay(), tokens: 12500 }] });
  } else if (message.method === 'test/echo') reply(message.id, message.params);
  else if (message.method === 'test/timeout') { /* Deliberately never reply. */ }
  else if (message.method === 'test/server-request') {
    process.stdout.write(JSON.stringify({ id: 'server-request', method: 'item/commandExecution/requestApproval', params: { command: 'should never execute' } }) + '\n');
    reply(message.id, true);
  } else if (message.id === 'server-request') process.stdout.write(JSON.stringify({ method: 'test/denied', params: message.error }) + '\n');
  else process.stdout.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unsupported' } }) + '\n');
});
