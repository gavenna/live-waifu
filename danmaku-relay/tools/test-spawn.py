import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))

# 关闭弹窗
s.send(b"script root.closePopup()\n")
time.sleep(0.3)
s.send(b"function root.resumeNonMenu()\n")
time.sleep(1)

# 模拟弹幕生兵
spawns = [
    ("红 坦克",   "script debug.createUnit('tank', 100.0, 200.0, 0, false)"),
    ("蓝 重坦",   "script debug.createUnit('heavyTank', 540.0, 200.0, 1, false)"),
    ("红 激光",   "script debug.createUnit('laserTank', 120.0, 220.0, 0, false)"),
    ("蓝 火炮",   "script debug.createUnit('artillery', 520.0, 220.0, 1, false)"),
    ("红 直升机", "script debug.createUnit('helicopter', 80.0, 180.0, 0, false)"),
    ("蓝 蜘蛛",   "script debug.createUnit('spiderBot', 560.0, 180.0, 1, false)"),
]
for d, cmd in spawns:
    s.send((cmd + '\n').encode())
    time.sleep(0.3)
    print(f'  {d} -> 已生成')

s.close()
print('\n6个单位已生成!')