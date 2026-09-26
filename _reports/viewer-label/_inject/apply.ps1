<#
  apply.ps1 (viewer-label) -- deploy the label-patched jar into the game.
  Same shape as probe-patrol's apply.ps1: identity-check game stopped, timestamped backup,
  hash-verify the deployed bytes, auto-rollback on mismatch. Backup suffix "-label-".

  Usage: powershell -ExecutionPolicy Bypass -File "...\viewer-label\_inject\apply.ps1"
  ASCII-only.
#>
[CmdletBinding()]
param(
    [string]$Jar = "D:\Projects\live-waifu\_reports\viewer-label\_inject\out\game-lib.patched.jar",
    [string]$GameDir = "D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Jar)) { Write-Host "patched jar not found: $Jar"; exit 3 }
$target = Join-Path $GameDir "game-lib.jar"
if (-not (Test-Path -LiteralPath $target)) { Write-Host "target not found: $target"; exit 3 }

Write-Host "WILL DEPLOY"
Write-Host ("  source : {0}  ({1} bytes)" -f $Jar, (Get-Item $Jar).Length)
Write-Host ("  target : {0}  ({1} bytes)" -f $target, (Get-Item $target).Length)

$running = @()
foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue)) {
    if ($p.CommandLine -and $p.CommandLine.Contains("corrodinggames")) { $running += $p }
}
if ($running.Count -gt 0) {
    Write-Host "REFUSING: game java.exe is still running (jar is locked):"
    foreach ($p in $running) { Write-Host ("  pid={0}" -f $p.ProcessId) }
    exit 4
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$target.bak-label-$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host ("BACKUP : {0}" -f $bak)
Copy-Item -LiteralPath $Jar -Destination $target -Force
$newHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
$srcHash = (Get-FileHash -LiteralPath $Jar -Algorithm SHA256).Hash
Write-Host ("DEPLOYED: {0} bytes  sha256={1}" -f (Get-Item $target).Length, $newHash.Substring(0,16))
if ($newHash -ne $srcHash) {
    Write-Host "DEPLOY MISMATCH -- rolling back"
    Copy-Item -LiteralPath $bak -Destination $target -Force
    exit 5
}
Write-Host "DEPLOY VERIFIED"
Write-Host "ROLLBACK:"
Write-Host ("  Copy-Item `"{0}`" `"{1}`" -Force" -f $bak, $target)
exit 0
