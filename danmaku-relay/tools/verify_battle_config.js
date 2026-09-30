'use strict'
/**
 * verify_battle_config.js — 离线回归：开局配置模块（battle/battleConfig.js）
 *
 * 跑法：  node tools/verify_battle_config.js
 * 零副作用：全在临时文件上跑，不连游戏、不碰中继、不改真实 data/battle-config.json。
 * 退出码 0 = 全过。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

let pass = 0
let fail = 0
const lines = []
function check (name, ok, detail) {
  if (ok) { pass++; lines.push(`[PASS] ${name}${detail ? '  -- ' + detail : ''}`) } else { fail++; lines.push(`[FAIL] ${name}${detail ? '  -- ' + detail : ''}`) }
}

// 落盘位置指到临时目录（模块加载时读 env，所以必须在 require 之前设好）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-verify-'))
process.env.RW_BATTLE_CONFIG_FILE = path.join(tmpDir, 'battle-config.json')
delete require.cache[require.resolve('../battle/battleConfig.js')]
const cfg = require('../battle/battleConfig')

// ---------- A. 默认值与 limits ----------
cfg.loadDefaults()
check('A1 默认 numberOfAIs=7', cfg.defaults.numberOfAIs === 7, JSON.stringify(cfg.defaults))
check('A2 默认 aiDifficulty=0', cfg.defaults.aiDifficulty === 0)
check('A3 默认 aiTeams=5(Free for all)', cfg.defaults.aiTeams === 5)
check('A4 默认 fogMode=2', cfg.defaults.fogMode === 2)
check('A5 默认 startingCredits=0(=不改，用地图默认)', cfg.defaults.startingCredits === 0)
check('A6 numberOfAIs 下限硬约束=4', cfg.LIMITS.numberOfAIs.min === 4)
check('A7 默认 roundMaxMs=0(=未设置，回落 RW_ROUND_MAX_MS/5 分钟)', cfg.defaults.roundMaxMs === 0, String(cfg.defaults.roundMaxMs))

// ---------- B. 越界与非法值夹紧 ----------
check('B1 numberOfAIs=3 夹到 4', cfg.setConfig({ numberOfAIs: 3 }, 'next').next.numberOfAIs === 4)
check('B2 numberOfAIs=99 夹到 7', cfg.setConfig({ numberOfAIs: 99 }, 'next').next.numberOfAIs === 7)
check('B3 numberOfAIs="abc" 回默认 7', cfg.setConfig({ numberOfAIs: 'abc' }, 'next').next.numberOfAIs === 7)
check('B4 aiDifficulty=-5 夹到 -2', cfg.setConfig({ aiDifficulty: -5 }, 'next').next.aiDifficulty === -2)
check('B5 aiDifficulty=9 夹到 3', cfg.setConfig({ aiDifficulty: 9 }, 'next').next.aiDifficulty === 3)
check('B6 fogMode=-1 夹到 0', cfg.setConfig({ fogMode: -1 }, 'next').next.fogMode === 0)
check('B7 fogMode=9 夹到 2', cfg.setConfig({ fogMode: 9 }, 'next').next.fogMode === 2)
check('B8 startingCredits 负数夹到 0', cfg.setConfig({ startingCredits: -100 }, 'next').next.startingCredits === 0)

// ---------- C. scope 语义（next 只影响一轮） ----------
cfg.clearNext()
const baseAIs = cfg.defaults.numberOfAIs
cfg.setConfig({ numberOfAIs: 5 }, 'next')
check('C1 next 生效', cfg.effective().numberOfAIs === 5)
check('C2 next 不动 defaults', cfg.defaults.numberOfAIs === baseAIs, 'defaults=' + cfg.defaults.numberOfAIs)
cfg.setConfig({ aiDifficulty: 2 }, 'next')
check('C3 next 可叠加', cfg.effective().numberOfAIs === 5 && cfg.effective().aiDifficulty === 2)
cfg.clearNext()
check('C4 clearNext 后回落默认', cfg.effective().numberOfAIs === baseAIs && cfg.next === null)

// ---------- D. 落盘与重启读回 ----------
cfg.setConfig({ numberOfAIs: 6, fogMode: 1 }, 'default')
check('D1 defaults 已更新', cfg.defaults.numberOfAIs === 6 && cfg.defaults.fogMode === 1)
check('D2 配置文件已写出', fs.existsSync(process.env.RW_BATTLE_CONFIG_FILE))
delete require.cache[require.resolve('../battle/battleConfig.js')]
const cfg2 = require('../battle/battleConfig')
cfg2.loadDefaults()
check('D3 重启后读回同值', cfg2.defaults.numberOfAIs === 6 && cfg2.defaults.fogMode === 1, JSON.stringify(cfg2.defaults))

// ---------- G. 单局时长上限（roundMaxMs）—— 控制面板可调 ----------
//   语义：0 = 未设置 ⇒ 回落 RW_ROUND_MAX_MS ⇒ 再回落 5 分钟内置兜底。
//   存的是毫秒（与 RW_ROUND_MAX_MS 同口径；面板用「分钟」输入，提交时 ×60000）。
{
  // ⚠️ 必须取**当前缓存实例**：D 段重新 require 过 battleConfig，模块缓存里已换成新实例，
  //    而 roundManager 内部 require 的是缓存里那个 —— 用上面那个旧 `cfg` 会各写各的、断言假红。
  const c = require('../battle/battleConfig')
  const { RoundManager } = require('../battle/roundManager.js')
  const MIN = 60 * 1000

  c.clearNext()
  delete process.env.RW_ROUND_MAX_MS
  c.setConfig({ roundMaxMs: 0 }, 'default')
  check('G0 limits 有 roundMaxMs（上限 6 小时）',
    !!c.LIMITS.roundMaxMs && c.LIMITS.roundMaxMs.max === 6 * 60 * MIN, JSON.stringify(c.LIMITS.roundMaxMs || null))

  check('G1 未设置(0) → 5 分钟兜底', new RoundManager().maxDurationMs === 5 * MIN,
    String(new RoundManager().maxDurationMs))

  process.env.RW_ROUND_MAX_MS = '180000'
  check('G2 未设置时 RW_ROUND_MAX_MS 生效（headless 用法不退化）',
    new RoundManager().maxDurationMs === 180000, String(new RoundManager().maxDurationMs))

  c.setConfig({ roundMaxMs: 90 * 1000 }, 'default')
  check('G3 面板值优先于 env', new RoundManager().maxDurationMs === 90 * 1000,
    String(new RoundManager().maxDurationMs))
  delete process.env.RW_ROUND_MAX_MS

  check('G4 roundMaxMs 超上限夹到 6 小时',
    c.setConfig({ roundMaxMs: 99999999999 }, 'next').next.roundMaxMs === 6 * 60 * MIN)
  c.clearNext()

  // 每轮开局重新解析（面板改了下一轮就生效，不是构造时定死）
  c.setConfig({ roundMaxMs: 120 * 1000 }, 'default')
  const rm = new RoundManager()
  c.setConfig({ roundMaxMs: 180 * 1000 }, 'default')
  rm.startRound({ name: 'g-test' })
  check('G5 startRound 重新解析（构造后改配置，下一轮即生效）', rm.maxDurationMs === 180 * 1000,
    String(rm.maxDurationMs))
  rm.endRound('test')
  c.setConfig({ roundMaxMs: 0 }, 'default')
}

// ---------- E. 坏文件不炸 ----------
fs.writeFileSync(process.env.RW_BATTLE_CONFIG_FILE, '{ this is not json', 'utf8')
delete require.cache[require.resolve('../battle/battleConfig.js')]
const cfg3 = require('../battle/battleConfig')
let threw = false
try { cfg3.loadDefaults() } catch (e) { threw = true }
check('E1 坏 JSON 不抛异常', !threw)
check('E2 坏 JSON 回落内置默认', cfg3.defaults.numberOfAIs === 7, JSON.stringify(cfg3.defaults))

// ---------- F. 起局接线：观众钱包余额设到 team3/4（源码级） ----------
const gcSrc = fs.readFileSync(require.resolve('../battle/gameController.js'), 'utf8')
check('F1 gameController 读 viewerStartingCredits', /viewerStartingCredits/.test(gcSrc))
check('F2 起局把余额设到 RED_VIEWER_TEAM / BLUE_VIEWER_TEAM',
  /setTeamCredits\(\$\{RED_VIEWER_TEAM\}/.test(gcSrc) && /setTeamCredits\(\$\{BLUE_VIEWER_TEAM\}/.test(gcSrc))
const bhtml = fs.readFileSync(__dirname + '/../toolbox/battle.html', 'utf8')
check('F3 面板有 cfgViewerCredits 输入框', /id="cfgViewerCredits"/.test(bhtml))
check('F4 面板 saveCfg 提交 viewerStartingCredits', /viewerStartingCredits:\s*Number\(document\.getElementById\('cfgViewerCredits'\)/.test(bhtml))
check('F5 面板有 cfgCrown（皇冠上移）输入框', /id="cfgCrown"/.test(bhtml))
check('F6 面板 saveCfg 提交 crownOffset', /crownOffset:\s*Number\(document\.getElementById\('cfgCrown'\)/.test(bhtml))
check('F7 battleConfig 有 crownOffset（默认 30）', (() => { try { return require('../battle/battleConfig').LIMITS.crownOffset.def === 30 } catch (e) { return false } })())
check('F8 battle/index.js 用 crownOffset 定位皇冠', /crownOffset/.test(fs.readFileSync(require.resolve('../battle/index.js'), 'utf8')))
check('F9 面板有 cfgFollowWin（关注间隔）输入框', /id="cfgFollowWin"/.test(bhtml))
check('F10 面板 saveCfg 提交 followWindowMin', /followWindowMin:\s*Number\(document\.getElementById\('cfgFollowWin'\)/.test(bhtml))
check('F11 battleConfig 有 followWindowMin（默认 60 分钟）', (() => { try { return require('../battle/battleConfig').LIMITS.followWindowMin.def === 60 } catch (e) { return false } })())
check('F12 关注判据用时间窗 followAllowed', /followAllowed/.test(fs.readFileSync(require.resolve('../battle/index.js'), 'utf8')))
{
  const bi = fs.readFileSync(require.resolve('../battle/index.js'), 'utf8')
  const dj = fs.readFileSync(require.resolve('../danmaku/douyin.js'), 'utf8')
  check('F13 关注播报带 source=follow 标记（供去重识别）', /source: 'follow'/.test(dj))
  check('F14 handleDanmaku 对窗口内重复关注直接静默', /followOnCooldown\(playerIdOf\(msg\)\)\)\s*return null/.test(bi))
}

console.log(lines.join('\n'))
console.log(`\n${pass} PASS / ${fail} FAIL`)
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { /* ignore */ }
process.exit(fail === 0 ? 0 : 1)
