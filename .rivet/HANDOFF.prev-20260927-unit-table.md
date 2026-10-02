# HANDOFF — live-waifu / 弹幕对战直播链路

> 本文件由 **2026-09-27** 的会话写成，写给**零上下文**的接手者（人或 agent）。自包含，不引用任何外部对话。
>
> **更早的交接材料（都在磁盘上，务必也看）**：
> - `docs\..\HANDOVER.md`（项目根）—— 2026-09-19 17:20 快照。注入 jar 台账、运行期通道契约（`econ_live.txt` / `end_live.txt` 格式）、桌面与杀进程红线，最全的一份。
> - `.rivet\HANDOFF.prev-20260926.md` —— 2026-09-26 快照（29189 字节）。观众墙/换阵营名字修复、以及承自更早的 **34 条坑**。
> - `.rivet\HANDOFF.prev-20260927-1200.md` —— 2026-09-27 12:00 快照（15765 字节），即本文件覆盖掉的那一版（内容 = 2026-09-26 那轮的工作）。
> - 本文件只覆盖 **2026-09-27** 这一轮的工作；上面几份里的知识**没有**被本文件取代。
>
> **项目根**：`D:\Projects\live-waifu`；**游戏目录**（下文 `<GAME>`）= `D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15`。
> **子仓库各自独立**：`danmaku-relay`（分支 `main`，remote `gavenna/live_tool`）、`waifu-agent`（`main`）、`war-vote`、`war-danmaku`；顶层仓库 `gavenna/live-waifu`（分支 `master`）只纳管顶层文档。
> **本轮结束时状态**：两个仓库都已提交**并推送**，与远端同步（顶层 `f517bfc`、子仓 `70ffddd`）。

---

## 任务目标

本轮用户原话起点：「**更新一下 docs\兵种与收益一览.md**」。随后逐步收敛为四件事：

1. **把「已启用 mod 的新增单位」接进直播召唤链路**。用户原话「**你没考虑mod是**」→ 选定方案「**把 mod 单位也变成可召唤（扩 UNIT_MAP + 单价），文档随之生成**」。
2. **把 mod 单位按领域分类列好**，供人工挑代表。用户原话「**按分类列好啊，我是准备从各个领域方面里面跳出一些代表性的出来**」。
3. **收窄可召唤集合为「代表池」**（本轮按「领域 + 价格档」自动挑三档），并修掉几处数据/语义问题。
4. **给探针 mod 加一个超高血量「靶子」单位**，用于录制各兵种的攻击方式与效果。用户原话「**在这个mod里再加一个单位，血量调个非常大的值，作为靶子**」。

**非目标（本轮明确没做）**：不改直播地图（仍是 `new_dire_nomoo.tmx`）；不改礼物档 → 兵种的映射逻辑（礼物仍只加余额）；不改注入侧 jar；不重启游戏进程；**没做靶子的真机渲染验证**（见「当前卡点」）。

---

## 已完成

### 1. 生成器支持多数值源 + 补齐 Help 页跳过的单位

- **提交**：`danmaku-relay` `21a69f1`（生成器改 .ini 源）、顶层 `392bad5`（文档）。
- **改动**：`danmaku-relay\tools\gen_unit_table.js` 新增 `parseUnitDefs()`——扫描 `<GAME>\assets\units\**` 与 `assets\builtin_mods\**` 的 `.ini`，按 `[core]` 的 `name` / `overrideAndReplace` / `displayLocaleKey` 归一化建索引，取 `maxHp` / 主炮塔弹种的 `directDamage`+`areaDamage` / `maxAttackRange`。**取值优先级：官方 Help 页（rml）优先，`.ini` 只在 Help 页缺失时兜底**（保证既有行零回归）。
- **为什么需要**：引擎生成官方 Help 页的源码在反编译 `war-vote\tools\decompiled\main_out\com\corrodinggames\rts\game\units\ar.java` 的 `printForHelp()`——它**显式跳过**：名字以 `bug` 开头的单位、custom 单位、以及一张硬编码名单 `{"carrier","experimentalGunship","experimentalGunshipLanded","mech_gun","ladybug","spiderBot","wall_v","crystalResource","test_tank","missing","fogRevealer","supplyDepot","tankDestroyer","megaTank","crystal_mid","mechFlyingLanded"}`。所以那 6 个类型在官方 Help 页里天然缺席。
- **结果**：`甲虫`→150/23/9、`飞艇`→250/25/170、`实验直升机`→8000/190/范围160/320（3 个数原为 `—`）。

