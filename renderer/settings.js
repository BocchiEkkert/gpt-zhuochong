'use strict';
const $ = id => document.getElementById(id), api = window.mori, view = window.MoriView;
let state, initialized = false, toastTimer, scaleTimer;
const dirty = new Set();
const fields = ['tokens', 'five-percent', 'five-reset-input', 'week-percent', 'week-reset-input', 'task', 'task-label'];
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
function localInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
function setField(id, value) { if (!dirty.has(id)) $(id).value = value; }
function render(next) {
  state = next;
  const settings = next.settings;
  if (document.activeElement !== $('scale')) {
    $('scale').value = Math.round(settings.scale * 100);
    $('scale-output').value = `${Math.round(settings.scale * 100)}%`;
  }
  for (const [id, key] of [['follow', 'followChatGPT'], ['login', 'startAtLogin'], ['topmost', 'alwaysOnTop'], ['motion', 'reduceMotion']]) $(id).checked = settings[key];
  $('login').disabled = next.platform !== 'win32' || !next.packaged;
  if ($('login').disabled) $('login-note').textContent = '使用 Windows 程序包后可开启；源码运行时不修改开机项';
  $('connection-dot').classList.toggle('connected', next.monitor.running && !next.monitor.error);
  $('connection-status').textContent = next.monitor.error ? 'ChatGPT 状态未知' : next.monitor.running ? 'ChatGPT 已打开' : '等待 ChatGPT 启动';
  $('hero-bubble').textContent = next.task.status === 'running' ? '认真思考中，请稍等一下。' : '今天，也一起慢慢来。';
  const warnings = [next.platform !== 'win32' ? '当前系统仅用于界面与接口预览。ChatGPT 启动联动和界面检测需在 Windows 10/11 验证。' : null, next.warning, next.integration.error].filter(Boolean);
  $('platform-notice').textContent = warnings.join(' '); $('platform-notice').hidden = warnings.length === 0;
  $('usage-day').textContent = next.usage.day + ' · 本地时间';
  setField('tokens', next.usage.todayTokens ?? '');
  setField('five-percent', next.usage.fiveHour.remainingPercent ?? '');
  setField('five-reset-input', localInput(next.usage.fiveHour.resetsAt));
  setField('week-percent', next.usage.weekly.remainingPercent ?? '');
  setField('week-reset-input', localInput(next.usage.weekly.resetsAt));
  setField('task', next.task.source === 'manual' ? next.task.status === 'unknown' ? 'auto' : next.task.status : 'auto');
  setField('task-label', next.task.source === 'manual' ? next.task.label : '');
  $('task-label').disabled = $('task').value === 'auto';
  for (const [id, data] of [['tokens-source', next.usage], ['five-source', next.usage.fiveHour], ['week-source', next.usage.weekly]]) $(id).textContent = view.source(data.source) + (data.updatedAt ? ' · ' + view.clock(data.updatedAt) : '');
  $('bridge-status').textContent = next.integration.ready ? `接口已就绪${next.integration.lastEventAt ? ' · 上次同步 ' + view.clock(next.integration.lastEventAt) : ' · 等待工具连接'}` : next.integration.error || '接口启动中';
  $('copy-token').disabled = !next.integration.ready;
  $('monitor-status').textContent = !next.monitor.supported ? '当前系统不支持 Windows 状态探测' : next.monitor.error || (!next.monitor.checkedAt ? '正在检查 ChatGPT.exe…' : !next.monitor.running ? '未检测到 ChatGPT.exe · 每 5 秒检查一次' : next.monitor.available ? `ChatGPT 已启动 · ${view.task(next.monitor.status)} · ${view.clock(next.monitor.checkedAt)}` : 'ChatGPT 已启动，但当前窗口未暴露可识别的生成按钮；任务状态未知');
  initialized = true;
}
api.onState(render); api.onNotice(toast); api.getState().then(render).catch(() => toast('连接桌宠失败，请重启 Mori。'));
async function saveSettings(patch) {
  try { render(await api.saveSettings(patch)); toast('设置已保存'); }
  catch (error) { if (state) render(state); toast(error.message.replace(/^Error invoking remote method '[^']+': (?:\w+Error: )?/, '')); }
}
for (const [id, key] of [['follow', 'followChatGPT'], ['login', 'startAtLogin'], ['topmost', 'alwaysOnTop'], ['motion', 'reduceMotion']]) $(id).addEventListener('change', () => { if (initialized) saveSettings({ [key]: $(id).checked }); });
$('scale').addEventListener('input', () => {
  $('scale-output').value = $('scale').value + '%';
  clearTimeout(scaleTimer); scaleTimer = setTimeout(() => saveSettings({ scale: Number($('scale').value) / 100 }), 200);
});
for (const id of fields) $(id).addEventListener('input', () => { dirty.add(id); $('form-message').textContent = '有未保存的修改'; });
$('task').addEventListener('change', () => { dirty.add('task'); $('task-label').disabled = $('task').value === 'auto'; });
$('usage-form').addEventListener('submit', async event => {
  event.preventDefault();
  const update = {};
  if (dirty.has('tokens')) { update.day = state.usage.day; update.todayTokens = $('tokens').value === '' ? null : Number($('tokens').value); }
  for (const [key, percent, reset] of [['fiveHour', 'five-percent', 'five-reset-input'], ['weekly', 'week-percent', 'week-reset-input']]) {
    if (dirty.has(percent) || dirty.has(reset)) update[key] = {
      remainingPercent: $(percent).value === '' ? null : Number($(percent).value),
      resetsAt: $(reset).value ? new Date($(reset).value).toISOString() : null,
    };
  }
  if (dirty.has('task') || dirty.has('task-label')) update.task = { status: $('task').value === 'auto' ? 'unknown' : $('task').value, label: $('task').value === 'auto' ? '' : $('task-label').value };
  if (!Object.keys(update).length) { toast('没有需要保存的修改'); return; }
  const submit = $('usage-form').querySelector('button[type="submit"]'); submit.disabled = true;
  try {
    const next = await api.saveUsage(update);
    dirty.clear(); render(next); $('form-message').classList.remove('error');
    $('form-message').textContent = '已保存 · 手动数据已明确标注'; toast('记录已同步到桌宠');
  } catch (error) {
    $('form-message').classList.add('error');
    $('form-message').textContent = error.message.replace(/^Error invoking remote method '[^']+': (?:\w+Error: )?/, '');
  } finally { submit.disabled = false; }
});
$('copy-token').addEventListener('click', async () => { try { await api.copyToken(); toast('连接密钥已复制，请妥善保管'); } catch { toast('复制失败，请重试'); } });
for (const [id, action] of [['show-pet', 'show'], ['reset-position', 'reset-position'], ['minimize-pet', 'minimize'], ['exit-pet', 'quit']]) $(id).addEventListener('click', () => api.action(action));
for (const link of document.querySelectorAll('nav a')) link.addEventListener('click', () => {
  for (const other of document.querySelectorAll('nav a')) other.classList.toggle('active', other === link);
});
