/// Built-in WebSocket relay — 替换 waifu-relay.py
///
/// ws://127.0.0.1:{RELAY_PORT}/status, 接受多客户端，广播消息给其他客户端。
/// app 启动时自动后台运行，不需要用户手动操作。

const RELAY_PORT: u16 = 9191;

use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use futures_util::{SinkExt, StreamExt};

type Tx = tokio::sync::mpsc::UnboundedSender<Message>;

struct Room {
    clients: Vec<(Tx, usize)>, // (sender, id)
    next_id: usize,
}

impl Room {
    fn new() -> Self {
        Self { clients: vec![], next_id: 0 }
    }

    fn add(&mut self, tx: Tx) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        self.clients.push((tx, id));
        id
    }

    fn remove(&mut self, id: usize) {
        self.clients.retain(|(_, cid)| *cid != id);
    }

    fn broadcast(&self, from_id: usize, msg: Message) {
        for (tx, cid) in &self.clients {
            if *cid != from_id {
                let _ = tx.send(msg.clone());
            }
        }
    }
}

pub async fn start() {
    let addr = format!("127.0.0.1:{}", RELAY_PORT);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[ws-relay] bind {}: {}", addr, e);
            return;
        }
    };
    println!("[ws-relay] ws://{}/status", addr);

    let room = Arc::new(Mutex::new(Room::new()));

    while let Ok((stream, _peer)) = listener.accept().await {
        let room = room.clone();
        tokio::spawn(async move {
            let ws = match tokio_tungstenite::accept_async(stream).await {
                Ok(ws) => ws,
                Err(_) => return,
            };
            let (mut tx, mut rx) = ws.split();

            // 注册到房间
            let (bridge_tx, mut bridge_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
            let client_id = room.lock().await.add(bridge_tx);

            // connected 握手
            let handshake = serde_json::json!({"type":"connected","port":RELAY_PORT}).to_string();
            let _ = tx.send(Message::Text(handshake.into())).await;

            // 并行：收客户端消息 → 广播, 收桥接消息 → 发送给此客户端
            let recv_task = {
                let room = room.clone();
                tokio::spawn(async move {
                    while let Some(Ok(msg)) = rx.next().await {
                        if let Message::Text(ref text) = msg {
                            if serde_json::from_str::<serde_json::Value>(text).is_ok() {
                                room.lock().await.broadcast(client_id, msg);
                            }
                        }
                    }
                    room.lock().await.remove(client_id);
                })
            };

            let send_task = tokio::spawn(async move {
                while let Some(msg) = bridge_rx.recv().await {
                    if tx.send(msg).await.is_err() {
                        break;
                    }
                }
            });

            let _ = tokio::join!(recv_task, send_task);
        });
    }
}
