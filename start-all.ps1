# live-waifu launcher - every component can be started independently with its own window
#
# Usage:
#   .\start-all.ps1              interactive menu
#   .\start-all.ps1 -All         start everything
#   .\start-all.ps1 -Relay       danmaku-relay only
#   .\start-all.ps1 -Waifu       waifu-agent only
#   .\start-all.ps1 -Companion   douyin live companion only
#   .\start-all.ps1 -Stop        stop everything and release ports
#
# If blocked by execution policy:
#   powershell -ExecutionPolicy Bypass -File .\start-all.ps1

param(
  [switch]$All,
  [switch]$Relay,
  [switch]$Waifu,
  [switch]$Companion,
  [switch]$Stop,
  [switch]$Status,
  [switch]$DryRun
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root     = $PSScriptRoot
$relayDir = Join-Path $root 'danmaku-relay'
$waifuDir = Join-Path $root 'waifu-agent'

# component ports
$PORTS_RELAY = 8766, 8767, 1088
$PORTS_WAIFU = 1420, 9191

# douyin live companion
$COMPANION = 'D:\tools\webcast_mate\12.9.3.475022132\直播伴侣.exe'

# ---------------------------------------------------------------- identity gate
# ⚠️ Both force-kill paths below used to trust *indirect* evidence:
#     - Release-Ports trusted a netstat PID (PIDs get recycled)
#     - Stop-All trusted a window TITLE (any process can own a window)
# On 2026-09-16 that killed explorer.exe -> no desktop, no taskbar, no start menu
# (no crash log: it was terminated, not a crash). Never kill without checking the
# process image name first.
$PROTECTED = @(
  # shell / session infrastructure - killing any of these bricks the desktop
  'explorer', 'winlogon', 'csrss', 'dwm', 'wininit', 'services', 'lsass',
  'smss', 'System', 'Registry', 'sihost', 'taskhostw', 'fontdrvhost',
  'StartMenuExperienceHost', 'SearchHost', 'ShellExperienceHost',
  'RuntimeBroker', 'TextInputHost', 'ctfmon', 'dllhost', 'WmiPrvSE',
  # the agent host itself
  'hermes-agent-cn-desktop', 'hermes-agent-cn-runtime-win32-x64',
  # AV
  'MsMpEng', 'NisSrv', 'SecurityHealthSystray'
)
# the only processes a launcher stop is ever allowed to force-kill
$KILLABLE = @('node', 'douyinLive', 'javaw', 'cmd', 'conhost',
              'waifu-agent', 'cargo', 'rustc', 'npm')

function Test-Killable([int]$procId) {
  $name = $null
  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
  if (-not $name) { return $false }
  if ($PROTECTED -contains $name) {
    Write-Host ("  [SKIP] PID {0} is a PROTECTED process ({1}) - refusing to kill" -f $procId, $name) -ForegroundColor Red
    return $false
  }
  if ($KILLABLE -notcontains $name) {
    Write-Host ("  [SKIP] PID {0} ({1}) is not a launcher component - refusing to kill" -f $procId, $name) -ForegroundColor Red
    return $false
  }
  return $true
}

# ---------------------------------------------------------------- dry run
# `-Stop` used to terminate explorer.exe (2026-09-16) and the exact path could not
# be proven afterwards. -DryRun exists so a stop can be PREVIEWED: it lists every
# process the stop logic would kill, with image name and command line, and kills
# nothing. Use it before any unattended stop.
function Show-WouldKill([int]$procId, [string]$why) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $p) { return }
  $cmd = ''
  try {
    $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($ci -and $ci.CommandLine) { $cmd = $ci.CommandLine }
  } catch { }
  if ($cmd.Length -gt 100) { $cmd = $cmd.Substring(0, 100) + '...' }
  $flag = 'KILL'
  if ($PROTECTED -contains $p.ProcessName) { $flag = 'SKIP(PROTECTED)' }
  elseif ($KILLABLE -notcontains $p.ProcessName) { $flag = 'SKIP(not-ours)' }
  Write-Host ("    [{0,-16}] PID {1,-7} {2,-22} ({3}) {4}" -f $flag, $procId, $p.ProcessName, $why, $cmd)
}

