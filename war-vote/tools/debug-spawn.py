import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))

# 生成一个 tank 在红方区域
cmd = "script debug.createUnit('tank', 200.0, 200.0, 0, false)"
print('发送:', cmd)
s.send((cmd + '\n').encode())
time.sleep(1)

# 生成一个 tank 在蓝方区域
cmd2 = "script debug.createUnit('tank', 600.0, 200.0, 1, false)"
print('发送:', cmd2)
s.send((cmd2 + '\n').encode())
time.sleep(1)

try:
    resp = s.recv(4096).decode()
    print('Response:', resp.strip()[:200])
except:
    print('(无响应)')

s.close()
print('完成')