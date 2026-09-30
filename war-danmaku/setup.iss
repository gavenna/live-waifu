; war-danmaku 安装包 — Inno Setup 脚本
; 用法: iscc setup.iss

[Setup]
AppName=war-danmaku
AppVersion=1.0
AppPublisher=war-danmaku
DefaultDirName={autopf}\war-danmaku
DefaultGroupName=war-danmaku
OutputDir=dist
OutputBaseFilename=war-danmaku-setup-v1.0
Compression=lzma2/ultra64
SolidCompression=yes
Uninstallable=yes
WizardStyle=modern
DisableProgramGroupPage=yes
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "dist\war-danmaku\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\data"
Name: "{app}\server\logs"

[Icons]
Name: "{group}\war-danmaku"; Filename: "{app}\war-danmaku.exe"; WorkingDir: "{app}"
Name: "{group}\卸载 war-danmaku"; Filename: "{uninstallexe}"
Name: "{commondesktop}\war-danmaku"; Filename: "{app}\war-danmaku.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\war-danmaku.exe"; Description: "启动 war-danmaku"; Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
Filename: "taskkill"; Parameters: "/F /IM war-danmaku.exe"; Flags: runhidden skipifdoesntexist
