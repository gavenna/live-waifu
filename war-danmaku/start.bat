@echo off
title war-danmaku
echo ============================================
echo   war-danmaku - danmaku battle game
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Killing old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo [OK] Old processes killed

echo [2/3] Starting game server...
start "GameServer" cmd /c "cd /d %~dp0 && node server\index.js && pause"
echo [OK] Server - ws://localhost:8765

echo [3/3] Starting frontend...
start "Frontend" cmd /c "cd /d %~dp0 && npx http-server frontend -p 3000 -c-1 && pause"
echo [OK] Frontend - http://localhost:3000

timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   OPEN IN BROWSER:
echo   http://localhost:3000
echo.
echo   Simulator commands:
echo     red / blue    = join team
echo     gift knight   = spawn knight
echo     danmaku sha   = chat attack
echo     help          = all commands
echo ============================================
echo.
echo === Starting simulator ===
echo.

node server\simulator.js
