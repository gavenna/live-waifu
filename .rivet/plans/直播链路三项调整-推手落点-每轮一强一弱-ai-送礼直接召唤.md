> **Model: deepseek-flash (cheap)**

**执行状态：** 已闭环。Task 1-3 均已完成；验证通过；交付门检查：GREEN。

> **Status: EXECUTED** — 2026-09-21T00:31:09.762Z
> （原 APPROVED 行由 `plan close` 追加 EXECUTED 时未清除，2026-09-22 手工去重 ——
>   两行并存会让"按首个 Status 扫描"的会话误判为'仍在执行中'。）

# 直播链路三项调整：推手落点 / 每轮一强一弱 AI / 送礼直接召唤

## 需求提炼

用户原话（本轮三个诉求）：
1. 「推手的设计……之前是担心指令会被 ai 抢回所以直接生成在交战区，现在不是解决了吗，所以**不要再直接生成在交战区了，其他不变**」
2. 「两边 AI 的难度不能每把都一样，**一定要有一个强一个弱**」
3. 「改成**送礼直接能召唤 10 个兵**，按照不同礼物价格召唤不同强度兵种，但……**最便宜的那几个礼物也要能召唤出强力兵种**，才能让观众觉得便宜礼物也值得」

目标：改掉 danmaku-relay 这三处行为，产出可离线回归 + 实机验证的证据。

非目标（明确排除）：
- **不改弹幕召唤的落点**（`FRONT_ZONE_MIN`，danmaku-relay/battle/liveSpawner.js:254/421）——本轮只动推手；弹幕那条是否也要跟着改，留给用户确认（见「开放问题」）。
- 不改推手的对称补兵 / 每边封顶 / 周期 / 兵种（"其他不变"）。
- 不改弹幕解析、经济扣款、播报链路。
- 不接真实抖音礼物（用 `simulate-danmaku` 与直调 `handleGift` 验证）。

## 现状与证据（file:line）

| 事实 | 证据 |
|---|---|
| 推手在跑 | danmaku-relay/battle/index.js:182 每轮 `spawner.startRoundPusher()`；relay-window.bat 设 `RW_PUSH_LEVEL=4`（interval 10s） |
| 推手落点在交战区 | danmaku-relay/battle/liveSpawner.js:337 `pushOnce()` → :345 `getRandomPosition(team,'front')` → :371 取 `FRONT_AREAS` |
| 引擎支持 per-team 难度 | war-vote/tools/_gfdec/gf_src/com/corrodinggames/rts/gameFramework/n/f.java:341-346：读 team_info `lockAiDifficulty` → 设该 AI 的 `.x`=难度、`.y`=锁定，并 log `Locking lockAiDifficulty:N by map request to:` |
| 运行时**无** per-team 难度 setter | war-vote/tools/decompiled/main_out/com/corrodinggames/librocket/scripts/Debug.java:532 只有全局 `setNetworkaiDifficulty(int)` |
| 礼物当前只加余额 | danmaku-relay/battle/index.js:477 `handleGift()` → `economy.credit(team, amount)`，`amount = coinValue × giftCreditsPerCoin` |
| 适配器已带 troopKey，但值是旧游戏兵名 | danmaku-relay/danmaku/douyin.js `_gift()` 的 `priceTiers` = `wrathOfGod/dragonKnight/...`（war-danmaku 的兵，非 RW 单位） |
| 地图每轮由中继复制进 assets | danmaku-relay/battle/index.js:269-285（`mods/maps/<file>` → `assets/maps/skirmish/<file>` ×2） |

## 架构 / 数据流

```mermaid
flowchart TD
  A[startNewRound] --> B[复制地图到 assets x2]
  B --> C{新增: 写本轮 per-team lockAiDifficulty}
  C --> D[loadMap / loadConfig x2]
  D --> E[FIGHTING]
  E --> F[推手 timer: 每边补 N 兵<br/>落点由 front 改为 <b>base</b>, 巡逻仍向敌基地]
  E --> G[弹幕 -> spawnUnit (front/base 不变)]
  E --> H[礼物 -> <b>直接召唤 10 兵</b>, 按价位定兵种]
```

## 三条改动设计

