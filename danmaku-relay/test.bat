@echo off
echo === danmaku-relay one-click test ===
echo Simulator - adapter - relay - subscriber, full chain auto verify
echo.
cd /d "%~dp0"
node test.js
echo.
pause
