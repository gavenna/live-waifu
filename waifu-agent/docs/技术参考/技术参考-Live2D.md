# pixi-live2d-display — 动作(Motion)与表达式(Expression)参考

> 原文：https://guansss.github.io/pixi-live2d-display/motions_expressions/
>
> 译注：本文是 pixi-live2d-display 库官方文档中关于动作系统和表达式系统的完整翻译，重点涵盖动作管理、优先级、同步机制（Motion Sync）等。

动作（Motion）由每个模型的 `MotionManager` 管理。

---

## 空闲动作（Idle Motions）

当模型没有播放任何动作时，它被视为"空闲（idle）"状态，此时 motion manager 会随机启动一个空闲动作（优先级为 idle）。

空闲动作指的是定义在专用动作组中的动作：Cubism 2 中的 `"idle"` 和 Cubism 4 中的 `"Idle"`。但你可以指定自定义的动作组来读取空闲动作：

```js
model.internalModel.motionManager.groups.idle = 'main_idle';
```

也可以在创建模型时指定，以便根据预加载策略预加载该组：

```js
const model = await Live2DModel.from('shizuku.model.json', { idleMotionGroup: 'main_idle' });
```

---

## 动作预加载（Preloading Motions）

动作是独立的文件，默认会懒加载。当你第一次启动某个动作时，它需要从服务器获取，根据网络速度可能会有明显延迟。

动作预加载就是为了解决这个问题。它在模型创建期间预加载动作，确保动作可以无缝播放（但首次播放的动作仍可能来不及加载完成）。

默认情况下，只有空闲动作会被预加载。你可以通过设置 `motionPreload` 选项来改变：

```js
import { MotionPreloadStrategy } from 'pixi-live2d-display';

// MotionPreloadStrategy.ALL   - 预加载全部
// MotionPreloadStrategy.IDLE  - 仅预加载空闲动作（默认）
// MotionPreloadStrategy.NONE  - 不预加载

const model = await Live2DModel.from('shizuku.model.json', { motionPreload: MotionPreloadStrategy.NONE });
```

⚠️ **注意**：谨慎使用 `MotionPreloadStrategy.ALL`。同时加载太多动作会发送大量 HTTP 请求，由于浏览器的并发连接限制，可能会阻塞网络，影响其他资源的加载。

---

## 启动动作（Starting Motions）

```js
// 启动 "tap_body" 组中的第一个动作
model.motion('tap_body', 0);

// 启动 "tap_body" 组中的随机一个动作
model.motion('tap_body');

// 以上调用是下面方法的简写
model.internalModel.motionManager.startMotion('tap_body', 0);
model.internalModel.motionManager.startRandomMotion('tap_body');
```

这些方法返回一个 `Promise`，当动作成功启动时 resolve 为 `true`，否则为 `false`。

---

## 优先级（Priorities）

动作可以按以下优先级之一启动：`IDLE`、`NORMAL` 和 `FORCE`。

| 优先级 | 说明 |
|--------|------|
| `IDLE` | 低优先级。每个模型通常有一组空闲动作，在模型空闲时自动以此优先级播放 |
| `NORMAL` | 中优先级。如果不指定优先级，这是默认值 |
| `FORCE` | 高优先级。确保动作无论当前什么优先级都会被播放（除非遇到竞态条件——后续同一个优先级的动作比它先加载完成） |
| `NONE` | 无优先级。不能分配给动作，内部用于表示"当前没有任何动作在播放"的状态 |

```js
import { MotionPriority } from 'pixi-live2d-display';

model.motion('tap_body', 0, MotionPriority.NORMAL);

// 启动随机动作
model.motion('tap_body', undefined, MotionPriority.NORMAL);
```

---

## 状态管理（State Management）

当已有动作正在播放时请求启动新动作，当前动作不会被立即取消——相反，新动作会**预约**（reserve）位置并开始加载，当前动作会一直播放到新动作加载完成。

实际规则更复杂一些，下面是状态转换表，说明了在特定情况下尝试启动动作时，最终会播放哪个动作（假设加载不会失败且会在较短时间内完成）：

