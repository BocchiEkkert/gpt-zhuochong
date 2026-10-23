'use strict';
const $ = id => document.getElementById(id), api = window.mori, view = window.MikoView;
function render(next) {
  view.applyAppearance(next);
  document.body.classList.toggle('reduced', next.settings.reduceMotion);
  $('today-tokens').textContent = view.number(next.usage.todayTokens);
  $('token-source').textContent = view.source(next.usage.source);
  $('token-note').textContent = next.usage.todayTokens === null ? '等待用量数据，不作估算' : `${next.usage.day} · ${next.usage.scope || '累计值'} · ${view.clock(next.usage.updatedAt)} 更新`;
  for (const [key, prefix] of [['fiveHour', 'five'], ['weekly', 'weekly']]) {
    const quota = next.usage[key];
    $(`${prefix}-value`).textContent = quota.remainingPercent === null ? '未知' : `剩余 ${quota.remainingPercent}%`;
    const bar = $(`${prefix}-bar`); bar.style.width = `${quota.remainingPercent ?? 0}%`;
    bar.parentElement.classList.toggle('unknown', quota.remainingPercent === null);
    bar.parentElement.classList.toggle('low', quota.remainingPercent !== null && quota.remainingPercent <= 20);
    $(`${prefix}-reset`).textContent = view.reset(quota.resetsAt);
    $(`${prefix}-source`).textContent = view.source(quota.source) + (quota.updatedAt ? ` · ${view.clock(quota.updatedAt)}` : '');
  }
  $('task-label').textContent = next.task.label || view.task(next.task.status);
  $('task-source').textContent = view.source(next.task.source);
  $('task-light').className = `status-light ${next.task.status}`;
  $('data-note').textContent = next.settings.dataSource === 'codex' ? (next.codex.ordinaryUsageAllowed === false ? 'Codex 报告普通额度不可用 · 以客户端提示为准' : next.codex.message) : `当前使用${next.settings.dataSource === 'manual' ? '手动记录' : '本机接口'}数据`;
  $('pin-panel').setAttribute('aria-pressed', String(!!next.panel?.pinned));
}
api.onState(render); api.getState().then(render);
$('settings').addEventListener('click', () => api.action('settings'));
$('close-pet').addEventListener('click', () => api.panel({ action: 'close' }));
$('pin-panel').addEventListener('click', () => api.panel({ action: 'toggle' }));
document.documentElement.addEventListener('pointerenter', () => api.panel({ action: 'hover', value: true }));
document.documentElement.addEventListener('pointerleave', () => api.panel({ action: 'hover', value: false }));
window.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); api.action('hide'); } });

document.getElementById('popover').addEventListener('pointerdown', event => { if (!event.target.closest('button')) api.panel({ action: 'pin' }); });
