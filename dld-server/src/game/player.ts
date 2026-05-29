export interface PlayerInfo {
  id: string;
  name: string;
  seat: number; // 0, 1, 2
  hand: number[]; // cards in hand
  online: boolean;
  ready: boolean;
}

export function createPlayer(id: string, name: string): PlayerInfo {
  return {
    id,
    name,
    seat: -1,
    hand: [],
    online: true,
    ready: false,
  };
}
