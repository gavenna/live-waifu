#Requires AutoHotkey v2.0
#SingleInstance Force

recording := false
clicks := []
gameTitle := "Rusted Warfare"
shotDir := A_ScriptDir "\shots"

if !DirExist(shotDir)
    DirCreate(shotDir)

CaptureWindow(x, y, w, h, outFile) {
    ps := Format('Add-Type -AssemblyName System.Drawing;$b=New-Object System.Drawing.Bitmap({1},{2});$g=[System.Drawing.Graphics]::FromImage($b);$g.CopyFromScreen({3},{4},0,0,[System.Drawing.Size]::new({1},{2}));$g.Dispose();$b.Save("{5}");$b.Dispose()', w, h, x, y, outFile)
    RunWait 'powershell -Command "' ps '"',, "Hide"
}

F1:: {
    global recording
    recording := !recording
    if recording {
        Loop Files shotDir "\*.png"
            FileDelete A_LoopFilePath
        ToolTip "录制中... 点游戏按钮 (F1暂停 F2完成 F3撤销)"
        SetTimer () => ToolTip(), -2000
    } else {
        ToolTip "已暂停"
        SetTimer () => ToolTip(), -2000
    }
}

~LButton:: {
    global recording, clicks, gameTitle
    if !recording
        return
    
    try {
        WinGetPos &winX, &winY, &winW, &winH, gameTitle
    } catch {
        return
    }
    
    MouseGetPos &mouseX, &mouseY
    relX := (mouseX - winX) / winW
    relY := (mouseY - winY) / winH
    
    idx := clicks.Length + 1
    shotFile := shotDir "\" Format("{:02}", idx) ".png"
    CaptureWindow(winX, winY, winW, winH, shotFile)
    
    clicks.Push({x: relX, y: relY, shot: shotFile})
    ToolTip "#" idx " (" Round(relX, 2) "," Round(relY, 2) ")"
    SetTimer () => ToolTip(), -1000
}

F3:: {
    global clicks
    if clicks.Length > 0 {
        clicks.Pop()
        ToolTip "撤销 剩余" clicks.Length
        SetTimer () => ToolTip(), -1000
    }
}

F2:: {
    global clicks, recording
    recording := false
    if clicks.Length = 0 {
        MsgBox "没有录制到任何点击"
        return
    }
    
    output := "module.exports = {`n"
    output .= "  window: { width: 1024, height: 768, mode: 'windowed' },`n"
    output .= "  steps: [`n"
    output .= "    { action: 'wait', ms: 3000, label: '等待游戏加载' },`n"
    for i, c in clicks {
        output .= "    { action: 'click', x: " Round(c.x, 4) ", y: " Round(c.y, 4) ", label: '步骤" i "', wait: 2000 },`n"
    }
    output .= "  ],`n"
    output .= "  tolerance: 0.02`n"
    output .= "}`n"
    
    outFile := A_ScriptDir "\gameSteps-recorded.js"
    if FileExist(outFile)
        FileDelete outFile
    FileAppend output, outFile
    
    MsgBox "录好了! 共 " clicks.Length " 步`n坐标: tools\gameSteps-recorded.js`n截图: tools\shots\"
    ExitApp
}

Esc:: ExitApp