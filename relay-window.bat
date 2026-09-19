@echo off
REM launched by start-all.ps1 in its own window
REM keep ALL text ASCII - cmd misreads UTF-8 CJK in .bat bodies
REM /k comes from the caller; this script must NOT exit the shell, so it
REM falls through to an interactive prompt after node stops.
REM the caller passes no /k title, so the title is set here as the FIRST command:
REM `title` runs before node starts and nothing in this window overwrites it later.
title [DANMAKU-RELAY] running - do not close
chcp 65001 >nul
cd /d "%~dp0danmaku-relay"

REM Engine-economy: danmaku spawns deduct the team's REAL in-game credits.
REM RW_ECON_ENABLED=1 turns it on; set 0 for free spawning (byte-identical to before).
REM Balance/income are read live from <game>\econ_live.txt (written by the injected EconBridge).
set RW_ECON_ENABLED=1

echo Starting danmaku-relay...
node index.js --auto-start
echo.
echo ============================================
echo   danmaku-relay has stopped.
echo   Ports 8766/8767 are now free.
echo   Re-run start-all.ps1  -Relay  to start again.
echo ============================================
echo.
