import WebSocket from 'ws';
import { Hub } from './hub';
import { Room } from '../game/room';
import { GamePhase } from '../game/state';
import { buildMessage, C2S, S2C } from './protocol';
import { sortCards } from '../engine/card';

interface ClientState {
  playerId: string;
  playerName: string;
  accountId: string;
  token: string;
  ws: WebSocket;
}

const PING_INTERVAL_MS = 15000;

// Simple in-memory login token store
const loginTokens: Map<string, { accountId: string; playerName: string; createdAt: number }> = new Map();
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class Client {
  hub: Hub;
  private ws: WebSocket;
  private state: ClientState | null = null;
  private pongReceived = true;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(hub: Hub, ws: WebSocket) {
    this.hub = hub;
    this.ws = ws;
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

    ws.on('pong', () => { this.pongReceived = true; });
  }

  private startHeartbeat(ws: WebSocket) {
    this.pingTimer = setInterval(() => {
      if (!this.pongReceived) { ws.terminate(); return; }
      this.pongReceived = false;
      ws.ping();
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
  }

  private send(msg: { type: string; payload: any }) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buildMessage(msg.type, msg.payload));
    }
  }

  private broadcastToRoom(roomId: string, msg: { type: string; payload: any }) {
    if (this.hub.broadcast) {
      this.hub.broadcast(roomId, msg, this.ws);
    }
  }

  // ---- Message Handler ----

  private handleMessage(msg: any) {
    const { type, payload } = msg;
    if (!type) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: '缺少 type 字段' } });
    }

    // Login doesn't require auth
    if (type === 'login') return this.handleLogin(payload);

    // All other messages require auth
    const auth = this.requireAuth();
    if (!auth) return;

    switch (type) {
      case C2S.CREATE_ROOM: return this.handleCreateRoom(payload);
      case C2S.JOIN_ROOM: return this.handleJoinRoom(payload);
      case C2S.LEAVE_ROOM: return this.handleLeaveRoom(payload);
      case C2S.ADD_AI: return this.handleAddAI(payload);
      case C2S.READY: return this.handleReady(payload);
      case C2S.BID: return this.handleBid(payload);
      case C2S.DOUBLE: return this.handleDouble(payload);
      case C2S.PLAY: return this.handlePlay(payload);
      case C2S.PASS: return this.handlePass(payload);
      case C2S.HINT: return this.handleHint(payload);
      case C2S.PING: return this.send({ type: S2C.PONG, payload: {} });
      case C2S.RECONNECT: return this.handleReconnect(payload);
      default:
        return this.send({ type: S2C.ERROR, payload: { code: 400, message: `未知的消息类型: ${type}` } });
    }
  }

  // ---- Login ----

  private handleLogin(payload: any) {
    const accountId = payload?.accountId?.trim();
    const playerName = payload?.playerName?.trim();
    const token = payload?.token;

    // Token-based re-login
    if (token && !accountId) {
      const stored = loginTokens.get(token);
      if (stored && Date.now() - stored.createdAt < TOKEN_TTL_MS) {
        this.state = {
          playerId: `p_${stored.accountId}`,
          playerName: stored.playerName,
          accountId: stored.accountId,
          token,
          ws: this.ws,
        };
        return this.send({
          type: 'login_ok',
          payload: { accountId: stored.accountId, playerName: stored.playerName, token },
        });
      }
      return this.send({ type: S2C.ERROR, payload: { code: 401, message: 'Token 已过期，请重新登录' } });
    }

    if (!accountId || !playerName) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: '请输入账号和昵称' } });
    }

    // Simple login: accountId + playerName, no password
    const newToken = 'tok_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    loginTokens.set(newToken, { accountId, playerName, createdAt: Date.now() });

    this.state = {
      playerId: `p_${accountId}`,
      playerName,
      accountId,
      token: newToken,
      ws: this.ws,
    };

    this.send({
      type: 'login_ok',
      payload: { accountId, playerName, token: newToken },
    });
  }

  private requireAuth(): ClientState | null {
    if (!this.state) {
      this.send({ type: S2C.ERROR, payload: { code: 401, message: '请先登录' } });
      return null;
    }
    return this.state;
  }

  // ---- Room Handlers ----

  private handleCreateRoom(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;

    this.hub.leaveRoom(auth.playerId);

    const room = this.hub.createRoom();
    const result = this.hub.joinRoom(room.id, auth.playerId, auth.playerName);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 500, message: result.error } });
    }

    // Send directly to the creating player
    this.send({
      type: S2C.ROOM_JOINED,
      payload: {
        roomId: room.id,
        seat: result.seat,
        players: this.hub.buildPlayerListPayload(room),
        phase: room.game.phase,
      },
    });
    // Also register this socket in the room broadcast set
    this.broadcastToRoom(room.id, {
      type: S2C.ROOM_JOINED,
      payload: { roomId: room.id, seat: result.seat, isSelf: true },
    });
  }

  private handleJoinRoom(payload: any) {
    const auth = this.requireAuth()!;
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
    this.send({
      type: S2C.ROOM_JOINED,
      payload: {
        roomId,
        seat: result.seat,
        players: this.hub.buildPlayerListPayload(room),
        phase: room.game.phase,
      },
    });

    // Register socket in room broadcast set
    this.broadcastToRoom(roomId, {
      type: S2C.ROOM_JOINED,
      payload: { roomId, seat: result.seat, isSelf: true },
    });

    // Notify other players
    this.broadcastToRoom(roomId, {
      type: S2C.PLAYER_JOINED,
      payload: {
        seat: result.seat,
        playerName: auth.playerName,
        isAI: false,
        players: this.hub.buildPlayerListPayload(room),
      },
    });
  }

  private handleLeaveRoom(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;

    const result = this.hub.leaveRoom(auth.playerId);
    if (result.room) {
      this.broadcastToRoom(result.room.id, {
        type: S2C.PLAYER_LEFT,
        payload: { seat: result.seat, players: this.hub.buildPlayerListPayload(result.room) },
      });
    }

    // Send explicit left message so client knows to go back to home
    this.send({ type: 'room_left', payload: {} });
  }

  private handleAddAI(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;

    const room = this.hub.getRoomByPlayer(auth.playerId);
    if (!room) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '你不在任何房间中' } });

    const result = this.hub.addAI(room.id);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: result.error } });
    }
    // addAI already broadcasts player_joined + triggers game start if full
  }

  private handleReady(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;

    const room = this.hub.getRoomByPlayer(auth.playerId);
    if (!room) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '你不在任何房间中' } });

    room.setPlayerReady(auth.playerId, true);

    this.broadcastToRoom(room.id, {
      type: S2C.PLAYER_READY,
      payload: { seat: room.getPlayer(auth.playerId)!.seat, playerName: auth.playerName },
    });
  }

  // ---- Game Action Handlers ----

  private handleBid(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;
    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const score = payload?.score ?? 0;
    const { events, error } = game.bid(auth.playerId, score);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchAndCheckAI(game.room, events);
  }

  private handleDouble(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;
    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const level = payload?.level ?? 0;
    const { events, error } = game.double(auth.playerId, level);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchAndCheckAI(game.room, events);
  }

  private handlePlay(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;
    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const cards = payload?.cards ?? [];
    const { events, error } = game.play(auth.playerId, cards);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchAndCheckAI(game.room, events);
  }

  private handlePass(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;
    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const { events, error } = game.pass(auth.playerId);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchAndCheckAI(game.room, events);
  }

  private handleHint(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;
    const game = this.hub.getGameByPlayer(auth.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '游戏不存在' } });

    const { cards, error } = game.hint(auth.playerId);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.send({ type: S2C.HINT_RESULT, payload: { cards } });
  }

  private handleReconnect(payload: any) {
    const auth = this.requireAuth()!;
    if (!auth) return;

    const roomId = payload?.roomId || this.hub.playerRooms.get(auth.playerId);
    if (!roomId) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '未找到之前的房间' } });

    const room = this.hub.rooms.get(roomId);
    if (!room) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '房间已不存在' } });

    room.setPlayerOnline(auth.playerId, true);
    this.hub.playerRooms.set(auth.playerId, roomId);

    this.sendFullState(room, auth.playerId);

    const player = room.getPlayer(auth.playerId);
    if (player) {
      this.broadcastToRoom(roomId, {
        type: S2C.PLAYER_RECONNECTED,
        payload: { seat: player.seat, playerName: auth.playerName },
      });
    }
  }

  private dispatchAndCheckAI(room: Room, events: { type: string; payload: any }[]) {
    for (const ev of events) {
      this.broadcastToRoom(room.id, ev);
    }
    // After human action, check if next turn is AI
    this.hub.scheduleNextIfAI(room.id);
  }

  private sendFullState(room: Room, playerId: string) {
    const state = room.game;
    const player = room.getPlayer(playerId);
    const hand = player ? sortCards(player.hand) : [];

    this.send({
      type: S2C.ROOM_STATE,
      payload: {
        roomId: room.id,
        phase: state.phase,
        seat: player?.seat,
        hand,
        players: this.hub.buildPlayerListPayload(room),
        bottomCards: (state.phase !== GamePhase.Waiting && state.phase !== GamePhase.Bidding) ? state.bottomCards : [],
        currentTurnSeat: state.currentTurnSeat,
        lastPlaySeat: state.lastPlaySeat,
        lastPlayCards: state.lastPlayCards,
        landlordSeat: state.landlordSeat,
        baseScore: state.baseScore,
        multiplier: state.multiplier,
      },
    });
  }

  private handleDisconnect() {
    if (!this.state) return;
    const result = this.hub.leaveRoom(this.state.playerId);
    if (result.room) {
      this.broadcastToRoom(result.room.id, {
        type: S2C.PLAYER_OFFLINE,
        payload: { seat: result.seat, playerName: this.state.playerName, players: this.hub.buildPlayerListPayload(result.room) },
      });
    }
  }
}
