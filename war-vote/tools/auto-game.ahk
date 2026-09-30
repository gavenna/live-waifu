#Requires AutoHotkey v2.0
#SingleInstance Force
SetMouseDelay 50

gameTitle := "Rusted Warfare"
steps := [
    {x: 0.626, y: 0.500, label: "单人战役", wait: 2000},
    {x: 0.350, y: 0.400, label: "Skirmish", wait: 1500},
    {x: 0.500, y: 0.500, label: "选地图", wait: 1000},
    {x: 0.800, y: 0.900, label: "Start", wait: 3000}
]

if !WinExist(gameTitle) {
    FileAppend "ERROR: 游戏未运行`n", "*"
    ExitApp
}

; 激活游戏窗口
WinActivate gameTitle
WinWaitActive gameTitle, , 3
Sleep 500

; 获取客户区
WinGetClientPos &cx, &cy, &cw, &ch, gameTitle
FileAppend Format("客户区: {}x{} @ ({},{})`n", cw, ch, cx, cy), "*"

; 执行每一步
CoordMode "Mouse", "Client"
for i, step in steps {
    px := Round(cw * step.x)
    py := Round(ch * step.y)
    FileAppend Format("[{}/{}] {} -> ({},{})`n", i, steps.Length, step.label, px, py), "*"
    Click px, py
    Sleep step.wait
}

FileAppend "完成!`n", "*"
ExitApp