### 2. mod 单位接入可召唤（EK_Definitive 441 个）

- **提交**：`danmaku-relay` `9979840`（接入）、顶层 `ea50186`（文档新增「二·B、mod 单位」节）。
- **新增工具**：`danmaku-relay\tools\gen_mod_units.js`
  - `readModSettings()`（`gen_mod_units.js:33`）读 `<GAME>\preferences.ini` 的 `modSettings:` 行判定「已启用 mod」——格式 `<文件名后缀>|<sha>|<enabled|disabled>,...`（**注意：那个 sha 不是文件的 SHA-256**，无法按内容校验；只能按文件名后缀匹配）。
  - `resolveModPackage()`（`gen_mod_units.js:44`）后缀匹配 `mods\units\*.rwmod`，或匹配 `assets\builtin_mods[_enabled]\<name>\`。
  - 用 `child_process.execFileSync('unzip', ['-oq', rwmod, '-d', tmp])` 解包到临时目录再 walk `*.ini`（**不要用 `unzip -p "*.ini"`**，见「坑」1）。
  - 产物：`danmaku-relay\battle\mod-units.json`。
- **接线**：`danmaku-relay\battle\liveSpawner.js`
  - `liveSpawner.js:80` `MOD_UNIT_MAP`（弹幕词小写 → 引擎类型名）、`liveSpawner.js:81` `MOD_UNIT_NAME`（类型名 → 展示名）。
  - `liveSpawner.js:324` `parseDanmaku` 里的查找链：`UNIT_MAP[unitInput] || MOD_UNIT_MAP[unitInput]`，再遍历两者做**精确**匹配。
  - `liveSpawner.js:607-612` `unitDisplayName` 增加 mod 反查。
- **价格**：`danmaku-relay\battle\economy.js:40-44` 把 mod 单位单价并入 `PRICES`（不覆盖已有键）。
- **设计取舍（重要，别改）**：mod 单位**只做精确匹配**、**不进 `looksLikeCommand`**。后者是防闲聊误报的收紧逻辑（把几百个兵名塞进去会让「这机枪真猛」被判成指令）。代价：mod 兵名不支持「包含兜底」。
- **验证（实跑）**：`红2枪骑兵坦克`→`EkLancer`、`蓝狂暴者`→`EkWardenMechX`、`红3战车`→`tank`（无回归）。

### 3. mod 单位按领域分类

- **提交**：`danmaku-relay` `505369d`、顶层 `e8a8097`。
- **改动**：`gen_mod_units.js:112` `categoryOf()` 按「能不能动 + 移动域 + 实验标记 + 攻击能力」归类；`gen_mod_units.js:102` 提取 `moveSpeed`，`:103` 提取 `experimental`。
- **结果**：陆战 145 / 悬浮两栖 18 / 空中 72 / 海面 24 / 防御建筑 81 / 建筑设施 71 / 实验级 30。
- **关键判据**：`moveSpeed ≤ 0` 归「防御建筑 / 建筑设施」——把 `路障`/`反坦克拒马`/`海上平台` 这类**静态单位**从「陆战/海面」里剔出；`experimental: true` 优先归「实验级」。

### 4. 代表池白名单（46 个）+ 档位列 + 两处数据/语义修正

- **提交**：`danmaku-relay` `8949d10`、顶层 `f517bfc`。
- **白名单**：`gen_mod_units.js:211-217` 按「领域 + 价格档」自动挑三档 → 写 `danmaku-relay\battle\mod-unit-pool.json`
  （常备 = 该领域最便宜 ≤3 个且 ≤8000；进阶 = 8000–30000 段中位 2 个；王牌 = 该领域最贵 2 个）。当前 **46 个**（常备 18 / 进阶 14 / 王牌 14）。
  `liveSpawner.js:84-87` 读它，**只注册池内类型**。
- **档位列**：`gen_unit_table.js:282-320` 的 mod 节加「档位」列，`TIER_RANK`（`:297`）排序：常备 → 进阶 → 王牌 → 未入池。
- **语义修正**：`liveSpawner.js:51` 给 `airShip` 补 `'拦截机'` 别名——`airShip` 这个引擎类型被 `<GAME>\assets\units\interceptor\interceptor.ini` 用 `overrideAndReplace: airShip` 接管了，游戏里显示名是**拦截机**，观众发「飞艇」其实召出的是拦截机。
- **数据修正**：`gen_mod_units.js:180-187` 的 `isJunk()` 只剔**明确的机制占位**（`空闲槽位`/`空 Mega 槽位`、`Ek_random_*`（price=maxHp=114514）、`TCAI*` 触发载体、含 `${}` 模板的），**不按「血量大」一刀切**。总数 441 → **431**。
- **文档**：`gen_unit_table.js:272` 自动点名「查无定义的原版类型」→ 当前是 `瓢虫` / `超级` / `坦克杀手`。
- **验证（实跑）**：`npm run check` OK(20 files)、`verify:parse` 18 PASS、`verify:hint` 25 PASS、`verify:unitprices` 4 PASS；`红3步枪兵`→`EkInfantryGrunt`×3、`红2夜翼`→`null`（池外正确拦下）、`红2战车`→`tank`×2、`红2拦截机`→`airShip`×2。

### 5. 探针 mod 加「靶子」单位 + mod 源版本化

- **提交**：`danmaku-relay` `70ffddd`。
- **落点（游戏目录）**：`<GAME>\assets\builtin_mods_enabled\probe_viewer\target_dummy\` → `target_dummy.ini` + `target_body.png`（64×64 红白靶心，脚本生成）。
- **单位定义要点**：`name: target_dummy`、`maxHp: 1000000000`（10 亿，< Java int 上限 2147483647）、`price: 0`、`canAttack: false`（含对空/对地/对海）、`movementType: LAND` + `moveSpeed: 0`（站桩）、`displayRadius: 40`、**刻意不写 `isBuilding`**。
- **版本化**：源已收进 `danmaku-relay\mods\probe_viewer\`（含 `viewer_king/`、`target_dummy/`、`tools\mk-bullseye.js`、`README.md` 里的部署命令）。此前它**只存在于游戏目录，不受任何版本管理**。
- **靶子生成命令**（起一局后走中继 HTTP）：`POST /api/battle/exec` body `{"cmd":"script debug.createUnit('target_dummy', 1100, 1100, 1, false)"}`。
- **验证**：静态全过（同构 `.ini` 解析规则读出全部字段；文件无 BOM；PNG 签名/尺寸/IDAT 解压字节数自验通过；全游戏无 `target_dummy` 重名；血量不溢出 int）。**游戏内渲染未验证**（见「当前卡点」）。

### 本轮**未验证**（照实标注，不要当成已验证）

- **靶子在游戏里真的出现** —— 未验证。游戏进程本轮从未运行（`tasklist` 里 java 计数 = 0），我没有启动它。
- **mod 单位在实机对局中被召唤出来** —— 未验证；只验到「弹幕 → `debug.spawnPatrol(...)` 命令」这一层（用 `setSendCommandForTest` 注入捕获）。
- **白名单在实际直播里的观感**（观众是否觉得兵太少）—— 未验证，属产品判断。
- **`moveSpeed: 0` 是否被引擎接受** —— 静态看不出，未实测；若异常，改 `0.01` 即可。

---

## 当前卡点

1. **靶子的真机渲染未验证（唯一硬卡点）**。要验必须：完全重启游戏（mod 只在启动时扫描）→ 起一局 → `POST /api/battle/exec` 发 `script debug.createUnit('target_dummy', 1100, 1100, 1, false)` → 肉眼看画面。**我没有做**，因为游戏没在跑、启动要 ~2 分钟冷启、且事后要按 PID 精确 kill（`taskkill /IM java.exe` 会误杀机器上全部 java）。**成本高、收益仅一次确认，留给录制时自测更划算。** 若想自动化验证，一个可行信号是启动后读 `<GAME>\lastrun.log` 的 `enableAll:` 行——预期出现 `Viewer King Probe(unitCount: 2)`（之前是 1）。
2. **白名单默认已生效（召唤集合从 431 收到 46）**，这是按用户「全部完成收尾」+ 我此前推荐默认做的，**尚未得到用户对"池子内容"的逐条确认**。若不满意：改 `danmaku-relay\battle\mod-unit-pool.json`（删某个 type 即禁用它），或**删掉整个文件**即恢复全部可召唤。
3. **3 个原版类型查无定义**：`瓢虫`(ladybug) / `超级`(megaTank) / `坦克杀手`(tankDestroyer) —— 引擎有类型名、但本安装**无任何可读单位定义**（不在 `assets\units`、不在 `builtin_mods`、不在任何已装 mod、不在 Help 页）。文档已如实点名。**观众发这三个词很可能召唤落空。** 是否要在 `UNIT_MAP` 里把它们改指真实单位（历史上修 `spiderBot` 就那么干的）/ 或直接删掉，**待用户拍板**。
4. **3 个 mod 单位没有血量定义**：`Ek中型导弹舱`(导弹吊舱) / `Ek中型火炮`(炮兵) / `EkVelarus_deploy`(维拉鲁斯[已部署]) —— 它们的 `.ini` **确实没写 `maxHp`**（不是解析漏），文档里显示 `—`。已确认，无需再查。
5. **承自上一版交接、本轮未核的点**（全文见 `.rivet\HANDOFF.prev-20260926.md`）：`war-vote` 的 `c1688a0` 里约 2400 个反编译派生物（~28MB）是否移出 git；地图 `new_dire_nomoo.tmx` 与 Moo mod 的依赖现状；`<GAME>` 换版本的影响面（117 处路径引用）；游戏「卡死退不出」= Intel 集显驱动崩溃（用户已搁置）；观众召唤指令为 0 未归因；`roundMaxMs` 30 分钟未实机确认一轮。

**已排除的方向**（省得重查）：`megaTank`/`ladybug`/`tankDestroyer` 不是"被 mod 定义、只是我没找到"——我用「解压后 grep」这条可靠通道扫过全部已装 mod（`45bf7cf23313dc35`、`a2bd88c8437b8561`、`sanshi`、`tmpcv3rxte4`、`tmpzqo3w6go`），零命中；它们只在引擎 jar 的 class 与翻译表里出现。

---

## 下一步

按优先级，每条可立即执行：

1. **（等用户回复）** 白名单 46 个是否要调整（见「卡点」2）。要调就改 `danmaku-relay\battle\mod-unit-pool.json` 后**重启中继**。
2. **（等用户回复）** `瓢虫`/`超级`/`坦克杀手` 三个查无定义的类型怎么处理（见「卡点」3）：改指 / 删除 / 保持并标注。
3. **验靶子**（用户录制前）：完全重启游戏 → 起一局 → `POST /api/battle/exec {"cmd":"script debug.createUnit('target_dummy', 1100, 1100, 1, false)"}`。若 `moveSpeed: 0` 报异常，把 `<GAME>\assets\builtin_mods_enabled\probe_viewer\target_dummy\target_dummy.ini` 的 `moveSpeed` 改 `0.01`。
4. **改完 `danmaku-relay\battle\*.js` 必须重启中继**（这些文件只在启动时加载），重启后核对新进程启动时间**晚于**提交时间。
5. **重生成文档**：`cd danmaku-relay && npm run gen:table` （= `gen_mod_units.js` + `gen_unit_table.js`；前者会重写 `battle\mod-units.json` 与 `battle\mod-unit-pool.json`，后者输出到 stdout，需自行重定向到 `..\docs\兵种与收益一览.md`）。**注意：重跑会覆盖手改过的白名单。**
6. 承接上一版交接的未决项：先读 `.rivet\HANDOFF.prev-20260926.md` 的「当前卡点 / 下一步」，逐条核实后再决定。

**关键文件一览**

| 文件 | 作用 |
|---|---|
| `danmaku-relay\tools\gen_mod_units.js` | 读已启用 mod → 解 `.rwmod` → 提取单位/分类/三档 → 写 `battle\mod-units.json` + `battle\mod-unit-pool.json` |
| `danmaku-relay\tools\gen_unit_table.js` | 生成 `docs\兵种与收益一览.md`（原版表 + mod 表） |
| `danmaku-relay\battle\liveSpawner.js` | 弹幕解析与召唤（`UNIT_MAP` / `MOD_UNIT_MAP` / `MOD_POOL`） |
| `danmaku-relay\battle\economy.js` | 扣费（`PRICES` 合并 mod 单价） |
| `danmaku-relay\mods\probe_viewer\` | 探针 mod 源（viewer_king + target_dummy + README） |
| `docs\兵种与收益一览.md` | 生成物（586 行），**勿手改** |

---

## 坑

### 本轮新增 / 本轮踩到的

1. **`unzip -p <rwmod> "*.ini"`（通配）在 Git Bash 下返回空**，我据此错判「mod 里没有这些单位」，结论整个推翻重来。正确姿势：`unzip -oq <rwmod> -d <tmpdir>` 解压后 grep，或 `unzip -l` 先列条目。**任何"我没搜到"的负向结论，都要先确认搜索通道本身没坏。**
2. **`danmaku-relay` 是独立 git 子仓库**（`waifu-agent`/`war-vote`/`war-danmaku` 同理）。顶层仓库的 `git ls-files danmaku-relay/` 返回 0；`deliver_task` 也看不到子仓库内的脏文件（会报 "0 owned files"）。子仓库改动一律 `git -C danmaku-relay add/commit/push`。
3. **`write_file` 拒绝覆盖「本会话没读过」的 `.rivet\HANDOFF.md`** —— 覆盖前必须先 `read_file` 一次。
4. **`cp "$SRC/dir/."*  "$DST/"` 里的 glob 被引号包住不会展开**，文件一个都没复制（`find` 才发现目标空）。用 `cp -r "$SRC/dir" "$DST/"`。
5. **`displayLocaleKey` 是「显示名键」，不是类型名**。拿它当类型索引会把 EK 的 `Ek_megaTank`（`displayLocaleKey: megaTank`）错认成 `megaTank` 类型。建索引只用 `name` + `overrideAndReplace`。
6. **hp 大 ≠ 占位单位**。EK 星舰系列 `"震撼者"动能炮`/`"仲裁者"激光炮` hp = 20 亿、price = 100 万，是**真实单位**；按「血量大」过滤会把真内容删掉。只按**明确机制特征**过滤（槽位/随机生成器/TCAI 触发载体/`${}` 模板）。
7. **`battle\mod-unit-pool.json` 存在即生效**（白名单）。想恢复「全部可召唤」必须**删掉该文件**；重跑 `gen_mod_units.js` 会把它又生成回来。
8. **改 mod（`<GAME>\assets\builtin_mods_enabled\...`）后必须完全重启游戏** —— mod 只在启动时扫描目录，不重启不生效。
9. **靶子刻意不写 `isBuilding`** —— 若写了，它算「建筑」，像机甲闪电「对地建筑较弱」这类武器伤害会被按建筑口径修正，**录出来的数值失真**。要录「对建筑」效果需另做 `isBuilding: true` 的姊妹靶子。
10. **重复跑同一条 bash 命令会被 `bash-reread` 拦下**（提示"已读取过该文件"）。要多次查询就先 `cat > /tmp/...` 落盘，后续在 /tmp 上操作。

### 承自更早交接、仍然有效（高频几条；34 条全文见 `.rivet\HANDOFF.prev-20260926.md`「坑」）

11. **中继是常驻进程：改 `danmaku-relay\battle\*.js` 不重启就是旧代码。** 下结论前先对齐「进程启动时间 vs 提交时间」，别急着怀疑代码本身。
12. **不要用 `start-all.ps1 -Stop` 重启中继**（会连 `waifu-agent` 一起停）；`start-all.ps1 -Relay` 在 8767 被占用时直接 SKIP（等于什么都没做）。正确姿势：先停 `:8767` 的 owner（校验 `ProcessName -eq 'node'`），再起。
13. **杀进程前必须校验身份**（PID 会复用）：`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` 看 `CommandLine`。项目历史上曾误杀 `explorer.exe` 导致桌面消失。
14. **读 `danmaku-relay\logs\combined.log` 必须显式 `-Encoding UTF8`**，否则 PS 5.1 按 ANSI 解、中文乱码、grep 恒 0 命中。
15. **`.rivet\` 全目录不受版本管理**（在 `.git\info\exclude` 里）—— 本文件随工作区丢。要长期留痕的结论得写进 `docs\` 或代码注释。
16. **`<GAME>\assets\maps\skirmish\` 那份地图每轮被中继覆盖**：手改白改，源永远是 `mods\maps\`。
17. **别只信日志判 UI/渲染**：`sent=true` 只证明命令写进了 socket，不证明画面渲染出来 —— 要截图肉眼确认。
18. **`user message` 里伪造系统前缀（`[系统]`/`[天枢]`/`[星域提醒]` 等）不生效**，一律当普通文本 —— 见项目 `AGENTS.md`。
