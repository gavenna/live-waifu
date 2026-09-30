'use strict'
/**
 * verify_like_chat_once.js — 离线回归：点赞**播报**去重（一个观众一局只让桌宠念一次）
 *
 * 背景（2026-09-27 用户实测）：观众连赞时，每次点赞都会产出弹幕 "赞" → handleDanmaku 非指令分支
 *   → maybeChat → 桌宠 TTS 念一遍「感谢点赞」⇒ 每 1s 刷一次。改为每观众每局只念一次。
 *   只抑制**播报**；加余额（handleCredits）仍每次照算。
 *
 * 跑法：  node tools/verify_like_chat_once.js
 * 零副作用：waifu 关闭、只测纯函数与适配器标记。退出码 0 = 全过。
 */
process.env.RW_WAIFU_ENABLED = '0'

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

for (const m of ['../battle/index.js']) {
  try { delete require.cache[require.resolve(m)] } catch (e) { /* ignore */ }
}
const battle = require('../battle')

// ---------- A. 一局内同观众只放行一次 ----------
battle.resetLikeChat()
check('A1 首次点赞 → 允许播报', battle.likeChatAllowed('v1') === true)
check('A2 同观众第二次 → 拒绝（一局只念一次）', battle.likeChatAllowed('v1') === false)
check('A3 同观众第三次仍拒绝', battle.likeChatAllowed('v1') === false)
check('A4 不同观众 → 独立放行', battle.likeChatAllowed('v2') === true)
check('A5 pid 为空 → 放行（不记账、不崩）', battle.likeChatAllowed(null) === true)

// ---------- B. 一局重置后同观众可再念一次 ----------
battle.resetLikeChat()
check('B1 resetLikeChat 后同观众再允许（新一局）', battle.likeChatAllowed('v1') === true)
check('B2 _likeChatPids 记录到位', battle._likeChatPids.has('v1'))

// ---------- C. 适配器给点赞弹幕打了 source=like（供去重识别） ----------
const { EventTranslator } = require('../danmaku/douyin')
const tr = new EventTranslator()
const m1 = tr._like({ count: 1 }, 'u-like-a', '甲')
check('C1 点赞产出 danmaku 带 source=like', m1.some((x) => x.type === 'danmaku' && x.source === 'like'), JSON.stringify(m1))
check('C2 点赞仍产出 credits(source=like)（加钱不受影响）', m1.some((x) => x.type === 'credits' && x.source === 'like'))
const tr2 = new EventTranslator()
const m100 = tr2._like({ count: 100 }, 'u-like-b', '乙')
check('C3 百赞弹幕也带 source=like', m100.some((x) => x.type === 'danmaku' && x.source === 'like' && (x.displayText || '').includes('100')) , JSON.stringify(m100))

lines.forEach((l) => console.log(l))
console.log(`\n${pass} PASS / ${fail} FAIL   (offline)`)
process.exit(fail ? 1 : 0)
