'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MikoLayout = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  const MIN_SCALE = 0.65, MAX_SCALE = 3, SCALE_STEP = 0.05;
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  function dimensions(settings) {
    const base = settings.avatar === 'original' ? { width: 160, height: 240 } : { width: 210, height: 270 };
    return { width: base.width * settings.scale, height: base.height * settings.scale };
  }
  function zoomScale(scale, steps) {
    return Math.round(clamp(scale + steps * SCALE_STEP, MIN_SCALE, MAX_SCALE) * 100) / 100;
  }
  function clampCharacter(position, size, area) {
    // Clamp the character, not the invisible window or reserved popup space.
    // If larger than a display, allow either edge to be reached without losing the whole pet.
    function axis(value, start, length, size) {
      const end = start + length - size;
      return clamp(value, Math.min(start, end), Math.max(start, end));
    }
    return { x: axis(position.x, area.x, area.width, size.width), y: axis(position.y, area.y, area.height, size.height) };
  }
  function calculate(settings, position, area) {
    const size = dimensions(settings), point = clampCharacter(position, size, area);
    const character = { ...point, ...size };
    const center = character.x + character.width / 2;
    // Independent windows stay above the character; offscreen coordinates are deliberate.
    const speech = { x: center - 130, y: character.y - 70, width: 260, height: 58 };
    const popover = { x: center - 175, y: character.y - 342, width: 350, height: 330 };
    const nameplate = { x: clamp(center - 80, area.x, area.x + area.width - 160),
      y: clamp(character.y + character.height + 4, area.y, area.y + area.height - 28), width: 160, height: 28 };
    // Only reserve space for the sprite's motion and its nameplate, never for a popup.
    const margin = Math.ceil(24 * settings.scale);
    const x = Math.floor(Math.min(character.x - margin, nameplate.x));
    const y = Math.floor(character.y - margin);
    const right = Math.ceil(Math.max(character.x + size.width + margin, nameplate.x + 160));
    const bottom = Math.ceil(Math.max(character.y + size.height + margin, nameplate.y + 28));
    return { character, speech, nameplate, popover, area: { ...area }, bounds: { x, y, width: right - x, height: bottom - y } };
  }
  function scaleAround(position, previous, next, pivot) {
    const factor = next / previous;
    return { x: pivot.x - (pivot.x - position.x) * factor, y: pivot.y - (pivot.y - position.y) * factor };
  }
  function restorePosition(settings, area) {
    const size = dimensions(settings), saved = settings.position;
    if (saved?.anchor === 'character') return { x: saved.x, y: saved.y };
    if (saved) {
      // 0.3 and earlier saved the outer transparent window's top-left corner.
      const height = Math.min(410 + (settings.avatar === 'original' ? 264 : 294) * settings.scale, area.height);
      return { x: saved.x + 390 - 40 - (Math.max(size.width, 180) + size.width) / 2,
        y: saved.y + height - 14 - 28 - size.height };
    }
    return { x: area.x + area.width - size.width - 40, y: area.y + area.height - size.height - 50 };
  }
  return { MIN_SCALE, MAX_SCALE, SCALE_STEP, dimensions, zoomScale, clampCharacter, calculate, scaleAround, restorePosition };
});
