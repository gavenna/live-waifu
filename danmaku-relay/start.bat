@echo off
echo === danmaku-relay ===
echo Starting danmaku relay service
echo.
cd /d "%~dp0"
start "" "danmaku-relay.exe"
echo.
echo Danmaku relay: ws://localhost:8766
echo Control panel: http://localhost:8767
echo Closing this window will NOT stop the service.
echo.
ping 127.0.0.1 -n 4 >nul
