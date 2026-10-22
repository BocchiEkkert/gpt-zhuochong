'use strict';
window.MikoView = {
  source: source => ({ manual: '手动录入', connector: '本机接口', codex: 'Codex 官方', codexLocal: '本机任务事件', accessibility: '界面检测', unknown: '未连接' })[source] || '未连接',
  number: value => value === null || value === undefined ? '—' : new Intl.NumberFormat('zh-CN').format(value),
  clock: value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '尚未更新',
  reset: value => {
    if (!value) return '重置时间未知';
    const minutes = Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 60000));
    if (!minutes) return '等待重新同步';
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
    return `${days ? `${days} 天 ` : ''}${hours ? `${hours} 小时 ` : ''}${mins} 分钟后重置`;
  },
  task: status => ({ running: '任务运行中', idle: '空闲待命', error: '任务遇到问题', unknown: '任务状态未知' })[status] || '任务状态未知',
  applyAppearance: state => {
    const settings = state.settings;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.avatar = settings.avatar;
    try { localStorage.setItem('mori-theme', settings.theme); } catch { /* Optional first-paint preference cache. */ }
    const original = settings.avatar === 'original';
    for (const image of document.querySelectorAll('[data-character]')) {
      const file = original ? 'dragon-girl.png' : 'dragon-chibi.png';
      if (!image.src.endsWith(file)) image.src = `../assets/${file}`;
      image.alt = original ? '银发紫瞳龙角少女，原比例全身立绘' : '银发紫瞳龙角少女，Q 版全身形象，ChatGPT 结形头饰与胸饰';
    }
  },
};
