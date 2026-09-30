/**
 * battle/battleConfig.js — 开局参数（AI 数量 / AI 难度 / 队伍模式 / 迷雾 / 初始资金）
 *                            + 互动奖励（观众点赞 / 关注 → 给某队加余额的金额）
 *
 * 两层语义：
 *   defaults —— 落盘（data/battle-config.json），跨中继重启保留，是"开播时设一次"那一层
 *   next     —— 仅内存，只影响**下一轮**，轮次结束后由 battle/index.js 清掉
 *   effective() = defaults 被 next 覆盖后的结果，起局时读它
 *
 * 🔴 硬约束（见 battle/teams.js:20-23）：引擎建 AI 先填奇数槽 1,3,5,7 再填偶数槽 2,4,6
 *    ⇒ numberOfAIs < 4 时 team 2 不存在 ⇒ BLUE_TEAM 整队失效、观众发的蓝军弹幕全部落空。
 *    这里做**最后一道**校验；UI 与 HTTP API 各自也校验一次（三道防线，宁可冗余）。
 *
 * 落盘路径可用 RW_BATTLE_CONFIG_FILE 覆盖（离线回归用临时文件，见 tools/verify_battle_config.js）。
 */
const fs = require('fs')
const path = require('path')

const FILE = process.env.RW_BATTLE_CONFIG_FILE ||
  path.join(__dirname, '..', 'data', 'battle-config.json')

/** 每项：min / max / def。def 同时充当"非法输入的回退值"。 */
const LIMITS = {
  numberOfAIs: { min: 4, max: 7, def: 7 },            // <4 ⇒ 蓝方(team 2)不存在，见文件头
  aiDifficulty: { min: -2, max: 3, def: 0 },          // 界面 6 档
  aiTeams: { min: 1, max: 5, def: 5 },                // 5 = Free for all（applyHostility 的前提）
  fogMode: { min: 0, max: 2, def: 2 },                // 0=No fog / 1=Basic fog / 2=默认（j/ad.java:476-483）
  startingCredits: { min: 0, max: 1000000, def: 0 },  // 0 = **不改**，沿用地图自带 credits
  // ★ 观众钱包开局余额（2026-09-27）：红=team3 / 蓝=team4 的初始 credits。
  //   0 = 不改（沿用引擎默认 4000，买不起白名单兵）；> 0 = 每轮开局把两边观众钱包设为它。
  //   观众召唤 / 互动都走这两个队（分账后），故这个数决定观众开局能不能出兵。
  viewerStartingCredits: { min: 0, max: 1000000, def: 100000 },
  // ★ 皇冠位置（2026-09-27）：冠军皇冠贴头像**正上方**，这个值 = 皇冠底边 ↔ 头像顶边的**屏幕像素间距**。
  //   调大 = 皇冠更靠上（离头像更远）。用「屏幕像素」而非世界像素 ⇒ 任何缩放下观感一致。
  crownOffset: { min: 0, max: 300, def: 30 },
  likeCredits: { min: 0, max: 1000000, def: 1000 },   // 每次观众点赞给某队加多少余额（0 = 关闭）
  followCredits: { min: 0, max: 1000000, def: 50000 }, // 每次观众关注给某队加多少余额（0 = 关闭）
  // ★ 关注去重的时间窗（2026-09-27）：同一人 N 分钟内重复关注**只算一次**；超过就算新的一次
  //   （取关后再关注能再拿）。0 = 只算第一次（严格去重，永不重复）。RW_FOLLOW_WINDOW_MS 可覆盖。
  followWindowMin: { min: 0, max: 1440, def: 60 },
  // ★ 点赞量化（2026-09-27）：按**连赞数**计 —— 基础额 likeCredits + (连赞数-1)×likePerExtra，单次封顶 likeCap。
  likePerExtra: { min: 0, max: 1000000, def: 10 },     // 连赞每多 1 个额外加多少（0 = 只按基础额）
  likeCap: { min: 0, max: 10000000, def: 5000 },       // 单次点赞奖励封顶（0 = 不封顶）
  // ★ 观众独立钱包（分账）模式：
  //   'viewer' = 观众的钱落**观众宿主队**（红=team3 / 蓝=team4），与 AI 主队(team1/2)隔离（默认，推荐）；
  //   'shared' = 旧行为：观众的钱与 AI 共用主队池（AI 会花掉观众充的钱）。
  //   这是**枚举**（不是数值）—— 见下方 clamp 的 enum 分支，不走 min/max。
  walletMode: { enum: ['viewer', 'shared'], def: 'viewer' },
  // 单局时长上限（毫秒）。0 = **未设置** ⇒ 回落 RW_ROUND_MAX_MS 环境变量，再回落 5 分钟内置兜底。
  //   控制面板用「分钟」输入，提交时 ×60000；这里存规范单位毫秒（与 RW_ROUND_MAX_MS 同口径）。
  //   每轮开局时重新解析（见 roundManager.resolveMaxDurationMs）⇒ 面板改了**下一轮**即生效。
  roundMaxMs: { min: 0, max: 21600000, def: 0 },      // 上限 6 小时，防手滑写离谱值
  // 注：送礼走**加余额**（2026-10 起：按礼物价值给该阵营观众钱包加钱，1 抖币 = 50W；
  //     「闪耀星辰」例外 → 直接召唤 1 个执行者）。比例是代码常量 CREDITS_PER_COIN
  //     （见 battle/giftTiers.js），**不是**面板配置项；旧存档里的 giftCreditsPerCoin 会被 loadDefaults 忽略。
}