### A. 推手改为落自家基地（其余不变）
danmaku-relay/battle/liveSpawner.js:345 `getRandomPosition(team, 'front')` → `getRandomPosition(team, 'base')`；同步改 :293-307 的段落注释（说明"AI 抢回"已由 disabledAI 宿主队根治，故不再前压）。对称补兵 / 封顶 / 周期 / 巡逻目标全不动。落基地后由 `spawnPatrol` 的巡逻令把兵推向敌基地——**"推"靠行军，不靠出生点**。

### B. 每轮一强一弱（新增机制）
引擎只认地图里的 `lockAiDifficulty`，运行时改不了 ⇒ **中继在每轮复制完地图后，往 assets 副本的 team_1_info / team_2_info 写入本轮难度对**。

新增 danmaku-relay/battle/difficulty.js：
- `pickPair(rng)`：弱 ∈ {-2,-1,0}、强 ∈ {1,2,3} 各随机取一个；随机决定红/蓝谁拿强 → `{red, blue}`（保证 `red !== blue` 且强弱分明、每轮不同）。
- `patchMapText(text, {red, blue})`（纯函数，可测）：在 `team_1_info` / `team_2_info` 的 `<properties>` 里 upsert `<property name="lockAiDifficulty" value="N"/>`，返回新文本。
- `patchMapFile(path, pair)`：读→patch→写。

接线：danmaku-relay/battle/index.js:269-285 的复制循环之后，对每个 dst 副本调用 `patchMapFile(..., pair)` 并 `logger.info('[BATTLE] 本轮 AI 难度: 红=X 蓝=Y')`。开关 `RW_AI_DIFF_PAIR=0` 关闭（回退到"两边同难度"）。

### C. 送礼直接召唤 10 兵
- `handleGift`（danmaku-relay/battle/index.js:477）去掉 `economy.credit`，改为：按 `coinValue`（抖币当量）查档 → 拿兵种 → 直接召唤 **10** 个到该观众归属队（走与弹幕相同的 spawnPatrol 路径，落自家基地旁），**不扣该队余额**（礼物本身就是支付）。
- 档表（新增到 danmaku-relay/battle/giftTiers.js，纯数据 + 纯函数，可测）：**低档也必须强**，所以最低档直接给中重坦：
  | 抖币（coinValue） | 兵种 |
  |---|---|
  | ≥ 1000 | `megaTank` |
  | ≥ 300 | `mammothTank` |
  | ≥ 50 | `laserTank` |
  | ≥ 10 | `heavyTank` |
  | ≥ 0（最便宜） | `heavyTank`（与上一档同款：便宜不亏待） |

  即：最便宜档 = heavyTank（800 造价），已经是很硬的兵，兑现"便宜礼物也值得"。
- 复用：把 danmaku-relay/battle/liveSpawner.js 里 `spawnUnit` 的"造 N 兵 + 巡逻令"抽成一个 `spawnBatch({team, unitType, count})`（不改弹幕路径行为），礼物与推手都可调它。
- 币值来源沿用适配器已给的 `coinValue/coinUnit`（抖音 diamond；B站 gold → ÷100）。

## 反证 / 复现

- **A 的证伪**：改完后跑一局，日志/截图应看到推手补的兵**出现在自家基地附近**而非中线。反证 = 仍出现在 FRONT_AREAS。复现命令：起局 → 打完一次 `pushOnce` 周期 → 截图比对。
- **B 的证伪**：改完后 `<GAME>\lastrun.log` 必须出现**两条** `Locking lockAiDifficulty:1 by map request to: X` 与 `...:2 ... to: Y`，且 `X !== Y`；连续两局应看到不同的 (X,Y) 或红蓝互换。反证 = 两局完全一致，或没有这两条日志（说明 team_info 的属性没被引擎读到——那就退回"只能靠 aiTeams/全局难度"并如实上报）。
- **C 的证伪**：直调 `handleGift({type:'gift', coinValue:1, coinUnit:'diamond', playerId:'x'})`，日志必须出 `[GIFT] ... → 召唤 heavyTank x10`，且**不再**出现 `[ECON] ... 加余额`；反证 = 仍只加余额 / 兵种档位不对。
- **不取信声称**：每步以 exit code（`npm run verify`）+ 落盘文件（lastrun.log / 截图）为据，不看"应该生效"。

