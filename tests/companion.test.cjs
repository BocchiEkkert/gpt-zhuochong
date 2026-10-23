'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Companion, CATEGORIES } = require('../src/companion.cjs');
const defaults = require('../renderer/dialogue.js');
const { DEFAULT_SETTINGS, validateSettings } = require('../src/model.cjs');
const { Store } = require('../src/store.cjs');
const { observeLinux, setAutostart } = require('../src/linux-desktop.cjs');
const context = { idleSeconds: 0, visible: true, blocked: false, running: false };
test('120 unique local phrases; custom banks validate, persist, and sequential/random avoid immediate repeats', () => {
  assert.equal(new Set(CATEGORIES.flatMap(key => defaults[key])).size, 120);
  const settings = { ...DEFAULT_SETTINGS, phraseBanks: { click: ['小饼干', '小星星'] }, speechOrder: 'sequential' };
  validateSettings(settings);
  const engine = new Companion({ random: () => 0 });
  assert.deepEqual(Array.from({ length: 4 }, () => engine.choose(settings, 'click').text), ['小饼干', '小星星', '小饼干', '小星星']);
  settings.speechOrder = 'random';
  assert.notEqual(engine.choose(settings, 'click').text, engine.choose(settings, 'click').text);
  assert.equal(engine.interact(settings, 'click', 5000).motion, 'touch');
  assert.equal(engine.interact(settings, 'click', 5100), null);
  for (const phraseBanks of [{ bad: ['a'] }, { click: [] }, { click: ['a\nb'] }, { click: ['x'.repeat(121)] }, { click: Array(301).fill('x') }]) assert.throws(() => validateSettings({ phraseBanks }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miko-copy-'));
  try {
    new Store(dir).settings({ phraseBanks: settings.phraseBanks, speechFrequency: 'quiet', speechEnabled: false });
    const restored = new Store(dir).read().settings;
    assert.deepEqual(restored.phraseBanks, settings.phraseBanks); assert.equal(restored.speechEnabled, false); assert.equal(restored.speechFrequency, 'quiet');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('idle requires fresh activity, respects cooldown, busy/hidden/locked/paused suppression and day caps across restarts', () => {
  const settings = { ...DEFAULT_SETTINGS }, saved = []; let now = new Date(2026, 9, 23, 8).getTime();
  const engine = new Companion({ random: () => 0, saveHistory: history => saved.push(history) });
  assert.equal(engine.tick(settings, { ...context, idleSeconds: 200 }, now), null);
  engine.tick(settings, context, now);
  assert.ok(engine.tick(settings, { ...context, idleSeconds: 200 }, now + 200000));
  assert.equal(engine.tick(settings, { ...context, idleSeconds: 4000 }, now + 4000000), null, 'one utterance per idle period');
  engine.tick(settings, context, now + 210000);
  assert.equal(engine.tick(settings, { ...context, idleSeconds: 200 }, now + 410000), null, 'cooldown');
  for (const patch of [{ running: true }, { blocked: true }, { visible: false }]) {
    engine.tick(settings, context, now + 4000000);
    assert.equal(engine.tick(settings, { ...context, idleSeconds: 200, ...patch }, now + 4200000), null);
    assert.equal(engine.tick(settings, { ...context, idleSeconds: 200 }, now + 4500000), null, 'suppression disarms until fresh activity');
  }
  engine.tick(settings, context, now + 5000000);
  assert.equal(engine.tick({ ...settings, speechEnabled: false }, { ...context, idleSeconds: 200 }, now + 5200000), null);
  engine.tick(settings, context, now + 5300000);
  assert.ok(engine.tick(settings, { ...context, idleSeconds: 1000 }, now + 6300000));
  assert.equal(saved.length, 2);
  const restored = new Companion({ history: { ...saved.at(-1), count: 8 } });
  restored.tick(settings, context, now + 7000000);
  assert.equal(restored.tick(settings, { ...context, idleSeconds: 200 }, now + 7200000), null, 'daily cap survives restart');
  now += 86400000; restored.tick(settings, context, now);
  assert.ok(restored.tick(settings, { ...context, idleSeconds: 200 }, now + 200000), 'new local day permits speech');
});
test('Linux desktop observation excludes the Codex app-server helper; autostart safely quotes and can be removed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'miko-linux-'));
  try {
    fs.mkdirSync(path.join(dir, '123')); fs.symlinkSync('/opt/codex', path.join(dir, '123', 'exe'));
    assert.equal(observeLinux(dir).running, false);
    fs.mkdirSync(path.join(dir, '124')); fs.symlinkSync('/opt/chatgpt', path.join(dir, '124', 'exe'));
    assert.equal(observeLinux(dir).running, true); assert.equal(observeLinux(dir).status, 'unknown');
    setAutostart(true, '/opt/Miko "100%"/miko', dir);
    const text = fs.readFileSync(path.join(dir, 'autostart/miko-gpt-pet.desktop'), 'utf8');
    assert.ok(text.includes('Exec="/opt/Miko \\"100%%\\"/miko" --background --ozone-platform=x11'));
    assert.throws(() => setAutostart(true, '/opt/x\nExec=bad', dir));
    setAutostart(false, '/opt/miko', dir); assert.equal(fs.existsSync(path.join(dir, 'autostart/miko-gpt-pet.desktop')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
