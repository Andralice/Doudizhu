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
  // Map ws -> playerId for game_start targeting
  private wsPlayerIds: Map<WebSocket, string> = new Map();

  constructor(port: number) {
    this.hub = new Hub();

    // Wire broadcast into hub — used for broadcasting game events to room
    this.hub.broadcast = (roomId, msg, _senderWs) => {
      this.broadcastToRoom(roomId, msg);
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

      // Callbacks for room management
      client.onRegisterInRoom((roomId, playerId) => {
        if (!this.roomSockets.has(roomId)) {
          this.roomSockets.set(roomId, new Set());
        }
        this.roomSockets.get(roomId)!.add(ws);
        this.wsPlayerIds.set(ws, playerId);
      });

      client.onUnregisterFromRoom((roomId) => {
        const sockets = this.roomSockets.get(roomId);
        if (sockets) sockets.delete(ws);
        this.wsPlayerIds.delete(ws);
      });

      ws.on('close', () => {
        for (const [, sockets] of this.roomSockets) { sockets.delete(ws); }
        this.wsPlayerIds.delete(ws);
        this.clients.delete(ws);
      });
    });

    server.listen(port, () => {
      console.log(`斗地主服务器已启动，端口: ${port}`);
      console.log(`WebSocket: ws://localhost:${port}`);
      console.log(`健康检查: http://localhost:${port}/health`);
    });
  }

  private broadcastToRoom(roomId: string, msg: { type: string; payload: any }) {
    const sockets = this.roomSockets.get(roomId);
    if (!sockets || sockets.size === 0) return;

    // For game_start: each human player only sees their own hand
    if (msg.type === 'game_start') {
      const hands = msg.payload.hands as number[][];
      const room = this.hub.rooms.get(roomId);
      if (!room) return;

      for (const ws of sockets) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        const playerId = this.wsPlayerIds.get(ws);
        const player = playerId ? room.getPlayer(playerId) : null;
        const seat = player?.seat ?? 0;
        ws.send(buildMessage('game_start', {
          hand: hands[seat] || [],
          handCounts: hands.map((h: number[]) => h.length),
          bidStartSeat: msg.payload.bidStartSeat,
        }));
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
}
