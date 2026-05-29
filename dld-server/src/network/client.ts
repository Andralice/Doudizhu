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

const loginTokens: Map<string, { accountId: string; playerName: string; createdAt: number }> = new Map();
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class Client {
  hub: Hub;
  private ws: WebSocket;
  private state: ClientState | null = null;
  private pongReceived = true;
  private pingTimer: NodeJS.Timeout | null = null;
  private _registerCallback: ((roomId: string, playerId: string) => void) | null = null;
  private _unregisterCallback: ((roomId: string) => void) | null = null;

  constructor(hub: Hub, ws: WebSocket) {
    this.hub = hub;
    this.ws = ws;
    this.startHeartbeat(ws);

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch {
        this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Invalid JSON' } });
      }
    });

    ws.on('close', () => { this.stopHeartbeat(); this.handleDisconnect(); });
    ws.on('pong', () => { this.pongReceived = true; });
  }

  onRegisterInRoom(cb: (roomId: string, playerId: string) => void) { this._registerCallback = cb; }
  onUnregisterFromRoom(cb: (roomId: string) => void) { this._unregisterCallback = cb; }

  private startHeartbeat(ws: WebSocket) {
    this.pingTimer = setInterval(() => {
      if (!this.pongReceived) { ws.terminate(); return; }
      this.pongReceived = false;
      ws.ping();
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat() { if (this.pingTimer) clearInterval(this.pingTimer); }

  private send(msg: { type: string; payload: any }) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buildMessage(msg.type, msg.payload));
    }
  }

  private broadcastToRoom(roomId: string, msg: { type: string; payload: any }) {
    if (this.hub.broadcast) this.hub.broadcast(roomId, msg);
  }

  private registerInRoom(roomId: string, playerId: string) {
    if (this._registerCallback) this._registerCallback(roomId, playerId);
  }

  private unregisterFromRoom(roomId: string) {
    if (this._unregisterCallback) this._unregisterCallback(roomId);
  }

  // ---- Message Router ----

  private handleMessage(msg: any) {
    const { type, payload } = msg;
    if (!type) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Missing type' } });

    if (type === 'login') return this.handleLogin(payload);
    if (type === 'register') return this.handleRegister(payload);

    const auth = this.requireAuth();
    if (!auth) return;

    switch (type) {
      case C2S.CREATE_ROOM: return this.handleCreateRoom();
      case C2S.JOIN_ROOM: return this.handleJoinRoom(payload);
      case C2S.LEAVE_ROOM: return this.handleLeaveRoom();
      case C2S.ADD_AI: return this.handleAddAI(payload);
      case C2S.READY: return this.handleReady(payload);
      case C2S.BID: return this.handleBid(payload);
      case 'grab': return this.handleGrab(payload);
      case C2S.DOUBLE: return this.handleDouble(payload);
      case C2S.PLAY: return this.handlePlay(payload);
      case C2S.PASS: return this.handlePass();
      case C2S.HINT: return this.handleHint();
      case C2S.PING: return this.send({ type: S2C.PONG, payload: {} });
      case C2S.RECONNECT: return this.handleReconnect(payload);
      default:
        return this.send({ type: S2C.ERROR, payload: { code: 400, message: `Unknown type: ${type}` } });
    }
  }

  // ---- Auth ----

  private handleRegister(payload: any) {
    const accountId = payload?.accountId?.trim();
    const nickname = payload?.nickname?.trim();
    if (!accountId || !nickname) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: '请填写账号和昵称' } });
    }
    // Import and call store
    const { register } = require('../store/accounts');
    const result = register(accountId, nickname);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: result.error } });
    }
    // Auto-login after register
    const newToken = 'tok_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    loginTokens.set(newToken, { accountId, playerName: nickname, createdAt: Date.now() });
    this.state = { playerId: `p_${accountId}`, playerName: nickname, accountId, token: newToken, ws: this.ws };
    this.send({ type: 'login_ok', payload: { accountId, playerName: nickname, token: newToken, stats: { gamesPlayed: 0, gamesWon: 0, winRate: '0%' } } });
  }

  private handleLogin(payload: any) {
    const token = payload?.token;
    // Token-based re-login
    if (token && !payload?.accountId) {
      const stored = loginTokens.get(token);
      if (stored && Date.now() - stored.createdAt < TOKEN_TTL_MS) {
        const { getStats } = require('../store/accounts');
        const stats = getStats(stored.accountId);
        this.state = { playerId: `p_${stored.accountId}`, playerName: stored.playerName, accountId: stored.accountId, token, ws: this.ws };
        return this.send({ type: 'login_ok', payload: { accountId: stored.accountId, playerName: stored.playerName, token, stats } });
      }
      return this.send({ type: S2C.ERROR, payload: { code: 401, message: 'Token 已过期，请重新登录' } });
    }

    const accountId = payload?.accountId?.trim();
    if (!accountId) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: '请输入账号' } });
    }
    // Check against store
    const { login, getStats } = require('../store/accounts');
    const result = login(accountId);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: result.error } });
    }
    const acc = result.account!;
    const newToken = 'tok_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    loginTokens.set(newToken, { accountId, playerName: acc.nickname, createdAt: Date.now() });
    const stats = getStats(accountId);
    this.state = { playerId: `p_${accountId}`, playerName: acc.nickname, accountId, token: newToken, ws: this.ws };
    this.send({ type: 'login_ok', payload: { accountId, playerName: acc.nickname, token: newToken, stats } });
  }

  private requireAuth(): ClientState | null {
    if (!this.state) {
      this.send({ type: S2C.ERROR, payload: { code: 401, message: '请先登录' } });
      return null;
    }
    return this.state;
  }

  // ---- Room Handlers ----

  private handleCreateRoom() {
    const s = this.state!;
    this.hub.leaveRoom(s.playerId);

    const room = this.hub.createRoom();
    const result = this.hub.joinRoom(room.id, s.playerId, s.playerName);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 500, message: result.error } });
    }

    this.registerInRoom(room.id, s.playerId);

    this.send({
      type: S2C.ROOM_JOINED,
      payload: { roomId: room.id, seat: result.seat, players: this.hub.buildPlayerListPayload(room), phase: room.game.phase },
    });
  }

  private handleJoinRoom(payload: any) {
    const s = this.state!;
    const roomId = payload?.roomId;
    if (!roomId) return this.send({ type: S2C.ERROR, payload: { code: 400, message: '请提供房间号' } });

    const result = this.hub.joinRoom(roomId, s.playerId, s.playerName);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: result.error } });
    }

    const room = result.room!;
    this.registerInRoom(roomId, s.playerId);

    this.send({
      type: S2C.ROOM_JOINED,
      payload: { roomId, seat: result.seat, players: this.hub.buildPlayerListPayload(room), phase: room.game.phase },
    });

    this.broadcastToRoom(roomId, {
      type: S2C.PLAYER_JOINED,
      payload: { seat: result.seat, playerName: s.playerName, isAI: false, players: this.hub.buildPlayerListPayload(room) },
    });
  }

  private handleLeaveRoom() {
    const s = this.state!;
    const room = this.hub.getRoomByPlayer(s.playerId);
    if (room) this.unregisterFromRoom(room.id);

    const result = this.hub.leaveRoom(s.playerId);
    if (result.room) {
      this.broadcastToRoom(result.room.id, {
        type: S2C.PLAYER_LEFT,
        payload: { seat: result.seat, players: this.hub.buildPlayerListPayload(result.room) },
      });
    }

    this.send({ type: 'room_left', payload: {} });
  }

  private handleAddAI(payload: any) {
    const s = this.state!;
    const room = this.hub.getRoomByPlayer(s.playerId);
    if (!room) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Not in a room' } });

    const aiType = (payload?.aiType === 'simple' ? 'simple' : 'deepseek') as 'deepseek' | 'simple';
    const result = this.hub.addAI(room.id, aiType);
    if (!result.success) {
      return this.send({ type: S2C.ERROR, payload: { code: 400, message: result.error } });
    }
    // AI added — player_joined is broadcast by hub.addAI
    // If room is now full, hub.addAI triggers game start
  }

  private handleReady(payload: any) {
    const s = this.state!;
    const room = this.hub.getRoomByPlayer(s.playerId);
    if (!room) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Not in a room' } });

    const player = room.getPlayer(s.playerId);
    if (!player) return;

    // Toggle ready state
    const newReady = payload?.ready ?? !player.ready;
    room.setPlayerReady(s.playerId, newReady);

    // Send updated state just to this player
    this.send({
      type: 'ready_state',
      payload: { ready: newReady, players: this.hub.buildPlayerListPayload(room) },
    });

    // Broadcast to others
    this.broadcastToRoom(room.id, {
      type: S2C.PLAYER_READY,
      payload: { seat: player.seat, playerName: s.playerName, ready: newReady, players: this.hub.buildPlayerListPayload(room) },
    });

    // Check if game should start (all 3 players ready)
    if (room.isFull() && room.allReady()) {
      setTimeout(() => this.hub.tryStartGame(room.id), 400);
    }
  }

  // ---- Game Actions ----

  private handleGrab(payload: any) {
    const s = this.state!;
    const game = this.hub.getGameByPlayer(s.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Game not found' } });
    const wantGrab = payload?.grab ?? false;
    const { events, error } = game.grab(s.playerId, wantGrab);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchEvents(game.room, events);
  }

  private handleBid(payload: any) {
    const s = this.state!;
    const game = this.hub.getGameByPlayer(s.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Game not found' } });
    const score = payload?.score ?? 0;
    const { events, error } = game.bid(s.playerId, score);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchEvents(game.room, events);
  }

  private handleDouble(payload: any) {
    const s = this.state!;
    const game = this.hub.getGameByPlayer(s.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Game not found' } });
    const level = payload?.level ?? 0;
    const { events, error } = game.double(s.playerId, level);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchEvents(game.room, events);
  }

  private handlePlay(payload: any) {
    const s = this.state!;
    const game = this.hub.getGameByPlayer(s.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Game not found' } });
    const cards = payload?.cards ?? [];
    const { events, error } = game.play(s.playerId, cards);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchEvents(game.room, events);
  }

  private handlePass() {
    const s = this.state!;
    const game = this.hub.getGameByPlayer(s.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Game not found' } });
    const { events, error } = game.pass(s.playerId);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.dispatchEvents(game.room, events);
  }

  private handleHint() {
    const s = this.state!;
    const game = this.hub.getGameByPlayer(s.playerId);
    if (!game) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Game not found' } });
    const { cards, error } = game.hint(s.playerId);
    if (error) return this.send({ type: S2C.ERROR, payload: { code: 400, message: error } });
    this.send({ type: S2C.HINT_RESULT, payload: { cards } });
  }

  private handleReconnect(payload: any) {
    const s = this.state!;
    const roomId = payload?.roomId || this.hub.playerRooms.get(s.playerId);
    if (!roomId) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'No room found' } });
    const room = this.hub.rooms.get(roomId);
    if (!room) return this.send({ type: S2C.ERROR, payload: { code: 400, message: 'Room gone' } });

    room.setPlayerOnline(s.playerId, true);
    this.hub.playerRooms.set(s.playerId, roomId);
    this.registerInRoom(roomId, s.playerId);

    this.sendFullState(room);
    const player = room.getPlayer(s.playerId);
    if (player) {
      this.broadcastToRoom(roomId, {
        type: S2C.PLAYER_RECONNECTED,
        payload: { seat: player.seat, playerName: s.playerName },
      });
    }
  }

  // ---- Helpers ----

  private dispatchEvents(room: Room, events: { type: string; payload: any }[]) {
    for (const ev of events) {
      this.broadcastToRoom(room.id, ev);
    }
    this.hub.scheduleNextIfAI(room.id);
  }

  private sendFullState(room: Room) {
    const s = this.state!;
    const state = room.game;
    const player = room.getPlayer(s.playerId);
    const hand = player ? sortCards(player.hand) : [];

    this.send({
      type: S2C.ROOM_STATE,
      payload: {
        roomId: room.id, phase: state.phase, seat: player?.seat, hand,
        players: this.hub.buildPlayerListPayload(room),
        bottomCards: (state.phase !== GamePhase.Waiting && state.phase !== GamePhase.Bidding) ? state.bottomCards : [],
        currentTurnSeat: state.currentTurnSeat, lastPlaySeat: state.lastPlaySeat,
        lastPlayCards: state.lastPlayCards, landlordSeat: state.landlordSeat,
        baseScore: state.baseScore, multiplier: state.multiplier,
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
