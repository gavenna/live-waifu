import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))

# 尝试点击 OK 按钮
cmds = [
    "script root.clickElement(root.getElementById('ok'))",
    "script root.closePopup()",
    "script root.closePopupOnly()",
    "script root.closeAlertOnly()",
    "function root.resumeNonMenu()",
]
for cmd in cmds:
    print('发送:', cmd)
    s.send((cmd + '\n').encode())
    time.sleep(0.5)

s.close()
print('完成')