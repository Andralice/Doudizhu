import { Room } from '../game/room';
import { GameManager } from '../game/game';
import { GamePhase } from '../game/state';
import { createAIPlayer, AIPlayer } from '../ai';
import { analyze, PlayResult } from '../engine/rules';
import { hasAnyPlay } from '../engine/hand';

const ROOM_ID_CHARS = '0123456789';
const ROOM_ID_LENGTH = 6;

const AI_DELAY_MS = 1500;
const AI_NAMES = ['阿尔法', '贝塔', '伽马', '冷锋', '战狼', '棋圣'];

let aiNameIndex = 0;
function nextAIName(): string {
  return AI_NAMES[aiNameIndex++ % AI_NAMES.length];
}

export type BroadcastFn = (roomId: string, msg: { type: string; payload: any }, senderWs?: any) => void;

export class Hub {
  rooms: Map<string, Room> = new Map();
  games: Map<string, GameManager> = new Map();
  playerRooms: Map<string, string> = new Map();
  broadcast: BroadcastFn | null = null;
  private aiTimers: Map<string, NodeJS.Timeout> = new Map();

  createRoom(): Room {
    let id: string;
    do { id = generateRoomId(); } while (this.rooms.has(id));
    const room = new Room(id);
    this.rooms.set(id, room);
    this.games.set(id, new GameManager(room));
    return room;
  }

  joinRoom(roomId: string, playerId: string, playerName: string): { success: boolean; room?: Room; seat?: number; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在' };

    const existingRoom = this.playerRooms.get(playerId);
    if (existingRoom && existingRoom !== roomId) {
      this.leaveRoom(playerId);
    }

    const result = room.addPlayer(playerId, playerName);
    if (!result.success) return { success: false, error: result.error };

    this.playerRooms.set(playerId, roomId);

    // Auto-start if 3 players and all ready
    if (room.isFull() && room.allReady()) {
      setTimeout(() => this.tryStartGame(roomId), 300);
    }

    return { success: true, room, seat: result.seat };
  }

  addAI(roomId: string): { success: boolean; seat?: number; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: '房间不存在' };
    if (room.isFull()) return { success: false, error: '房间已满，无法添加AI' };

    const aiId = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const aiName = nextAIName();
    const aiPlayer = createAIPlayer(aiId, aiName, 0); // seat will be set by room

    const result = room.addPlayer(aiId, aiName, true, aiPlayer);
    if (!result.success) return { success: false, error: result.error };

    // Update AI's seat
    aiPlayer.seat = result.seat!;

    // Notify clients
    if (this.broadcast) {
      this.broadcast(roomId, {
        type: 'player_joined',
        payload: {
          seat: result.seat,
          playerName: aiName,
          isAI: true,
          players: this.buildPlayerListPayload(room),
        },
      });
    }

    // Auto-start if 3 players
    if (room.isFull() && room.allReady()) {
      setTimeout(() => this.tryStartGame(roomId), 300);
    }

