@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  Clone the 4 sibling repos into this folder
echo  (they are SEPARATE git repos, NOT part of live-waifu)
echo ============================================================
echo.
if not exist "waifu-agent\.git"   git clone https://github.com/gavenna/waifu-agent.git waifu-agent
if not exist "danmaku-relay\.git" git clone https://github.com/gavenna/live_tool.git   danmaku-relay
if not exist "war-danmaku\.git"   git clone https://github.com/gavenna/livegame.git    war-danmaku
if not exist "war-vote\.git"      git clone https://github.com/gavenna/war-vote.git    war-vote
echo.
echo All done. (folders that already exist were skipped)
pause
