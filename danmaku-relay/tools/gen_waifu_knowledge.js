'use strict'
/**
 * gen_waifu_knowledge.js — 生成 AI 主播的「玩法知识」文件（battle/waifu-knowledge.md）
 *
 * 为什么要有它：waifu 的玩法知识原先**手写、无同步机制** ⇒ 白名单换代后它还在教观众
 * 「红3战车」（早已不可召唤）、旧单价、旧冷却。本生成器把知识**从权威源算出来**，
 * 消灭"说法滞后于实现"。
 *
 * 数据源（全部项目内、面向玩法）：
 *   battle/summon-whitelist.json  可召唤兵种（**truth source**）+ 机制（冷却/分档/零门槛/队上限）
 *   battle/mod-units.json         mod 兵种单价
 *   battle/unit-prices.json       原版兵种单价（兜底）
 *   battle/giftTiers.js           礼物档位
 *   battle/battleConfig.js        点赞 / 关注奖励
 *
 * 🔒 净化边界：只输出**玩法事实**；**绝不**写入端口 / 脚本 / 注入 / 文件路径 / 进程 等内部细节。
 *    verify_waifu_knowledge.js 的 C 组断言会把关。
 *
 * 用法： node tools/gen_waifu_knowledge.js          # 写入 battle/waifu-knowledge.md
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
  if (price == null) { const last = caps[caps.length - 1]; return last ? last.cap : null }
  for (const t of caps) if (t.maxPrice == null || price <= t.maxPrice) return t.cap
  return caps.length ? caps[caps.length - 1].cap : null
}
function disp (type) { const n = sp.unitDisplayName(type); return n === type ? type : n }
function wordOf (type) {
  for (const cat of Object.keys(wl.categories || {})) {
    for (const u of (wl.categories[cat] || [])) if (u.type === type) return u.word
  }
  return disp(type)
}

const CAT_LABEL = { land: '陆战', air: '空中', building: '防御 / 建筑', sea: '海面' }

function buildKnowledge () {
  const L = []
  L.push('# 直播间《红蓝对战》玩法知识（回答观众时必须依据这些事实，不要编造）')
  L.push('')
  L.push('> ⚙️ 本文件由生成器自动产出 —— **请勿手改**；改玩法请改对应源文件后重跑生成。')
  L.push('> 用途：作为 AI 主播的玩法依据 —— 让它**知道**本直播间怎么玩、有哪些兵、机制如何。')
  L.push('')
  L.push('## 一、观众怎么参战')
  L.push('- 弹幕格式：**阵营 + 数量（可省）+ 兵种**。例：`红3狂暴者` / `蓝方5秃鹰` / `red2buzzard`。')
  L.push('- 阵营：红 / 蓝（英文 red / blue），**必填**；数量默认 1。')
  L.push('- 单条数量上限**按单价分档**：≤2万 → 最多 10 / ≤8万 → 最多 5 / >8万 → 最多 2。')
  const basic = (wl.summon && wl.summon.basicUnit) || 'EkBuzzard'
  L.push(`- **零门槛**：光发「红」或「蓝」（不带兵种）→ 出 1 个${wordOf(basic)}。`)
  const cd = wl.summon && wl.summon.cooldownMs
  L.push(`- 同一观众 **${cd ? Math.round(cd / 1000) : 3} 秒**冷却；每支队伍每轮观众兵总量上限 **${(wl.summon && wl.summon.teamCapPerRound) || 300}**。`)
  L.push('- 阵营写错 / 兵种词不在下列清单 / 纯聊天 → 整条**忽略**（不出兵、不扣钱）。')
  L.push('')
  L.push('## 二、能召唤哪些兵种（当前白名单）')
  L.push('> **只有下列的词能召唤**。旧词（战车 / 坦克 / tank / 猛犸…）**已不可用**，发了会被判「未识别」。')
  L.push('')
  for (const cat of ['land', 'air', 'building', 'sea']) {
    const list = (wl.categories && wl.categories[cat]) || []
    L.push(`**${CAT_LABEL[cat]}**`)
    if (!list.length) { L.push('- （本轮未开放）'); L.push(''); continue }
    for (const u of list) {
      const p = priceOf(u.type)
      const cap = capOf(p)
      const cost = p == null ? '免费（单价未收录）' : `单价 ${p}`
      const capTxt = cap == null ? '' : ` · 单条最多 ${cap}`
      const al = (u.aliases && u.aliases.length) ? `（也可写 ${u.aliases.join(' / ')}）` : ''
      const gift = u.giftOnly ? ' · **仅礼物触发**，弹幕发它无效' : ''
      L.push(`- \`${u.word}\`${al} · ${cost}${capTxt}${gift}`)
    }
    L.push('')
  }
  L.push('## 三、经济（弹幕真的花钱）')
  L.push('- 每次召唤从**你所支持阵营的观众钱包**里扣「单价 × 数量」。')
  L.push('- 钱不够 → **整条弹幕被拒绝**（不出兵、不扣钱），并播报「余额不足」。')
  L.push(`- 点赞 → 给你支持的阵营**加钱**（每次 +${cfg.likeCredits}）；关注 → 加更多（每次 +${cfg.followCredits}，每人每场只算一次）。`)
  L.push('- 游戏画面右上角实时显示红蓝两队「$ 余额 (+ 每秒收入)」。')
  L.push('')
  L.push('## 四、送礼物 → 给阵营加钱')
  L.push(`- 送礼物**按礼物价值给你支持的阵营加余额**：每 1 抖币 = ${giftTiers.CREDITS_PER_COIN / 10000}W 游戏币（B站按 1000 金瓜子 ≈ 10 抖币 折算）。`)
  L.push('- 加的钱进队伍钱包，可以再发弹幕换兵；钱不够时弹幕会被拒绝。')
  L.push('- **例外：「闪耀星辰」** 不换钱，它**直接召唤 1 个执行者**（Ek星舰，全图最强清场兵）到你支持的阵营。')
  L.push('')
  L.push('## 五、一局怎么走')
  L.push('- 自动开局 → 红蓝 AI 对战 → 一方基地被拆、或超时（默认 5 分钟）判胜负 → 自动开下一局。')
  L.push('- 结束播报：哪方获胜、第几轮、用时、双方兵力；贡献榜前三下一轮头顶带称号。')
  L.push('')
  L.push('## 六、别编造')
  L.push('- 具体数字（余额 / 兵力 / 轮次 / 在线人数）不知道就说不知道、或俏皮带过；消息里会给「当前战况」，只依据它说。')
  L.push('- 只讲玩法本身；程序内部的实现、后台配置之类的细节不要对观众讲。')
  L.push('')
  return L.join('\n')
}

function main () {
  const out = path.join(__dirname, '..', 'battle', 'waifu-knowledge.md')
  fs.writeFileSync(out, buildKnowledge(), 'utf8')
  process.stderr.write('wrote ' + out + '\n')
}
if (require.main === module) main()
module.exports = { buildKnowledge }
