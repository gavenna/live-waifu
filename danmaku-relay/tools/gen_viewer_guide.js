'use strict'
/**
 * gen_viewer_guide.js — 生成**观众向**玩法说明（写 ../../docs/玩法说明.md，主页置顶用）
 *
 * 为什么要有它：主页文档是**对外承诺** —— 观众照着发弹幕，写错就是事故。
 *   本仓库历史上就出过"手写知识文件、无同步机制"⇒ 白名单换代后它还在教观众
 *   「红3战车」（早已不可召唤）。故这里与 gen_waifu_knowledge 同源：
 *   **一切数字从权威源算出来**，改玩法只需重跑，不会漂移。
 *
 * 数据源（项目内、面向玩法）：
 *   battle/summon-whitelist.json  可召唤兵种（truth source）+ 机制（冷却/分档/零门槛/队上限）
 *   battle/mod-units.json         mod 兵种单价
 *   battle/unit-prices.json       原版兵种单价（兜底）
 *   battle/giftTiers.js           礼物 → 余额比例 / 专属召唤
 *   battle/battleConfig.js        点赞 / 关注 / 开局余额 / 单局时长
 *
 * 🔒 净化边界：只输出**玩法事实**；**绝不**写文件路径 / 端口 / 脚本 / 注入 / 内部 API / 进程。
 *    tools/verify_viewer_guide.js 的 C 组断言会把关。
 *
 * 用法： node tools/gen_viewer_guide.js        # 写入 ../../docs/玩法说明.md
 */
const fs = require('fs')
const path = require('path')

let modUnits = []
try { modUnits = require('../battle/mod-units.json').units || [] } catch (e) { modUnits = [] }
const prices = require('../battle/unit-prices.json')
const giftTiers = require('../battle/giftTiers')
const battleConfig = require('../battle/battleConfig')
const sp = require('../battle/liveSpawner')
const wl = require('../battle/summon-whitelist.json')

try { battleConfig.loadDefaults() } catch (e) { /* 无落盘配置 → 内置默认 */ }
const cfg = battleConfig.effective()

const modByType = new Map(modUnits.map((u) => [u.type, u]))

function priceOf (type) {
  const mu = modByType.get(type)
  if (mu && Number.isFinite(mu.price)) return mu.price
  const p = prices[type]
  return Number.isFinite(p) ? p : null
}

function capOf (price) {
  const caps = (wl.summon && wl.summon.tierCaps) || []
  if (!caps.length) return null
  if (price == null) return caps[caps.length - 1].cap
  for (const t of caps) if (t.maxPrice == null || price <= t.maxPrice) return t.cap
  return caps[caps.length - 1].cap
}

function disp (type) { const n = sp.unitDisplayName(type); return n === type ? type : n }
function wordOf (type) {
  for (const cat of Object.keys(wl.categories || {})) {
    for (const u of (wl.categories[cat] || [])) if (u.type === type) return u.word
  }
  return disp(type)
}

/** 游戏币 → 口播/文档用中文量词（160000 → "16 万"，2000 → "2000"）。 */
function fmtMoney (n) {
  const v = Math.round(Number(n) || 0)
  if (v >= 100000000) return (v / 100000000) + ' 亿'
  if (v >= 10000) return (v / 10000) + ' 万'
  return String(v)
}

const CAT_ORDER = ['land', 'air', 'building', 'sea']
const CAT_LABEL = { land: '陆战部队', air: '空中部队', building: '防御 / 建筑', sea: '海军' }

