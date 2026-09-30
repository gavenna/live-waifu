#Requires AutoHotkey v2.0
#SingleInstance Force

; 找游戏窗口
hwnd := WinExist("Rusted Warfare")
if !hwnd {
    MsgBox "未找到游戏窗口"
    ExitApp
}

; 获取客户区大小
WinGetClientPos &cx, &cy, &cw, &ch, hwnd

; 计算点击位置（单人战役 62.6%, 47.4%）
px := Round(cw * 0.626)
py := Round(ch * 0.474)

; 激活窗口
WinActivate hwnd
Sleep 200

; 在客户区内点击
CoordMode "Mouse", "Client"
Click px, py
Sleep 2000

; 切回
WinActivate "Hermes Agent"

MsgBox "点击完成"
ExitApp