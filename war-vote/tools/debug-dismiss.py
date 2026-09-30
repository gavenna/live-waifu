import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))

# 多次尝试关闭弹窗
for i in range(5):
    s.send(b"script root.resume()\n")
    time.sleep(0.5)

time.sleep(1)
s.close()
print('弹窗已关闭')