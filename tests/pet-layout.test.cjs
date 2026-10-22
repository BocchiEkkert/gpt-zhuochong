'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const geometry = require('../renderer/pet-layout.js');
const { validateSettings } = require('../src/model.cjs');
const { followVisibility } = require('../src/follow-visibility.cjs');
const area = { x: 0, y: 0, width: 1920, height: 1080 };
function inside(rect, area) {
  return rect.x >= area.x && rect.y >= area.y && rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;
}
test('wheel scale accepts 300%, clamps both limits and keeps its pointer pivot', () => {
  assert.equal(validateSettings({ scale: 3 }).scale, 3);
  assert.throws(() => validateSettings({ scale: 3.01 }));
  assert.equal(geometry.zoomScale(2.95, 1), 3); assert.equal(geometry.zoomScale(3, 10), 3);
  assert.equal(geometry.zoomScale(.65, -10), .65);
  const pivot = { x: 600, y: 500 }, before = { x: 500, y: 350 };
  const after = geometry.scaleAround(before, 1, 3, pivot);
  assert.equal((pivot.x - after.x) / 3, pivot.x - before.x);
  assert.equal((pivot.y - after.y) / 3, pivot.y - before.y);
});
test('both full-size characters reach every desktop corner without reserving popup space', () => {
  for (const avatar of ['original', 'chibi']) {
    const settings = { avatar, scale: 3 }, size = geometry.dimensions(settings);
    for (const x of [area.x, area.x + area.width - size.width]) for (const y of [area.y, area.y + area.height - size.height]) {
      const result = geometry.calculate(settings, { x, y }, area);
      assert.equal(result.character.x, x); assert.equal(result.character.y, y);
      assert.equal(result.character.width, avatar === 'chibi' ? 630 : 480);
      assert.equal(result.character.height, avatar === 'chibi' ? 810 : 720);
      assert.ok(inside(result.popover, area)); assert.ok(inside(result.nameplate, area));
      const a = result.popover, b = result.character;
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  }
});
test('negative monitor coordinates and oversized pets remain reachable, with readable popup bounds', () => {
  const secondary = { x: -1280, y: -120, width: 1280, height: 720 };
  const settings = { avatar: 'chibi', scale: 3 };
  for (const point of [{ x: -5000, y: -5000 }, { x: 5000, y: 5000 }]) {
    const result = geometry.calculate(settings, point, secondary);
    assert.ok(inside(result.popover, secondary));
    assert.ok(result.character.x >= -1280 && result.character.x + 630 <= 0);
    assert.ok(result.character.y >= -210 && result.character.y <= -120);
  }
  const tiny = { x: 0, y: 0, width: 390, height: 600 };
  const result = geometry.calculate(settings, { x: 10000, y: -10000 }, tiny);
  assert.equal(result.character.width, 630); assert.equal(result.character.height, 810);
  assert.equal(result.character.x, 0); assert.equal(result.character.y, -210);
  assert.ok(inside(result.popover, tiny));
});
test('new character anchors persist directly and old outer-window positions are migrated', () => {
  const old = geometry.restorePosition({ avatar: 'chibi', scale: 1, position: { x: 100, y: 80 } }, area);
  assert.deepEqual(old, { x: 240, y: 472 });
  const next = { x: -1200, y: 50, anchor: 'character' };
  assert.deepEqual(geometry.restorePosition({ avatar: 'chibi', scale: 3, position: next }, area), { x: -1200, y: 50 });
  assert.equal(validateSettings({ position: next }).position.anchor, 'character');
  assert.throws(() => validateSettings({ position: { x: 1, y: 2, anchor: 'window' } }));
});
test('closing before the first monitor reply stays in tray until the client stops and launches again', () => {
  let decision = followVisibility({ running: true, previousRunning: null, dismissed: true });
  assert.equal(decision.show, false); assert.equal(decision.dismissed, true);
  decision = followVisibility({ running: true, previousRunning: true, dismissed: decision.dismissed });
  assert.equal(decision.show, false);
  decision = followVisibility({ running: false, previousRunning: true, dismissed: decision.dismissed });
  assert.equal(decision.hide, true); assert.equal(decision.dismissed, false);
  decision = followVisibility({ running: true, previousRunning: false, dismissed: decision.dismissed });
  assert.equal(decision.show, true);
  assert.equal(followVisibility({ running: true, previousRunning: null, dismissed: false, background: true }).show, true);
});
