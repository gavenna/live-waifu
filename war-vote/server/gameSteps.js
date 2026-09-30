// war-vote 游戏自动化 — 坐标配置
// 所有坐标都是相对窗口的百分比 (0.0 ~ 1.0)
// 首次探索后替换为真实值

module.exports = {
  window: {
    width: 1024,
    height: 768,
    mode: 'windowed'
  },
  steps: [
    { action: 'wait', ms: 3000, label: '等待游戏加载' },
    { action: 'click', x: 0.45, y: 0.60, label: 'Skirmish', wait: 2000 },
    { action: 'click', x: 0.30, y: 0.40, label: '目标地图', wait: 1000 },
    { action: 'click', x: 0.85, y: 0.90, label: 'Start Game', wait: 3000 },
    { action: 'verify', label: '确认游戏画面正常' }
  ],
  tolerance: 0.02
}