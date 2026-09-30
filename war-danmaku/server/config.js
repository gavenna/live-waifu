/**
 * 游戏配置 — 所有数值参数集中管理
 *
 * 改数值只改这个文件，不在业务代码里写死。
 * 改完后重启 server 生效。
 */

module.exports = {
  // === 开发模式 ===
  DEV_MODE: true,                    // true=调试模式（缩短回合时间），上线前改 false

  // === 服务器 ===
  WS_PORT: 8765,
  DANMAKU_RELAY_WS: 'ws://localhost:8766', // 弹幕中继 WS（连接 danmaku-relay）
  DB_PATH: 'data/war-danmaku.db',   // SQLite 数据库路径

  // === 游戏循环 ===
  ROUND_TIME: 20 * 60 * 1000,       // 单局最大时长 20分钟（ms）
  PREP_TIME: 30 * 1000,             // 准备阶段 30秒
  SETTLE_TIME: 10 * 1000,           // 结算展示 10秒
  BATTLE_TICK_MS: 100,              // 战斗计算 tick 间隔 100ms (10tps)

  // DEV_MODE 覆盖（调试时自动缩短）
  get PREP_TIME_EFF() { return this.DEV_MODE ? 30 * 1000 : this.PREP_TIME; },
  get ROUND_TIME_EFF() { return this.DEV_MODE ? 3 * 60 * 1000 : this.ROUND_TIME; },
  get SETTLE_TIME_EFF() { return this.DEV_MODE ? 6 * 1000 : this.SETTLE_TIME; },

  // === 城堡 ===
  CASTLE_HP: 10000,                 // 城堡初始血量

  // === 动态平衡 ===
  BALANCE: {
    OUTNUMBER_RATIO: 2.0,           // 人数差 >2倍触发平衡
    OUTNUMBER_BUFF: 0.3,            // 少数方伤害 +30%
    COMEBACK_THRESHOLD: 0.3,        // 城堡 HP <30% 触发背水一战
    COMEBACK_BUFF: 0.15,            // 劣势方伤害 +15%
    STOMP_TIME: 5 * 60 * 1000,      // 碾压 5分钟触发加速
    STOMP_BUFF: 0.10,               // 优势方伤害 +10%
    // 战斗参数
    COUNTER_MULTIPLIER: 2.0,        // 克制伤害倍率
    PUSH_FACTOR: 0.02,             // 战线推进系数（每点伤害差推进的战线单位）
    COLLISION_RANGE: 60,           // 近战交战距离 (px)
    RANGED_ATTACK_RANGE: 230,     // 远程攻击距离 (px)
    SPEED_FACTOR: 3,              // 速度→像素转换 (px/tick per speed unit)
    CASTLE_DMG_PER_TICK: 50,      // 战线到城堡时每 tick 伤害（单线模式）
    CASTLE_DMG_PER_TICK_LANE: 17, // 三线模式每线每 tick 伤害（3×17≈51≈50）
    FRONTLINE_MAX: 1000,          // 战线最大值（到达城堡）
    MAX_TROOP_AGE: 60 * 1000,     // 兵种最大存活时间 60秒
  },

  // === 城堡防御 ===
  CASTLE_DEFENSE: {
    RANGE: 350,                   // 箭塔射程 (px)，从城堡中心算
    INTERVAL: 2000,               // 射击间隔 (ms)
    DAMAGE: 5,                    // 每箭伤害
    ARROW_SPEED: 500,             // 箭矢飞行速度 (px/s)，用于前端动画
  },

  // === 三线战场 ===
  LANES: {
    COUNT: 3,
    Y: [390, 575, 760],           // 北境/王道/河谷 的 Y 中心坐标
    NAMES: ['北境', '王道', '河谷'],
    RED_GATE_X: 285,
    BLUE_GATE_X: 1635,
  },

  // === 兵种定义 ===
  // 每个兵种 = 一个付费档位
  // HP 上调 5x，伤害下调 2x（高费兵），确保战斗时长足够展示动画
  TROOPS: {
    // 免费层（弹幕指令触发）
    militia:  { name: '民兵',   damage: 1,   hp: 50,  speed: 1.0, cost: 0,     attackRange: 55,  showAvatar: false, avatarSize: 0,    avatarTime: 0,    counters: ['raider'] },
    spearman: { name: '矛兵',   damage: 2,   hp: 45,  speed: 0.9, cost: 0,     attackRange: 65,  showAvatar: false, avatarSize: 0,    avatarTime: 0,    counters: ['militia'] },
    bowman:   { name: '弓兵',   damage: 1.5, hp: 30,  speed: 1.0, cost: 0,     attackRange: 200, showAvatar: false, avatarSize: 0,    avatarTime: 0,    ranged: true,  counters: ['spearman'] },
    raider:   { name: '突袭兵', damage: 2.5, hp: 35,  speed: 2.2, cost: 0,     attackRange: 55,  showAvatar: false, avatarSize: 0,    avatarTime: 0,    counters: ['bowman'] },
    // 入门层 (~1元)
    swordsman:{ name: '剑士',   damage: 3,   hp: 150, speed: 1.2, cost: 1,     attackRange: 64,  showAvatar: false, avatarSize: 0,    avatarTime: 0,    counters: ['militia'] },
    knight:   { name: '骑士',   damage: 12,  hp: 400, speed: 2.0, cost: 5,     attackRange: 58,  showAvatar: false, avatarSize: 0,    avatarTime: 0,    counters: ['swordsman', 'archer'] },
    // 进阶层 (1~10元)
    archer:   { name: '弓手',   damage: 20,  hp: 125, speed: 1.0, cost: 10,    attackRange: 230, showAvatar: false, avatarSize: 0,    avatarTime: 0,    ranged: true,  counters: ['knight'] },
    catapult: { name: '投石车', damage: 60,  hp: 250, speed: 0.5, cost: 30,    attackRange: 280, showAvatar: false, avatarSize: 0,    avatarTime: 0,    aoe: true,     counters: ['archer'] },
    // 核心层 (10~100元) ★ 营收主力
    royalGuard:  { name: '皇家卫队', damage: 100, hp: 1000, speed: 1.5, cost: 99,  attackRange: 70,  showAvatar: true,  avatarSize: 'small',  avatarTime: 5000,  counters: ['knight', 'archer'] },
    fireArrow:   { name: '火矢齐射', damage: 500, hp: 0,   speed: 0,   cost: 199, attackRange: 0,   showAvatar: false, avatarSize: 0,       avatarTime: 0,    globalSkill: true, slow: 0.3, slowTime: 8000, counters: [] },
    batteringRam:{ name: '攻城锤',   damage: 1500,hp: 0,   speed: 0,   cost: 299, attackRange: 0,   showAvatar: true,  avatarSize: 'medium', avatarTime: 8000,  siege: true,   counters: [] },
    // 顶级层 (100~500元) ★ 大哥专区
    giant:       { name: '岩石巨人', damage: 500, hp: 2500, speed: 0.8, cost: 520,  attackRange: 85,  showAvatar: true, avatarSize: 'large',  avatarTime: 12000, counters: ['militia', 'swordsman', 'knight', 'archer', 'catapult', 'royalGuard'] },
    dragonKnight:{ name: '龙骑士',   damage: 1000,hp: 5000,speed: 3.0, cost: 1200, attackRange: 180, showAvatar: true, avatarSize: 'huge',   avatarTime: 3000,  dragonBreath: true, breathBurn: 30, breathTime: 3000, roarInterval: 5000, counters: ['giant'] },
    wrathOfGod:  { name: '天神之怒', damage: 8000, hp: 0,   speed: 0,   cost: 3000, attackRange: 0,   showAvatar: false,avatarSize: 0,       avatarTime: 0,    globalSkill: true, castleDmg: 0.2, counters: [] },
    // 盲盒
    warChest:    { name: '战争宝箱', damage: 0,   hp: 0,   speed: 0,   cost: 99,  showAvatar: false, avatarSize: 0,       avatarTime: 0,    random: true,  counters: [] },
  },

  // === 盲盒概率 ===
  WAR_CHEST_POOL: ['swordsman', 'catapult', 'royalGuard', 'giant', 'dragonKnight'],
  WAR_CHEST_WEIGHTS: [0.35, 0.30, 0.20, 0.10, 0.05],

  // === 积分 ===
  SCORE: {
    KILL: 10,
    CASTLE_DMG_DIVISOR: 10,         // 对城堡伤害/10 = 积分
    WIN_BONUS: 200,
    MVP_BONUS: 500,
    SVP_BONUS: 300,
    GIFT_MULTIPLIER: 3,             // 礼物价值×3 = 积分
    MULTI_KILL_5: 1.5,
    MULTI_KILL_10: 2.0,
  },

  // === 军衔（段位） ===
  RANKS: [
    { name: '新兵',    minScore: 0 },
    { name: '老兵',    minScore: 500 },
    { name: '十夫长',  minScore: 2000 },
    { name: '百夫长',  minScore: 8000 },
    { name: '千夫长',  minScore: 20000 },
    { name: '将军',    minScore: 50000 },
    { name: '元帅',    minScore: 100000 },
  ],

  // === 弹幕指令 ===
  DANMAKU_COMMANDS: {
    '1': 'join_red',
    '红': 'join_red',
    '加红': 'join_red',
    '炎龙': 'join_red',
    '2': 'join_blue',
    '蓝': 'join_blue',
    '加蓝': 'join_blue',
    '霜狼': 'join_blue',
    '杀': 'spawn_militia_3',
    '枪': 'spawn_spearman_2',
    '射': 'spawn_bowman_2',
    '袭': 'spawn_raider_2',
    '冲': 'spawn_raider_2',
    '666': 'spawn_militia_3',
    '赞': 'spawn_militia_3',    // 抖音点赞映射
  },


  // === 兵种动画 ===
  ANIMATION: {
    IDLE_AFTER_SPAWN: 600,        // 出生后 idle 停留时间 (ms)
    IDLE_FRAMES: 4,               // idle 帧数（呼吸循环）
    IDLE_FRAME_MS: 150,           // idle 帧间隔 → 总周期 600ms
    WALK_FRAMES: 6,               // walk 帧数（闭口走步循环）
    WALK_FRAME_MS: 100,           // walk 帧间隔 → 总周期 600ms
    WALK_BOB_AMPLITUDE: 3,        // 行走程序化弹跳幅度 (px)
    ATTACK_FRAMES: 4,             // attack 帧数（蓄力→挥砍→命中→收招）
    ATTACK_FRAME_MS: 120,         // attack 帧间隔 → 总时长 480ms
    DEATH_FRAMES: 4,              // death 帧数（受击→踉跄→倒地→消失）
    DEATH_FRAME_MS: 180,          // death 帧间隔 → 总时长 720ms
    DEATH_DURATION: 720,          // 死亡动画总时长 (ms)，播完后从数组移除
    ATTACK_RANGE_FACTOR: 1.3,     // 攻击动画触发范围 = COLLISION_RANGE × 此值
  },

  // === 日志 ===
  // 使用 Pino，通过环境变量控制: LOG_LEVEL=debug|info|warn|error
  // 开发模式: pino-pretty 彩色输出到终端
  // 生产模式: NODE_ENV=production → server/logs/combined.log + error.log

  // === 渲染 ===
  CANVAS_WIDTH: 1920,
  CANVAS_HEIGHT: 1080,
  FPS_TARGET: 30,

  // === 虚拟主播话术 (waifu-agent 集成) ===
  ANNOUNCER: {
    ENABLED: true,                                 // 是否启用话术播报
    WAIFU_WS_URL: 'ws://127.0.0.1:9191/status',   // waifu-agent WS 中继地址
    TTS_VOICE: 'zh-CN-XiaoxiaoNeural',             // edge-tts 语音
    TTS_CACHE_SIZE: 50,                            // LRU 缓存条数
    PYTHON_PATH: 'python',                         // Python 路径
    DRY_RUN: false,                                // true=跳过 TTS, 只打印话术 (调试用)
    TRACE_LEVEL: 0,                                // 0=仅 speak 日志 1=管线追踪 2=全量调试

    // 防抖/冷却 (ms)
    GIFT_COOLDOWN: 2000,         // 礼物感谢最小间隔
    KILL_COOLDOWN: 4000,         // 击杀播报最小间隔
    SIEGE_COOLDOWN: 5000,        // 攻城播报最小间隔
    REPORT_INTERVAL: 30000,      // 定期战况播报间隔

    // LLM 话术 (Phase 3)
    LLM_ENABLED: false,                                // Phase 3 前关闭
    LLM_API_URL: 'https://api.deepseek.com/v1/chat/completions',
    LLM_MODEL: 'deepseek-chat',
    LLM_INTERVAL: 30000,         // LLM 调用最小间隔
    LLM_TIMEOUT: 10000,          // LLM 超时降级到模板
  },
};
