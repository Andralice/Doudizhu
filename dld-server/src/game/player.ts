import type { AIPlayer } from '../ai';

export interface PlayerInfo {
  id: string;
  name: string;
  seat: number;
  hand: number[];
  online: boolean;
  ready: boolean;
  isAI: boolean;
  aiPlayer?: AIPlayer; // non-null for AI players
}

export function createPlayer(id: string, name: string, isAI = false, aiPlayer?: AIPlayer): PlayerInfo {
  return {
    id,
    name,
    seat: -1,
    hand: [],
    online: !isAI, // AI is always "online"
    ready: !isAI, // AI is always ready
    isAI,
    aiPlayer,
  };
}
