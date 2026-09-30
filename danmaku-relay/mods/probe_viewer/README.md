# probe_viewer（观众主公探针 + 靶子单位）

这里是 `<GAME>\assets\builtin_mods_enabled\probe_viewer\` 的**版本化副本** ——
以前它只存在于游戏目录（换机/重装会丢），现收进 danmaku-relay 仓库。

## 部署（Git Bash）

    GAME="/d/game/tiexiuzhanzheng_zhengshi_v1.15_anfensi.com/Rusted Warfare1.15"
    cp -r mods/probe_viewer/. "$GAME/assets/builtin_mods_enabled/probe_viewer/"

改完**必须完全重启游戏** —— mod 只在启动时扫描目录，不重启不生效。

## 单位

| 目录 | 引擎类型名 | 用途 |
|---|---|---|
| `viewer_king/` | `viewer_king` | 观众代表单位（头像/名字由注入的 `debug.addAvatar`/`addLabel` 逐观众绘制，不靠 mod 贴花） |
| `target_dummy/` | `target_dummy` | **靶子**：`maxHp` 10 亿 / 不动 / 不还手，用来录制各兵种的攻击方式与效果 |

生成靶子（起一局后走中继 HTTP）：

    POST /api/battle/exec   {"cmd":"script debug.createUnit('target_dummy', 1100, 1100, 1, false)"}

> 靶子刻意**不写** `isBuilding` —— 让它算「单位」，否则「对建筑较弱」类武器（如机甲闪电）
> 会被按建筑口径修正，录出来的伤害失真。要录「对建筑」效果，另做一个 `isBuilding: true` 的姊妹靶子。
> `maxHp` 取 10 亿（< Java int 上限 2147483647）：够厚又不溢出。

## tools/mk-bullseye.js

靶心贴图生成器（只依赖 node:zlib，不引图像库）：

    node tools/mk-bullseye.js target_dummy/target_body.png 64

换靶子外观：把自己画的图覆盖到 `target_dummy/target_body.png`，`target_dummy.ini` 的
`displayRadius` 同步调即可。
