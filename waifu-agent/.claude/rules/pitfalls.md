# 踩坑登记簿

> 只登记**机制级/环境级/流程级**经验。不登记具体代码 bug。
> 判断标准：换一个 agent 来干不同的事，会不会再踩一遍？会 → 写进来。

---

## 环境陷阱

### P1. Python `__pycache__` 缓存过时代码

**症状**：明明修了 Python 脚本的 bug，错误一模一样重现。

**根因**：Python 把 `.py` 编译成 `__pycache__/*.pyc`，改源码后可能仍用旧 `.pyc`。

**哪类 agent 会踩**：`backend-dev`、`devops`、任何改 Python 脚本的

**修复/预防**：
```bash
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
```
`.gitignore` 必须包含 `__pycache__/` 和 `*.pyc`。

---

### P2. Windows Defender 拦截编译产物

**症状**：`os error 4551` / `应用程序控制策略已阻止此文件`

**哪类 agent 会踩**：`backend-dev`、`devops`

**修复/预防**：Windows 安全中心 → 排除项 → 添加项目文件夹。agent 无法自动修，必须告知用户。

---

### P3. Tauri dev 时子进程 cwd 是 `src-tauri/`

**症状**：Rust 子进程的相对路径（如 `waifu-memory/cli.py`）解析为 `src-tauri/waifu-memory/cli.py`（不存在）。

**哪类 agent 会踩**：`backend-dev`、任何写 Rust subprocess 调用的

**修复/预防**：Rust 端用绝对路径或 `app.path().resource_dir()` 定位，不要依赖 cwd 正确。

---

### P4. Vercel free tier 响应后冻结进程

**症状**：fire-and-forget 的 async 函数在 HTTP response 发出后不执行完。

**哪类 agent 会踩**：`devops`、任何改 waifu-auth API 的

**修复/预防**：`await` 所有异步操作再返回 response。Serverless 不懂"后台任务"。

---

### P5. Tauri 2 `bundle.resources` key 是源路径

**症状**：`resource path 'xxx' doesn't exist`，尝试 `../` 路径失败。

**根因**：Tauri 2 对象格式 `bundle.resources` 中，**key 是源路径**（相对 `src-tauri/`），`../` 不生效。

**哪类 agent 会踩**：`backend-dev`、`devops`

**修复/预防**：外部目录需要用 Directory Junction 链接到 `src-tauri/` 下：
```powershell
New-Item -ItemType Junction -Path "src-tauri/scripts" -Target "../scripts"
```
`.gitignore` 中排除 junction 目录。

---

## 架构约束

### A1. CARGO_MANIFEST_DIR 打包后指向编译机路径（铁律 0）

**症状**：dev 模式正常，打包后资源文件/脚本找不到。

**根因**：`env!("CARGO_MANIFEST_DIR")` 编译时展开为编译机绝对路径，打包后该路径在用户电脑上不存在。

**哪类 agent 会踩**：`backend-dev`、任何 Rust 代码

**修复/预防**：
```rust
// ✅ 静态资源：打包进 bundle.resources → app.path().resource_dir()
// ✅ 用户数据：app.path().app_data_dir()
// ✅ 代码内嵌：include_str!()
// ❌ 永远不用 env!("CARGO_MANIFEST_DIR") 定位运行时资源
```

---

### A2. React StrictMode 双重挂载 → boolean flag 死锁

**症状**：async 初始化在 StrictMode 下只执行一次，第二次 mount 被 flag 拦死。

**哪类 agent 会踩**：`frontend-dev`

**修复/预防**：
```tsx
// ❌ 错误
if (loadingRef.current) return;
loadingRef.current = true;
await doAsync();

// ✅ 正确：generation counter
const gen = ++genRef.current;
await doAsync();
if (gen !== genRef.current) return; // 过期丢弃
// Cleanup 中也要 ++genRef.current
```

---

### A3. 无框窗口鼠标事件必须双向拦截

**症状**：按钮点不动、点击变成拖拽窗口。

**哪类 agent 会踩**：`frontend-dev`

**修复/预防**：所有交互元素必须同时拦截 mousedown + mouseup + click：
```tsx
onMouseDown={(e) => e.stopPropagation()}
onMouseUp={(e) => e.stopPropagation()}
onClick={(e) => { e.stopPropagation(); doStuff(); }}
```

---

### A4. `save_settings` 传 partial 对象会清空全部用户设置

**症状**：改了设置面板一个值，保存后其他所有配置丢失。

**哪类 agent 会踩**：`frontend-dev`、`backend-dev`

**修复/预防**：前后端双重防护。Rust 端 merge 而非 replace；TS 端先 `load_settings` 再 spread 覆盖。

---

### A5. TTS 清洗管线 Rust + TS 双实现，必须同步

**症状**：新增 `[tag]` 语法后 TTS 念出标签文字。