## 任务分解（每项 RED→GREEN；TDD）

1. **A 推手落点**：先改 danmaku-relay/tools/verify_automation.js 里对 `pushOnce` 的断言（RED：断言落点 ∈ SPAWN_AREAS）→ 改 liveSpawner.js:345 → GREEN。
2. **C 抽 spawnBatch**：先加 danmaku-relay/tools/verify_gift_summon.js（**新增**）断言 spawnBatch 发出的命令数/落点/兵种（RED）→ 抽函数 → GREEN。
3. **C 档表 + handleGift**：verify_gift_summon.js 断言 `pickGiftUnit(1)='heavyTank'`、`pickGiftUnit(2000)='megaTank'`、`handleGift` 出 10 兵且不加余额（RED）→ 实现 danmaku-relay/battle/giftTiers.js + 改 index.js:477 → GREEN。
4. **B difficulty.js**：先加 danmaku-relay/tools/verify_difficulty.js（**新增**）断言 `pickPair` 红蓝必不相等、`patchMapText` 幂等且给两个 team_info 都写上 `lockAiDifficulty`（RED）→ 实现 → GREEN。
5. **B 接线**：改 danmaku-relay/battle/index.js:269-285 复制后调用 patchMapFile + 日志；verify_difficulty.js 覆盖 patch 后文本（RED→GREEN）。
6. **全量门禁**：`cd danmaku-relay && npm run verify`（含 check + 各 verify_*.js），必须 exit 0。
7. **实机一轮**：重启中继起一局 → 查 lastrun.log 的 `Locking lockAiDifficulty` 两条（B）、截图看推手落点（A）、`simulate-danmaku` 一条礼物（C）。
8. **交付**：danmaku-relay 子仓库按文件限定提交（`git -C danmaku-relay add <具体文件>`，不用 `git add -A`）。

### Wave 1（A + C）：推手落点 + 送礼召唤
验证命令：`cd danmaku-relay && node tools/verify_automation.js && node tools/verify_gift_summon.js && npm run check`

### Wave 2（B）：每轮一强一弱
验证命令：`cd danmaku-relay && node tools/verify_difficulty.js && npm run verify`

### Wave 3（实机）
验证命令：起一局 → `grep "Locking lockAiDifficulty" <GAME>/lastrun.log`（应 2 条、值不同）+ 截图。

## 风险 / 待验证假设

- **假设 1（未验证）**：`lockAiDifficulty` 的取值刻度 = battleConfig 的 `aiDifficulty`（-2..3）。若引擎用别的刻度，需按实机 `lastrun.log` 的 `to: N` 回读校准。
- **假设 2（未验证）**：`lockAiDifficulty` 对 team 1/2 生效的前提是这两个 AI 玩家已创建（`numberOfAIs=7`）。若两遍 loadConfig 的第一遍就吃属性，需要确认第二遍不会再被全局 `aiDifficulty` 覆盖。
- **风险**：地图副本被每轮改写 ⇒ 必须**每轮都从 mods/maps 重新复制再改写**（当前 index.js 就是这么做的），不要让改写污染源图。
- **风险**：礼物固定 10 兵 × 便宜档 heavyTank 很硬，可能一局被礼物推平；若实测失衡，调 `GIFT_UNITS` 或档表（都是单点常量）。

## 开放问题（待用户拍板，不阻塞 Wave 1/2）

1. **弹幕召唤要不要也退出交战区？**（本轮只动推手。弹幕 ≥2 个仍落 FRONT_AREAS。）
2. **「10 个兵种」= 10 个兵** 我按此实现；若你指的是"10 种不同兵种"，档表结构要改。

## 7. Execution closure

已闭环：Task 1-3 均已完成并通过验证。

最终验证记录：

```bash
cd danmaku-relay && npm run verify
cd danmaku-relay && node tools/verify_gift_summon.js
cd danmaku-relay && node tools/verify_difficulty.js
grep -a lockAiDifficulty <GAME>/lastrun.log
```

交付门检查：GREEN。
