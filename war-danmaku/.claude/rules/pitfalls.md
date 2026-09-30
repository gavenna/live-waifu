# 踩坑登记簿

> 只登记**机制级/环境级/流程级**经验。不登记具体代码 bug。
> 判断标准：换一个 agent 来干不同的事，会不会再踩一遍？会 → 写进来。

---

## 环境陷阱

### P1. Python `__pycache__` 缓存过时代码

**症状**：明明修了 Python 脚本的 bug，错误一模一样重现。

**根因**：Python 把 `.py` 编译成 `__pycache__/*.pyc`，改源码后可能仍用旧 `.pyc`。

**哪类 agent 会踩**：任何改 Python 脚本的

**修复/预防**：
```bash
find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
```
`.gitignore` 必须包含 `__pycache__/` 和 `*.pyc`。

---

### P2. Windows Defender 拦截编译产物

**症状**：`os error 4551` / `应用程序控制策略已阻止此文件`

**哪类 agent 会踩**：任何本地开发的 agent

**修复/预防**：Windows 安全中心 → 排除项 → 添加项目文件夹。agent 无法自动修，必须告知用户。

---

### P3. Node.js 子进程 cwd 不确定性

**症状**：`fs.readFile('./config.json')` 有时找到有时找不到。

**根因**：Node 子进程的 cwd 取决于启动方式（直接 `node` vs VS Code task vs npm script），不同启动方式 cwd 可能不同。

**哪类 agent 会踩**：任何写 Node.js 文件读写的

**修复/预防**：用 `path.resolve(__dirname, 'config.json')` 而非相对路径。或启动时 `console.log(process.cwd())` 确认。

---

## 架构约束

### A1. React StrictMode 双重挂载 → boolean flag 死锁

**症状**：async 初始化在 StrictMode 下只执行一次，第二次 mount 被 flag 拦死。

**哪类 agent 会踩**：`frontend-dev`

**修复/预防**：
```js
// ❌ 错误
if (loadingRef.current) return;
loadingRef.current = true;
await doAsync();

// ✅ 正确：generation counter
const gen = ++genRef.current;
await doAsync();
if (gen !== genRef.current) return; // 过期丢弃
```

---

### A2. 无框窗口鼠标事件必须双向拦截

**症状**：按钮点不动、点击变成拖拽窗口。

**哪类 agent 会踩**：`frontend-dev`

**修复/预防**：所有交互元素必须同时拦截 mousedown + mouseup + click。

---

### A3. 配置 partial write 会清空全部数据

**症状**：改了一个配置值，保存后其他所有配置丢失。

**哪类 agent 会踩**：`frontend-dev`、`backend-dev`

**修复/预防**：先 read 全量数据 → spread 覆盖 → write 全量数据。永远不 partial write。

---

### A4. emit 方只发事件，listener 统一持久化

**症状**：同一条数据被写两次（emit 方写一次，listener 又写一次）。

**哪类 agent 会踩**：全部

**修复/预防**：emit 方不写数据，副作用全部在 listener 中集中处理。

---

### A5. Canvas 尺寸不能写死 px

**症状**：OBS 切换分辨率后画面变形、裁剪。

**哪类 agent 会踩**：`frontend-dev`

**修复/预防**：Canvas 尺寸从 config 读取，支持 1920×1080 / 1280×720 两档。

---

### A6. WebSocket 断连不重连 → 游戏画面冻结

**症状**：server 重启后前端画面卡住不动，刷新才恢复。

**哪类 agent 会踩**：`backend-dev`、`frontend-dev`

**修复/预防**：前端 WS 客户端必须实现 exponential backoff 自动重连。server 重启期间前端显示"重连中..."。

---

### A7. 弹幕高并发 → 游戏状态竞态

**症状**：弹幕高峰期（几百条/秒）兵种生成重复、积分漏记。

**哪类 agent 会踩**：`backend-dev`

**修复/预防**：弹幕处理用队列 + 去重（同 uid 同指令 500ms 内只处理一次）。战斗计算用固定 tick rate（10tps），不随弹幕量变化。

---

### A8. 兵种配置改了但渲染不生效

**症状**：改了 `config.js` 里的兵种伤害，重启 server 后前端显示的伤害数字没变。