**哪类 agent 会踩**：`ai-specialist`、`frontend-dev`、`backend-dev`

**修复/预防**：
```bash
grep -rn "cleanTts\|clean_tts" src/ src-tauri/
```
新增任何文本语法标记，必须同步更新两边的清洗函数。

---

### A6. emit 方只发事件，listener 统一持久化

**症状**：同一条数据被写两次（emit 方写一次，listener 又写一次）。

**哪类 agent 会踩**：`frontend-dev`

**修复/预防**：emit 方不写数据，副作用全部在 listener 中集中处理。

---

### A7. PIXI Canvas 尺寸不能写死 px

**症状**：窗口缩放后角色变形、裁剪。

**哪类 agent 会踩**：`cubism-dev`、`frontend-dev`

**修复/预防**：用 `useWindowSize()` + 等比缩放，所有尺寸从 config 读取。

---

### A8. 面板用独立窗口，不用 overlay

**症状**：设置面板/聊天面板挡住角色。

**哪类 agent 会踩**：`frontend-dev`

**修复/预防**：用 `WebviewWindow` 创建独立窗口，不搞 overlay。

---

## 流程纪律

### F1. 改功能前先 grep 全链路

**症状**：改了 A 处，漏了 B/C/D 处，bug "修好了"但下周重现。

**哪类 agent 会踩**：全部

**修复/预防**：动手前 `grep -rn` 所有调用点，画完调用图再改。

---

### F2. "改了但没生效"先查缓存层

**排查顺序**：`.pyc` 字节码 → CDN/raw URL 缓存 → Vite HMR 缓存 → Rust 编译缓存。

**哪类 agent 会踩**：全部

**修复/预防**：不要反复加日志重跑。按顺序清缓存。

---

### F3. 用户提供的外部信息须验证

**症状**：用户说"用户名是 gaven"，实际是 gaven6666。

**哪类 agent 会踩**：全部（尤其是 `product-manager`、主会话）

**修复/预防**：仓库路径、API URL、用户名等关键配置项自己打开确认，不盲信。

### F4. TTS 管线的 `splitSentences` 会把英文 prompt 按逗号切碎

**症状**：TTS 念出英文 `[img: ...]` 图片描述词，各种 regex 清洗都挡不住。

**根因**：`splitSentences` 遇到 >100 字符无中文标点的文本时，触发 `COMMA_SPLIT` 按逗号切分。`[img: ...]` 是 300+ 字符纯英文 → 被切成碎片 → 每个碎片没了 `[...]` 外壳 → 所有清洗失效。

**排查方法**：
1. 在 LLM 输出处加 `RAW_RESPONSE` 日志看完整回复
2. 在 TTS 入口加 `[TTS] text_in/clean_out` 日志看清洗前后

**修复/预防**：
- 在 `splitSentences` 之前清除 `[img: ...]` 整行：`textBuffer.replace(/\[img:[^\]]*\]/gi, "")`
- `isTtsWorthy` 加中文检测：少于 2 个中文字直接跳过
- **关键原则：遇到管道 bug，先在首尾加日志看清数据，再改逻辑。不要调 prompt 或加 regex 护栏。**

---

## 前端陷阱

### F5. React inline style `background` 简写会打断 `@keyframes` 动画

**症状**：CSS class 渲染的动画效果正常，inline style 渲染同样的属性却不正常——动画卡顿、不同步、或看起来"不一样"。

**根因**：React inline style 中 `background` 是简写属性，每次变化（如 `"transparent"` ↔ `"linear-gradient(...)"` 切换）会重置所有 background 子属性，包括 `background-position`。如果同元素上有 `@keyframes` 动画在控制 `background-position`，动画会被打断。

**排查方法**：
1. 对比同一个效果用 CSS class 和 inline style 两种渲染方式的差异
2. 如果 class 正常 inline 不正常 → 大概率是简写属性副作用
3. 检查 inline style 中是否有简写属性（`background`/`font`/`border`/`animation`/`flex` 等）在动态切换

**修复/预防**：
- 不变的 CSS 属性放 CSS class（`<style>` 标签中定义），inline style 只保留动态属性
- 拆分简写为子属性：`background-image` + `background-size` + `background-repeat` 代替 `background`
- 受影响的简写属性列表：`background`, `font`, `border`, `margin`, `padding`, `animation`, `transition`, `flex`, `grid`

**案例**（2026-07-11）：
- 致谢画面 shimmer 效果，inline style 中 `background` 在行淡入时从 `"transparent"` 切到 `"linear-gradient(...)"`
- 同元素 CSS class 中定义了 `animation: shimmer 2s linear infinite`（移动 `background-position`）
- 每次 `background` 切换都会重置 `background-position` → 各行 shimmer 相位错乱
- 改为 CSS class `.shimmer-credits` 集中所有不变属性 → 修复
