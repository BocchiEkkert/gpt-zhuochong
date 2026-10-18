'use strict';
const $ = id => document.getElementById(id);
const view = window.MoriView;
let state, hideTimer, showTimer, pinned = false, dragging = false, startPoint, moved = false, interactive = null;
const api = window.mori;
function setOpen(open) { $('popover').hidden = !open; }
function render(next) {
  state = next;
  view.applyAppearance(next);
  document.documentElement.style.setProperty('--scale', next.settings.scale);
  document.body.classList.toggle('reduced', next.settings.reduceMotion);
  $('today-tokens').textContent = view.number(next.usage.todayTokens);
  $('token-source').textContent = view.source(next.usage.source);
  $('token-note').textContent = next.usage.todayTokens === null ? '等待用量数据，不作估算' : `${next.usage.day} · ${next.usage.scope || '累计值'} · ${view.clock(next.usage.updatedAt)} 更新`;
  for (const [key, prefix] of [['fiveHour', 'five'], ['weekly', 'weekly']]) {
    const quota = next.usage[key];
    $(`${prefix}-value`).textContent = quota.remainingPercent === null ? '未知' : `剩余 ${quota.remainingPercent}%`;
    const bar = $(`${prefix}-bar`);
    bar.style.width = `${quota.remainingPercent ?? 0}%`;
    bar.parentElement.classList.toggle('unknown', quota.remainingPercent === null);
    bar.parentElement.classList.toggle('low', quota.remainingPercent !== null && quota.remainingPercent <= 20);
    $(`${prefix}-reset`).textContent = view.reset(quota.resetsAt);
    $(`${prefix}-source`).textContent = view.source(quota.source) + (quota.updatedAt ? ` · ${view.clock(quota.updatedAt)}` : '');
  }
  $('task-label').textContent = next.task.label || view.task(next.task.status);
  $('task-source').textContent = view.source(next.task.source);
  $('task-light').className = `status-light ${next.task.status}`;
  $('mini-light').className = `mini-light ${next.task.status}`;
  $('mini-status').textContent = ({ running: '思考中', idle: '待命中', error: '需关注', unknown: '待连接' })[next.task.status];
  $('speech').textContent = next.task.status === 'running' ? '正在认真想，稍等我一下。' : next.monitor.error ? '连接有点小问题，看看设置吧。' : next.monitor.running ? '你来啦，今天也一起加油。' : '打开 Codex，我就来陪你。';
  $('data-note').textContent = next.settings.dataSource === 'codex' ? (next.codex.ordinaryUsageAllowed === false ? 'Codex 报告普通额度不可用 · 以客户端提示为准' : next.codex.message) : `当前使用${next.settings.dataSource === 'manual' ? '手动记录' : '本机接口'}数据`;
}
api.onState(render);
api.getState().then(render).catch(() => { $('speech').textContent = '连接失败，请重启 Mori。'; });
$('pet-area').addEventListener('pointerenter', () => {
  clearTimeout(hideTimer); showTimer = setTimeout(() => setOpen(true), 180);
});
$('popover').addEventListener('pointerenter', () => clearTimeout(hideTimer));
function scheduleHide() { clearTimeout(showTimer); hideTimer = setTimeout(() => { if (!pinned && !dragging) setOpen(false); }, 400); }
$('pet-area').addEventListener('pointerleave', scheduleHide);
$('popover').addEventListener('pointerleave', scheduleHide);
$('nameplate').addEventListener('click', () => { pinned = !pinned; setOpen(pinned); });
$('settings').addEventListener('click', () => api.action('settings'));
function hide() { pinned = false; setOpen(false); api.action('hide'); }
$('close-pet').addEventListener('click', hide);
api.onHidden(() => { pinned = false; dragging = false; interactive = null; setOpen(false); });
window.addEventListener('contextmenu', event => { event.preventDefault(); api.action('settings'); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); hide(); } });
window.addEventListener('mousemove', event => {
  const next = Boolean(event.target.closest('.interactive')) || dragging;
  if (interactive !== next) { interactive = next; api.interactive(next); }
});
const character = $('character');
character.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  startPoint = { x: event.screenX, y: event.screenY }; moved = false; dragging = true;
  character.setPointerCapture(event.pointerId);
  api.drag({ phase: 'start', x: event.screenX, y: event.screenY });
});
character.addEventListener('pointermove', event => {
  if (!dragging) return;
  if (Math.hypot(event.screenX - startPoint.x, event.screenY - startPoint.y) > 4) moved = true;
  if (moved) { setOpen(false); api.drag({ phase: 'move', x: event.screenX, y: event.screenY }); }
});
function endDrag(event) {
  if (!dragging) return;
  dragging = false;
  if (character.hasPointerCapture(event.pointerId)) character.releasePointerCapture(event.pointerId);
  api.drag({ phase: 'end', x: event.screenX, y: event.screenY });
}
character.addEventListener('pointerup', endDrag);
character.addEventListener('pointercancel', endDrag);
character.addEventListener('click', () => { if (!moved) { pinned = !pinned; setOpen(pinned); } });
