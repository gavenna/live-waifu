# 直播图 new_dire 玩法说明

> 本文描述**当前正在直播用的那张图**——`new_dire.tmx` 的构成与玩法。
> 所有数字都是 2026-09-23 改造后实测（`danmaku-relay\tools\verify_units_et.py` 跑产物得出），不是估算。
> 观众侧怎么发弹幕、什么兵多少钱，看 `直播指令手册.md` 与 `兵种与收益一览.md`；本文只管**地图里有什么**。

---

## 一、地图长什么样

110×110 格（每格 20px，即 2200×2200 像素）。**中间是一大片水域**，把战场切成两个对角：

| | 位置 | 指挥中心 |
|---|---|---|
| **红方**（team 1） | 左上 | (455, 355) |
| **蓝方**（team 2） | 右下 | (1775, 1695) |

两岸隔水相望，海军有真实用武之地（不是摆设）。红蓝各自的陆军/空军/海军与防御都堆在自家这块陆地上。

> team 0 是本地人类槽，**故意不放任何单位**——这样镜头才是全图观战视角。地图 Triggers 里靠
> `team_0_info`（`allyGroup=1` + `disabledAI=1`）防止引擎把"team0 没基地"判成秒判负。

---

## 二、三层的图，改哪一层

```
源图（主播摆的阵）                      产物（适配后）                  引擎实读
mods\maps\                              mods\maps\                     assets\maps\skirmish\
"New New Dire Straight (2p)…22 九月"  →  new_dire.tmx               →   new_dire.tmx
  (team 0=蓝 / team 1=红)                 (team 2=蓝 / team 1=红)        （中继每轮开局前拷过去）
```

**要改就改源图**，然后重跑适配生成产物。改 `assets\` 里那份是白改——中继每轮开局会覆盖它。

---

## 三、当前编成

全图 **185 个起手单位**：红方 88、蓝方 97。其中 **135 个是 Moo's Defence Agency 的单位**（红 63 / 蓝 72），其余 50 个是原版基础单位（工厂、经济、潜艇、核与反核）。

### 红方（team 1）· 88 个

**Moo 单位（63）**

| 类别 | 单位 |
|---|---|
| 陆地主力 | `saberTank` ×26 |
| 空军 | `grandSlamBomber` ×8 |
| 海军 | `cruiserShip` ×4、`dreadnoughtShip` ×4、`destroyerShip` ×3、`dinghyShip` ×1、`mooClassBattleship` ×1 |
| 陆军支援 | `buffaloTank` ×3、`achillesTank` ×2、`wyvernTank` ×1 |
| 实验单位 | `typeUGunship` ×1 |
| 炮塔 | 见第四节（9 个） |

**原版保留（25）**：`airFactory` ×4、`mechFactoryT2` ×3、`seaFactory` ×2、`extractorT3_reinforced` ×2、`heavySub` ×5、`experimentalHoverTank` ×2、`landFactory`/`laboratory`/`builder`/`commandCenter`/`nukeLauncherC`/`antiNukeLauncherC` 各 ×1

### 蓝方（team 2）· 97 个

**Moo 单位（72）**

| 类别 | 单位 |
|---|---|
| 陆地主力 | `lynxTank` ×21 |
| 陆军支援 | `dusterTank` ×3、`zephyrTank` ×3、`cometTank` ×2、`paladinTank` ×1 |
| 空军 | `harbingerGunship` ×8、`grandSlamBomber` ×5 |
| 海军 | `cruiserShip` ×7、`destroyerShip` ×5、`dreadnoughtShip` ×4、`dinghyShip` ×1、`mooClassBattleship` ×1 |
| 实验单位 | `monarch` ×1、`wyvernTankDeployed` ×1 |
| 炮塔 | 见第四节（9 个） |

**原版保留（25）**：`airFactory` ×4、`attackSubmarine` ×4、`heavySub` ×3、`seaFactory` ×2、`landFactory` ×2、`mechFactoryT2` ×2、`extractorT3_reinforced` ×2、`experimentalLandFactory`/`builder`/`commandCenter`/`repairbay`/`nukeLauncherC`/`antiNukeLauncherC` 各 ×1

> **红蓝不是对称编成**，这是原本就有的差异（主播摆阵时两边就不同），换兵种时保持了各自的位置与数量不变。
> 红方陆地主力是 26 台 `saberTank`，蓝方是 21 台 `lynxTank`——`lynxTank` 更轻更便宜，蓝方用数量补。

---

## 四、炮塔布防

红蓝**各 9 个**，兵种与数量完全镜像：

| 炮塔 | 数量/方 | 角色 |
|---|---|---|
| `mgTurret` | 3 | 内层对地（廉价、量大） |
| `rocket_turret` | 2 | 中层对地 |
| `mgTurretT2` | 1 | 中层对地（升级版） |
| `turretArtyLight` | 1 | 外层轻炮 |
| `turretArtyHeavy` | 1 | 外层重炮 |
| `shredderAATurret` | 1 | 防空 |

**位置**由 `map_add_mod_towers.py` 自动选出，规则三条：落点必须 **LAND-CLEAN**（该点及 5×5 邻域无任何纯水图块）、与任何已有单位间距 ≥48px、以"朝敌方指挥中心"为主轴分内/中/外三圈展开。炮塔全在自家半场的陆地上。

**防空只放 1 个/方**是刻意的：观众会花钱召唤飞机，AA 铺满会让飞机落地就蒸发、观众觉得被骗——这条克制沿用 `地图设计与预设兵阵.md` §5 的既有决策。

---

## 五、硬依赖：这张图现在离不开 Moo's Defence Agency

地图里的 135 个 Moo 单位靠对象的 `customUnit` 属性引用（引擎源码 `game\b\a.java`：`customUnit` 有值就查自定义单位注册表，查不到直接抛异常）。后果：

**mod 被禁用、改名或删掉 ⇒ 地图加载失败**（`Could not find custom unit of:`），不是"少几个兵"。

所以这张图跟 `mods\units\Moo's Defence Agency v3.1.rwmod` 绑定了。换机器、重装游戏、清理 mod 目录时都要把它带上。

