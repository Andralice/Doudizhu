export { SimpleAI, createAI } from './simple';
export type { AIStrategy } from './simple';
export { DeepSeekAdvisor, getAdvisor } from './deepseek';

import { SimpleAI, AIStrategy } from './simple';
import { DeepSeekAdvisor, getAdvisor } from './deepseek';

export interface AIPlayer {
  id: string;
  name: string;
  ai: SimpleAI;
  strategy: AIStrategy;
}

export async function createAIPlayer(
  playerId: string,
  name: string,
  hand?: number[],
): Promise<AIPlayer> {
  const advisor = getAdvisor();

  // Use DeepSeek strategy if available, otherwise use default heuristic
  let strategy: AIStrategy = { aggression: 0.5, bombThreshold: 0.5 };

  if (advisor.isAvailable && hand && hand.length > 0) {
    strategy = await advisor.getStrategy(hand, {
      isLandlord: false,
      handSize: hand.length,
      opponentLeftSize: 17,
      opponentRightSize: 17,
      multiplier: 1,
      roundNumber: 0,
      lastPlayType: null,
      lastPlayValue: null,
      bombCount: 0,
    }, playerId);
  } else {
    // Default heuristic based on hand size
    const size = hand?.length ?? 17;
    if (size <= 3) strategy = { aggression: 0.9, bombThreshold: 0.9 };
    else if (size <= 6) strategy = { aggression: 0.7, bombThreshold: 0.7 };
  }

  return {
    id: playerId,
    name,
    ai: new SimpleAI(strategy),
    strategy,
  };
}
