import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { Hub } from './hub';
import { Client } from './client';
import { buildMessage, S2C } from './protocol';

export class Server {
  private hub: Hub;
  private wss: WebSocketServer;
  private clients: Map<WebSocket, Client> = new Map();
  // roomId -> Set of ws connections
  private roomSockets: Map<string, Set<WebSocket>> = new Map();

  constructor(port: number) {
    this.hub = new Hub();

    const publicDir = path.join(__dirname, '..', '..', 'public');

    const server = http.createServer((req, res) => {
      // Health check
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', rooms: this.hub.rooms.size }));
        return;
      }
      // List rooms API
      if (req.url === '/rooms') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.hub.listRooms()));
        return;
      }
      // Serve static files
      const url = req.url === '/' ? '/index.html' : req.url || '/index.html';
      const filePath = path.join(publicDir, url);
      const extMap: Record<string, string> = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      const ext = path.extname(filePath);
      const contentType = extMap[ext] || 'text/plain';

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      const client = new Client(this.hub, ws);

      // Setup callbacks
      client.onBroadcast((roomId, msg, senderWs) => {
        this.broadcastToRoom(roomId, msg, senderWs);
      });
      client.onJoinRoom((roomId, ws2) => {
        if (!this.roomSockets.has(roomId)) {
          this.roomSockets.set(roomId, new Set());
        }
        this.roomSockets.get(roomId)!.add(ws2);
      });

      this.clients.set(ws, client);

      // Cleanup on close
      ws.on('close', () => {
        this.removeClientFromRooms(ws);
        this.clients.delete(ws);
      });
    });

    server.listen(port, () => {
      console.log(`斗地主服务器已启动，端口: ${port}`);
      console.log(`WebSocket: ws://localhost:${port}`);
      console.log(`健康检查: http://localhost:${port}/health`);
    });
  }

  private broadcastToRoom(roomId: string, msg: { type: string; payload: any }, senderWs?: WebSocket) {
    const sockets = this.roomSockets.get(roomId);
    if (!sockets) return;

    // For game_start, each player should only see their own hand
    if (msg.type === 'game_start') {
      // Send personalized messages to each player with only their hand
      const hands = msg.payload.hands; // [[cards], [cards], [cards]]
      for (const ws of sockets) {
        const client = this.clients.get(ws);
        const playerId = (client as any)?.state?.playerId;
        if (!playerId) continue;
        // Find seat
        const room = this.hub.rooms.get(roomId);
        if (!room) continue;
        const player = room.getPlayer(playerId);
        if (!player) continue;
        const seat = player.seat;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buildMessage('game_start', {
            hand: hands[seat],
            handCounts: hands.map((h: number[]) => h.length),
            bidStartSeat: msg.payload.bidStartSeat,
          }));
        }
      }
      return;
    }

    // For room_state (reconnect), don't modify — the client handler already built it
    const data = buildMessage(msg.type, msg.payload);
    for (const ws of sockets) {
      if (ws !== senderWs && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private removeClientFromRooms(ws: WebSocket) {
    for (const [roomId, sockets] of this.roomSockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.roomSockets.delete(roomId);
      }
    }
  }
}
