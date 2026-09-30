# /deploy — 构建发布一条龙

构建 waifu-agent 并打包 MSI 安装包。你说"发布"/"构建"/"打包"自动触发。

## 流程

1. **TypeScript 类型检查** — `./node_modules/.bin/tsc --noEmit`
2. **Rust 编译检查** — `cd src-tauri && cargo check`（快，不完整编译）
3. **Tauri 构建** — `npx tauri build`（完整构建 + 打包 MSI）
4. **验证产物** — 检查 `src-tauri/target/release/bundle/msi/` 下的 MSI 文件

## 构建前检查

- `tauri.conf.json` 的 `beforeBuildCommand` 是 `"npm run build"`（不要加 bash 命令，cmd.exe 不认）
- `package.json` 和 `tauri.conf.json` 版本号一致
- Python `__pycache__` 已通过 `.gitignore` 排除，不需要在构建命令中清理

## 常见问题

| 症状 | 原因 | 修法 |
|------|------|------|
| `系统找不到指定的路径` | beforeBuildCommand 含 bash 命令 | 改为 `"npm run build"` |
| `resource path doesn't exist` | bundle.resources 路径问题 | 用 Directory Junction 链接 |
| `exit code 1` at beforeBuildCommand | npm run build 失败 | 先单独跑 `npm run build` 看具体错误 |

## 重要

- **不要 `cargo clean`** — 会删 `target/` 下 ~28GB 编译缓存
- **版本号** — 改版本时 `package.json` 和 `tauri.conf.json` 必须同步
- **Python embedded** — 构建产物含 Python 运行时，首次构建较慢
