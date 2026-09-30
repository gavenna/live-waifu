/**
 * 游戏自动化执行引擎 — 通过 PowerShell 调用 Win32 API 实现点击
 * 坐标全部用百分比，执行时转换为实际像素
 */

const { execSync, execFile } = require('child_process');
const path = require('path');
const logger = require('./logger');

// Win32 API 点击脚本（内联 PowerShell）
const CLICK_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
"@
param([int]$X, [int]$Y)
[Win32]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 50
[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
`;

// 获取游戏窗口位置
function getGameWindow() {
  try {
    const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$hwnd = [Win32]::FindWindow([NullString]::Value, "Rusted Warfare")
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "NOT_FOUND"; exit 1 }
$rect = New-Object Win32+RECT
[Win32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
Write-Host "$($rect.Left),$($rect.Top),$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top)"
`;
    const result = execSync(`powershell -Command "${script.replace(/"/g, '\\"')}"`, { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim();
    if (result === 'NOT_FOUND') return null;
    const [x, y, w, h] = result.split(',').map(Number);
    return { x, y, width: w, height: h };
  } catch (e) {
    return null;
  }
}

// 点击相对坐标（百分比）
function clickAt(xPct, yPct, tolerance) {
  const win = getGameWindow();
  if (!win) throw new Error('游戏窗口未找到');

  // 百分比 → 实际像素 + 随机容差
  const dx = (Math.random() - 0.5) * 2 * (tolerance || 0.02) * win.width;
  const dy = (Math.random() - 0.5) * 2 * (tolerance || 0.02) * win.height;
  const px = Math.round(win.x + win.width * xPct + dx);
  const py = Math.round(win.y + win.height * yPct + dy);

  logger.info(`[AUTO] 点击 (${xPct.toFixed(2)}, ${yPct.toFixed(2)}) → 像素 (${px}, ${py})`);
  execSync(`powershell -Command "${CLICK_SCRIPT.replace(/"/g, '\\"').replace(/\n/g, ';')}" -X ${px} -Y ${py}`, { timeout: 5000, windowsHide: true });
}

// 等待
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 检查游戏是否在运行
function isGameRunning() {
  try {
    execSync('cmd /c tasklist /FI "IMAGENAME eq javaw.exe" /NH | findstr javaw', { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

// 等待游戏窗口出现
async function waitForGameWindow(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getGameWindow()) return true;
    await sleep(500);
  }
  return false;
}

// 执行游戏步骤
async function executeGameSteps(steps, tolerance) {
  for (const step of steps) {
    logger.info(`[AUTO] 步骤: ${step.label}`);

    if (step.action === 'wait') {
      await sleep(step.ms);
      continue;
    }

    if (step.action === 'click') {
      clickAt(step.x, step.y, tolerance);
      if (step.wait) await sleep(step.wait);
      continue;
    }

    if (step.action === 'verify') {
      // 简单验证：游戏窗口还在
      if (!isGameRunning()) {
        throw new Error('游戏已退出，自动化失败');
      }
      logger.info('[AUTO] 验证通过：游戏仍在运行');
      continue;
    }
  }
}

module.exports = { executeGameSteps, waitForGameWindow, isGameRunning, getGameWindow, clickAt };