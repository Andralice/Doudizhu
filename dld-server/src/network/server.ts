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
  private roomSockets: Map<string, Set<WebSocket>> = new Map();

  constructor(port: number) {
    this.hub = new Hub();

    // Wire broadcast callback into hub
    this.hub.broadcast = (roomId, msg, senderWs) => {
      this.broadcastToRoom(roomId, msg, senderWs);
    };

    const publicDir = path.join(__dirname, '..', '..', 'public');

    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', rooms: this.hub.rooms.size }));
        return;
      }
      if (req.url === '/rooms') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.hub.listRooms()));
        return;
      }
      const url = req.url === '/' ? '/index.html' : req.url || '/index.html';
      const filePath = path.join(publicDir, url);
      const extMap: Record<string, string> = {
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
      };
      const ext = path.extname(filePath);
      const contentType = extMap[ext] || 'text/plain';

      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      const client = new Client(this.hub, ws);
      this.clients.set(ws, client);

      // Auto-join room sockets when player joins a room
      // We detect room join by watching for ROOM_JOINED messages
      const originalSend = (client as any).send;
      // Instead, track via client message processing: when room_joined/player_joined happens

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

  // Called by hub.broadcast and client.broadcastToRoom
  private broadcastToRoom(roomId: string, msg: { type: string; payload: any }, senderWs?: WebSocket) {
    // Track room membership: when a player joins a room, add their socket
    if (msg.type === S2C.ROOM_JOINED && msg.payload.roomId && senderWs) {
      if (!this.roomSockets.has(msg.payload.roomId)) {
        this.roomSockets.set(msg.payload.roomId, new Set());
      }
      this.roomSockets.get(msg.payload.roomId)!.add(senderWs);
    }

    const sockets = this.roomSockets.get(roomId);
    if (!sockets) return;

    // For game_start, each player only sees their own hand
    if (msg.type === 'game_start') {
      const hands = msg.payload.hands as number[][];
      for (const ws of sockets) {
        const client = this.clients.get(ws);
        if (!client) continue;
        // Access client's internal state to get player info
        const room = this.hub.rooms.get(roomId);
        if (!room) continue;
        // Find this player's seat by matching WebSocket to playerId
        // We iterate to find the right player
        for (const p of room.players) {
          if (!p || p.isAI) continue;
          const pRoom = this.hub.playerRooms.get(p.id);
          if (pRoom === roomId && ws.readyState === WebSocket.OPEN) {
            ws.send(buildMessage('game_start', {
              hand: hands[p.seat],
              handCounts: hands.map((h: number[]) => h.length),
              bidStartSeat: msg.payload.bidStartSeat,
            }));
            break;
          }
        }
      }
      return;
    }

    const data = buildMessage(msg.type, msg.payload);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private removeClientFromRooms(ws: WebSocket) {
    for (const [, sockets] of this.roomSockets) {
      sockets.delete(ws);
    }
  }
}
