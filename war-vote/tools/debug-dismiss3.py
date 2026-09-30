import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))
cmds = [
    "script root.clickElement(root.getElementById('ok'))",
    "script root.closePopup()",
    "script root.closeAlertOnly()",
    "function root.resumeNonMenu()",
]
for cmd in cmds:
    s.send((cmd + '\n').encode())
    time.sleep(0.3)
s.close()
print('弹窗关闭命令已发送')