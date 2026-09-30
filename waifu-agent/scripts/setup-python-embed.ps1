# setup-python-embed.ps1 — Prepare embedded Python + STT deps for Tauri bundling
#
# Downloads: Python embedded, ffmpeg, faster-whisper, whisper model
# Output:
#   src-tauri/python-embed/     (Python + pip + edge-tts + faster-whisper)
#   src-tauri/tools/ffmpeg.exe  (ffmpeg for STT WebM→WAV conversion)

$ErrorActionPreference = "Stop"
$pythonVersion = "3.12.8"
$pythonUrl = "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip"
$targetDir = "$PSScriptRoot\..\src-tauri\python-embed"
$toolsDir = "$PSScriptRoot\..\src-tauri\tools"
$zipPath = "$env:TEMP\python-embed.zip"
$python = "$targetDir\python.exe"

Write-Host "=== Setup Python Embedded + STT for waifu-agent ==="

# ── 1. Python embedded ───────────────────────────
Write-Host "[1/10] Downloading Python $pythonVersion embedded..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $pythonUrl -OutFile $zipPath

Write-Host "[2/10] Extracting to $targetDir..."
if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
Expand-Archive -Path $zipPath -DestinationPath $targetDir
Remove-Item $zipPath

# ── 2. Enable site-packages ───────────────────────
Write-Host "[3/10] Enabling site-packages..."
$pthFile = Get-ChildItem -Path $targetDir -Filter "*._pth" | Select-Object -First 1
if ($pthFile) {
    $content = Get-Content $pthFile.FullName
    $content = $content -replace "^#import site", "import site"
    if ($content -notmatch "Lib\\\\site-packages") {
        $content += "`nLib\site-packages"
    }
    $content | Set-Content $pthFile.FullName
    Write-Host "  Updated $($pthFile.Name)"
}

# ── 3. Install pip ────────────────────────────────
Write-Host "[4/10] Installing pip..."
$pipUrl = "https://bootstrap.pypa.io/get-pip.py"
$pipPath = "$targetDir\get-pip.py"
Invoke-WebRequest -Uri $pipUrl -OutFile $pipPath
& $python $pipPath
Remove-Item $pipPath

# ── 4. edge-tts + websockets (companion) ──────────
Write-Host "[5/10] Installing edge-tts & websockets..."
& $python -m pip install edge-tts websockets --no-cache-dir

# ── 5. faster-whisper ─────────────────────────────
Write-Host "[6/10] Installing faster-whisper..."
& $python -m pip install faster-whisper --no-cache-dir

# ── 6. web search deps ────────────────────────────
Write-Host "[7/10] Installing search deps (requests, bs4, ddgs)..."
& $python -m pip install requests beautifulsoup4 ddgs --no-cache-dir

# ── 7. ffmpeg ──────────────────────────────────────
Write-Host "[8/10] Downloading ffmpeg..."
$ffmpegZip = "$env:TEMP\ffmpeg.zip"
$ffmpegExtract = "$env:TEMP\ffmpeg-extract"
Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip
Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force
$ffmpegBinDir = Get-ChildItem -Path $ffmpegExtract -Directory | Select-Object -First 1
$ffmpegExe = Join-Path $ffmpegBinDir.FullName "bin\ffmpeg.exe"
if (-not (Test-Path $toolsDir)) { New-Item -ItemType Directory -Path $toolsDir | Out-Null }
Copy-Item $ffmpegExe "$toolsDir\ffmpeg.exe" -Force
Remove-Item $ffmpegZip -Force
Remove-Item $ffmpegExtract -Recurse -Force
Write-Host "  ffmpeg.exe → $toolsDir"

# ── (Optional) Pre-download whisper model ─────────
Write-Host ""
Write-Host "Pre-downloading faster-whisper base model (~150MB, one-time)..."
& $python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8'); print('Model ready.')"

Write-Host ""
Write-Host "=== Done! ==="
$pySize = (Get-ChildItem -Path $targetDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
$ffSize = (Get-Item "$toolsDir\ffmpeg.exe").Length / 1MB
Write-Host "Python embed: $([math]::Round($pySize, 1)) MB"
Write-Host "ffmpeg.exe:   $([math]::Round($ffSize, 1)) MB"

# ── 9. Create directory junctions for scripts/ and waifu-memory/ ──
Write-Host ""
Write-Host "[9/9] Creating directory junctions for Tauri resource bundling..."
$srcTauri = "$PSScriptRoot\..\src-tauri"
$junctionScripts = "$srcTauri\scripts"
$junctionMemory = "$srcTauri\waifu-memory"
$sourceScripts = "$PSScriptRoot\..\scripts"
$sourceMemory = "$PSScriptRoot\..\waifu-memory"

# Use cmd /c mklink (New-Item -ItemType Junction not available on all Win10)
if (-not (Test-Path $junctionScripts)) {
    & cmd /c "mklink /J `"$junctionScripts`" `"$sourceScripts`"" | Out-Null
    Write-Host "  Created junction: scripts → $sourceScripts"
} else {
    Write-Host "  Junction already exists: scripts"
}
if (-not (Test-Path $junctionMemory)) {
    & cmd /c "mklink /J `"$junctionMemory`" `"$sourceMemory`"" | Out-Null
    Write-Host "  Created junction: waifu-memory → $sourceMemory"
} else {
    Write-Host "  Junction already exists: waifu-memory"
}