**根因**：兵种属性在前端 `sprites.js` 里也有一份硬编码（用于客户端预测显示）。

**哪类 agent 会踩**：`frontend-dev`、`backend-dev`

**修复/预防**：兵种属性只存 server 端 `config.js`，前端通过 WS 获取。或者如果前端需要本地副本，新增兵种/改属性时 `grep -rn` 确认没有硬编码残留。类似 waifu-agent 的 TTS 双端同步问题。

> **2026-07-19 再次验证**: 新增矛兵/弓兵/突袭兵时，在 config.js 加了定义但在 sprites.js 漏了 SPRITE_DEFS + FALLBACK_COLORS，画面无显示。confirm 了此坑的持续性。详见 [[new-troop-checklist]]。

> **2026-07-26 扩展 — 事件字段结构改动必须 grep 全部消费方**:
> 改 `pendingEvents` 事件（如 `spawn_preview`）时，只对齐了部分消费方（Announcer），漏了 `frontend/renderer.js` 的 `evt.text` 消费 → 前端显示 undefined。
> **消费方清单**: `frontend/renderer.js`（事件渲染）、`server/announcer/index.js`（话术）、`toolbox/`（面板展示）、`server/battle.js`（战斗事件）。
> **预防**: 新增/修改/删除事件字段时，逐一对齐所有消费方；同一事件类型在不同分支必须结构一致（premium 有 text 而 cheap/medium 没有 → undefined）。反面案例：gameEngine.js handleGift else 分支 spawn_preview 缺 text 字段，renderer.js:250 `⚡ ${evt.text}` 显示 undefined。

---

## 流程纪律

### F1. 改功能前先 grep 全链路

**症状**：改了 A 处，漏了 B/C/D 处，bug "修好了"但下周重现。

**哪类 agent 会踩**：全部

**修复/预防**：动手前 `grep -rn` 所有调用点，画完调用图再改。

---

### F2. "改了但没生效"先查缓存层

**排查顺序**：`.pyc` 字节码 → 浏览器缓存 → Node.js 模块缓存 → OBS 浏览器源缓存。

**哪类 agent 会踩**：全部

**修复/预防**：不要反复加日志重跑。按顺序清缓存。

---

### F3. 用户提供的外部信息须验证

**症状**：用户说"抖音礼物 ID 是 123"，实际是 456。

**哪类 agent 会踩**：全部

**修复/预防**：API URL、礼物 ID 映射、弹幕指令格式等关键配置项自己打开确认，不盲信。

---

### F4. inline style `background` 简写打断动画

**症状**：CSS animation 在 inline style 动态切换 `background` 后动画卡顿/不同步。

**根因**：`background` 是简写属性，切换时会重置 `background-position` 等子属性，打断同元素的 `@keyframes` 动画。

**修复/预防**：不变属性放 CSS class，inline style 只放动态属性。或用 `background-image` 代替 `background` 简写。

---

## 游戏专属陷阱

### G1. OBS 浏览器源缓存极其顽固

**症状**：改了前端代码，浏览器直接打开正常，OBS 里看到的还是旧画面。

**根因**：OBS 浏览器源有自己的缓存层，不完全遵循 HTTP cache-control。

**修复/预防**：
1. 前端 HTML 加 `<meta http-equiv="Cache-Control" content="no-cache">`
2. WS URL 加 query string `?t=${Date.now()}` 防缓存
3. OBS 里右键浏览器源 → 刷新

---

### G2. B站弹幕协议有 5-10 秒延迟

**症状**：发弹幕后游戏画面的反应慢了 5-10 秒。

**根因**：直播流本身就比弹幕传输快，B站 WebSocket 弹幕还有额外的缓冲延迟。

**哪类 agent 会踩**：`backend-dev`

**修复/预防**：这是正常的，不要试图消除延迟。设计上注意：反馈时机写"送礼/弹幕后**立即在画面预告**（'XXX 正在召唤巨龙...'），实际兵种 1-2 秒后出现"。不要让观众觉得"没反应"。

---

### G3. 弹幕采样频率不能太高

**症状**：弹幕滚动区刷屏太快，完全看不清。