function Release-Ports([int[]]$ports) {
  foreach ($port in $ports) {
    $lines = netstat -ano | Select-String ":$port\s" | Select-String 'LISTENING'
    foreach ($line in $lines) {
      $ownerPid = ($line -split '\s+')[-1].Trim()
      if ($ownerPid -match '^\d+$' -and $ownerPid -ne '0' -and $ownerPid -ne $PID) {
        # the PID came from a netstat snapshot and may already have been recycled
        if ($DryRun) {
          Show-WouldKill ([int]$ownerPid) ("port $port owner")
        }
        elseif (Test-Killable ([int]$ownerPid)) {
          taskkill /F /PID $ownerPid 2>$null | Out-Null
          Write-Host "  [OK] released port $port (PID $ownerPid)" -ForegroundColor Gray
        }
      }
    }
  }
}

function Test-Port([int]$port) {
  $l = netstat -ano | Select-String ":$port\s" | Select-String 'LISTENING'
  return [bool]$l
}

function Wait-Http([string]$url, [int]$tries = 30) {
  for ($i = 0; $i -lt $tries; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 900
  }
  return $false
}

# ---------------------------------------------------------------- title guard
# `npx tauri dev` (and `npm run`) overwrite the console title with an npm banner a
# few seconds after launch, so the `title` line inside the .bat is not enough.
# `Start-Job` cannot repair it either: the job is destroyed when this script exits,
# so the rename silently never happens.
#
# The guard below is therefore a DETACHED powershell process (a real child process,
# not a job). It is launched *before* the window exists, polls from outside and
# re-applies the title until the component window is closed.
#
# It only ever touches a window whose owning PID is
#   (a) the cmd.exe we started,
#   (b) one of that cmd.exe's direct children (conhost.exe owns the console window
#       - cmd.exe itself usually has no window handle), or
#   (c) a process whose OWN command line contains the component .bat name.
# This powershell / the launcher window can never match, so renaming the user's own
# terminal by accident is impossible (that happened with a plain title match).
$TITLE_GUARD = @'
$ErrorActionPreference = 'SilentlyContinue'

$want   = '@@WANT@@'
$marker = '@@MARKER@@'
$bat    = '@@BAT@@'
$tpid   = @@TPID@@
$log    = Join-Path $env:TEMP ('live-waifu-title-' + $tpid + '.log')

function Say([string]$m) {
  try { Add-Content -Path $log -Value ((Get-Date).ToString('HH:mm:ss') + ' ' + $m) -Encoding UTF8 } catch { }
}

Say 'guard started, target pid @@TPID@@'

try {
  Add-Type -Namespace LWTitle -Name W -MemberDefinition @"
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowTextW(IntPtr h, string s);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
public static int Retitle(int[] pids, string want, string marker) {
  int n = 0;
  EnumWindows(delegate(IntPtr h, IntPtr l) {
    if (!IsWindowVisible(h)) { return true; }
    uint wp;
    GetWindowThreadProcessId(h, out wp);
    bool hit = false;
    for (int i = 0; i < pids.Length; i++) { if ((uint)pids[i] == wp) { hit = true; break; } }
    if (!hit) { return true; }
    System.Text.StringBuilder sb = new System.Text.StringBuilder(512);
    GetWindowTextW(h, sb, sb.Capacity);
    if (sb.ToString().IndexOf(marker, System.StringComparison.Ordinal) < 0) {
      SetWindowTextW(h, want);
      n = n + 1;
    }
    return true;
  }, IntPtr.Zero);
  return n;
}
"@
} catch {
  Say ('Add-Type FAILED: ' + $_.Exception.Message)
  exit 1
}

$pids     = @($tpid)
$lastScan = [datetime]::MinValue
$deadline = (Get-Date).AddHours(12)

while ($true) {
  if (-not (Get-Process -Id $tpid -ErrorAction SilentlyContinue)) { Say 'window process gone, guard exits'; break }
  if ((Get-Date) -gt $deadline) { Say 'guard lifetime reached, exits'; break }

  # candidate pids are refreshed every 15s: cmd.exe, its direct children, and any
  # process that really runs our .bat (command line is checked, title is not)
  if (((Get-Date) - $lastScan).TotalSeconds -gt 15) {
    $list = New-Object 'System.Collections.Generic.List[int]'
    $list.Add($tpid)
    foreach ($k in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$tpid")) { [void]$list.Add([int]$k.ProcessId) }
    foreach ($k in @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($bat) })) { [void]$list.Add([int]$k.ProcessId) }
    $pids = @($list | Sort-Object -Unique)
    $lastScan = Get-Date
  }

  try {
    $n = [LWTitle.W]::Retitle([int[]]$pids, $want, $marker)
    if ($n -gt 0) { Say ('title re-applied on ' + $n + ' window(s)') }
  } catch { }

  Start-Sleep -Milliseconds 500
}
'@

