@echo off
setlocal
set "PROJECT_DIR=%~dp0."

for %%N in (godot.exe godot4.exe) do (
    for /f "delims=" %%G in ('where %%N 2^>nul') do (
        set "GODOT=%%G"
        goto :run
    )
)

for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\GodotEngine.GodotEngine_*") do (
    for %%G in ("%%~fD\Godot*_win64.exe") do (
        if exist "%%~fG" (
            set "GODOT=%%~fG"
            goto :run
        )
    )
)

echo Godot 4.7 or newer was not found.
echo Install it with: winget install --id GodotEngine.GodotEngine -e
pause
exit /b 1

:run
"%GODOT%" --path "%PROJECT_DIR%" %*