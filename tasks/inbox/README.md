# 任务投递箱

把要交给公司机（Copilot CLI）执行的任务写成 `<任务名>.md` 放进本目录，推送到 `master`。

公司机上的 watcher 会：

1. 轮询本目录，发现新任务（幂等：`agents/<任务名>` 分支已存在则跳过）
2. 用 Copilot 执行任务文件里的指令
3. 把结果推到 `agents/<任务名>` 分支

本地拉取 `agents/<任务名>` 审计 diff，确认无误后再合入 `master`。

机制与 `sharedPRJ` 仓库里的 `watcher/README.md` 完全一致；本仓库不重复放 watcher 脚本，
公司机用同一份 `watch.py`、通过 `SHAREDPRJ_REPO` 指向本仓库即可。

## 注意

- 任务文件正文**就是**交给 Copilot 的 prompt，写清楚要它做什么。
- 别在任务文件里写任何密钥/token。
