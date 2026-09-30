# war-danmaku 启动脚本
# Usage: .\start.ps1
# 一键启动: 游戏服务器 + 前端 + 弹幕中继

# 控制台切 UTF-8
chcp 65001 > $null

$root = $PSScriptRoot
Set-Location $root

Write-Host "=== war-danmaku ===" -ForegroundColor Cyan

# Kill old processes
@(8765, 3000) | ForEach-Object {
  $port = $_
  $line = netstat -ano 2>$null | Select-String ":$port " | Select-String "LISTENING"
  if ($line) {
    $p = ($line -split '\s+')[-1]
    taskkill /F /PID $p 2>$null | Out-Null
    Write-Host "[OK] Released port $port" -ForegroundColor Gray
  }
}
Start-Sleep 1

# Start game server
$serverProc = Start-Process -FilePath "node" -ArgumentList "server/index.js" -NoNewWindow -PassThru
Write-Host "[OK] Game server http://localhost:8765 (PID $($serverProc.Id))" -ForegroundColor Green

# Start frontend server
$frontendProc = Start-Process -FilePath "cmd" -ArgumentList "/c npx http-server frontend -p 3000 -c-1" -NoNewWindow -PassThru
Write-Host "[OK] Frontend http://localhost:3000 (PID $($frontendProc.Id))" -ForegroundColor Green

Write-Host ""
Write-Host "弹幕工具: 请启动 danmaku-relay (单独项目)"
Write-Host "  cd ..\danmaku-relay && .\start.bat"
Write-Host ""
Write-Host "Open http://localhost:3000 (game)" -ForegroundColor White
Write-Host "Close this window to stop all" -ForegroundColor Gray
Write-Host ""

# Wait for child processes
try {
  $serverProc.WaitForExit()
  if ($frontendProc) { $frontendProc.WaitForExit() }
}
catch {
  Write-Host "Shutting down..." -ForegroundColor Yellow
  if (!$serverProc.HasExited) { $serverProc.Kill() }
  if ($frontendProc -and !$frontendProc.HasExited) { $frontendProc.Kill() }
}
