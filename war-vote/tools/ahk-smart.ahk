#Requires AutoHotkey v2.0
#SingleInstance Force
SetMouseDelay 50

gameTitle := "Rusted Warfare"
toolsDir := "D:\Projects\live-waifu\war-vote\tools"

if !WinExist(gameTitle) {
    FileAppend "ERROR: 游戏未运行`n", "*"
    ExitApp
}

OcrFind(targetText) {
    global toolsDir
    RunWait Format('python "{}/ocr-step.py"', toolsDir),, "Hide"
    jsonFile := toolsDir "\ocr-step-result.json"
    if !FileExist(jsonFile)
        return ""
    json := FileRead(jsonFile, "UTF-8")
    
    ; 找目标文字
    pos := InStr(json, targetText)
    if !pos
        return ""
    
    ; 往后找最近的 "x": 和 "y":（同一条记录里）
    after := SubStr(json, pos)
    
    xMatch := RegExMatch(after, '"x":\s*([\d.]+)', &xm)
    if !xMatch
        return ""
    xVal := xm[1] + 0
    
    yMatch := RegExMatch(after, '"y":\s*([\d.]+)', &ym)
    if !yMatch
        return ""
    yVal := ym[1] + 0
    
    return {x: xVal, y: yVal}
}

ClickGame(xPct, yPct) {
    global gameTitle
    hwnd := WinExist(gameTitle)
    WinActivate hwnd
    WinWaitActive hwnd, , 2
    Sleep 300
    WinGetClientPos &cx, &cy, &cw, &ch, hwnd
    CoordMode "Mouse", "Client"
    px := Round(cw * xPct)
    py := Round(ch * yPct)
    FileAppend Format("  客户区{}x{} -> 点击({},{})`n", cw, ch, px, py), "*"
    Click px, py
}

FileAppend "=== AHK 自适应 ===`n", "*"

steps := [
    {find: "单人战役", label: "单人战役", wait: 3000},
    {find: "Skirmish", label: "Skirmish", wait: 2000},
    {find: "Start", label: "开始", wait: 5000},
]

for i, step in steps {
    FileAppend Format("[{}/{}] {}`n", i, steps.Length, step.label), "*"
    
    coords := OcrFind(step.find)
    if !coords {
        FileAppend Format("  未找到 '{}'`n", step.find), "*"
        continue
    }
    
    FileAppend Format("  OCR: '{}' @ ({},{})`n", step.find, coords.x, coords.y), "*"
    ClickGame(coords.x, coords.y)
    Sleep step.wait
}

FileAppend "完成`n", "*"
ExitApp