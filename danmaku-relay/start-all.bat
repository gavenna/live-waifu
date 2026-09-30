@echo off
echo === danmaku-relay one-click start ===
echo Starting service + adapters + control panel
echo.
cd /d "%~dp0"
start "" node index.js --auto-start
ping 127.0.0.1 -n 3 >nul
REM open all panels: control + battle + leaderboard (OBS browser source)
start "" http://localhost:8767/battle.html
start "" http://localhost:8767/leaderboard.html
start "" http://localhost:8767
echo.
echo Danmaku relay  : ws://localhost:8766
echo Control panel  : http://localhost:8767                     (auto-opened)
echo Battle panel   : http://localhost:8767/battle.html         (auto-opened)
echo Leaderboard    : http://localhost:8767/leaderboard.html    (auto-opened, OBS source)
echo Adapters       : started automatically (logs in service window)
echo Closing this window will NOT stop the service.
echo.
ping 127.0.0.1 -n 4 >nul
