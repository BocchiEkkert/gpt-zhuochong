'use strict';
window.MoriView = {
  source: source => ({ manual: '手动录入', connector: '本机接口', accessibility: '界面检测', unknown: '未连接' })[source] || '未连接',
  number: value => value === null || value === undefined ? '—' : new Intl.NumberFormat('zh-CN').format(value),
  clock: value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '尚未更新',
  reset: value => {
    if (!value) return '重置时间未知';
    const minutes = Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 60000));
    if (!minutes) return '等待重新同步';
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
    return `${days ? `${days} 天 ` : ''}${hours ? `${hours} 小时 ` : ''}${mins} 分钟后重置`;
  },
  task: status => ({ running: '正在生成', idle: '等待下一条指令', error: '任务遇到问题', unknown: '任务状态未知' })[status] || '任务状态未知',
};
