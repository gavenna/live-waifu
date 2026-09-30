'use strict'
/**
 * battle/giftTiers.js — 礼物 → 阵营余额 / 专属召唤（纯数据 + 纯函数，可离线回归）
 *
 * 2026-10 行为变更（主播规则）：礼物**不再按价位分档召唤兵**，改为——
 *   ① 默认：按礼物价值给该观众**归属阵营**的观众钱包**加余额**（1 抖币 = 50W 游戏币）。
 *      「小心心」是这条规则的自然结果：1 抖币 → +50W；连刷 10 颗 = 10 抖币 → +500W。
 *   ② 例外：**「闪耀星辰」** 直接召唤 1 个执行者（Ek星舰，清图王牌）——
 *      这是目前**唯一**"礼物召唤兵种"的礼物。
 *
 * 币值口径沿用适配器已给的 coinValue/coinUnit：抖音按「抖币」(diamond)，B站按「金瓜子」(gold)。
 *   1000 金瓜子 = 1 元 = 10 抖币 ⇒ gold 除以 100。
 */

/** 1 抖币当量 → 多少游戏币余额。想调"礼物的分量"改这里（单点常量）。 */
const CREDITS_PER_COIN = 500000

/** 按礼物名匹配的**专属召唤**（目前只有闪耀星辰）。name=礼物名包含的关键字，unit=引擎类型名。 */
const GIFT_NAME_UNITS = [
  { name: '闪耀星辰', unit: 'Ek星舰', count: 1 }
]

/** 礼物消息 → 抖币当量（抖音=diamond 原值；B站=gold ÷ 100）。非法/非正一律 0。 */
function coinsOf (msg) {
  const raw = Number(msg && msg.coinValue)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return msg.coinUnit === 'gold' ? raw / 100 : raw
}

/** 抖币当量 → 该给阵营加的余额（取整，非正一律 0）。 */
function creditsFor (coins) {
  const v = Number(coins)
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.round(v * CREDITS_PER_COIN)
}

/** 礼物名 → 专属召唤 {unit, count}；无专属召唤返回 null。 */
function unitOfGiftName (name) {
  const s = String(name == null ? '' : name)
  if (!s) return null
  for (const g of GIFT_NAME_UNITS) if (s.includes(g.name)) return { unit: g.unit, count: g.count }
  return null
}

/** 单次礼物事件的**礼物个数**（连刷数）。缺 count 字段时回退 1（旧调用方兼容）。 */
function giftCountOf (msg) {
  const n = Math.round(Number(msg && msg.count))
  return Number.isFinite(n) && n > 0 ? n : 1
}

module.exports = { CREDITS_PER_COIN, GIFT_NAME_UNITS, coinsOf, creditsFor, unitOfGiftName, giftCountOf }
