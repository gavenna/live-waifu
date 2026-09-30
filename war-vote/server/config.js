// war-vote 配置 —— 端口、RW 路径、投票规则、兵种表
// 数值全部集中在这里，业务代码不写死

module.exports = {
  DEV_MODE: true,

  // ===== 端口（集中在此，勿在别处硬编码）=====
  WS_PORT: 8768,        // 服务 WS + HTTP
  FRONTEND_PORT: 3001,  // OBS 浏览器源
  TOOLBOX_PORT: 8761,   // 控制面板

  // ===== 弹幕中继 =====
  DANMAKU_RELAY_WS: 'ws://localhost:8766',
  // false = 不连弹幕中继，只用控制面板的手动/模拟投票（调试或看效果时用）
  USE_RELAY: true,

  // ===== Rusted Warfare 安装位置（换机器改这里）=====
  RW_DIR: 'D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/Rusted Warfare1.15',
  RW_MAPS_SUBDIR: 'mods/maps',
  // 生成的地图固定用这个名字 —— 主播每局点同一位置，将来 RPA 化只需点固定坐标
  MAP_FILE: 'live_battle',

  // ===== 地图规格 =====
  MAP_WIDTH: 40,
  MAP_HEIGHT: 40,
  TILE_SIZE: 20,
  // 双方阵地各占地图一侧，中间留出的隔离列数
  CENTER_GAP: 2,
  // 阵地距地图边缘留白
  MARGIN: 1,

  // units.tsx 在 tmx 里的 firstgid（地面 tileset 只占 gid 1）
  UNITS_FIRSTGID: 2,

  // ===== 投票规则 =====
  VOTE_DURATION_MS: 1 * 60 * 1000,  // 投票窗口 5 分钟
  MAX_VOTES_PER_PLAYER: 1,          // 每人每局票数上限（防刷）
  READY_HOLD_MS: 800,               // 锁票后到生成完成的展示延迟

  // ===== 阵营 =====
  TEAMS: {
    red:  { key: 'red',  team: 0, label: '红方', color: '#ff5a5a' },
    blue: { key: 'blue', team: 1, label: '蓝方', color: '#5a9bff' },
  },

  // 入阵营指令：弹幕文本 → 阵营 key
  JOIN_COMMANDS: {
    '红': 'red', '红方': 'red', '红队': 'red', '加红': 'red',
    '蓝': 'blue', '蓝方': 'blue', '蓝队': 'blue', '加蓝': 'blue',
  },

  // ===== 兵种表 =====
  // unit 名必须是 RW/mods/maps/units.tsx 里 team0/team1 都存在的单位
  // aliases 是观众可发的弹幕文本（数字键 + 中文别名双通道）
  TROOPS: [
    { key: 'tank',        unit: 'tank',        label: '坦克',   aliases: ['1', '坦克'] },
    { key: 'artillery',   unit: 'artillery',   label: '炮兵',   aliases: ['2', '炮', '炮兵'] },
    { key: 'heavyTank',   unit: 'heavyTank',   label: '重坦',   aliases: ['3', '重坦'] },
    { key: 'helicopter',  unit: 'helicopter',  label: '直升机', aliases: ['4', '飞机', '直升机'] },
    { key: 'turret',      unit: 'turret',      label: '炮塔',   aliases: ['5', '塔', '炮塔'] },
    { key: 'laserTank',   unit: 'laserTank',   label: '激光',   aliases: ['6', '激光'] },
    { key: 'bugMelee',    unit: 'bugMelee',    label: '虫族',   aliases: ['7', '虫', '虫子'] },
    { key: 'nukeLaucher', unit: 'nukeLaucher', label: '核弹',   aliases: ['8', '核弹'] },
  ],

  // ===== 阵型 =====
  // 只定义红方，蓝方自动 x 镜像。建筑固定，观众碰不到。
  FORMATION: {
    label: '锋矢阵',
    tipX: 18,   // 顶点 x（红方，靠近中线）
    tipY: 20,   // 顶点 y（地图垂直中心）
    rows: 10,        // 向后展开行数 —— 决定槽位总数与阵型进深
    widthStep: 0.5,  // 每退一行，半宽增加多少格（0.5 = 每两行长一格；调大更宽胖）
    // 按离顶点的距离分层决定兵种：前重甲、中主力、后远程
    layers: [
      { depth: 0, unit: 'heavyTank' },
      { depth: 3, unit: 'tank' },
      { depth: 6, unit: 'laserTank' },
      { depth: 8, unit: 'artillery' },
      { depth: 9, unit: 'turret' },
    ],
    buildings: [
      { x: 3, y: 20, unit: 'commandCenter' },
      { x: 3, y: 18, unit: 'landFactory' },
      { x: 5, y: 20, unit: 'builder' },
      { x: 5, y: 18, unit: 'builder' },
    ],
    // 阵型槽位占满后的溢出区（红方坐标，逐行填充）
    overflow: { x0: 2, y0: 3, width: 10, unit: 'tank' },
  },

  // 日志
  LOG_DIR: 'logs',
};