function buildGuide () {
  const L = []
  const summonable = []
  const giftOnly = []
  for (const c of CAT_ORDER) {
    for (const u of ((wl.categories || {})[c] || [])) (u.giftOnly ? giftOnly : summonable).push({ cat: c, u })
  }
  const basic = (wl.summon && wl.summon.basicUnit) || 'EkBuzzard'
  const cdSec = Math.round(((wl.summon && wl.summon.cooldownMs) || 3000) / 1000)
  const teamCap = (wl.summon && wl.summon.teamCapPerRound) || 300
  const caps = ((wl.summon && wl.summon.tierCaps) || []).slice()
    .sort((a, b) => (a.maxPrice == null ? Infinity : a.maxPrice) - (b.maxPrice == null ? Infinity : b.maxPrice))

  L.push('# 默川直播间 ·《红蓝对战》玩法说明')
  L.push('')
  L.push('发一条弹幕，就能召唤部队替你支持的阵营打仗 —— 红蓝两军 AI 自动对拼，你来加码。')
  L.push('')
  L.push('## 一、30 秒上手')
  L.push('')
  L.push('1. **站队**：发一条写 `红` / `蓝` 的**有效指令**（哪怕只发一个 `红`）就算入队；进直播间也会自动随机编队。')
  L.push('2. **发指令**：`阵营 + 数量 + 兵种` —— 例：`红3狂暴者`、`蓝方5秃鹰`、`red2buzzard`。')
  L.push('3. **看出兵**：你的部队从自家指挥中心出发，自动扑向敌方基地。')
  L.push('')
  L.push(`> 记不住兵种名？光发一个 \`红\` 或 \`蓝\` 也行 —— 直接出 1 个${wordOf(basic)}，零门槛参战。`)
  L.push('')

  L.push(`## 二、能召唤哪些兵（当前开放 ${summonable.length} 种）`)
  L.push('')
  L.push('> ⚠️ **只有下面这些词能召唤**。旧词（`战车` / `坦克` / `tank` / `猛犸` …）已经不能用了，发了不出兵。')
  L.push('')
  for (const c of CAT_ORDER) {
    const usable = ((wl.categories || {})[c] || []).filter((u) => !u.giftOnly)
    if (!usable.length) continue
    L.push(`**${CAT_LABEL[c]}**`)
    L.push('')
    for (const u of usable) {
      const p = priceOf(u.type)
      const cap = capOf(p)
      const al = (u.aliases && u.aliases.length) ? `（也可写 ${u.aliases.join(' / ')}）` : ''
      const bits = [p == null ? '**免费**（不扣钱）' : `单价 **${fmtMoney(p)}**`]
      if (cap != null) bits.push(`单条最多 **${cap} 个**`)
      L.push(`- \`${u.word}\`${al} · ${bits.join(' · ')}`)
    }
    L.push('')
  }

  L.push('## 三、能出多少（数量与限制）')
  L.push('')
  L.push('- **数量写在阵营后面**：`红5秃鹰` = 5 个秃鹰；不写就是 1 个。')
  if (caps.length) {
    L.push('- **单条上限按兵种造价分档**：')
    for (let i = 0; i < caps.length; i++) {
      const t = caps[i]
      const prev = caps[i - 1]
      let label
      if (i === 0) label = `单价 ≤ ${fmtMoney(t.maxPrice)}`
      else if (t.maxPrice == null) label = `单价 > ${fmtMoney(prev.maxPrice)}`
      else label = `单价 ${fmtMoney(prev.maxPrice)} – ${fmtMoney(t.maxPrice)}`
      L.push(`  - ${label} → 一条最多 **${t.cap} 个**`)
    }
  }
  L.push(`- **冷却**：同一个人 **${cdSec} 秒**内只能发一条有效指令。`)
  L.push(`- **每队总量**：每一局，一支队伍的观众兵合计上限 **${teamCap} 个**（红蓝一样，防止一边倒）。`)
  L.push(`- **兵种数**：弹幕能召唤 **${summonable.length} 种**`
    + (giftOnly.length ? `，另有 **${giftOnly.length} 种只能靠礼物召唤**（见下）。` : '。'))
  L.push('')

  L.push('## 四、钱怎么算')
  L.push('')
  L.push('- 召唤花的是**你支持阵营的游戏币**（不是真钱）：`单价 × 数量`。')
  if (cfg.viewerStartingCredits) L.push(`- 每局开局，两队各有 **${fmtMoney(cfg.viewerStartingCredits)}** 启动资金。`)
  L.push('- 点赞、关注、送礼物都能给阵营**加钱**（见下）。')
  L.push('- 钱不够 → 这条弹幕**作废**（不出兵、不扣钱），画面上会提示「余额不足」。')
  L.push('- 画面右上角实时显示两队的 `$ 余额 (+ 每秒收入)`。')
  L.push('')

  L.push('## 五、送礼物')
  L.push('')
  L.push(`- **送礼物 = 给阵营加钱**：每 1 抖币 = **${fmtMoney(giftTiers.CREDITS_PER_COIN)}** 游戏币。`)
  L.push(`  - 例：1 颗小心心（1 抖币）→ 阵营 **+${fmtMoney(giftTiers.CREDITS_PER_COIN)}**；连刷 10 颗 → **+${fmtMoney(giftTiers.CREDITS_PER_COIN * 10)}**。`)
  for (const g of giftOnly) {
    L.push(`- **例外：「闪耀星辰」** 不换钱 —— 它**直接召唤 1 个${wordOf(g.u.type)}**（全图最强清场兵）到你支持的阵营。`)
  }
  L.push('- 加的钱进阵营钱包，可以继续发弹幕换兵。')
  L.push('')

  L.push('## 六、点赞 / 关注')
  L.push('')
  if (cfg.likeCredits) {
    const extra = cfg.likePerExtra ? `，每多 1 个连赞再 +${cfg.likePerExtra}` : ''
    const cap = cfg.likeCap ? `，单次最多 +${cfg.likeCap}` : ''
    L.push(`- **点赞**：给阵营 **+${cfg.likeCredits}**${extra}${cap}。`)
  }
  if (cfg.followCredits) {
    const w = cfg.followWindowMin ? `（同一人 ${cfg.followWindowMin} 分钟内只算一次）` : '（每人只算一次）'
    L.push(`- **关注**：给阵营 **+${cfg.followCredits}**${w}。`)
  }
  L.push('')

  L.push('## 七、一局怎么走')
  L.push('')
  const mins = cfg.roundMaxMs ? Math.round(cfg.roundMaxMs / 60000) : 5
  L.push(`- 自动开局 → 红蓝 AI 对拼 → 一方基地被拆，或超过 ${mins} 分钟判胜负 → 自动开下一局。`)
  L.push('- 结束后播报胜负和本轮**贡献榜前三**；前三名下一轮的部队头顶会带**称号 / 皇冠**。')
  L.push('')
  L.push('---')
  L.push('')
  L.push('> 本说明由生成器自动产出（改玩法后重跑）。如与直播间实际播报不一致，以直播间为准。')
  return L.join('\n') + '\n'
}

function main () {
  const out = path.join(__dirname, '..', '..', 'docs', '玩法说明.md')
  fs.writeFileSync(out, buildGuide(), 'utf8')
  process.stderr.write('wrote ' + out + '\n')
}
if (require.main === module) main()
module.exports = { buildGuide }
