@echo off
set "GAME_DIR=D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15"
set "PATH=%GAME_DIR%;%PATH%"
cd /d "%GAME_DIR%"
"jvm\bin\java.exe" -Djava.net.preferIPv4Stack=true -Xmx1000M -Dfile.encoding=UTF-8 -Djava.library.path=. -cp "game-lib.jar;libs/*" com.corrodinggames.rts.java.Main -debug 9999:autostart -log lastrun.log