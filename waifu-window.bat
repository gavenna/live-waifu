@echo off
REM launched by start-all.ps1 in its own window
REM keep ALL text ASCII - cmd misreads UTF-8 CJK in .bat bodies
REM /k comes from the caller so an interactive shell survives after npm exits
chcp 65001 >nul
title [WAIFU-AGENT] running - tauri dev
cd /d "%~dp0waifu-agent"
REM the tauri CLI replaces the title above with an npm banner; start-all.ps1 runs a
REM detached guard process that re-applies [WAIFU-AGENT] from outside while it runs.
npx tauri dev
REM npm leaves its banner behind after it exits - restore the title for the prompt
title [WAIFU-AGENT] running - tauri dev
echo.
echo ============================================
echo   waifu-agent has stopped.
echo   Re-run start-all.ps1  -Waifu  to start again.
echo ============================================
echo.
