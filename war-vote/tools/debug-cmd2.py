import socket, time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))

# 尝试不同命令格式
cmds = [
    "function root.resume()",
    "function root.startNew('maps/skirmish/live_battle.tmx')",
    "function root.loadConfigAndStartNew('maps/skirmish/live_battle.tmx')",
    "root.showMainMenu()",
]

for cmd in cmds:
    print('发送:', cmd)
    s.send((cmd + '\n').encode())
    time.sleep(1)
    try:
        response = s.recv(4096).decode()
        print('  Response:', response.strip()[:200])
    except:
        print('  (无响应)')

s.close()