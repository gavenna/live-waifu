<#
  build.ps1 -- build the "viewer label" injection (T4).

  Input  : the CURRENTLY DEPLOYED game-lib.jar
  Output : out\classes\** + out\game-lib.patched.jar (+ patch.log / verify_static.txt)

  Steps: 0) sync+hash input  1) clean stale classes  2) ECJ compile LabelPatcher.java
         3) run LabelPatcher  4) static verify marker in patched Debug.class

  ASCII-only (PS 5.1 decodes BOM-less .ps1 as ANSI).

  Usage: powershell -ExecutionPolicy Bypass -File "...\viewer-label\_inject\build.ps1"
  Exit code: 0 = build + static verify green.
#>
[CmdletBinding()]
param(
    [string]$Java = $env:RW_JAVA,
    [string]$DeployedJar = "D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\game-lib.jar"
)
$ErrorActionPreference = "Stop"

$Inject     = $PSScriptRoot
$Workspace  = (Resolve-Path (Join-Path $Inject "..\..\..")).Path
$Tools      = Join-Path $Workspace "_reports\econ-research\_tools"
$Javassist  = Join-Path $Tools "javassist.jar"
$Ecj        = Join-Path $Tools "ecj-3.21.0.jar"
$SrcPatcher = Join-Path $Inject "src\LabelPatcher.java"
$InDir      = Join-Path $Inject "in"
$InJar      = Join-Path $InDir "game-lib.deployed.jar"
$Out        = Join-Path $Inject "out"
$Classes    = Join-Path $Out "classes"
$PatchedJar = Join-Path $Out "game-lib.patched.jar"
$BuildLog   = Join-Path $Out "build.log"

if (-not $Java -or $Java.Trim() -eq "") {
    $Java = "D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15\jvm\bin\java.exe"
}
New-Item -ItemType Directory -Force -Path $Out, $Classes, $InDir | Out-Null
Set-Content -Path $BuildLog -Value ("=== viewer-label build.ps1 " + (Get-Date -Format o) + " ===")

function Invoke-Native {
    param([string]$Exe, [string[]]$ArgList)
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $lines = @()
    try { $lines = & $Exe @ArgList 2>&1 | ForEach-Object { $_.ToString() } }
    finally { $code = $LASTEXITCODE; $ErrorActionPreference = $prev }
    return [pscustomobject]@{ Output = $lines; ExitCode = $code }
}
function Emit {
    param($Lines, [string]$LogPath)
    if ($null -eq $Lines) { $Lines = @() }
    if ($Lines -isnot [array]) { $Lines = @($Lines) }
    Add-Content -Path $LogPath -Value (($Lines | ForEach-Object { "$_" }) -join "`r`n")
    foreach ($l in $Lines) { Write-Host "$l" }
}

$missing = @()
foreach ($f in @($Java, $Ecj, $Javassist, $SrcPatcher, $DeployedJar)) {
    if (-not (Test-Path -LiteralPath $f)) { $missing += $f }
}
if ($missing.Count -gt 0) { Write-Host ("MISSING:" + ($missing -join " | ")); exit 3 }

Write-Host "=== [0/4] sync input ==="
$depHash = (Get-FileHash -LiteralPath $DeployedJar -Algorithm SHA256).Hash
Copy-Item -LiteralPath $DeployedJar -Destination $InJar -Force
$inHash = (Get-FileHash -LiteralPath $InJar -Algorithm SHA256).Hash
Write-Host ("deployed jar : {0}  ({1} bytes)  sha256={2}" -f $DeployedJar, (Get-Item $DeployedJar).Length, $depHash.Substring(0,16))
if ($depHash -ne $inHash) { Write-Host "INPUT HASH MISMATCH"; exit 1 }
$prevHash = ""
if (Test-Path $PatchedJar) { $prevHash = (Get-FileHash -LiteralPath $PatchedJar -Algorithm SHA256).Hash.Substring(0,16) }

if (Test-Path $Classes) {
    Get-ChildItem $Classes -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Host "=== [1/4] cleaned stale classes ==="
} else { Write-Host "=== [1/4] no stale classes ===" }

Write-Host "=== [2/4] ECJ compile LabelPatcher.java ==="
$compileArgs = @("-jar", $Ecj, "-source", "1.8", "-target", "1.8",
                 "-cp", ($Javassist + ";" + $InJar), "-d", $Classes, $SrcPatcher)
$r = Invoke-Native -Exe $Java -ArgList $compileArgs
Emit -Lines $r.Output -LogPath $BuildLog
Write-Host ("    ecj exit = " + $r.ExitCode)
if ($r.ExitCode -ne 0) { Write-Host "ECJ COMPILE FAILED"; exit 1 }

Write-Host "=== [3/4] run LabelPatcher ==="
$r2 = Invoke-Native -Exe $Java -ArgList @("-cp", ($Classes + ";" + $Javassist + ";" + $InJar),
                                         "LabelPatcher", "--in", $InJar, "--out", $Out)
Emit -Lines $r2.Output -LogPath $BuildLog
Write-Host ("    LabelPatcher exit = " + $r2.ExitCode)
if ($r2.ExitCode -ne 0) { Write-Host "LABELPATCHER FAILED (see out/patch.log)"; exit 1 }

Write-Host "=== [4/4] static verify ==="
$verifyPy = Join-Path $Inject "verify_label.py"
$r3 = Invoke-Native -Exe "python" -ArgList @($verifyPy, $PatchedJar)
Emit -Lines $r3.Output -LogPath $BuildLog
Set-Content -Path (Join-Path $Out "verify_static.txt") -Value (($r3.Output | ForEach-Object { "$_" }) -join "`r`n")
Write-Host ("    verify exit = " + $r3.ExitCode)

$outHash = (Get-FileHash -LiteralPath $PatchedJar -Algorithm SHA256).Hash
Write-Host ("patched jar : {0} bytes  sha256={1}" -f (Get-Item $PatchedJar).Length, $outHash.Substring(0,16))
if ($prevHash -eq $outHash.Substring(0,16) -and $prevHash -ne "") { Write-Host "WARNING: patched jar hash UNCHANGED" }
if ($r3.ExitCode -eq 0) { Write-Host "BUILD OK" } else { Write-Host "VERIFY FAILED" }
exit $r3.ExitCode
