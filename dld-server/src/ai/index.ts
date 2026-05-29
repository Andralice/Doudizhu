export { SimpleAI } from './simple';
export { DeepSeekPlayer, AIMemory, getDeepSeekPlayer } from './deepseek';
export type { AIDecision } from './deepseek';

import { DeepSeekPlayer, getDeepSeekPlayer } from './deepseek';
import { SimpleAI } from './simple';

export interface AIPlayer {
  id: string;
  name: string;
  seat: number;
  engine: DeepSeekPlayer;  // primary: DeepSeek with memory
  fallback: SimpleAI;       // fallback: rule-based
}

export function createAIPlayer(id: string, name: string, seat: number): AIPlayer {
  const engine = getDeepSeekPlayer();
  return {
    id,
    name,
    seat,
    engine,
    fallback: new SimpleAI({ aggression: 0.6, bombThreshold: 0.6 }),
  };
}
