import { createPlayer, PlayerInfo } from './player';
import { createInitialState, GameState, GamePhase, PlayerRole } from './state';

export interface RoomSummary {
  roomId: string;
  playerCount: number;
  players: { name: string; seat: number }[];
  phase: GamePhase;
}

export class Room {
  id: string;
  players: (PlayerInfo | null)[] = [null, null, null];
  game: GameState;
  private seatAssignCounter = 0;

  constructor(id: string) {
    this.id = id;
    this.game = createInitialState(id);
  }

  addPlayer(playerId: string, name: string): { success: boolean; seat?: number; error?: string } {
    if (this.isFull()) {
      return { success: false, error: '房间已满' };
    }
    // Find first empty seat
    const seat = this.players.findIndex((p) => p === null);
    if (seat === -1) {
      return { success: false, error: '没有空位' };
    }
    const player = createPlayer(playerId, name);
    player.seat = seat;
    this.players[seat] = player;
    return { success: true, seat };
  }

  removePlayer(playerId: string): number | null {
    const idx = this.players.findIndex((p) => p?.id === playerId);
    if (idx === -1) return null;
    this.players[idx] = null;
    return idx;
  }

  getPlayer(playerId: string): PlayerInfo | null {
    return this.players.find((p) => p?.id === playerId) ?? null;
  }

  getPlayerBySeat(seat: number): PlayerInfo | null {
    return this.players[seat] ?? null;
  }

  setPlayerOnline(playerId: string, online: boolean): void {
    const p = this.getPlayer(playerId);
    if (p) p.online = online;
  }

  setPlayerReady(playerId: string, ready: boolean): void {
    const p = this.getPlayer(playerId);
    if (p) p.ready = ready;
  }

  allPlayersOnline(): boolean {
    return this.players.every((p) => p && p.online);
  }

  allReady(): boolean {
    return this.players.every((p) => p && p.ready);
  }

  playerCount(): number {
    return this.players.filter((p) => p !== null).length;
  }

  isFull(): boolean {
    return this.players.every((p) => p !== null);
  }

  isEmpty(): boolean {
    return this.players.every((p) => p === null);
  }

  getSummary(): RoomSummary {
    return {
      roomId: this.id,
      playerCount: this.playerCount(),
      players: this.players
        .filter((p) => p !== null)
        .map((p) => ({ name: p!.name, seat: p!.seat })),
      phase: this.game.phase,
    };
  }
}
