import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(10)
s.connect(('127.0.0.1', 9999))

# 关闭弹窗
s.send(b"script root.closePopup()\n")
time.sleep(0.5)
s.send(b"function root.resumeNonMenu()\n")
time.sleep(1)

# 生成红方坦克
s.send(b"script debug.createUnit('tank', 200.0, 200.0, 0, false)\n")
time.sleep(0.3)
# 生成蓝方重型坦克
s.send(b"script debug.createUnit('heavyTank', 500.0, 200.0, 1, false)\n")
time.sleep(0.3)
# 生成红方激光坦克
s.send(b"script debug.createUnit('laserTank', 180.0, 220.0, 0, false)\n")
time.sleep(0.3)
# 生成蓝方火炮
s.send(b"script debug.createUnit('artillery', 520.0, 220.0, 1, false)\n")
time.sleep(0.3)
# 生成红方直升机
s.send(b"script debug.createUnit('helicopter', 160.0, 180.0, 0, false)\n")
time.sleep(0.5)

s.close()
print('已生成 5 个单位: 红方(坦克+激光坦克+直升机) vs 蓝方(重坦+火炮)')