| 当前状态 | NONE | IDLE | NORMAL | FORCE |
|----------|:----:|:----:|:------:|:-----:|
| 未播放 / 未预约 | none | **C** | **C** | **C** |
| 播放 A(IDLE) / 未预约 | A | A | **C** | **C** |
| 播放 A(NORMAL) / 未预约 | A | A | A | **C** |
| 播放 A(FORCE) / 未预约 | A | A | A | **C** |
| 播放 A(IDLE) / 预约 B(NORMAL) | B | B | B | **C** |
| 播放 A(NORMAL) / 预约 B(FORCE) | B | B | B | **C** |
| 播放 A(FORCE) / 预约 B(FORCE) | B | B | B | **C** |
| 未播放 / 预约 B(IDLE) | B | B | **C** | **C** |
| 未播放 / 预约 B(FORCE) | B | B | B | **C** |
| 未播放 / 预约 B(FORCE) | B | B | B | **C** |

**注意**：这些规则在某些情况下与 Live2D 官方案例不同：
- 竞态条件会被正确处理
- 尚不支持并行播放多个动作

---

## 声音（Sounds）

如果动作指定了声音文件，声音会随动作一起播放。

所有 `<audio>` 元素由单例 `SoundManager` 统一管理。播放期间，你可以通过 `SoundManager.audios` 访问这些音频元素。

可以设置全局音量，会影响所有活动的音频以及将来创建的音频：

```js
import { SoundManager } from 'pixi-live2d-display';

SoundManager.volume = 0.5;
```

要单独处理音频，可以监听 `motionStart` 事件：

```js
model.internalModel.motionManager.on('motionStart', (group, index, audio) => {
  if (audio) {
    // 例如：为该音频显示字幕
    showSubtitle(group, index);

    audio.addEventListener('ended', () => dismissSubtitle());
  }
});
```

---

## 动作同步（Motion Sync）⭐ 核心功能

启动带声音的动作时，有两个并发任务：

```
  ┌──────────┐     ┌──────────┐
  │加载动作   │     │播放动作   │
  └──────────┘     └──────────┘

  ┌──────────┐     ┌──────────┐
  │加载声音   │     │播放声音   │
  └──────────┘     └──────────┘
```

这很容易导致声音与动作不同步，因为两者并不总是在同一时间加载完成。

使用 motion sync（动作同步）后，播放会被**延迟**，直到动作和声音都加载完成：

```
  ┌──────────┐
  │加载动作   │
  └──────────┘
               ┌───────────────┐     ┌──────────────┐
               │等待两者都完成 │────▶│同时播放动作+声音│
               └───────────────┘     └──────────────┘
  ┌──────────┐
  │加载声音   │
  └──────────┘
```

**此功能默认开启**，可通过[全局配置](https://guansss.github.io/pixi-live2d-display/configs)中的 `motionSync` 选项关闭。

---

## 表达式（Expressions）

表达式由 `MotionManager` 内部的 `ExpressionManager` 管理。

```js
// 应用第一个表达式
model.expression(0);

// 应用名为 "smile" 的表达式
model.expression('smile');

// 不传参数时，应用随机表达式
model.expression();

// 以上调用是下面方法的简写
model.internalModel.motionManager.expressionManager.setExpression(0);
model.internalModel.motionManager.expressionManager.setExpression('smile');
model.internalModel.motionManager.expressionManager.setRandomExpression();
```

⚠️ **注意**：如果模型的设置中没有定义任何表达式，`ExpressionManager` 根本不会被创建，也就是说 `model.internalModel.motionManager.expressionManager` 会是 `undefined`。

---

## 对 waifu-agent 项目的参考意义

1. **Motion Sync 默认开启**：如果 waifu-agent 使用 pixi-live2d-display 内置机制播放动作+语音，Motion Sync 会自动处理加载时序，不需要额外实现同步逻辑
2. **手动控制表达式 + 嘴型参数**：如果用 `expression()` 驱动嘴型，注意 ExpressionManager 可能不存在（模型没有定义表达式时）
3. **SoundManager 全局音量**：可直接用 `SoundManager.volume` 控制语音音量
4. **motionStart 事件**：监听此事件可在语音播放时触发字幕、表情同步等行为
