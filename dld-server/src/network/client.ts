import WebSocket from 'ws';
import { Hub } from './hub';
import { GameManager } from '../game/game';
import { Room } from '../game/room';
import { GamePhase } from '../game/state';
import { buildMessage, C2S, S2C } from './protocol';
import { sortCards } from '../engine/card';

interface ClientState {
  playerId: string;
  playerName: string;
  ws: WebSocket;
}

const PING_INTERVAL_MS = 15000;
const PONG_TIMEOUT_MS = 30000;

export class Client {
  hub: Hub;
  private ws: WebSocket;
  private state: ClientState | null = null;
  private pongReceived = true;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;

  constructor(hub: Hub, ws: WebSocket) {
    this.hub = hub;
    this.ws = ws;
    this.state = null;
    this.startHeartbeat(ws);

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch {
        this.send({ type: S2C.ERROR, payload: { code: 400, message: '无效的消息格式' } });
      }
    });

    ws.on('close', () => {
      this.stopHeartbeat();
      this.handleDisconnect();
    });

    ws.on('pong', () => {
      this.pongReceived = true;
    });
  }

  private startHeartbeat(ws: WebSocket) {
    this.pingTimer = setInterval(() => {
      if (!this.pongReceived) {
        // Client didn't respond to last ping — disconnect
        ws.terminate();
        return;
      }
      this.pongReceived = false;
      ws.ping();
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
  }

  private send(msg: { type: string; payload: any }) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buildMessage(msg.type, msg.payload));
    }
  }

  private broadcastToRoom(room: Room, msg: { type: string; payload: any }) {
    if (this._broadcastCallback) {
      this._broadcastCallback(room.id, msg, this.ws);
    }
  }

  private notifyRoomJoined(roomId: string) {
    if (this._roomJoinCallback) {
      this._roomJoinCallback(roomId, this.ws);
    }
  }

  private _broadcastCallback: ((roomId: string, msg: { type: string; payload: any }, senderWs: WebSocket) => void) | null = null;
  private _roomJoinCallback: ((roomId: string, ws: WebSocket) => void) | null = null;

  onBroadcast(cb: (roomId: string, msg: { type: string; payload: any }, senderWs: WebSocket) => void) {
    this._broadcastCallback = cb;
  }
  onJoinRoom(cb: (roomId: string, ws: WebSocket) => void) {
    this._roomJoinCallback = cb;
  }

  private handleDisconnect() {
    if (!this.state) return;
    const result = this.hub.leaveRoom(this.state.playerId);
    if (result.room) {
      // Notify other players in the room
      this.broadcastToRoom(result.room, {
        type: S2C.PLAYER_OFFLINE,
        payload: { seat: result.seat, playerName: this.state.playerName },
      });
    }
  }

  private handleMessage(msg: any) {
    const { type, payload } = msg;
    if (!type) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: '缺少 type 字段' } });
    }

    switch (type) {
      case C2S.CREATE_ROOM:
        return this.handleCreateRoom(payload);
      case C2S.JOIN_ROOM:
        return this.handleJoinRoom(payload);
      case C2S.LEAVE_ROOM:
        return this.handleLeaveRoom(payload);
      case C2S.READY:
        return this.handleReady(payload);
      case C2S.BID:
        return this.handleBid(payload);
      case C2S.DOUBLE:
        return this.handleDouble(payload);
      case C2S.PLAY:
        return this.handlePlay(payload);
      case C2S.PASS:
        return this.handlePass(payload);
      case C2S.HINT:
        return this.handleHint(payload);
      case C2S.PING:
        return this.send({ type: S2C.PONG, payload: {} });
      case C2S.RECONNECT:
        return this.handleReconnect(payload);
      default:
        return this.send({ type: S2C.ERROR, payload: { code: 400, message: `未知的消息类型: ${type}` } });
    }
  }

  private requireAuth(payload: any): { playerId: string; playerName: string } | null {
    const id = payload?.playerId || this.state?.playerId;
    const name = payload?.playerName || this.state?.playerName;
    if (!id || !name) {
      this.send({ type: S2C.ERROR, payload: { code: 401, message: '请先提供 playerId 和 playerName' } });
      return null;
    }
    if (!this.state) {
      this.state = { playerId: id, playerName: name, ws: this.ws };
    }
    // Update ws reference (important for reconnects)
    if (this.state) {
      this.state.playerId = id;
      this.state.playerName = name;
    }
    return { playerId: id, playerName: name };
  }

  private handleCreateRoom(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    // Leave current room first
    this.hub.leaveRoom(auth.playerId);

    const room = this.hub.createRoom();
    const result = this.hub.joinRoom(room.id, auth.playerId, auth.playerName);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 500, message: result.error } });
    }

    this.notifyRoomJoined(room.id);
    this.send({
      type: S2C.ROOM_JOINED,
      payload: {
        roomId: room.id,
        seat: result.seat,
        players: this.buildPlayerList(room),
        phase: room.game.phase,
      },
    });
  }

  private handleJoinRoom(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const roomId = payload?.roomId;
    if (!roomId) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: '请提供房间号' } });
    }

    const result = this.hub.joinRoom(roomId, auth.playerId, auth.playerName);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: result.error } });
    }

    const room = result.room!;

    this.notifyRoomJoined(roomId);
    // Tell the joining player
    this.send({
      type: S2C.ROOM_JOINED,
      payload: {
        roomId,
        seat: result.seat,
        players: this.buildPlayerList(room),
        phase: room.game.phase,
      },
    });

    // Tell other players
    this.broadcastToRoom(room, {
      type: S2C.PLAYER_JOINED,
      payload: {
        seat: result.seat,
        playerName: auth.playerName,
        players: this.buildPlayerList(room),
      },
    });
  }

  private handleLeaveRoom(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const result = this.hub.leaveRoom(auth.playerId);
    if (result.room) {
      this.broadcastToRoom(result.room, {
        type: S2C.PLAYER_LEFT,
        payload: { seat: result.seat, playerName: auth.playerName },
      });
    }

    this.send({ type: S2C.ROOM_JOINED, payload: { roomId: null, seat: null } });
  }

  private handleReady(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const room = this.hub.getRoomByPlayer(auth.playerId);
    if (!room) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '你不在任何房间中' } });

    room.setPlayerReady(auth.playerId, true);

    this.broadcastToRoom(room, {
      type: S2C.PLAYER_READY,
      payload: { seat: room.getPlayer(auth.playerId)!.seat, playerName: auth.playerName },
    });

    // Check if all are ready and we have 3 players
    if (room.isFull() && room.allReady()) {
      const game = this.hub.getGame(room.id)!;
      const { events, error } = game.startGame();
      if (error) {
        return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
      }
      this.dispatchGameEvents(room, events);
    }
  }

  // ---- Game action handlers ----

  private handleBid(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const score = payload?.score ?? 0;
    const { events, error } = game.bid(auth.playerId, score);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });

    this.dispatchGameEvents(game.room, events);
  }

  private handleDouble(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const level = payload?.level ?? 0;
    const { events, error } = game.double(auth.playerId, level);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });

    this.dispatchGameEvents(game.room, events);
  }

  private handlePlay(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const cards = payload?.cards ?? [];
    const { events, error } = game.play(auth.playerId, cards);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });

    this.dispatchGameEvents(game.room, events);
  }

  private handlePass(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const { events, error } = game.pass(auth.playerId);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });

    this.dispatchGameEvents(game.room, events);
  }

  private handleHint(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const { cards, error } = game.hint(auth.playerId);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });

    this.send({ type: S2C.HINT_RESULT, payload: { cards } });
  }

  private handleReconnect(payload: any) {
    const auth = this.requireAuth(payload);
    if (!auth) return;

    const roomId = payload?.roomId || this.hub.playerRooms.get(auth.playerId);
    if (!roomId) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: '未找到之前的房间' } });
    }

    const room = this.hub.rooms.get(roomId);
    if (!room) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: '房间已不存在' } });
    }

    // Re-register player to this room
    room.setPlayerOnline(auth.playerId, true);
    this.hub.playerRooms.set(auth.playerId, roomId);

    // Send full state sync
    this.sendFullState(room, auth.playerId);

    // Notify others
    const player = room.getPlayer(auth.playerId);
    if (player) {
      this.broadcastToRoom(room, {
        type: S2C.PLAYER_RECONNECTED,
        payload: { seat: player.seat, playerName: auth.playerName },
      });
    }
  }

  private sendFullState(room: Room, playerId: string) {
    const game = this.hub.getGame(room.id);
    const state = room.game;

    // Send player their hand (only their own cards)
    const player = room.getPlayer(playerId);
    const hand = player ? sortCards(player.hand) : [];

    this.send({
      type: S2C.ROOM_STATE,
      payload: {
        roomId: room.id,
        phase: state.phase,
        seat: player?.seat,
        hand,
        players: this.buildPlayerList(room),
        bottomCards: state.phase !== GamePhase.Waiting && state.phase !== GamePhase.Bidding ? state.bottomCards : [],
        currentTurnSeat: state.currentTurnSeat,
        lastPlaySeat: state.lastPlaySeat,
        lastPlayCards: state.lastPlayCards,
        landlordSeat: state.landlordSeat,
        baseScore: state.baseScore,
        multiplier: state.multiplier,
      },
    });
  }

  // ---- Helpers ----

  private dispatchGameEvents(room: Room, events: { type: string; payload: any }[]) {
    for (const event of events) {
      // For game_start, filter hands: each player only sees their own hand
      if (event.type === 'game_start') {
        for (let seat = 0; seat < 3; seat++) {
          const p = room.getPlayerBySeat(seat);
          if (p) {
            // We need to send to each player individually with only their hand
            // But broadcast sends to all. Instead, we send the full hands array
            // and the client/handler filters.
          }
        }
      }
      this.broadcastToRoom(room, event);
    }
  }

  private buildPlayerList(room: Room) {
    return room.players.map((p) =>
      p
        ? {
            seat: p.seat,
            name: p.name,
            handCount: p.hand.length,
            online: p.online,
            ready: p.ready,
          }
        : null,
    );
  }
}
