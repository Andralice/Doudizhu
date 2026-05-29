export { SimpleAI } from './simple';
export { DeepSeekPlayer, AIMemory, getDeepSeekPlayer } from './deepseek';
export type { AIDecision } from './deepseek';

import { DeepSeekPlayer, getDeepSeekPlayer } from './deepseek';
import { SimpleAI } from './simple';

export type AIType = 'deepseek' | 'simple';

export interface AIPlayer {
  id: string;
  name: string;
  seat: number;
  aiType: AIType;
  engine: DeepSeekPlayer;
  fallback: SimpleAI;
}

export function createAIPlayer(id: string, name: string, seat: number, aiType: AIType = 'deepseek'): AIPlayer {
  return {
    id,
    name,
    seat,
    aiType,
    engine: getDeepSeekPlayer(),
    fallback: new SimpleAI({ aggression: 0.6, bombThreshold: 0.6 }),
  };
}
