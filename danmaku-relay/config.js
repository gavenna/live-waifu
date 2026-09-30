/**
 * 弹幕中继配置 — 礼物映射、适配器参数、端口
 *
 * 改数值只改这个文件。重启生效。
 */

module.exports = {
  // === 端口 ===
  RELAY_PORT: 8766,              // 弹幕广播 WS 端口（订阅方 = 游戏服务器连这个）
  CTRL_PORT: 8767,               // 控制 HTTP API 端口（启停/状态/日志，供游戏工具箱跨进程调用）

  // === douyinLive 代理 ===
  DOUYINLIVE_PATH: 'tools/douyinLive.exe',  // 相对项目根。SEA 打包后 exe 同目录 tools/ 下
  DOUYINLIVE_YAML: 'tools/douyinLive.yaml', // 运行时根据 secrets.douyin.cookie 生成

  // === B站礼物 → 兵种映射 ===
  // 精确 ID 映射优先（secrets.bilibili.giftMap），未命中走此价格阶梯（金瓜子）
  BILIBILI_GIFT_TIERS: [
    { min: 1000, troop: 'giant' },        // 1000 金瓜子
    { min: 500, troop: 'royalGuard' },
    { min: 100, troop: 'knight' },
    { min: 10, troop: 'swordsman' },
  ],

  // === 抖音礼物 ID 映射 ===
  // 精确 ID 映射优先（secrets.douyin.giftMap），未匹配走 douyin.js 价格阶梯
  DOUYIN_GIFT_MAP: {
    // '1': 'swordsman',    // 小心心 1抖币
    // '5': 'knight',       // 棒棒糖 5抖币
    // '10': 'archer',      // 鲜花 10抖币
    // '30': 'catapult',    // 铁锤 30抖币
    // '99': 'royalGuard',  // 盾墙 99抖币
    // '199': 'fireArrow',  // 火矢齐射 199抖币
    // '299': 'batteringRam', // 攻城锤 299抖币
    // '520': 'giant',      // 城堡 520抖币
    // '1200': 'dragonKnight', // 龙骑士 1200抖币
    // '3000': 'wrathOfGod',   // 天神之怒 3000抖币
  },

  // === 抖音适配器配置 ===
  DOUYIN_ADAPTER: {
    PROXY_WS_URL: 'ws://localhost:1088', // douyinLive 代理地址
    LIKE_COOLDOWN_MS: 1000,         // 点赞冷却（单用户 ms）
    AUTO_JOIN_ON_ENTER: true,       // 进房自动加入随机阵营
    ENTER_JOIN_CHANCE: 0,           // 进房自动加入概率（0=全加入，0.5=50%）
    FOLLOW_REWARD_TROOP: 'militia', // 关注奖励兵种（null=无奖励）
    FOLLOW_REWARD_COUNT: 1,         // 关注奖励兵种数量
  },
};
