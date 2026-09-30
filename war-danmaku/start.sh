#!/bin/bash
# war-danmaku 一键启动
# 用法: bash start.sh

cleanup() {
  echo ""
  echo "正在关闭..."
  [ -n "$SERVER_PID" ] && kill $SERVER_PID 2>/dev/null
  echo "已关闭"
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "=== war-danmaku ==="

# 杀旧进程
for port in 8765 8766; do
  pid=$(netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING | awk '{print $NF}' | head -1)
  if [ -n "$pid" ]; then
    cmd //c "taskkill /F /PID $pid" 2>/dev/null
    echo "[OK] 释放端口 $port"
  fi
done
sleep 1

# 启动游戏服务端
node server/index.js &
SERVER_PID=$!
echo "[OK] 游戏服务端 ws://localhost:8765"

# B站: 通过控制面板 :8760 → "启动B站" 按钮启动，走 bilibili.js (Node.js)，无需 Python

echo ""
echo "浏览器 http://localhost:8765"
echo "Ctrl+C 关闭全部"
echo ""

wait
