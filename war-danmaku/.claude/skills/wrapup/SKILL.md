# /wrapup — war-danmaku 项目收尾

> 继承通用 wrapup（`~/.claude/skills/wrapup/SKILL.md`），本文件只写 war-danmaku 专属规则。
> 执行时先跑通用 SKILL.md 的全部步骤，再做本文件的专属检查。

---

## 项目专属 Step: 构建 & 运行验证（不可跳过）

### A. 语法检查
```bash
node --check server/*.js
node --check server/danmaku/*.js
```

### B. 依赖安全检查（🚨 踩过坑的）
**每次 `npm uninstall` 前必须**:
```bash
grep -rn "require('被删的包')" server/ toolbox/
```
确认没有任何文件还在引用它。
> 反面案例: 2026-07-20 清理依赖时删了 `better-sqlite3`，但 `server/db.js` 还在用，导致 server 启动即崩。日志还没来得及写就挂了，用户看到"没开播"但根因是 server 没起来。

### C. 构建验证
```bash
node build.js
```
确认 exe 和安装包都能正常生成。

### D. 启动冒烟测试
```bash
dist/war-danmaku/toolbox/war-danmaku-toolbox.exe
curl http://localhost:8760/api/start
curl http://localhost:8760/api/status   # game=true, frontend=true
curl http://localhost:3000               # 返回 HTML
```

### E. 端口一致性检查
> 改端口必须同步更新: `server/config.js`、`frontend/wsClient.js`、`start.ps1`、`build.js`
```bash
grep -rn "8765\|8766\|3000\|1088\|8760" server/ toolbox/ frontend/ --include="*.js" --include="*.html" | grep -v node_modules | grep -v ".json"
```

### F. 关键文件保护
以下文件**绝不可删除或改名**，它们是运行时必需的：
- `server/db.js` — SQLite 持久化
- `server/logger.js` — 日志系统
- `server/config.js` — 全局配置
- `server/danmaku/douyin.js` — 抖音适配器
- `frontend/index.html` — 游戏画面入口

---

## 项目专属 pitfalls 更新触发

以下场景出现时，必须追加到 `.claude/rules/pitfalls.md`：

| 触发条件 | 登记项 |
|----------|--------|
| 删依赖导致崩 | 登记到 G13+：被删包名 + 哪些文件还在引用 |
| npm 装新包时覆盖了旧配置 | 登记：配置文件被覆盖的包名 |
| 改了端口但某处没同步 | 登记：遗漏的文件 |
| 构建产物中有源码泄漏 | 登记：泄漏的文件路径 |

---

## 项目专属 Memory 更新触发

以下场景出现时，必须写 Memory：

| 触发条件 | Memory 类型 |
|----------|------------|
| 用户明确说"以后注意"/"别再犯了" | `feedback` |
| 新发现的架构约束 | `project` |
| 用户偏好的工作流变化 | `user` |
