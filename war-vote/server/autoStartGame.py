"""
Rusted Warfare 自动启动脚本 — 通过 Debug Socket 远程控制
用法: python autoStartGame.py
功能: 启动游戏 → 开 Debug Socket → 加载地图 → 关闭弹窗 → 进入游戏
"""
import subprocess, socket, time, os

GAME_DIR = r"D:\game\tiexiuzhanzheng_zhengshi_v1.15_anfensi.com\Rusted Warfare1.15"
JAVA_EXE = os.path.join(GAME_DIR, "jvm", "bin", "java.exe")
DEBUG_PORT = 9999
MAP_PATH = "maps/skirmish/live_battle.tmx"

def start_game():
    """启动游戏（带 Debug Socket）"""
    env = os.environ.copy()
    env["PATH"] = GAME_DIR + ";" + env["PATH"]
    proc = subprocess.Popen([
        JAVA_EXE,
        "-Djava.net.preferIPv4Stack=true", "-Xmx1000M", "-Dfile.encoding=UTF-8",
        "-Djava.library.path=.", "-cp", "game-lib.jar;libs/*",
        "com.corrodinggames.rts.java.Main",
        "-debug", f"{DEBUG_PORT}:autostart",
        "-log", "lastrun.log"
    ], cwd=GAME_DIR, env=env)
    return proc

def send_cmd(cmd):
    """通过 Debug Socket 发送命令"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(10)
    s.connect(("127.0.0.1", DEBUG_PORT))
    s.send((cmd + "\n").encode())
    time.sleep(1)
    try:
        resp = s.recv(4096).decode()
    except:
        resp = ""
    s.close()
    return resp

def wait_for_port(port, timeout=15):
    """等待端口可用"""
    for _ in range(timeout * 2):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(1)
            s.connect(("127.0.0.1", port))
            s.close()
            return True
        except:
            time.sleep(0.5)
    return False

def main():
    # 检查游戏是否已运行
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2)
        s.connect(("127.0.0.1", DEBUG_PORT))
        s.send(b"ping\n")
        resp = s.recv(1024).decode()
        s.close()
        if "pong" in resp:
            print("游戏已在运行，直接发送命令")
            send_cmd(f"script root.open('sandboxOptions.rml', '{MAP_PATH}')")
            time.sleep(2)
            send_cmd(f"script root.loadConfigAndStartNewSandbox('{MAP_PATH}')")
            time.sleep(2)
            send_cmd("script root.resume()")
            print("地图已加载!")
            return
    except:
        pass

    # 启动游戏
    print("启动游戏...")
    proc = start_game()

    # 等待 Debug Socket
    print("等待 Debug Socket...")
    if not wait_for_port(DEBUG_PORT):
        print("ERROR: Debug Socket 超时")
        return

    # 发送 ping 验证
    resp = send_cmd("ping")
    print(f"Ping: {resp.strip()}")

    # 打开 sandboxOptions 页面（加载 UI 元素）
    print(f"加载地图: {MAP_PATH}")
    send_cmd(f"script root.open('sandboxOptions.rml', '{MAP_PATH}')")
    time.sleep(2)

    # 启动游戏
    send_cmd(f"script root.loadConfigAndStartNewSandbox('{MAP_PATH}')")
    time.sleep(2)

    # 关闭弹窗（多种方式确保关闭）
    time.sleep(2)
    send_cmd("script root.clickElement(root.getElementById('ok'))")
    time.sleep(0.3)
    send_cmd("script root.closePopup()")
    time.sleep(0.3)
    send_cmd("script root.closeAlertOnly()")
    time.sleep(0.3)
    send_cmd("function root.resumeNonMenu()")
    time.sleep(1)
    print("游戏已自动启动!")

if __name__ == "__main__":
    main()