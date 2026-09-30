@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  Clone the 4 sibling repos into this folder
echo  (they are SEPARATE git repos, not part of live-waifu)
echo ============================================================
echo.

call :pull "waifu-agent"  "https://github.com/gavenna/waifu-agent.git"
call :pull "danmaku-relay" "https://github.com/gavenna/live_tool.git"
call :pull "war-danmaku"  "https://github.com/gavenna/livegame.git"
call :pull "war-vote"     "https://github.com/gavenna/war-vote.git"

echo.
echo ============================================================
echo  All done.
echo ============================================================
pause
exit /b 0

:pull
setlocal
set NAME=%~1
set URL=%~2
if exist "%~1\.git" (
    echo [update] %NAME%
    git -C "%NAME%" pull --ff-only
) else (
    echo [clone]  %NAME%  ^<- %URL%
    git clone "%URL%" "%NAME%"
)
endlocal
exit /b 0
