#Requires AutoHotkey v2.0
#SingleInstance Force

; 自适应游戏自动化：每步 OCR 识别 → 点击 → 验证
; 用法: AutoHotkey64.exe auto-adaptive.ahk
; 流程: 截图 → Python OCR → 读结果 → 点击 → 等待 → 下一步

gameTitle := "Rusted Warfare"
logFile := A_ScriptDir "\auto-adaptive.log"
ocrScript := A_ScriptDir "\ocr-step.py"
resultFile := A_ScriptDir "\ocr-step-result.json"
shotFile := A_ScriptDir "\ocr-step-shot.png"

Log(msg) {
    FileAppend "[" A_Hour ":" A_Min ":" A_Sec "] " msg "`n", logFile
}

; 获取游戏窗口客户区
GetGameClient(&x, &y, &w, &h) {
    hwnd := WinExist(gameTitle)
    if !hwnd
        return false
    WinGetClientPos &x, &y, &w, &h, hwnd
    return true
}

; 截图 + OCR 识别当前画面
OcrCurrentScreen() {
    global shotFile, ocrScript, resultFile
    
    ; 用 Python 截图 + OCR
    RunWait 'python "' ocrScript '"',, "Hide"
    
    ; 读结果
    if !FileExist(resultFile)
        return ""
    return FileRead(resultFile)
}

; 点击指定位置
ClickGame(xPct, yPct) {
    global gameTitle
    hwnd := WinExist(gameTitle)
    if !hwnd
        return
    
    WinActivate hwnd
    WinWaitActive hwnd, , 2
    Sleep 200
    
    WinGetClientPos &cx, &cy, &cw, &ch, hwnd
    CoordMode "Mouse", "Client"
    px := Round(cw * xPct)
    py := Round(ch * yPct)
    Click px, py
    Log "点击 (" px "," py ") = (" xPct "," yPct ")"
}

; 在 OCR 结果中查找目标文字
FindText(jsonStr, searchText) {
    ; 简单 JSON 解析（找 text 和 x, y）
    ; 格式: {"text": "单人战役", "x": 0.626, "y": 0.500}
    pos := InStr(jsonStr, searchText)
    if !pos
        return ""
    
    ; 往前找 x 值
    xStart := InStr(jsonStr, '"x":', , pos - 50, 1)
    if !xStart
        return ""
    xVal := SubStr(jsonStr, xStart + 4, 10)
    xVal := RegExReplace(xVal, "[^0-9.].*")
    
    ; 往前找 y 值
    yStart := InStr(jsonStr, '"y":', , pos - 50, 1)
    if !yStart
        return ""
    yVal := SubStr(jsonStr, yStart + 4, 10)
    yVal := RegExReplace(yVal, "[^0-9.].*")
    
    return {x: xVal + 0, y: yVal + 0}
}

; === 主流程 ===
Log "=== 自适应自动化开始 ==="

if !WinExist(gameTitle) {
    Log "ERROR: 游戏未运行"
    MsgBox "游戏未运行"
    ExitApp
}

; 步骤定义（每步要找的文字）
targetSteps := [
    {find: "单人战役", label: "主菜单→单人战役", wait: 3000},
    {find: "Skirmish", label: "Skirmish", wait: 2000},
    {find: "Start", label: "开始游戏", wait: 5000}
]

for i, step in targetSteps {
    Log "步骤 " i ": " step.label " (找: " step.find ")"
    
    ; 截图 OCR
    jsonResult := OcrCurrentScreen()
    if !jsonResult {
        Log "ERROR: OCR 失败"
        continue
    }
    
    ; 查找目标
    coords := FindText(jsonResult, step.find)
    if !coords {
        Log "WARN: 未找到 '" step.find "', 跳过"
        continue
    }
    
    Log "找到: " step.find " @ (" coords.x "," coords.y ")"
    
    ; 点击
    ClickGame(coords.x, coords.y)
    
    ; 等待
    Sleep step.wait
}

Log "=== 完成 ==="
MsgBox "自动化完成"
ExitApp