function Start-TitleGuard {
  param(
    [int]$TargetPid,
    [string]$Want,
    [string]$Marker,
    [string]$Bat
  )
  if (-not $TargetPid) { return }
  # values are injected by literal replacement, then the whole guard is passed as
  # -EncodedCommand: base64 has no spaces/quotes, so cmd-style quoting cannot eat it
  $src = $TITLE_GUARD.Replace('@@TPID@@', "$TargetPid").Replace('@@WANT@@', $Want).Replace('@@MARKER@@', $Marker).Replace('@@BAT@@', $Bat)
  $b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($src))
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $b64
  Write-Host '  [OK] title guard running (detached, re-applies the title every 0.5s)' -ForegroundColor DarkGray
}

# ---------------------------------------------------------------- relay
function Start-Relay {
  Write-Host ''
  Write-Host '[RELAY] danmaku-relay + battle system  (WS :8766 / panel :8767)' -ForegroundColor Cyan

  if (Test-Port 8767) {
    Write-Host '  [SKIP] already running (:8767 in use)' -ForegroundColor Yellow
  } else {
    Release-Ports $PORTS_RELAY
    # /k keeps an interactive shell alive after node stops, so the window is
    # always usable (a /c window with a dead child is an empty, un-typeable box)
    # the title itself is set by the first line of relay-window.bat; -PassThru gives
    # us the cmd PID so the external guard can re-apply it if anything overwrites it
    $relayProc = Start-Process cmd -WorkingDirectory $relayDir -ArgumentList '/k', '..\relay-window.bat' -PassThru
    if ($relayProc) {
      Start-TitleGuard -TargetPid $relayProc.Id -Want '[DANMAKU-RELAY] running - do not close' -Marker '[DANMAKU-RELAY]' -Bat 'relay-window.bat'
    }
    if (Wait-Http 'http://localhost:8767/api/status') {
      Write-Host '  [OK] service ready' -ForegroundColor Green
    } else {
      Write-Host '  [FAIL] not ready after 27s - check the relay window' -ForegroundColor Red
      return
    }
  }

  # record the node PID (useful for external tooling / cleanup)
  $line = netstat -ano | Select-String ':8767\s' | Select-String 'LISTENING' | Select-Object -First 1
  if ($line) {
    $nodePid = ($line.ToString() -split '\s+')[-1].Trim()
    if ($nodePid -match '^\d+$') {
      Set-Content -Path (Join-Path $root '.live-waifu.pid') -Value $nodePid -Encoding ascii
    }
  }

  Write-Host '  control panel : http://localhost:8767' -ForegroundColor Green
  Write-Host '  battle panel  : http://localhost:8767/battle.html' -ForegroundColor Green
  Write-Host '  game launches when you click [start new round]' -ForegroundColor Yellow
  Write-Host '  window title  : [DANMAKU-RELAY] running - do not close' -ForegroundColor Gray

  # open both panels in the browser
  Start-Process 'http://localhost:8767/battle.html'
  Start-Sleep -Milliseconds 800
  Start-Process 'http://localhost:8767'
  Write-Host '  [OK] opened control + battle panels' -ForegroundColor Green
}

# ---------------------------------------------------------------- waifu
function Start-Waifu {
  Write-Host ''
  Write-Host '[WAIFU] waifu-agent desktop pet  (Tauri dev, :1420)' -ForegroundColor Cyan

  if (Test-Port 1420) {
    Write-Host '  [SKIP] already running (:1420 in use)' -ForegroundColor Yellow
  } else {
    Release-Ports $PORTS_WAIFU
    # waifu-window.bat sets the title on line 6, but the tauri CLI overwrites it a
    # few seconds later with the npm banner, so the detached guard has to win it back
    $waifuProc = Start-Process cmd -WorkingDirectory $waifuDir -ArgumentList '/k', '..\waifu-window.bat' -PassThru
    if ($waifuProc) {
      Start-TitleGuard -TargetPid $waifuProc.Id -Want '[WAIFU-AGENT] running - tauri dev' -Marker '[WAIFU-AGENT]' -Bat 'waifu-window.bat'
    }
    Write-Host '  [OK] launching (first build takes 1-2 min)' -ForegroundColor Green
  }

  Write-Host '  window title  : [WAIFU-AGENT] running - tauri dev' -ForegroundColor Gray
  Write-Host '  NOTE: tauri:dev compiles Rust on start; the window appears after build' -ForegroundColor Yellow
  Write-Host '  the tauri CLI overwrites the console title with an npm banner -' -ForegroundColor Gray
  Write-Host '  the guard re-applies [WAIFU-AGENT] from outside, so the title settles' -ForegroundColor Gray
}

