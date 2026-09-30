#!/usr/bin/env node
/**
 * verify_map_contract.js — 验证「地图契约」与中继消费一致（换图通用化的回归门）。
 *
 * 跑法：node tools/verify_map_contract.js ；exit 0 = 全过，非 0 = 有 FAIL。
 * 覆盖：
 *   1-4  map-config.json 存在且结构完整（CC / 观众基准 / 镜头）。
 *   5-6  liveSpawner 的 SPAWN_AREAS 中心 == 契约 CC（证明确实读了契约，而非回退写死值）。
 *   7-8  PATROL_TARGETS 指向**敌方 CC**（消除旧图"出生点用新图、巡逻目标用旧图"的错位）。
 *   9    契约内部一致：patrolTargets = 对面 CC。
 */
'use strict'
const mapConfig = require('../battle/mapConfig')
const spawner = require('../battle/liveSpawner')

const RED = 1
const BLUE = 2

let fails = 0
function chk (name, ok, detail) {
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (detail ? '  -- ' + detail : ''))
  if (!ok) fails++
}

chk('1) map-config.json 存在', !!mapConfig, mapConfig ? '' : '缺文件（中继会回退写死常量）')
if (!mapConfig) { console.log('RESULT: FAIL'); process.exit(1) }
chk('2) commandCenters red/blue 齐全', !!(mapConfig.commandCenters.red && mapConfig.commandCenters.blue))
chk('3) viewerAnchors red/blue 齐全',
  !!(mapConfig.viewerAnchors && mapConfig.viewerAnchors.red && mapConfig.viewerAnchors.blue))
chk('4) camera 数值合法',
  !!mapConfig.camera && [mapConfig.camera.x, mapConfig.camera.y, mapConfig.camera.zoom].every(Number.isFinite))

function center (team) {
  const a = spawner.SPAWN_AREAS[team]
  return { x: Math.round((a.xMin + a.xMax) / 2), y: Math.round((a.yMin + a.yMax) / 2) }
}
const ccRed = center(RED)
const ccBlue = center(BLUE)
const mRed = mapConfig.commandCenters.red
const mBlue = mapConfig.commandCenters.blue
chk('5) SPAWN_AREAS 中心 == 契约 CC(红) — 证明中继确实读了契约',
  ccRed.x === mRed.x && ccRed.y === mRed.y, JSON.stringify(ccRed))
chk('6) SPAWN_AREAS 中心 == 契约 CC(蓝)',
  ccBlue.x === mBlue.x && ccBlue.y === mBlue.y, JSON.stringify(ccBlue))

chk('7) PATROL_TARGETS 红方 → 蓝方 CC',
  spawner.PATROL_TARGETS[RED].x === mBlue.x && spawner.PATROL_TARGETS[RED].y === mBlue.y,
  JSON.stringify(spawner.PATROL_TARGETS[RED]))
chk('8) PATROL_TARGETS 蓝方 → 红方 CC',
  spawner.PATROL_TARGETS[BLUE].x === mRed.x && spawner.PATROL_TARGETS[BLUE].y === mRed.y,
  JSON.stringify(spawner.PATROL_TARGETS[BLUE]))

chk('9) 契约 patrolTargets = 对面 CC',
  mapConfig.patrolTargets.red.x === mBlue.x && mapConfig.patrolTargets.red.y === mBlue.y &&
  mapConfig.patrolTargets.blue.x === mRed.x && mapConfig.patrolTargets.blue.y === mRed.y)

console.log('RESULT: ' + (fails ? 'FAIL' : 'PASS'))
process.exit(fails ? 1 : 0)