**哪类 agent 会踩**：`frontend-dev`

**修复/预防**：弹幕滚动最多同时显示 5 条，每条停留 3 秒。多余弹幕排队或丢弃。不追求"显示所有弹幕"，追求"显示代表弹幕"。

---

### G4. AI 生成精灵图无 Alpha 通道

**症状**：AI API 生成的 PNG 全是 RGB 模式，角色周围是白底/杂色方块，挡住背景。

**根因**：几乎所有文生图 API（包括 agnes-image-2.1-flash）都不支持原生透明 PNG 输出。

**修复/预防**：
1. AI 生成 → `frontend/assets/sprites/`
2. `python server/fix-sprites-rembg.py`（U²-Net 语义分割去背景）
3. **不要裁切**（裁切改变画布尺寸，渲染锚点会偏移）

**哪类 agent 会踩**：任何处理精灵图的

---

### G5. 前端端口混淆（8765 ≠ 3000）

**症状**：用户报告"改了前端但画面没变化"、"图片看起来不对"。

**根因**：`localhost:8765` 是 WebSocket 游戏服务器（不提供前端页面），`localhost:3000` 才是前端静态文件服务器。用户在 8765 看到的是浏览器缓存的旧页面或服务器的基础 HTTP 响应。

**修复/预防**：始终确认用户在 `localhost:3000` 查看游戏画面。8765 只处理 WebSocket 连接和游戏逻辑。

---

### G6. 图生图 API 不保持角色一致性

**症状**：以现有精灵图为输入，img2img 生成的"同角色不同姿态"图片，颜色、比例、细节全变了。

**根因**：`agnes-image-2.0-flash` 把输入图当作"风格参考"而非"像素锚点"。同厂商文生图模型也不支持。

**哪类 agent 会踩**：`artist`、任何想用 AI 生成动画帧的

**修复/预防**：
1. 当前 API 做不到角色一致性 → 程序化动画是唯一可行路线
2. 两个模型都输出 RGB 无 Alpha，如需透明必须 rembg
3. API 忽略 `size` 参数，始终返回 1024²

---

### G7. ctx.restore() 放错位置 → UI 元素随动画乱飞

---

### G9. 双服务器架构不能随意合并

**症状**：改了 package.json 或端口配置后，前端画面丢失、资源 404、用户骂人。

**根因**：项目有两套服务器——游戏服务器（8765，Node.js，serve frontend/ + assets/）和前端开发服务器（3000，http-server，仅 serve frontend/）。start.ps1 启前者，npm run frontend 启后者。两者 serve 路径不同（8765 的 `/assets/` → `assets/`，3000 的 `/assets/` → `frontend/assets/`）。用户习惯用哪个就哪个，绝不改用户工作流。

**哪类 agent 会踩**：任何改 package.json、端口配置、start.ps1 的

**修复/预防**：
1. 绝不在不通知用户的情况下改 npm scripts 或启动脚本
2. 新增资源文件（如音频）需确认在两个服务器路径下都能访问，或统一放 `frontend/` 下
3. start.ps1 是用户唯一入口，改动前必须确认

---

### G8. `const` 声明在普通 `<script>` 之间冲突

**症状**：页面全黑/白屏，Console 报 `Uncaught SyntaxError: Identifier 'X' has already been declared`。

**根因**：多个普通 `<script>`（非 `type="module"`）共享全局作用域，两个文件都声明 `const W = 1920` 就会冲突。`node --check` 单文件检查不出来。

**哪类 agent 会踩**：任何在多个前端 JS 文件中定义变量的

**修复/预防**：
1. 用 `var` 替代顶层 `const`（允许重复声明）
2. 或用不同变量名（如 `_W`、`_H`）
3. 或包装 IIFE `(function() { ... })()`
4. 或加 `type="module"` 到 `<script>` 标签（但需改所有 `window.xxx` 为 `export`）

**排查方式**：浏览器 F12 → Console 看第一行报错，通常是 `renderer.js:1` 这类"还没进去就死了"的位置。

**症状**：兵种主人名字飞到屏幕角落上下跳动。

**根因**：`ctx.restore()` 写在 HP 条和名字绘制之后，UI 元素受 drawWithAnim() 内的 translate/scale/rotate 污染。

