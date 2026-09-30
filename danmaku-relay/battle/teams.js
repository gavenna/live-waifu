/**
 * battle/teams.js — 红 / 蓝双方使用的 game team(槽位) 编号
 *
 * ★★★ 2026-09-18 实机定案：红 = team 1，蓝 = **team 2**（原来是 team 0）
 *
 * 为什么不再用 team 0：
 *   1. team 0 是**引擎无条件创建、且没人操控的本地人类玩家**
 *      （`appFramework\i.java:102`、`game\i.java:547` 全树只有这两处 `new e(0)`，都硬编码 0）。
 *      把它当一方 ⇒ 胜负判定（`gameFramework\n\f.java:903-957` 以本地玩家为参照系）
 *      会在"我"被打光时弹 Defeat 并停摆 —— 这正是用户报的"局被一个没人操控的我结束"。
 *   2. 实机（2026-09-18 23:32）还发现：只要队 0 在名单里，`applyHostility()`
 *      就会把 `setTeamAllyGroup(0, 0)` 发出去，**覆盖掉我们刚设好的观察者标记 -3**。
 *      队 0 不参与 ⇒ 这条命令自然消失。
 *   3. 让**两个真正的 AI 队**（都有基地、都会主动进攻）对战，观众空投的兵才有 AI 接管。
 *
 * ⚠️ 为什么蓝是 2 而不是别的：引擎建 AI 的顺序是
 *   **先填奇数槽 1,3,5,7，再填偶数槽 2,4,6**（`appFramework\i.java:104-133` 两轮循环）
 *   ⇒ 想让 team 2 存在，`numberOfAIs` 至少要是 4（用 7 时 1..7 全在）。
 *   地图侧必须**给 team 1 与 team 2 各一套基地**（`build_stream_map.py` 就是干这个的）。
 *
 * 观察者（可选加固）：开局 5s 后发 `script debug.setTeamAllyGroup(0, -3)`
 *   （`Debug.java:287-295` 直接写 `n.r`，无校验；`n.java:381` `b()` 即 `r == -3`）
 *   —— 注意**必须等 `applyHostility` 跑完**（`AUTO_BATTLE_START_DELAY_MS = 5000`）再发，否则被覆盖。
 */
const RED_TEAM = 1
const BLUE_TEAM = 2

/**
 * 阵营主队 → 该阵营的**观众钱包队**（观众独立钱包）。
 *   红主队(1) → 红观众宿主(3)；蓝主队(2) → 蓝观众宿主(4)；其它队原样返回。
 * 用途：分账模式下，观众召唤扣款 / 互动充值都落在这个队，
 *   与 AI 主队（team1/2，AI 自己也在花）隔离 —— 观众的钱 AI 碰不到。
 * 纯函数，供经济层（liveSpawner）与奖励层（battle/index）共用。
 */
function viewerTeamOf (team) {
  if (team === RED_TEAM) return RED_VIEWER_TEAM
  if (team === BLUE_TEAM) return BLUE_VIEWER_TEAM
  return team
}

// ★ 2026-09-19：观众召唤兵的**无 AI 宿主席位**（见下面说明）。
//   地图 live_dire.tmx 的 team_3_info/team_4_info 定义了它们的 allyGroup（红1/蓝2）+ disabledAI。
//   为什么需要：观众兵若落在有 AI 的 RED_TEAM/BLUE_TEAM 上，本队 AI 每 tick 会重新指派自己队的
//   单位、覆盖脚本下的巡逻令 av.j ⇒ 兵"走到一半被叫回家"。改落在 disabledAI 的队上，AI 不指挥它，
//   兵只认脚本命令。队号 3/4 由 numberOfAIs=7 保证被引擎创建（先奇后偶，team3 必在）。
//   ⚠️ 这两个队号**与地图绑定**：换号必须同步改 live_dire.tmx 的 team_3_info/team_4_info。
const RED_VIEWER_TEAM = 3    // 红方观众兵宿主（同盟组=红）
const BLUE_VIEWER_TEAM = 4   // 蓝方观众兵宿主（同盟组=蓝）

module.exports = { RED_TEAM, BLUE_TEAM, RED_VIEWER_TEAM, BLUE_VIEWER_TEAM, viewerTeamOf }
