@echo off
title waifu-auth Server
cd /d "%~dp0"
echo Starting waifu-auth on http://localhost:3456/api/
npx tsx server.ts
pause