**修复/预防**：`ctx.restore()` 紧跟在 drawImage 之后、UI 元素之前。动画 transform 和 UI 渲染用 save/restore 隔离。

---

### G10. Windows PowerShell + Pino → 中文乱码

**症状**：Node.js 进程的 Pino 日志中文显示为乱码（如 `鍙亣AI`），但 Python 进程的日志中文正常。

**根因**：Windows PowerShell 控制台默认代码页是 GBK (936)。Pino/pino-pretty 强制输出 UTF-8 字节流，终端用 GBK 解码 → 乱码。Python `logging` 用系统代码页输出，所以正常。

**哪类 agent 会踩**：任何在 Windows 上配置 Pino 日志的

**修复/预防**：
1. `start.ps1` 开头加 `chcp 65001 > $null` — 把控制台切到 UTF-8
2. 不要让 Pino 输出到 GBK 终端再 redirect 到文件 — 用 `pino/file` transport 直接写文件
3. 验证方式：日志中出现 `[INFO]` 而非 `[32mINFO[39m` 且中文可读

---

### G11. 正则批量迁移 logger 调用 → 模板字符串/相邻字符串断裂

**症状**：`node --check` 报 `SyntaxError: missing ) after argument list` 或 `Invalid or unexpected token`，行内出现两个相邻的单引号字符串（如 `'[TAG] '文字'`）或截断行。

**根因**：用正则 `s.replace(/logger\.(\w+)\('([A-Z]+)',\s*/g, 'logger.$1(\'[$2] ')` 迁移 logger 调用时，只处理了 tag 部分，没有正确处理原消息参数的类型：
- 原始 `logger.info('TAG', 'plain msg')` → 正则产生 `logger.info('[TAG] 'plain msg')` — 两个相邻单引号字符串，无操作符
- 原始 `logger.info('TAG', \`template\`)` → 正则产生 `logger.info('[TAG] \`template\`)` — 字符串 + 模板字面量相邻
- 原始 `logger.info('TAG', variable)` → 正则产生 `logger.info('[TAG] variable)` — 变量引用被当作独立标识符

**哪类 agent 会踩**：任何做批量代码迁移的

**修复/预防**：
1. 不要用正则批量改 logger 调用 — 逐文件手工改，每个调用确认参数类型
2. 改完后必须 `node --check` 逐个文件验证
3. 优先改 template literal 版本（`\`[TAG] msg\``），它兼容变量和纯文本
4. 用 `grep` 找出所有 `logger.` 行，确认没有两个相邻单引号字符串

---

### G12. douyinLive 部分直播间需要登录态 Cookie

**症状**：douyinLive 连接后 5-7 秒断连，日志显示 `ROOM_CHECK_FAILED` / `status_code=4003034`。但公开大直播间（如 README 示例房间号）不需要 cookie 也能正常连接。

**根因**：个人/小型直播间调用 Douyin web/enter API 需要登录态。`document.cookie` 拿不到 `sessionid`（HttpOnly），必须在浏览器 F12 → Network → Request Headers 复制完整 Cookie 头。

**哪类 agent 会踩**：任何配置 douyinLive 的

**修复/预防**：
1. 先不用 cookie 试公开直播间 → 确认 douyinLive 本身可用
2. 如果报 4003034 → 需要 Cookie：F12 → Network → 找请求 → 复制 Cookie 整行
3. 关键 cookie：`sessionid`、`sid_guard`、`ttwid`（缺一不可）
4. `document.cookie` 不包含 HttpOnly cookie → 不要用 Console 方式提取

---

### G13. `@dycast/core` DyCast 类不能在 Node.js 直接使用

**症状**：Node.js 中 `require('@dycast/core')` 后调用 `new DyCast()` 报 `ReferenceError: location is not defined`。

**根因**：`DyCast` 类的 `BASE_URL` 使用了 `location.origin`（浏览器 API），WebSocket 使用浏览器原生 `WebSocket`。`@dycast/core` 的 `server-only` 导出仅包含代理服务器 `DyCastServer`。

**哪类 agent 会踩**：任何想在 Node.js 后端用 `@dycast/core` 直连抖音的

