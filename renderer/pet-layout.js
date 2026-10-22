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
  function overlap(a, b) {
    return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  }
  function fit(rect, area) {
    return { ...rect, x: clamp(rect.x, area.x + 8, area.x + area.width - rect.width - 8),
      y: clamp(rect.y, area.y + 8, area.y + area.height - rect.height - 8) };
  }
  function calculate(settings, position, area) {
    const size = dimensions(settings), point = clampCharacter(position, size, area);
    const character = { ...point, ...size };
    const center = character.x + character.width / 2, bottom = character.y + character.height;
    const speechWidth = Math.min(240, area.width - 16);
    const speech = fit({ x: center - speechWidth / 2, y: character.y - 42, width: speechWidth, height: 34 }, area);
    if (character.y - 42 < area.y && bottom + 42 <= area.y + area.height) speech.y = bottom + 8;
    const nameplate = fit({ x: center - 80, y: bottom + 4, width: Math.min(160, area.width - 16), height: 28 }, area);
    const width = Math.min(350, area.width - 16), height = Math.min(330, area.height - 16);
    const candidates = [
      { x: center - width / 2, y: character.y - height - 12, width, height },
      { x: center - width / 2, y: bottom + 44, width, height },
      { x: character.x - width - 12, y: character.y, width, height },
      { x: character.x + character.width + 12, y: character.y, width, height },
    ].map(rect => fit(rect, area));
    let popover = candidates[0], penalty = Infinity;
    for (const candidate of candidates) {
      const score = overlap(candidate, character) + overlap(candidate, nameplate);
      if (score < penalty) { popover = candidate; penalty = score; }
    }
    const rects = [character, speech, nameplate, popover], margin = 16;
    const x = Math.floor(Math.min(...rects.map(rect => rect.x))) - margin;
    const y = Math.floor(Math.min(...rects.map(rect => rect.y))) - margin;
    const right = Math.ceil(Math.max(...rects.map(rect => rect.x + rect.width))) + margin;
    const lower = Math.ceil(Math.max(...rects.map(rect => rect.y + rect.height))) + margin;
    return { character, speech, nameplate, popover, area: { ...area }, bounds: { x, y, width: right - x, height: lower - y } };
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
