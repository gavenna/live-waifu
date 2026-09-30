import socket, time, json

# 通过弹幕中继 WebSocket 模拟弹幕
import websocket
ws = websocket.create_connection('ws://localhost:8766')

danmakus = [
    {'type':'danmaku','content':'红 坦克','userId':'user1','nickname':'观众A'},
    {'type':'danmaku','content':'蓝 重坦','userId':'user2','nickname':'观众B'},
    {'type':'danmaku','content':'红 激光','userId':'user3','nickname':'观众C'},
    {'type':'danmaku','content':'蓝 火炮','userId':'user4','nickname':'观众D'},
]

for d in danmakus:
    ws.send(json.dumps(d))
    time.sleep(0.5)
    print(f'  弹幕 "{d["content"]}" -> 已发送')

ws.close()
print('\n4条弹幕已通过中继发送!')