# ---------------------------------------------------------------- companion
function Start-Companion {
  Write-Host ''
  Write-Host '[COMPANION] Douyin live companion' -ForegroundColor Cyan

  $running = Get-Process -Name '直播伴侣' -ErrorAction SilentlyContinue
  if ($running) {
    Write-Host '  [SKIP] already running' -ForegroundColor Yellow
    return
  }

  if (Test-Path $COMPANION) {
    Start-Process $COMPANION -WorkingDirectory (Split-Path $COMPANION)
    Write-Host '  [OK] launched' -ForegroundColor Green
    Write-Host '  window title  : 直播伴侣' -ForegroundColor Gray
  } else {
    Write-Host "  [FAIL] not found: $COMPANION" -ForegroundColor Red
    Write-Host '         update $COMPANION in this script if the version changed' -ForegroundColor Gray
  }
}

# ---------------------------------------------------------------- game
function Start-Game {
  Write-Host ''
  Write-Host '[GAME] Rusted Warfare + debug socket' -ForegroundColor Cyan
  $gameDir = 'D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15'
  $java = Join-Path $gameDir 'jvm\bin\java.exe'
  if (-not (Test-Path $java)) {
    Write-Host "  [FAIL] java not found: $java" -ForegroundColor Red
    return
  }
  $env:PATH = "$gameDir;$env:PATH"
  Start-Process -FilePath $java -WorkingDirectory $gameDir -ArgumentList @(
    '-Djava.net.preferIPv4Stack=true', '-Xmx1000M', '-Dfile.encoding=UTF-8',
    '-Djava.library.path=.', '-cp', 'game-lib.jar;libs/*',
    'com.corrodinggames.rts.java.Main', '-debug', '9999:autostart', '-log', 'lastrun.log'
  )
  Write-Host '  [OK] launching (debug socket :9999)' -ForegroundColor Green
  Write-Host '  window title  : Rusted Warfare' -ForegroundColor Gray
}

# ---------------------------------------------------------------- stop
function Stop-All {
  Write-Host ''
  if ($DryRun) {
    Write-Host '=== DRY RUN - nothing will be killed ===' -ForegroundColor Magenta
    Write-Host '    processes this stop WOULD terminate:' -ForegroundColor Magenta
  } else {
    Write-Host '=== stop all components ===' -ForegroundColor Yellow
  }
  Release-Ports ($PORTS_RELAY + $PORTS_WAIFU | Select-Object -Unique)
  if ($DryRun) {
    foreach ($q in @(Get-Process douyinLive,'waifu-agent' -ErrorAction SilentlyContinue)) {
      Show-WouldKill ([int]$q.Id) 'by image name'
    }
  } else {
    taskkill /F /IM douyinLive.exe 2>$null | Out-Null
  }
  # `taskkill /IM javaw.exe` would kill ANY JVM on the machine - scope it to the game
  $gw = @(Get-CimInstance Win32_Process -Filter "Name='javaw.exe'" -ErrorAction SilentlyContinue |
          Where-Object { $_.CommandLine -and $_.CommandLine -like '*corrodinggames*' })
  foreach ($g in $gw) {
    if ($DryRun) {
      Show-WouldKill ([int]$g.ProcessId) "Rusted Warfare"
    }
    elseif (Test-Killable ([int]$g.ProcessId)) {
      taskkill /F /PID $g.ProcessId 2>$null | Out-Null
      Write-Host "  [OK] stopped Rusted Warfare (PID $($g.ProcessId))" -ForegroundColor Gray
    }
  }
  # Kill the component consoles by matching the *script they are running* in their
  # own command line. The previous form used `taskkill /FI "WINDOWTITLE eq ..."`,
  # which matches on the window title alone with NO process check - any process
  # whose window happened to match was terminated.
  foreach ($b in 'relay-window.bat', 'waifu-window.bat') {
    $hits = @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
              Where-Object { $_.CommandLine -and $_.CommandLine -like "*$b*" })
    foreach ($h in $hits) {
      if ($DryRun) {
        Show-WouldKill ([int]$h.ProcessId) "runs $b"
      }
      elseif (Test-Killable ([int]$h.ProcessId)) {
        taskkill /F /PID $h.ProcessId 2>$null | Out-Null
        Write-Host "  [OK] stopped $b (PID $($h.ProcessId))" -ForegroundColor Gray
      }
    }
  }
  if (-not $DryRun) { Stop-Process -Name waifu-agent -ErrorAction SilentlyContinue }
  if ($DryRun) {
    Write-Host '[DRY RUN] nothing was killed.' -ForegroundColor Magenta
  } else {
    Write-Host '[OK] all stopped' -ForegroundColor Green
  }
}