**修复/预防**：
1. 后端方案用 douyinLive (Go 编译的独立代理)，不要用 `@dycast/core`
2. `@dycast/core` 适合浏览器端场景（Vue/React 前端通过 DyCastServer 代理连接）
3. 如果非要用 `@dycast/core` 的工具函数（`getLiveInfo`、`getSignature`、各种 `decode*`），可单独导入，但需自建 WebSocket 连接层

---

### G14. 清理依赖前必须 grep 全量引用

**症状**：删了一个"看起来没用"的 npm 包，server 启动即崩，日志还没写就挂了。

**根因**：`npm ls | grep <包名>` 不准确（只检查 package.json 的依赖声明），实际代码可能有 `require('<包名>')`。

**修复/预防**：
```bash
# 删包前必须跑
grep -rn "require('<包名>')" server/ toolbox/ --include="*.js"
```
> 反面案例：2026-07-20 清理依赖时删除 `better-sqlite3`，但 `server/db.js` 还在用。server 启动即崩，用户看到"没开播"但根因是 server 没起来。

---

### G15. SEA 打包后 `__dirname` 语义变化

**症状**：源码能跑，SEA exe 找不到文件。路径偏移到诡异的上级目录。

**根因**：Node.js SEA 模式下，`__dirname` = exe 所在目录（项目根），而非普通模式下的 `server/` 子目录。`path.resolve(__dirname, '..')` 会偏移到项目根之上。

**修复/预防**：
```js
// 通用写法（兼容普通 + SEA）
const baseDir = __dirname.endsWith('server') ? path.resolve(__dirname, '..') : __dirname;
```
对于 `server/danmaku/` 下的文件：
```js
const baseDir = __dirname.endsWith(`server${path.sep}danmaku`) ? path.resolve(__dirname, '..', '..') : __dirname;
```
> **不要**用 `endsWith('danmaku')`——项目名也可能包含这个词。

---

### G16. 改代码后旧进程残留 → 新代码不生效

**症状**：改了 `server/index.js`，启动 `node server/index.js` 报 `EADDRINUSE`，但 `curl` 各端口返回的还是旧代码的响应。日志内容也是旧版本的。

**根因**：之前的 Node.js 进程还在后台跑着，占用端口。新进程无法启动，所有 API 请求打到旧进程上。

**哪类 agent 会踩**：全部

**修复/预防**：
1. 改代码后第一步：`netstat -ano | grep ":8765" | grep LISTENING` 拿到 PID
2. Git Bash 下用 `cmd //c "taskkill //F //PID <pid>"` 杀进程（双斜杠防 Bash 路径转换）
3. 确认端口释放后再启新 server
4. 考虑写 `npm run kill` 脚本：`for pid in $(netstat -ano | grep ":8765" | grep LISTENING | awk '{print $5}'); do cmd //c "taskkill //F //PID $pid" 2>nul; done`

> 反面案例：2026-07-21 整个会话中至少 5 次因旧进程残留导致测试结果混乱，每次都要手动 kill 再重启。

---

### G17. observer/pushState 条件绑定 → 状态切换不可见

**症状**：Announcer 收不到 COUNTDOWN 开始、PLAYING 开始、ROUND_END 等阶段切换事件。WAITING 阶段的 opening 消息从来不播。只有伴随事件的 pushState（如战斗 tick）才能通知到 Announcer。

**根因**：observer 通知条件写成了 `if (this.pendingEvents.length > 0 && this.eventListeners.length > 0)`。纯状态切换（COUNTDOWN→PLAYING 等）时 pendingEvents 为空，observer 不触发。

**哪类 agent 会踩**：任何实现 observer/pub-sub 模式的

**修复/预防**：observer 通知**不绑定业务数据条件**。`pushState` / `emit` 本身就应该触发通知，不管有没有附带数据。空事件数组也是有效通知（状态变了）。

> 反面案例：2026-07-23 Announcer 集成，COUNTDOWN/PLAYING 开始全部静默，debug 一天才发现是 pushState 条件过滤掉了。

> 反面案例：2026-07-21 整个会话中至少 5 次因旧进程残留导致测试结果混乱，每次都要手动 kill 再重启。
