import socket, time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))
print('已连接 Debug Socket')

s.send(b'ping\n')
time.sleep(0.5)
response = s.recv(4096).decode()
print('Ping:', response.strip())

cmd = "script root.loadConfigAndStartNewSandbox('maps/skirmish/live_battle.tmx')"
print('发送:', cmd)
s.send((cmd + '\n').encode())
time.sleep(3)
try:
    response = s.recv(4096).decode()
    print('Response:', response.strip())
except:
    print('(无响应)')

s.close()