function builtinDefaults () {
  const o = {}
  for (const k of Object.keys(LIMITS)) o[k] = LIMITS[k].def
  return o
}

let defaults = builtinDefaults()
let next = null

/** 夹到合法区间；非数字回退 def（绝不产出 NaN）。枚举项（有 enum 数组）走值集校验。 */
function clamp (key, v) {
  const L = LIMITS[key]
  if (L.enum) return L.enum.indexOf(String(v)) >= 0 ? String(v) : L.def
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return L.def
  return Math.min(Math.max(n, L.min), L.max)
}

/** 从磁盘读 defaults；文件缺失/损坏一律回落内置默认，**永不抛**。 */
function loadDefaults () {
  defaults = builtinDefaults()
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    for (const k of Object.keys(LIMITS)) {
      if (raw && raw[k] != null) defaults[k] = clamp(k, raw[k])
    }
  } catch (e) { /* 首次运行无文件 / 文件损坏 —— 都用内置默认，不阻断起局 */ }
  return defaults
}

function saveDefaults () {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(defaults, null, 2), 'utf8')
    return true
  } catch (e) { return false }
}

/**
 * 写入配置（只改 patch 里出现的键）。
 * @param {object} patch
 * @param {'default'|'next'} scope default = 存为全局默认并落盘；next = 只影响下一轮
 * @returns {{defaults:object,next:object|null,effective:object}}
 */
function setConfig (patch, scope) {
  const clean = {}
  for (const k of Object.keys(LIMITS)) {
    if (patch && patch[k] != null) clean[k] = clamp(k, patch[k])
  }
  if (scope === 'next') {
    next = Object.assign({}, next || {}, clean)
  } else {
    defaults = Object.assign({}, defaults, clean)
    saveDefaults()
  }
  return { defaults, next, effective: effective() }
}

/** defaults 被 next 覆盖后的结果 —— 起局时读这个。 */
function effective () { return Object.assign({}, defaults, next || {}) }

/** 清掉单轮覆盖（轮次结束时调用）。幂等。 */
function clearNext () { next = null; return true }

/** 当前生效的分账模式：'viewer'（默认，观众钱包落 viewer 宿主队）/ 'shared'（旧行为，落 AI 主队）。 */
function walletMode () {
  const m = effective().walletMode
  return m === 'shared' ? 'shared' : 'viewer'
}

module.exports = {
  LIMITS,
  loadDefaults,
  saveDefaults,
  setConfig,
  effective,
  clearNext,
  clamp,
  walletMode,
  get defaults () { return defaults },
  get next () { return next }
}
