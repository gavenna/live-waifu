import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))

# 尝试不同方式关闭弹窗
cmds = [
    "script root.closePopup()",
    "script root.closeAlertOnly()", 
    "script root.resume()",
]
for cmd in cmds:
    print('发送:', cmd)
    s.send((cmd + '\n').encode())
    time.sleep(1)

s.close()
print('完成')