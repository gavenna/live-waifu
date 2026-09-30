---
name: frontend
description: >
  React 前端开发、UI 组件、交互逻辑、样式。改 App.tsx / 组件 / 样式时自动触发。
  用法: /frontend 我要在聊天面板加一个按钮
---

# React 前端开发指南

> 改前端代码前先看这里。踩坑登记簿: `.claude/rules/pitfalls.md`

## 核心文件

| 文件 | 职责 |
|------|------|
| `src/App.tsx` | 三窗口路由 + PIXI + LLM 中继（最大文件） |
| `src/components/ChatUI.tsx` | 聊天面板 |
| `src/components/SettingsPanel.tsx` | 设置面板 |
| `src/types/settings.ts` | RuntimeSettings 类型 + 默认值 |
| `src/persona.config.ts` | 角色预设配置 |
| `src/config/stickerConfig.ts` | 贴图定义和选择逻辑 |

## 铁律

### 无框窗口：必须同时拦截 mousedown + mouseup + click

根 div 的 `onMouseDown` 会触发 `start_dragging_window()`，只拦截 `onClick` 不够。

```tsx
// ✅ 容器上统一拦截
<div
  onMouseDown={(e) => e.stopPropagation()}
  onMouseUp={(e) => e.stopPropagation()}
>
  <button onClick={...} />
</div>

// ❌ 只拦截 click → 按钮点不动
```

### 异步操作用 generation counter，不用 boolean flag

React StrictMode 双重挂载 → boolean flag 死锁。

```tsx
// ✅ 正确
const genRef = useRef(0);
const load = async () => {
  const gen = ++genRef.current;
  const result = await doAsync();
  if (gen !== genRef.current) return;
  setState(result);
};
useEffect(() => () => { ++genRef.current; }, []);

// ❌ 错误: if (loadingRef.current) return; loadingRef.current = true;
```

### PIXI Canvas 必须自适应窗口

```tsx
const scale = Math.min(winSize.w / persona.canvasWidth, winSize.h / persona.canvasHeight);
// 不能写死 px
```

### UI 尺寸从 config 走，不硬编码

```tsx
// ❌ width: 32
// ✅ width: personaConfig.chatBtnSize
```

### save_settings 必须传完整对象

`invoke("save_settings", { settings })` 会**原样覆盖整个 settings.json**。

```tsx
// ❌ 只传一个字段 → 清空整个文件
invoke("save_settings", { settings: { webSearchEnabled: next } })

// ✅ 展开完整对象
invoke("save_settings", { settings: { ...fullSettings, webSearchEnabled: next } })
```

### useEffect listener 依赖不能用 useState

useState 变化 → useEffect 重跑 → listener 销毁重建 → 丢事件。

```tsx
// ✅ 用 ref: flagRef.current 始终最新，listener 只注册一次
const flagRef = useRef(true);
useEffect(() => { listen("event", () => { if (flagRef.current) ... }); }, []);
```

### convertFileSrc 路径规范化

Windows 上反斜杠会导致路径解析失败:
```tsx
const src = convertFileSrc(filePath.replace(/\\/g, "/"));
```

### 通用规则

- **面板弹独立窗口** — 用 `WebviewWindow`，不搞 overlay 遮挡角色
- **错误不能静默吞** — 不能 `.catch(() => {})`，至少 `console.error`
- **全 inline styles，暗色半透明风** — 无 CSS 框架
- **log(tag, ...) 的 tag 必须在 `logConfig.ts` 的 LOG_SWITCH 里**

## 改完代码后

> tsc 由 hook 自动执行（Stop hook 不通过不准结束）。以下检查 hook 覆盖不到：

1. **改 UI 组件/样式** — 检查所有交互元素是否正确拦截了 `onMouseDown` + `onMouseUp`
2. **改状态管理/事件** — grep 确认 `useEffect` listener 依赖没有用 useState、async 操作用了 generation counter
3. **改窗口通信** — grep 确认 `emit` 方没有自己做持久化
4. **改设置面板** — 确认 `save_settings` 传了完整对象
5. **改贴图相关** — 确认 `cleanTtsText` 和 Rust 端 `clean_tts_text` 同步

> 改动涉及用户可见的交互变化，在回复中告诉用户：改了什么、去哪里看效果。