    return { success: true, seat: result.seat };
  }

  leaveRoom(playerId: string): { room?: Room; seat?: number } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return {};

    const room = this.rooms.get(roomId);
    if (!room) return {};

    const player = room.getPlayer(playerId);
    if (player?.isAI) return {}; // can't remove AI

    const seat = room.removePlayer(playerId);
    this.playerRooms.delete(playerId);

    // Remove AI players when human leaves (cleanup)
    const aiPlayers = room.players.filter((p) => p?.isAI);
    for (const ai of aiPlayers) {
      if (ai) room.removePlayer(ai.id);
    }

    if (room.isEmpty()) {
      this.rooms.delete(roomId);
      this.games.delete(roomId);
      this.clearAITimer(roomId);
    }

    return { room, seat: seat ?? undefined };
  }

  getRoomByPlayer(playerId: string): Room | null {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return null;
    return this.rooms.get(roomId) ?? null;
  }

  getGameByPlayer(playerId: string): GameManager | null {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return null;
    return this.games.get(roomId) ?? null;
  }

  getGame(roomId: string): GameManager | null {
    return this.games.get(roomId) ?? null;
  }

  // ---- AI Auto-Play ----

  scheduleAITurn(roomId: string) {
    this.clearAITimer(roomId);

    const game = this.games.get(roomId);
    if (!game) return;

    const state = game.state;
    if (state.phase !== GamePhase.Bidding && state.phase !== GamePhase.Doubling && state.phase !== GamePhase.Playing) return;

    const currentSeat = state.currentTurnSeat;
    if (currentSeat === null) return;

    const player = game.room.getPlayerBySeat(currentSeat);
    if (!player?.isAI || !player.aiPlayer) return;

    const timer = setTimeout(() => {
      this.processAITurn(roomId);
    }, AI_DELAY_MS);

    this.aiTimers.set(roomId, timer);
  }

  private async processAITurn(roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return;

    const state = game.state;
    const currentSeat = state.currentTurnSeat;
    if (currentSeat === null) return;

    const player = game.room.getPlayerBySeat(currentSeat);
    if (!player?.isAI || !player.aiPlayer) return;

    const ai = player.aiPlayer;
    const hand = player.hand;

    try {
      let events: { type: string; payload: any }[] = [];

      switch (state.phase) {
        case GamePhase.Bidding: {
          // Simple bidding: bid if have good cards, pass otherwise
          const bidScore = this.aiBidDecision(hand, state.baseScore);
          const result = game.bid(player.id, bidScore);
          if (result.error) {
            // Fallback: pass
            const fallback = game.bid(player.id, 0);
            events = fallback.events;
          } else {
            events = result.events;
          }
          break;
        }
        case GamePhase.Doubling: {
          const result = game.double(player.id, 0);
          events = result.events;
          break;
        }
        case GamePhase.Playing: {
          const isNewRound = state.lastPlaySeat === null || state.lastPlaySeat === currentSeat;
          const lastPlay = isNewRound ? null : analyze(state.lastPlayCards);

          // Use DeepSeek or fallback AI
          let decision: { action: 'play' | 'pass'; cards: number[] };
          const deepseek = ai.engine;

          if (deepseek.isAvailable) {
            decision = await deepseek.decide([...hand], lastPlay, currentSeat, isNewRound);
          } else {
            // Use SimpleAI fallback
            const cards = ai.fallback.decide([...hand], lastPlay);
            decision = { action: cards ? 'play' : 'pass', cards: cards || [] };
          }

          if (decision.action === 'pass' && !isNewRound) {
            const result = game.pass(player.id);
            events = result.events;
          } else if (decision.cards.length > 0) {
            const result = game.play(player.id, decision.cards);
            if (result.error) {
              // Fallback: pass if can, else play smallest
              if (!isNewRound) {
                const pr = game.pass(player.id);
                events = pr.events;
              } else {
                const hintCards = ai.fallback.decide([...hand], null);
                if (hintCards) {
                  const pr2 = game.play(player.id, hintCards);
                  events = pr2.events;
                }
              }
            } else {
              events = result.events;
            }
          } else if (!isNewRound) {
            const result = game.pass(player.id);
            events = result.events;
          }
          break;
        }
      }

      // Dispatch events
      if (events.length > 0 && this.broadcast) {
        for (const ev of events) {
          this.broadcast(roomId, ev);
        }
      }

      // Schedule next AI turn if needed
      this.scheduleNextIfAI(roomId);
    } catch (err) {
      console.error(`[AI] Error processing AI turn:`, err);
      // Try to recover
      this.scheduleNextIfAI(roomId);
    }
  }

  private aiBidDecision(hand: number[], currentScore: number): number {
    // Simple heuristic: count big cards
    let score = 0;
    for (const c of hand) {
      const v = Math.floor(c / 10);
      if (v >= 15) score += 2;   // 2 or joker
      else if (v >= 13) score += 1; // K or A
      else if (c % 10 === 0 && c / 10 >= 3 && c / 10 <= 15) {
        // Check for bombs (4 of a kind)
        const groups = new Map<number, number>();
        for (const h of hand) {
          const hv = Math.floor(h / 10);
          groups.set(hv, (groups.get(hv) || 0) + 1);
        }
        for (const [, count] of groups) {
          if (count === 4) score += 3;
        }
        break; // only count bombs once
      }
    }

    if (score >= 8 && currentScore < 3) return 3;
    if (score >= 5 && currentScore < 2) return 2;
    if (score >= 3 && currentScore < 1) return 1;
    return 0;
  }

  scheduleNextIfAI(roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return;
    const state = game.state;
    if (state.phase === GamePhase.Finished || state.phase === GamePhase.Waiting) return;

    const currentSeat = state.currentTurnSeat;
    if (currentSeat === null) return;

    const player = game.room.getPlayerBySeat(currentSeat);
    if (player?.isAI) {
      this.scheduleAITurn(roomId);
    }
  }

  private clearAITimer(roomId: string) {
    const timer = this.aiTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.aiTimers.delete(roomId);
    }
  }

  // ---- Game Start ----

  tryStartGame(roomId: string) {
    const game = this.games.get(roomId);
    if (!game) return;
    const { events, error } = game.startGame();
    if (error) return;

    if (this.broadcast) {
      for (const ev of events) {
        this.broadcast(roomId, ev);
      }
    }

    // If first bidder is AI, schedule their turn
    this.scheduleNextIfAI(roomId);
  }

  // ---- Helpers ----

  buildPlayerListPayload(room: Room) {
    return room.players.map((p) =>
      p ? { seat: p.seat, name: p.name, handCount: p.hand.length, online: p.online, ready: p.ready, isAI: p.isAI } : null
    );
  }

  listRooms(): { roomId: string; playerCount: number; phase: string }[] {
    const result: { roomId: string; playerCount: number; phase: string }[] = [];
    for (const [id, room] of this.rooms) {
      result.push({ roomId: id, playerCount: room.playerCount(), phase: room.game.phase });
    }
    return result;
  }
}

function generateRoomId(): string {
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)];
  }
  return id;
}
