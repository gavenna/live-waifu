; 录制的点击坐标

module.exports = {
  window: { width: 1024, height: 768, mode: 'windowed' },
  steps: [
    { action: 'wait', ms: 3000, label: '等待游戏加载' },
    { action: 'click', x: 0.4017, y: 0.3569, label: '单人战役', wait: 2000 },
    { action: 'click', x: 0.4116, y: 0.4424, label: '沙盒编辑器', wait: 2000 },
    { action: 'click', x: 0.4833, y: 0.1626, label: 'Map Type 默认 Skirmish Map', wait: 2000 },
  ],
  tolerance: 0.02
}