---

## 六、怎么改（工具链）

全在 `danmaku-relay\tools\`：

| 工具 | 用途 |
|---|---|
| `map_swap_mod_units.py` | 把阵型里的基础兵种换成 Moo 单位。`check` / `dryrun` / `apply` / `revert` / `verify`。映射表在脚本顶部 `MAP`，改一行即可重调 |
| `map_add_mod_towers.py` | 补 Moo 炮塔。`plan`（只读，列出将放的位置）/ `apply` / `verify` / `revert`。层数与兵种在 `LAYERS` |
| `map_adapt_newdire.py` | 源图 → 产物。**只改 team 值**（`team 0→2`、`(t:0)→(t:2)`），`unit`/`customUnit` 原样传递 |
| `verify_units_et.py` | 用 XML 解析器（不是正则）复核 UnitObjects 全量——**补 `verify_adapted_map.py` 的盲区**，见第七节 |

改完的标准流程：

```bash
cd danmaku-relay
python tools/map_swap_mod_units.py apply       # 换兵种（自动备份）
python tools/map_add_mod_towers.py apply       # 加炮塔（自动备份）
python tools/map_adapt_newdire.py apply        # 生成产物，末行应 RESULT: PASS
python tools/verify_units_et.py "<产物路径>"    # 独立复核，应 RESULT: PASS
```

回退：两个改写脚本各留 `.bak-modswap-<时间戳>` / `.bak-towers-<时间戳>` 备份，`revert` 模式可还原。

**改完不必重启中继**——中继每轮开局前会重新拷贝产物，下一轮自动生效。

---

## 七、坑

1. **`verify_adapted_map.py` 看不见 mod 单位。** 它用正则只认 `<property name="unit" …/>`，而 Moo 兵种走的是 `customUnit`。实测：产物有 185 个对象，它只报 50 条、`{1:25, 2:25}`，然后给一个 **PASS**——这是个**有损的通过**。换 `verify_units_et.py`（XML 通道）才能读全。
2. **文件路径带中文**，Git Bash 里直接传给 python 会被转码搞坏。脚本内部用 `glob` 自己找文件，或在 Python 里拼路径。
3. **别手改 `assets\maps\skirmish\new_dire.tmx`**，中继每轮覆盖它。
4. **源图文件名别加 `[pN]` 前缀**（会把队伍上限压到 1 支 AI）。`(2p)` 在中间无妨。
5. 排障只看 `<GAME>\lastrun.log` 的 `Mapfile:` 行——`battle/mapPool.js` 打的"经典战场/森林遭遇"是遗留代码，与实际加载无关。

---

## 八、观众怎么参与

这张图是中继的默认对局图。观众发「红3战车」这样的弹幕 → 中继在红方指挥中心旁生成 3 辆战车、从红方余额扣钱 → 红蓝自动对打 → 一方基地被拆或超时判胜负 → 自动开下一局。

完整的弹幕格式、兵种价目、礼物档表见：

- `直播指令手册.md` —— 弹幕怎么写、冷却、花钱规则
- `兵种与收益一览.md` —— 可召唤兵种的价格与官方数值（由 `tools/gen_unit_table.js` 自动生成，勿手改）

> ⚠️ 注意区分两件事：**地图阵型里的 135 个 Moo 单位**是开局就摆好的（本文档第三节），
> **观众能召唤的兵种**由 `battle/liveSpawner.js` 的 `UNIT_MAP` 决定——目前那张表里**没有** Moo 单位，
> 所以观众暂时召唤不了 `saberTank` 这类新兵。要让观众也能召唤，需要往 `UNIT_MAP` 里加别名。
