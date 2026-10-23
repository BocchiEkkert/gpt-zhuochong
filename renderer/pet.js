'use strict';
const $ = id => document.getElementById(id), api = window.mori, view = window.MikoView;
let state, hoverTimer, wheelTimer, wheelDelta = 0, wheelBusy = false;
let pressed = false, dragging = false, startPoint, moved = false, interactive = null;
function positionElements() {
  if (!state) return;
  let layout = state.layout;
  if (!layout) {
    const area = { x: 0, y: 0, width: innerWidth, height: innerHeight };
    layout = window.MikoLayout.calculate(state.settings, window.MikoLayout.restorePosition(state.settings, area), area);
    layout.bounds = { x: 0, y: 0, width: innerWidth, height: innerHeight };
  }
  for (const key of ['character', 'nameplate']) {
    const rect = layout[key], style = document.documentElement.style;
    for (const prop of ['x', 'y', 'width', 'height']) style.setProperty(`--${key}-${prop}`, `${rect[prop] - (prop === 'x' ? layout.bounds.x : prop === 'y' ? layout.bounds.y : 0)}px`);
  }
}
function render(next) {
  state = next; view.applyAppearance(next); positionElements();
  document.documentElement.style.setProperty('--scale', next.settings.scale);
  document.body.classList.toggle('reduced', next.settings.reduceMotion);
  $('mini-light').className = `mini-light ${next.task.status}`;
  $('mini-status').textContent = ({ running: '思考中', idle: '待命中', error: '需关注', unknown: '待连接' })[next.task.status];
  window.MikoMotion.settings(next.settings); window.MikoMotion.play(next.motion || 'idle');
}
api.onState(render); api.getState().then(render);
api.onMotion(name => { if (state) state.motion = name; window.MikoMotion.show(); window.MikoMotion.play(name, true); });
window.addEventListener('resize', positionElements);
function hover(value) {
  clearTimeout(hoverTimer);
  if (!value) api.panel({ action: 'hover', value: false });
  else if (!pressed) hoverTimer = setTimeout(() => api.panel({ action: 'hover', value: true }), 250);
}
for (const id of ['character', 'nameplate']) {
  $(id).addEventListener('pointerenter', () => hover(true));
  $(id).addEventListener('pointerleave', () => hover(false));
}
$('nameplate').addEventListener('click', () => api.panel({ action: 'toggle' }));
api.onHidden(() => {
  clearTimeout(hoverTimer); clearTimeout(wheelTimer); wheelDelta = 0;
  pressed = false; dragging = false; interactive = null; window.MikoMotion.hide();
});
window.addEventListener('contextmenu', event => { event.preventDefault(); api.action('settings'); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); api.action('hide'); } });
window.addEventListener('mousemove', event => {
  const next = Boolean(event.target.closest('.interactive')) || pressed;
  if (interactive !== next) { interactive = next; api.interactive(next); }
});
const character = $('character');
async function flushWheel() {
  if (wheelBusy || !wheelDelta) return;
  const delta = wheelDelta; wheelDelta = 0;
  const steps = Math.sign(delta) * Math.min(10, Math.max(1, Math.round(Math.abs(delta) / 100)));
  wheelBusy = true;
  try { render(await api.scalePet(steps)); }
  finally { wheelBusy = false; if (wheelDelta) wheelTimer = setTimeout(flushWheel, 80); }
}
character.addEventListener('wheel', event => {
  event.preventDefault(); event.stopPropagation();
  if (!state || pressed || !Number.isFinite(event.deltaY) || !event.deltaY) return;
  wheelDelta -= event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
  clearTimeout(wheelTimer); wheelTimer = setTimeout(() => flushWheel().catch(() => {}), 80);
}, { passive: false });
character.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  clearTimeout(hoverTimer); startPoint = { x: event.screenX, y: event.screenY }; moved = false; pressed = true;
  character.setPointerCapture(event.pointerId);
});
character.addEventListener('pointermove', event => {
  if (!pressed) return;
  if (!moved && Math.hypot(event.screenX - startPoint.x, event.screenY - startPoint.y) > 5) {
    moved = true; dragging = true; api.drag({ phase: 'start', ...startPoint });
  }
  if (dragging) api.drag({ phase: 'move', x: event.screenX, y: event.screenY });
});
function endDrag(event) {
  if (!pressed) return;
  pressed = false;
  if (character.hasPointerCapture(event.pointerId)) character.releasePointerCapture(event.pointerId);
  if (dragging) api.drag({ phase: 'end', x: event.screenX, y: event.screenY });
  if (event.type === 'pointercancel') moved = true;
  dragging = false; api.interactive(true); interactive = true;
}
character.addEventListener('pointerup', endDrag); character.addEventListener('pointercancel', endDrag);
character.addEventListener('click', () => { if (!moved) { api.panel({ action: 'close' }); api.action('touch'); } });
