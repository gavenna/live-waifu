import socket, time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))
print('已连接')

# Step 1: 打开 sandboxOptions 页面（这会加载 UI 元素）
cmd1 = "script root.open('sandboxOptions.rml', 'maps/skirmish/live_battle.tmx')"
print('Step 1:', cmd1)
s.send((cmd1 + '\n').encode())
time.sleep(2)

# Step 2: 调用 start
cmd2 = "script root.loadConfigAndStartNewSandbox('maps/skirmish/live_battle.tmx')"
print('Step 2:', cmd2)
s.send((cmd2 + '\n').encode())
time.sleep(3)

try:
    response = s.recv(4096).decode()
    print('Response:', response.strip()[:200])
except:
    print('(无响应)')

s.close()