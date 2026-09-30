/**
 * 游戏坐标探索工具
 * 用法: node server/exploreGame.js
 * 功能: 截取游戏窗口截图，显示窗口位置信息
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');
if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });

// 获取游戏窗口信息
function getGameWindow() {
  try {
    const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32Explore {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@
$results = @()
$callback = [Win32Explore+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32Explore]::IsWindowVisible($hWnd)) {
        $sb = New-Object System.Text.StringBuilder 256
        [Win32Explore]::GetWindowText($hWnd, $sb, 256) | Out-Null
        $title = $sb.ToString()
        if ($title -and $title.Length -gt 0) {
            $pid = 0
            [Win32Explore]::GetWindowThreadProcessId($hWnd, [ref]$pid) | Out-Null
            $rect = New-Object Win32Explore+RECT
            [Win32Explore]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
            $w = $rect.Right - $rect.Left
            $h = $rect.Bottom - $rect.Top
            if ($w -gt 100 -and $h -gt 100) {
                Write-Output "$pid|$title|$($rect.Left)|$($rect.Top)|$w|$h"
            }
        }
    }
    return $true
}
[Win32Explore]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
`;
    const result = execSync(`powershell -Command "${script.replace(/"/g, '\\"')}"`, { encoding: 'utf-8', timeout: 10000, windowsHide: true });
    const windows = result.trim().split('\n').filter(Boolean).map(line => {
      const [pid, title, left, top, w, h] = line.split('|');
      return { pid: Number(pid), title, left: Number(left), top: Number(top), width: Number(w), height: Number(h) };
    });
    return windows;
  } catch (e) {
    return [];
  }
}

// 截取指定窗口
function captureWindow(win, filename) {
  try {
    const script = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(${win.width}, ${win.height})
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${win.left}, ${win.top}, 0, 0, [System.Drawing.Size]::new(${win.width}, ${win.height}))
$g.Dispose()
$bmp.Save("${path.join(TOOLS_DIR, filename).replace(/\\/g, '\\\\')}")
$bmp.Dispose()
Write-Host "OK"
`;
    execSync(`powershell -Command "${script.replace(/"/g, '\\"')}"`, { timeout: 10000, windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

// 主流程
console.log('=== 游戏窗口探索工具 ===\n');
const windows = getGameWindow();

if (windows.length === 0) {
  console.log('没有找到可见窗口');
  process.exit(1);
}

console.log('找到以下窗口:');
windows.forEach((w, i) => {
  console.log(`  [${i}] PID:${w.pid} "${w.title}" @ (${w.left},${w.top}) ${w.width}x${w.height}`);
});

// 找游戏窗口（标题包含 Rusted 或 Warfare）
const gameWin = windows.find(w => /rusted|warfare/i.test(w.title));
if (gameWin) {
  console.log(`\n游戏窗口: "${gameWin.title}"`);
  console.log(`  位置: (${gameWin.left}, ${gameWin.top})`);
  console.log(`  大小: ${gameWin.width} x ${gameWin.height}`);
  
  const filename = `game-${Date.now()}.png`;
  if (captureWindow(gameWin, filename)) {
    console.log(`  截图: tools/${filename}`);
  }
} else {
  console.log('\n未找到游戏窗口（标题不含 Rusted/Warfare）');
  console.log('请手动启动游戏后重试');
}