import socket, time

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))
print('[1/3] 已连接 Debug Socket')

# 关闭弹窗
s.send(b"script root.closePopup()\n")
time.sleep(0.3)
s.send(b"function root.resumeNonMenu()\n")
time.sleep(1)
print('[2/3] 弹窗已关闭')

# 实时生兵 — 模拟弹幕 "红 坦克" / "蓝 重坦" 等
spawns = [
    ("红 坦克",   "script debug.createUnit('tank', 180.0, 200.0, 0, false)"),
    ("蓝 重坦",   "script debug.createUnit('heavyTank', 460.0, 200.0, 1, false)"),
    ("红 激光",   "script debug.createUnit('laserTank', 160.0, 220.0, 0, false)"),
    ("蓝 火炮",   "script debug.createUnit('artillery', 480.0, 220.0, 1, false)"),
    ("红 直升机", "script debug.createUnit('helicopter', 140.0, 180.0, 0, false)"),
    ("蓝 蜘蛛",   "script debug.createUnit('spiderBot', 500.0, 180.0, 1, false)"),
    ("红 巨型坦克","script debug.createUnit('mammothTank', 200.0, 240.0, 0, false)"),
    ("蓝 防空塔", "script debug.createUnit('antiAirTurret', 520.0, 240.0, 1, false)"),
]

print('[3/3] 实时生兵:')
for danmaku, cmd in spawns:
    s.send((cmd + '\n').encode())
    time.sleep(0.3)
    print(f'  弹幕 "{danmaku}" -> 已生成')

s.close()
print('\n完成! 8个单位已实时生成到游戏中')