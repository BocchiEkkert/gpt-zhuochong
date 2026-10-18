'use strict';
const { unknownQuota } = require('./model.cjs');
const { codexUsageForView } = require('./codex-data.cjs');
function composeView(state, codex, activity, monitor, now = new Date()) {
  const next = structuredClone(state);
  next.manualUsage = structuredClone(state.usage); next.manualTask = structuredClone(state.task);
  if (state.settings.dataSource === 'codex') {
    next.usage = codexUsageForView(codex, now);
    const task = activity.task;
    if (task && now.getTime() - Date.parse(task.updatedAt) < 120000) next.task = task;
    else if (monitor.running && monitor.status !== 'unknown') next.task = { status: monitor.status, label: '', source: 'accessibility', updatedAt: monitor.checkedAt };
    else next.task = { status: 'unknown', label: '', source: 'unknown', updatedAt: null };
  } else {
    const source = state.settings.dataSource;
    if (next.usage.source !== source) Object.assign(next.usage, { todayTokens: null, source: 'unknown', updatedAt: null });
    for (const key of ['fiveHour', 'weekly']) if (next.usage[key].source !== source) next.usage[key] = unknownQuota();
    if (next.task.source !== source || next.task.status === 'unknown' || (source === 'connector' && now.getTime() - Date.parse(next.task.updatedAt) >= 120000)) next.task = { status: 'unknown', label: '', source: 'unknown', updatedAt: null };
  }
  return next;
}
module.exports = { composeView };
