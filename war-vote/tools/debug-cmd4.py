import socket, time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))
print('已连接')

# 先打开 sandboxOptions 加载 UI
s.send(b"script root.open('sandboxOptions.rml', 'maps/skirmish/live_battle.tmx')\n")
time.sleep(2)

# 尝试不同路径格式
paths = [
    "maps/skirmish/live_battle.tmx",
    "live_battle.tmx",
    "mods/maps/live_battle.tmx",
    "maps/live_battle.tmx",
]

for p in paths:
    cmd = "script root.loadConfigAndStartNewSandbox('{}')".format(p)
    print('尝试:', cmd)
    s.send((cmd + '\n').encode())
    time.sleep(2)

s.close()