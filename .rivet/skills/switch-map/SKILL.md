---
name: switch-map
description: "换直播地图（Rusted Warfare 弹幕对战）——把主播在游戏编辑器里新摆的阵型图适配进 danmaku-relay 直播链路并验证。当用户说'换成这个地图''换图''新的阵型''摆好了，用这张''用 <某张图>' 时用。涵盖：源图定位、适配生成、独立复核、坐标系判据、实机验证、坑清单。"
triggers: ["换成(这个|这|那)?(地图|图)|换成这个地图", "换(个|张|一下)?(地图|图)", "新(的)?(阵型|地图|摆阵)", "摆好(了)?.*(图|阵)", "(用|以).*(地图|图).*(来|吧)", "switch.{0,10}map", "change.{0,10}map", "适配.{0,6}(地图|图)"]
---
# 换直播地图

主播会反复在游戏编辑器里重摆阵型、另存为新 `.tmx`，然后一句"换成这个地图"。
本 skill 是那条流水线的**唯一正确走法**——照做，不要临场发明。

## 0. 心智模型（三层，别搞混）

```
源图（主播摆的阵）               产物（适配后）              引擎实读
<GAME>\mods\maps\               <GAME>\mods\maps\          <GAME>\assets\maps\skirmish\
 "New ...Dire Straight...tmx" →  new_dire.tmx         →    new_dire.tmx
 (team0=蓝 / team1=红)           (team2=蓝 / team1=红)       (中继每轮开局前从产物复制过去)
```

- `<GAME>` = `D:\game\ tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15`
- **产物名固定 `new_dire.tmx` 不变** ⇒ 换源只改工具的 SRC；中继 `MAP_FILE_DEFAULT`
  （`danmaku-relay\battle\index.js`）与坐标常量都不用动。
- 手改 `<GAME>\assets\` 里那份是白改——中继每轮开局覆盖它。
- 中继**每轮**从 `mods\maps` 重新拷贝 ⇒ 换完**下一轮自动生效**，不一定要重启中继。

## 1. 不可协商的硬事实（反编译 + 实机双证，违反必出故障）

| 约束 | 为什么 | 证据 |
|---|---|---|
| 源图单位存在 `<objectgroup name="UnitObjects">` 的 `<object>` 里，带**内联** `unit`+`team` 属性 | 引擎按内联属性造兵，`gid` 只用于解析 tileset（不影响队伍） | `game\b\a.java:104-127` + `game\b\i.java:58` |
| 直播要 **team1=红 / team2=蓝 / team0 空** | team0 是本地人类槽：没 AI、不会自己打；不给它基地才有全图观战视角 | `battle\liveSpawner.js:420` 注释；地图指南 §6.1 |
| Triggers 必须含 `map_info`：`type=skirmish` + `winCondition=commandCenter` + `fog=map` | 缺 winCondition ⇒ 引擎回落到"以 team0 判定" ⇒ 一进游戏弹 Defeat | 地图指南 §4.2 |
| Triggers 必须含 **`team_0_info`（`allyGroup=1`+`disabledAI=1`）** | 判负逻辑查"本地队的**同盟组**里还有没有指挥中心"，team0 自己没基地；中继的 `setTeamAllyGroup(0,1)` 要起局后 ~10s 才发，晚于引擎首次判定 ⇒ **秒判负** | `gameFramework\n\f.java:918-967`；实测不加时 `Game Time 00:00` 判负，加上后 `end_live.txt` `defeat 0` |
| Triggers 必须含 `team_3_info`/`team_4_info`（`allyGroup` 红1/蓝2 + `disabledAI=1`） | 观众召唤兵的**无 AI 宿主队**；落在有 AI 的队会被本队 AI 把巡逻令抢回去 | `f.java:349-353`；`battle\teams.js:29-35` |
| 队号 1/2/3/4 **与地图绑定** | 换队号要同步改 `battle\teams.js` 与 `gameController.js` 的 `ALLY_GROUP` | `teams.js:33` |

> `danmaku-relay\tools\map_adapt_newdire.py` 已把上述全部做成 `TRIGGERS` 模板。
> **别手搓 Triggers**，改模板即可（要加 `camera_start`/`introText` 之类也在这里加）。

## 2. 步骤

设 `GAME` 与两个路径变量，后面直接用（Git Bash）：

```bash
GAME="D:/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/Rusted Warfare1.15"
TOOL="danmaku-relay/tools/map_adapt_newdire.py"
VERIFY=".rivet/skills/switch-map/scripts/verify_adapted_map.py"
SRC="$GAME/mods/maps/<新的那张 New ... .tmx>"
DST="$GAME/mods/maps/new_dire.tmx"
```

### S1 找源图 + 核对结构（只读，先做）

```bash
ls -la "$GAME/mods/maps/" | grep -iE "dire|straight"      # 找最新的 "New ..." 那张（可按时间）
export PYTHONIOENCODING=utf-8
python "$TOOL" dump                                        # 看**当前产物**构成（改前基线）
```

核对新源图五件事（任一条不符 → **停下来找用户确认**，别硬adapt）：
1. 有 `<objectgroup name="UnitObjects">`（不是在 `Units` **瓦片层**——那套是另一种格式，本工具不处理）
2. 有 `<objectgroup name="Triggers">` 且当前只有 `map_info`
3. `UnitObjects` 里**只有 team 0 和 team 1**
4. 有 `Ground` / `Items` / `set` 三层（引擎强制要求 `Ground` 与 `Items`）
5. 基地 `commandCenter` 的 (x,y) 与上一张大致相同（差得多 ⇒ 见 §3 坐标系）

### S2 改工具的 SRC

`map_adapt_newdire.py` 顶部：
```python
SRC = os.environ.get("RW_NEWDIRE_SRC", os.path.join(GAME, "mods", "maps", "<新源图文件名>"))
```
（或临时用 `RW_NEWDIRE_SRC=<路径> python map_adapt_newdire.py apply`，不改文件）

### S3 生成产物

```bash
cd danmaku-relay/tools && python map_adapt_newdire.py selftest   # 守卫还在不在（不必需，但便宜）
python map_adapt_newdire.py apply                                # 写 $DST，末尾自跑 check
```
期望末行 `RESULT: PASS`，并打印 `队伍构成 {'1': <红>, '2': <蓝>}`（team0=0）。

### S4 独立复核（**别信工具自己的 PASS**）

工具的自检与它的改写逻辑同源，会一起犯同一个错。**必须**再跑一遍独立实现：

```bash
python "$VERIFY" "$SRC" "$DST"; echo "exit=$?"     # 期望 9 条全 OK、RESULT: PASS、exit 0
python -c "import gzip,base64,re,hashlib,sys; \
 t=open(sys.argv[1],encoding='utf-8').read(); \
 m=re.search(r'(<layer\b[^>]*\bname=\"Ground\"[^>]*>\s*<data[^>]*?>)(.*?)(</data>)',t,re.S); \
 print(hashlib.md5(gzip.decompress(base64.b64decode(re.sub(r'\s+','',m.group(2))))).hexdigest())" "$SRC"
