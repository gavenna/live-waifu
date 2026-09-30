import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))
# 点击 OK 按钮
s.send(b"script root.clickElement(root.getElementById('ok'))\n")
time.sleep(1)
s.close()
print('OK 已点击')