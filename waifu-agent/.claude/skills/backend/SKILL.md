---
name: backend
description: >
  Rust 后端开发、Tauri 命令、系统集成。改 lib.rs / auth.rs / llm_client.rs 等 Rust 文件时自动触发。
  用法: /backend 我要加一个读取文件的新 Tauri command
---

# Rust 后端开发指南

> 改 Rust 代码前先看这里。踩坑登记簿: `.claude/rules/pitfalls.md`

## 核心文件

| 文件 | 职责 |
|------|------|
| `src-tauri/src/lib.rs` | Tauri commands 注册 + invoke_handler |
| `src-tauri/src/auth.rs` | 许可验证 |
| `src-tauri/src/llm_client.rs` | LLM API 客户端 |
| `src-tauri/src/edge_tts.rs` | Edge TTS |
| `src-tauri/src/stt.rs` | 语音识别 |
| `src-tauri/tauri.conf.json` | 窗口/构建配置 |
| `src-tauri/capabilities/default.json` | 窗口/事件权限 |

## 铁律

### 路径：app_data_dir() 是唯一合法的运行时数据根目录

打包后 `CARGO_MANIFEST_DIR` 指向开发机路径，`home_dir()` 已废弃。

| 数据类型 | 怎么访问 |
|----------|---------|
| 静态资产（随代码不变） | `include_str!("../../SOUL.md")` |
| 用户数据（运行时产生） | `app.path().app_data_dir().join("subdir")` |
| 临时数据（进程内） | `std::env::temp_dir()` |

```rust
// ✅ 正确
let data_dir = app.path().app_data_dir()?;

// ❌ 错误
env!("CARGO_MANIFEST_DIR")    // 打包后失效
home_dir().join(".waifu-agent") // 已废弃
```

改完后: `grep -rn "CARGO_MANIFEST_DIR\|home_dir" src-tauri/`

### cargo clean 禁令

`src-tauri/target/` 含编译缓存 + MSI/EXE 约 28GB。`cargo clean` 全部丢失，重建需数小时。

替代方案: `cargo check` → crate 缓存损坏 → 删 `~/.cargo/registry/cache/` 对应目录。

### 新增 Tauri command 的步骤

1. 在 `lib.rs` 中实现 `#[tauri::command] async fn xxx()`
2. 在 `invoke_handler![]` 宏中注册
3. 如果用到了新窗口/事件权限 → 更新 `capabilities/default.json`
4. 前端调用点: `invoke("xxx", { ... })` — grep 确保没遗漏

### save_settings 必须合并而非覆盖

```rust
// ✅ 正确：和已有文件合并
let existing = std::fs::read_to_string(&p).ok()
    .and_then(|s| serde_json::from_str(&s).ok())
    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
let merged = /* shallow merge */;

// ❌ 错误：直接覆盖 → 清空用户所有设置
std::fs::write(&p, serde_json::to_string_pretty(&settings)?)?;
```

### 通用规则

- **改功能前 grep 全链路** — `grep -rn` 所有调用点再动手
- **错误不能静默吞掉** — 不能 `unwrap_or_default()`、`match Err(_) => {}`
- **方案改动先陈明利弊** — 别直接动手

## 改完代码后

> tsc + cargo check 由 hook 自动执行（Stop hook 不通过不准结束）。以下检查 hook 覆盖不到：

1. **新增/修改 Tauri command** — grep 前端调用点确认 invoke 参数名一致，确认 `capabilities/default.json` 已更新
2. **涉及 TTS/贴图** — 确认 Rust+TS 双端文本清洗函数已同步更新
3. **涉及设置持久化** — 确认做了合并而非覆盖（grep `save_settings` 所有调用点）
4. **涉及数据流** — 确认新日志的 tag 在 `logConfig.ts` 的 `LOG_SWITCH` 里

### 🚨 管道调试铁律

涉及文本处理管线（TTS/LLM/贴图/清洗）的新功能或改动，**必须先加两端日志再看效果**：

```rust
// 入口：看原始输入
log_debug(&format!("[xxx] RAW: {}", input.chars().take(200).collect::<String>()));

// 出口：看清洗结果
log_debug(&format!("[xxx] CLEAN: in={} out={}", input.len(), output.len()));
```

**不要**：改完代码 → 让用户测试 → 不行再改 → 再测。这是最慢的路径。
**要**：加日志 → 看数据 → 定位断点 → 一次修对。

> 如果改动了对外接口（前端 invoke 的新 command / 修改了返回值格式），在回复中告诉用户：改了什么、前端要怎么对应。
