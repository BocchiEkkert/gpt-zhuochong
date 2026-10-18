'use strict';
const $ = id => document.getElementById(id), api = window.mori, view = window.MoriView;
let state, initialized = false, toastTimer, scaleTimer;
const dirty = new Set(), fields = ['tokens', 'five-percent', 'five-reset-input', 'week-percent', 'week-reset-input', 'task', 'task-label'];
const message = error => String(error.message || error).replace(/^Error invoking remote method '[^']+': (?:\w+Error: )?/, '');
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
function localInput(iso) { if (!iso) return ''; const date = new Date(iso); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); }
function setField(id, value) { if (!dirty.has(id)) $(id).value = value; }
function render(next) {
  state = next; view.applyAppearance(next);
  const settings = next.settings, recorded = next.manualUsage || next.usage, task = next.manualTask || next.task;
  if (document.activeElement !== $('scale')) { $('scale').value = Math.round(settings.scale * 100); $('scale-output').value = `${Math.round(settings.scale * 100)}%`; }
  for (const [id, key] of [['follow', 'followCodex'], ['login', 'startAtLogin'], ['topmost', 'alwaysOnTop'], ['motion', 'reduceMotion']]) $(id).checked = settings[key];
  $('dark-theme').checked = settings.theme === 'dark';
  $('avatar-original').checked = settings.avatar === 'original'; $('avatar-chibi').checked = settings.avatar === 'chibi';
  $('data-source').value = settings.dataSource;
  $('login').disabled = next.platform !== 'win32' || !next.packaged;
  if ($('login').disabled) $('login-note').textContent = '使用打包后的 Windows 程序可开启；源码运行时不修改开机项';
  $('connection-dot').classList.toggle('connected', next.codex.status === 'connected');
  $('connection-status').textContent = settings.dataSource !== 'codex' ? (settings.dataSource === 'manual' ? '手动记录模式' : '本机接口模式') : ({ connected: 'Codex 额度已连接', connecting: '正在连接 Codex', missing: '未找到 Codex CLI', signedOut: 'Codex 尚未登录', unsupported: 'Codex 接口不可用', error: 'Codex 连接中断', disabled: '等待 Codex 连接' })[next.codex.status] || '等待 Codex 连接';
  $('hero-bubble').textContent = next.task.status === 'running' ? '认真工作中，陪你一起。' : '今天，也一起慢慢来。';
  const warnings = [next.platform !== 'win32' ? '当前系统可使用 Codex CLI 读取额度；桌面客户端自动显示功能以 Windows 为目标。' : null, next.warning, next.integration.error].filter(Boolean);
  $('platform-notice').textContent = warnings.join(' '); $('platform-notice').hidden = !warnings.length;
  $('codex-status').textContent = next.codex.message;
  $('codex-badge').textContent = next.codex.status === 'connected' ? 'CONNECTED' : 'CODEX';
  $('codex-path').textContent = next.codex.executable || settings.codexExecutable || '自动检测桌面版内置程序与已安装的官方 CLI';
  $('refresh-codex').disabled = settings.dataSource !== 'codex';
  $('daily-status').textContent = next.codex.dailyNote;
  $('monitor-status').textContent = next.activity?.error || (next.task.status !== 'unknown' ? `${view.task(next.task.status)} · ${view.source(next.task.source)} · ${view.clock(next.task.updatedAt)}` : next.monitor.error || '暂无可确认的本机任务事件；状态显示未知。');
  $('usage-day').textContent = next.usage.day;
  $('summary-tokens').textContent = view.number(next.usage.todayTokens);
  $('summary-token-source').textContent = view.source(next.usage.source) + (next.usage.updatedAt ? ' · ' + view.clock(next.usage.updatedAt) : '');
  for (const [key, id] of [['fiveHour', 'five'], ['weekly', 'week']]) {
    const quota = next.usage[key]; $('summary-' + id).textContent = quota.remainingPercent === null ? '—' : `${quota.remainingPercent}%`;
    $('summary-' + id + '-reset').textContent = `${view.reset(quota.resetsAt)} · ${view.source(quota.source)}`;
  }
  $('usage-note').textContent = settings.dataSource === 'codex' ? (next.codex.ordinaryUsageAllowed === false ? 'Codex 报告普通额度不可用。百分比与 token 互不换算，实际执行资格以 Codex 客户端为准。' : '五小时和周窗口按 Codex 实际返回的数据匹配；今日 token 使用 Codex 账户日统计，可能有延迟。未提供的数据保持未知。') : '当前显示手动记录或本机接口的数据，来源会在桌宠面板中注明。';
  setField('tokens', recorded.todayTokens ?? ''); setField('five-percent', recorded.fiveHour.remainingPercent ?? ''); setField('five-reset-input', localInput(recorded.fiveHour.resetsAt));
  setField('week-percent', recorded.weekly.remainingPercent ?? ''); setField('week-reset-input', localInput(recorded.weekly.resetsAt));
  setField('task', task.source === 'manual' ? task.status : 'unknown'); setField('task-label', task.source === 'manual' ? task.label : '');
  for (const [id, data] of [['tokens-source', recorded], ['five-source', recorded.fiveHour], ['week-source', recorded.weekly]]) $(id).textContent = view.source(data.source) + (data.updatedAt ? ' · ' + view.clock(data.updatedAt) : '');
  $('bridge-status').textContent = next.integration.ready ? `接口已就绪${next.integration.lastEventAt ? ' · 上次同步 ' + view.clock(next.integration.lastEventAt) : ' · 等待工具连接'}` : next.integration.error || '接口启动中';
  $('copy-token').disabled = !next.integration.ready; initialized = true;
}
api.onState(render); api.onNotice(toast); api.getState().then(render).catch(() => toast('连接桌宠失败，请重启 Mori。'));
async function saveSettings(patch) { try { render(await api.saveSettings(patch)); toast('设置已保存'); } catch (error) { if (state) render(state); toast(message(error)); } }
for (const [id, key] of [['follow', 'followCodex'], ['login', 'startAtLogin'], ['topmost', 'alwaysOnTop'], ['motion', 'reduceMotion']]) $(id).addEventListener('change', () => { if (initialized) saveSettings({ [key]: $(id).checked }); });
$('dark-theme').addEventListener('change', () => saveSettings({ theme: $('dark-theme').checked ? 'dark' : 'light' }));
for (const id of ['avatar-original', 'avatar-chibi']) $(id).addEventListener('change', () => { if ($(id).checked) saveSettings({ avatar: $(id).value }); });
$('data-source').addEventListener('change', () => saveSettings({ dataSource: $('data-source').value }));
$('scale').addEventListener('input', () => { $('scale-output').value = $('scale').value + '%'; clearTimeout(scaleTimer); scaleTimer = setTimeout(() => saveSettings({ scale: Number($('scale').value) / 100 }), 200); });
for (const id of fields) $(id).addEventListener('input', () => { dirty.add(id); $('form-message').textContent = '有未保存的修改'; });
$('usage-form').addEventListener('submit', async event => {
  event.preventDefault(); const update = {};
  if (dirty.has('tokens')) { update.day = state.usage.day; update.todayTokens = $('tokens').value === '' ? null : Number($('tokens').value); }
  for (const [key, percent, reset] of [['fiveHour', 'five-percent', 'five-reset-input'], ['weekly', 'week-percent', 'week-reset-input']]) {
    if (dirty.has(percent) || dirty.has(reset)) update[key] = { remainingPercent: $(percent).value === '' ? null : Number($(percent).value), resetsAt: $(reset).value ? new Date($(reset).value).toISOString() : null };
  }
  if (dirty.has('task') || dirty.has('task-label')) update.task = { status: $('task').value, label: $('task-label').value };
  if (!Object.keys(update).length) { toast('没有需要保存的修改'); return; }
  const submit = $('usage-form').querySelector('button[type="submit"]'); submit.disabled = true;
  try { const next = await api.saveUsage(update); dirty.clear(); render(next); $('form-message').classList.remove('error'); $('form-message').textContent = '已保存并切换到手动记录'; toast('手动记录已同步到桌宠'); }
  catch (error) { $('form-message').classList.add('error'); $('form-message').textContent = message(error); }
  finally { submit.disabled = false; }
});
$('refresh-codex').addEventListener('click', async () => {
  $('refresh-codex').disabled = true;
  try { render(await api.refreshCodex()); toast('已更新 Codex 连接状态'); } catch (error) { toast(message(error)); }
  finally { $('refresh-codex').disabled = state.settings.dataSource !== 'codex'; }
});
$('select-codex').addEventListener('click', async () => { try { render(await api.selectCodex()); } catch (error) { toast(message(error)); } });
$('auto-codex').addEventListener('click', () => saveSettings({ codexExecutable: '', dataSource: 'codex' }));
$('copy-token').addEventListener('click', async () => { try { await api.copyToken(); toast('连接密钥已复制，请妥善保管'); } catch { toast('复制失败，请重试'); } });
for (const [id, action] of [['show-pet', 'show'], ['reset-position', 'reset-position'], ['codex-help', 'codex-help']]) $(id).addEventListener('click', () => api.action(action));
window.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); api.action('hide'); } });
for (const link of document.querySelectorAll('nav a')) link.addEventListener('click', () => { for (const other of document.querySelectorAll('nav a')) other.classList.toggle('active', other === link); });
