export enum GamePhase {
  Waiting = 'waiting',
  Dealing = 'dealing',
  Bidding = 'bidding',
  Doubling = 'doubling',
  Playing = 'playing',
  Finished = 'finished',
}

export enum PlayerRole {
  Unassigned = 0,
  Landlord = 1,
  Farmer = 2,
}

export interface SeatInfo {
  seat: number; // 0, 1, 2
  playerId: string;
  name: string;
  role: PlayerRole;
  handCount: number;
  online: boolean;
  ready: boolean;
}

export interface GameState {
  phase: GamePhase;
  roomId: string;
  seats: (SeatInfo | null)[]; // length 3
  bottomCards: number[]; // 底牌，地主确定后公开
  currentTurnSeat: number | null;
  lastPlaySeat: number | null; // 上一手出牌者的 seat
  lastPlayCards: number[]; // 上一手出的牌
  landlordSeat: number | null;
  baseScore: number; // 底分 (1/2/3)
  multiplier: number; // 倍数（炸弹、火箭会翻倍）
  winnerSeat: number | null; // 赢家 seat (FINISHED 时)
}

export function createInitialState(roomId: string): GameState {
  return {
    phase: GamePhase.Waiting,
    roomId,
    seats: [null, null, null],
    bottomCards: [],
    currentTurnSeat: null,
    lastPlaySeat: null,
    lastPlayCards: [],
    landlordSeat: null,
    baseScore: 1,
    multiplier: 1,
    winnerSeat: null,
  };
}