# ---------------------------------------------------------------- status
function Show-Status {
  Write-Host ''
  Write-Host '=== component status ===' -ForegroundColor Cyan
  $rows = @(
    @{ n = 'danmaku-relay'; p = 8767; t = 'http://localhost:8767/api/status' },
    @{ n = 'douyinLive';    p = 1088; t = $null },
    @{ n = 'waifu-agent';   p = 1420; t = $null }
  )
  foreach ($r in $rows) {
    $up = Test-Port $r.p
    $mark = if ($up) { 'UP  ' } else { 'DOWN' }
    $color = if ($up) { 'Green' } else { 'DarkGray' }
    Write-Host ("  [{0}] {1}  :{2}" -f $mark, $r.n, $r.p) -ForegroundColor $color
  }
  $c = Get-Process -Name '直播伴侣' -ErrorAction SilentlyContinue
  $cm = if ($c) { 'UP  ' } else { 'DOWN' }
  $cc = if ($c) { 'Green' } else { 'DarkGray' }
  Write-Host ("  [{0}] {1}" -f $cm, 'live companion') -ForegroundColor $cc
}

function Show-Menu {
  Write-Host ''
  Write-Host '============================================' -ForegroundColor Cyan
  Write-Host '   live-waifu live-stream suite' -ForegroundColor Cyan
  Write-Host '============================================' -ForegroundColor Cyan
  Write-Host '  Each item opens its own window.'
  Write-Host ''
  Write-Host '  1 = danmaku-relay + battle  (:8766/:8767)' -ForegroundColor White
  Write-Host '  2 = waifu-agent desktop pet (:1420)' -ForegroundColor White
  Write-Host '  3 = Douyin live companion' -ForegroundColor White
  Write-Host '  4 = Rusted Warfare (debug :9999)' -ForegroundColor White
  Write-Host '  5 = start 1+2+3'
  Write-Host '  6 = status'
  Write-Host '  7 = stop all + release ports' -ForegroundColor Yellow
  Write-Host '  0 = exit'
  Write-Host ''
  Write-Host '  game also auto-launches when you click [start new round]' -ForegroundColor Yellow
  Write-Host '============================================'
}

# ---------------------------------------------------------------- dispatch
if ($Stop) { Stop-All; exit 0 }
if ($Status) { Show-Status; exit 0 }

if ($All) {
  Release-Ports ($PORTS_RELAY + $PORTS_WAIFU | Select-Object -Unique)
  Start-Relay
  Start-Waifu
  Start-Companion
  exit 0
}
if ($Relay)     { Start-Relay; exit 0 }
if ($Waifu)     { Start-Waifu; exit 0 }
if ($Companion) { Start-Companion; exit 0 }

while ($true) {
  Show-Menu
  $choice = Read-Host 'select'
  switch ($choice.Trim()) {
    '1' { Start-Relay }
    '2' { Start-Waifu }
    '3' { Start-Companion }
    '4' { Start-Game }
    '5' { Start-Relay; Start-Waifu; Start-Companion }
    '6' { Show-Status }
    '7' { Stop-All }
    '0' { exit 0 }
    default { Write-Host 'invalid option' -ForegroundColor Red }
  }
  Start-Sleep 1
}
