import { Room } from '../game/room';
import { GameManager } from '../game/game';
import { GamePhase } from '../game/state';

const ROOM_ID_CHARS = '0123456789';
const ROOM_ID_LENGTH = 6;

function generateRoomId(): string {
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    id += ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)];
  }
  return id;
}

export class Hub {
  rooms: Map<string, Room> = new Map();
  games: Map<string, GameManager> = new Map();
  // Map playerId -> roomId for quick lookup
  playerRooms: Map<string, string> = new Map();

  createRoom(): Room {
    let id: string;
    do {
      id = generateRoomId();
    } while (this.rooms.has(id));

    const room = new Room(id);
    this.rooms.set(id, room);
    this.games.set(id, new GameManager(room));
    return room;
  }

  joinRoom(roomId: string, playerId: string, playerName: string): { success: boolean; room?: Room; seat?: number; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: '房间不存在' };
    }

    // Check if player is already in another room
    const existingRoom = this.playerRooms.get(playerId);
    if (existingRoom && existingRoom !== roomId) {
      this.leaveRoom(playerId);
    }

    const result = room.addPlayer(playerId, playerName);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    this.playerRooms.set(playerId, roomId);
    return { success: true, room, seat: result.seat };
  }

  leaveRoom(playerId: string): { room?: Room; seat?: number } {
    const roomId = this.playerRooms.get(playerId);
    if (!roomId) return {};

    const room = this.rooms.get(roomId);
    if (!room) return {};

    const seat = room.removePlayer(playerId);
    this.playerRooms.delete(playerId);

    // Clean up empty rooms
    if (room.isEmpty()) {
      this.rooms.delete(roomId);
      this.games.delete(roomId);
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

  listRooms(): { roomId: string; playerCount: number; phase: string }[] {
    const result: { roomId: string; playerCount: number; phase: string }[] = [];
    for (const [id, room] of this.rooms) {
      result.push({
        roomId: id,
        playerCount: room.playerCount(),
        phase: room.game.phase,
      });
    }
    return result;
  }
}
