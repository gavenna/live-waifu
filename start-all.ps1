# live-waifu 统一启动器
# 用法:
#   .\start-all.ps1            交互式菜单
#   .\start-all.ps1 -All       一键启动完整直播链路 (relay + game + vote + waifu)
#   .\start-all.ps1 -Relay     只启动弹幕中继
#   .\start-all.ps1 -Game      只启动游戏服务端 + 前端画面
#   .\start-all.ps1 -Vote      只启动 war-vote 摆阵投票
#   .\start-all.ps1 -Waifu     只启动 waifu-agent 桌宠 (tauri dev)
#   .\start-all.ps1 -Stop      关闭全部组件并释放端口
#
# 若提示执行策略限制: powershell -ExecutionPolicy Bypass -File .\start-all.ps1

param(
  [switch]$All,
  [switch]$Relay,
  [switch]$Game,
  [switch]$Vote,
  [switch]$Waifu,
  [switch]$Stop
)

chcp 65001 > $null
$ErrorActionPreference = 'SilentlyContinue'

$root        = $PSScriptRoot
$relayDir    = Join-Path $root 'danmaku-relay'
$gameDir     = Join-Path $root 'war-danmaku'
$voteDir     = Join-Path $root 'war-vote'
$waifuDir    = Join-Path $root 'waifu-agent'

# 组件端口
$PORTS_RELAY = 8766, 8767, 1088
$PORTS_GAME  = 8765, 3000, 8760
$PORTS_VOTE  = 8768, 3001
$PORTS_WAIFU = 1420, 9191

function Release-Ports([int[]]$ports) {
  foreach ($port in $ports) {
    $lines = netstat -ano | Select-String ":$port\s" | Select-String 'LISTENING'
    foreach ($line in $lines) {
      $ownerPid = ($line -split '\s+')[-1].Trim()
      if ($ownerPid -match '^\d+$' -and $ownerPid -ne '0' -and $ownerPid -ne $PID) {
        taskkill /F /PID $ownerPid 2>$null | Out-Null
        Write-Host "  [OK] 释放端口 $port (PID $ownerPid)" -ForegroundColor Gray
      }
    }
  }
}

function Start-Relay {
  Write-Host "`n[1/4] 启动 danmaku-relay (WS :8766 / 面板 :8767)..." -ForegroundColor Cyan
  Start-Process cmd -WorkingDirectory $relayDir -ArgumentList '/k', 'chcp 65001 >nul && title danmaku-relay && node index.js'
  Write-Host '  控制面板: http://localhost:8767 (在面板里启停 B站/抖音适配器)' -ForegroundColor Green
}

function Start-Game {
  Write-Host "`n[2/4] 启动 war-danmaku 游戏服务端 (:8765 + :3000 画面 + :8760 工具箱)..." -ForegroundColor Cyan
  # node server/index.js 单进程同时监听 8765/3000/8760，勿再单独起 http-server (会抢 3000)
  Start-Process cmd -WorkingDirectory $gameDir -ArgumentList '/k', 'chcp 65001 >nul && title war-danmaku-server && node server/index.js'
  Write-Host '  OBS 浏览器源 / 调试: http://localhost:3000' -ForegroundColor Green
  Write-Host '  游戏工具箱: http://localhost:8760' -ForegroundColor Green
}

function Start-Vote {
  Write-Host "`n[3/4] 启动 war-vote 摆阵投票 (:8768 面板 + :3001 画面)..." -ForegroundColor Cyan
  Start-Process cmd -WorkingDirectory $voteDir -ArgumentList '/k', 'chcp 65001 >nul && title war-vote && node server/index.js'
  Write-Host '  直播画面: http://localhost:3001 (OBS 浏览器源)' -ForegroundColor Green
  Write-Host '  控制面板: http://localhost:8768 (开始投票 / 锁定 / 重置)' -ForegroundColor Green
}

function Start-Waifu {
  Write-Host "`n[4/4] 启动 waifu-agent 桌宠 (Tauri dev, 首次编译较慢; WS 中继 :9191)..." -ForegroundColor Cyan
  Start-Process cmd -WorkingDirectory $waifuDir -ArgumentList '/k', 'chcp 65001 >nul && title waifu-agent-dev && npm run tauri:dev'
}

function Stop-All {
  Write-Host "`n=== 关闭全部组件 ===" -ForegroundColor Yellow
  Write-Host '释放端口...'
  Release-Ports ($PORTS_RELAY + $PORTS_GAME + $PORTS_VOTE + $PORTS_WAIFU | Select-Object -Unique)
  Stop-Process -Name douyinLive -ErrorAction SilentlyContinue
  Stop-Process -Name waifu-agent -ErrorAction SilentlyContinue
  Write-Host '[OK] 已发送关闭信号 (各组件窗口可手动关闭)' -ForegroundColor Green
}

function Show-Menu {
  Write-Host ''
  Write-Host '============================================' -ForegroundColor Cyan
  Write-Host '   live-waifu 直播互动套件 - 启动菜单' -ForegroundColor Cyan
  Write-Host '============================================' -ForegroundColor Cyan
  Write-Host '  1 = 弹幕中继 danmaku-relay (:8766/:8767)'
  Write-Host '  2 = 战争弹幕游戏 war-danmaku (:8765+:3000)'
  Write-Host '  3 = 摆阵投票 war-vote (:8768+:3001)'
  Write-Host '  4 = waifu-agent 桌宠 (Tauri dev)'
  Write-Host '  5 = 全部启动 (完整链路, 推荐直播顺序)'
  Write-Host '  6 = 关闭全部 + 释放端口'
  Write-Host '  0 = 退出'
  Write-Host '============================================'
}

if ($Stop) { Stop-All; exit 0 }

if ($All)  { Release-Ports ($PORTS_RELAY + $PORTS_GAME + $PORTS_VOTE + $PORTS_WAIFU | Select-Object -Unique); Start-Relay; Start-Sleep 2; Start-Game; Start-Vote; Start-Waifu; exit 0 }
if ($Relay -or $Game -or $Vote -or $Waifu) {
  if ($Relay) { Release-Ports $PORTS_RELAY; Start-Relay }
  if ($Game)  { Release-Ports $PORTS_GAME; Start-Game }
  if ($Vote)  { Release-Ports $PORTS_VOTE; Start-Vote }
  if ($Waifu) { Release-Ports $PORTS_WAIFU; Start-Waifu }
  exit 0
}

while ($true) {
  Show-Menu
  $choice = Read-Host '请选择'
  switch ($choice.Trim()) {
    '1' { Release-Ports $PORTS_RELAY; Start-Relay }
    '2' { Release-Ports $PORTS_GAME; Start-Game }
    '3' { Release-Ports $PORTS_VOTE; Start-Vote }
    '4' { Release-Ports $PORTS_WAIFU; Start-Waifu }
    '5' { Release-Ports ($PORTS_RELAY + $PORTS_GAME + $PORTS_VOTE + $PORTS_WAIFU | Select-Object -Unique); Start-Relay; Start-Sleep 2; Start-Game; Start-Vote; Start-Waifu }
    '6' { Stop-All }
    '0' { exit 0 }
    default { Write-Host '无效选项' -ForegroundColor Red }
  }
  Start-Sleep 1
}
