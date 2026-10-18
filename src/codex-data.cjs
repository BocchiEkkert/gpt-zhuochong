'use strict';
const { localDay, unknownQuota } = require('./model.cjs');

function quotaFromWindow(window, now = new Date()) {
  if (!window || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) return unknownQuota();
  const reset = Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0 ? window.resetsAt * 1000 : null;
  if (reset !== null && (!Number.isFinite(reset) || reset <= now.getTime() || reset > 8.64e15)) return unknownQuota();
  return { remainingPercent: Math.round((100 - window.usedPercent) * 10) / 10,
    resetsAt: reset === null ? null : new Date(reset).toISOString(), updatedAt: now.toISOString(), source: 'codex' };
}
function readRateLimits(result, now = new Date()) {
  if (!result || typeof result !== 'object') throw new TypeError('Codex 额度响应无效');
  const buckets = result.rateLimitsByLimitId;
  // Never silently display another model's quota as the Codex account quota.
  const bucket = buckets && Object.keys(buckets).length ? buckets.codex : result.rateLimits;
  if (!bucket || (bucket.limitId && bucket.limitId !== 'codex')) throw new TypeError('此账户未返回 Codex 额度窗口');
  const windows = [bucket.primary, bucket.secondary].filter(Boolean);
  const five = windows.find(w => w.windowDurationMins === 300);
  const week = windows.find(w => w.windowDurationMins === 10080);
  return { fiveHour: quotaFromWindow(five, now), weekly: quotaFromWindow(week, now),
    ordinaryUsageAllowed: typeof result.ordinaryUsageAllowed === 'boolean' ? result.ordinaryUsageAllowed : null,
    plan: typeof bucket.planType === 'string' ? bucket.planType.slice(0, 40) : null,
    quotaUpdatedAt: now.toISOString(),
    quotaNote: !five && !week ? 'Codex 未返回五小时或周窗口；不替换为其他额度窗口。' : null };
}
function readDailyUsage(result, now = new Date()) {
  if (!result || !Array.isArray(result.dailyUsageBuckets)) return null;
  const day = localDay(now);
  const bucket = result.dailyUsageBuckets.find(item => item && item.startDate === day);
  if (!bucket || !Number.isSafeInteger(bucket.tokens) || bucket.tokens < 0) return null;
  return { day, todayTokens: bucket.tokens, source: 'codex', updatedAt: now.toISOString(), scope: 'Codex 账户日统计' };
}
function codexUsageForView(codex, now = new Date()) {
  const freshQuota = codex.status === 'connected' && codex.quotaUpdatedAt && now.getTime() - Date.parse(codex.quotaUpdatedAt) < 120000;
  const freshDaily = codex.status === 'connected' && codex.daily?.day === localDay(now) && now.getTime() - Date.parse(codex.daily.updatedAt) < 120000;
  return { day: localDay(now), todayTokens: freshDaily ? codex.daily.todayTokens : null,
    source: freshDaily ? 'codex' : 'unknown', updatedAt: freshDaily ? codex.daily.updatedAt : null,
    scope: 'Codex 账户日统计',
    fiveHour: freshQuota ? expireQuota(codex.fiveHour, now) : unknownQuota(),
    weekly: freshQuota ? expireQuota(codex.weekly, now) : unknownQuota() };
}
function expireQuota(quota, now) {
  if (!quota || (quota.resetsAt && Date.parse(quota.resetsAt) <= now.getTime())) return unknownQuota();
  return { ...quota };
}
module.exports = { quotaFromWindow, readRateLimits, readDailyUsage, codexUsageForView };