```
再对**上一张源图**跑同一条命令比 md5：**相同 ⇒ 地形没动，坐标不用改**；不同 ⇒ 进 §3。

### S5 实机（要开服务，先经用户同意）

```bash
# 起中继（会拉起游戏、占 8766/8767/9999、开窗口 —— 项目红线要求先征得同意）
cd danmaku-relay && RW_ECON_ENABLED=1 RW_PUSH_LEVEL=4 node index.js --auto-start &
# 起局后核三条：
grep -a "Mapfile" "$GAME/lastrun.log" | tail -3      # 应出现 .../skirmish/new_dire.tmx
grep -aE "Could not find unit|spectator" "$GAME/lastrun.log"   # 应为空
cat "$GAME/end_live.txt"                              # 应 defeat 0 / first_seen 0 none（无秒判负）
```
再用截图脚本看一眼（后台抓帧、不切窗口）：
`python <skill 根>/live-waifu-ops/scripts/capture_game_frame.py <tag>`——应看到两支军队在场上、**无 Defeat 面板**。

## 3. 坐标系：什么时候必须改中继常量

三组常量都在 `danmaku-relay\battle\liveSpawner.js`：
`SPAWN_AREAS`(:234) / `FRONT_AREAS`(:249) / `PATROL_TARGETS`(:277)（另 `FRONT_ZONE_MIN` :254）。

- **地形 md5 相同** ⇒ 原样可用。Dire Straight 这一系（live_dire / New Dire Straight / New New…）
  全是同一套 `Ground`，所以历代换图都没动过坐标。
- **地形不同** ⇒ 必须重取点，用现成工具：
  ```bash
  python _archive/ccresearch-game/terrain_at.py "$DST" <x,y> <x,y> ...   # 严格规则：点 + 5×5 邻域无水域
  ```
  然后改那三组常量。**改完把 `battle/teams.js` 的宿主队号与 `gameController.js` 的
  `ALLY_GROUP` 一起核对**（队号与地图绑定）。

## 4. 坑（踩过的，别再踩）

1. **别用死基线卡源图**。工具早期把源队伍条数写死 `{0:91,1:88}`，主播每存一次新图就得改工具。
   现在只卡**结构不变量**（队伍集合恰为 `{0,1}`、都非空）。改守卫后跑 `python map_adapt_newdire.py selftest`。
2. **秒判负 = 缺 `team_0_info`**，不是"Units 层缺 team2 基地"（HANDOFF 里那条猜测是错的）。
3. **`Mapfile:` 行才是引擎真读了哪张图**。`battle/mapPool.js` 的日志（"经典战场/森林遭遇"）是遗留代码，
   与实际加载无关，**别信它排障**。
4. **文件名不要带 `[pN]` 前缀**（会把队伍上限压到 1 支 AI）。`(2p)` 在中间无妨。
5. **一次改不动就查 `lastrun.log`**：`Disabling AI:3/4 by map request` 说明 Triggers 被读到了；
   没有它 ⇒ Triggers 没生效，回头查 S2/S3。
6. **`.rivet/skills/` 不受版本管理**（在 `.git/info/exclude` 里）。改这个 skill 后想留痕，得自己另存一份。

## 5. 验收清单（缺一不算完成）

- [ ] `map_adapt_newdire.py apply` → `RESULT: PASS`
- [ ] `verify_adapted_map.py <源> <产物>` → 9 条全 OK、`exit=0`（**独立复核，不可省**）
- [ ] `Ground/Items/set` 与源逐字节一致（脚本第 1 条已覆盖）
- [ ] 若地形变了：三组坐标已重验/重取
- [ ] 实机：`Mapfile` = `skirmish/new_dire.tmx`、无 `Could not find unit`、`end_live.txt defeat 0`、截图无 Defeat 面板
- [ ] 提交：`git -C danmaku-relay add tools/map_adapt_newdire.py battle/index.js`（**按文件限定**，别 `git add -A`）
