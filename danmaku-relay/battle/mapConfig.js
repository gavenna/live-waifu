'use strict'
/**
 * battle/mapConfig.js — 读取「地图契约」battle/map-config.json（由 tools/gen_map_contract.js 生成）。
 *
 * 为什么有它：把与地图几何绑定的量（指挥中心 / 巡逻目标 / 观众基准 / 镜头 / 队号 / 水域）
 * 从代码里抽出来，集中到生成物。换图 = 换地图文件 + 重跑 gen_map_contract，代码不动。
 *
 * 缺文件或结构不全时导出 null，调用方回退到各自写死的兜底常量（保证旧图仍可切回）。
 */
let cfg = null
try {
  const raw = require('./map-config.json')
  if (raw && raw.commandCenters && raw.commandCenters.red && raw.commandCenters.blue) cfg = raw
} catch (e) { cfg = null }
module.exports = cfg
