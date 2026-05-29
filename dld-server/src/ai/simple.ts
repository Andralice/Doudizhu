import { value, sortCards } from '../engine/card';
import { analyze, PlayType, PlayResult } from '../engine/rules';
import { getHint } from '../engine/hand';

export interface AIStrategy {
  aggression: number;   // 0-1, higher = more aggressive (play bigger cards)
  bombThreshold: number; // when to use bombs (0=never, 1=immediately)
}

const DEFAULT_STRATEGY: AIStrategy = {
  aggression: 0.5,
  bombThreshold: 0.7,
};

export class SimpleAI {
  strategy: AIStrategy;

  constructor(strategy?: Partial<AIStrategy>) {
    this.strategy = { ...DEFAULT_STRATEGY, ...strategy };
  }

  decide(hand: number[], lastPlay: PlayResult | null): number[] | null {
    const sorted = sortCards(hand);

    // Use hint system as baseline (smallest valid play)
    const hintCards = getHint(sorted, lastPlay);

    if (!hintCards) return null;

    // With probability based on aggression, play bigger cards
    if (Math.random() < this.strategy.aggression && lastPlay) {
      const betterCards = this.findBetterPlay(sorted, lastPlay);
      if (betterCards) return betterCards;
    }

    return hintCards;
  }

  private findBetterPlay(hand: number[], lastPlay: PlayResult): number[] | null {
    // Group by value to find better options
    const groups = new Map<number, number[]>();
    for (const c of hand) {
      const v = value(c);
      const g = groups.get(v);
      if (g) g.push(c);
      else groups.set(v, [c]);
    }

    const sortedVals = [...groups.keys()].sort((a, b) => a - b);

    switch (lastPlay.type) {
      case PlayType.Single: return this.betterSingle(groups, sortedVals, lastPlay);
      case PlayType.Pair: return this.betterPair(groups, sortedVals, lastPlay);
      case PlayType.Triple:
      case PlayType.TripleOne:
      case PlayType.TriplePair:
        return this.betterTriple(hand, groups, sortedVals, lastPlay);
      case PlayType.Straight:
        return this.betterStraight(hand, groups, sortedVals, lastPlay);
      default:
        return null;
    }
  }

  private betterSingle(groups: Map<number, number[]>, vals: number[], lastPlay: PlayResult): number[] | null {
    // If close to winning, play highest single
    const bigger = vals.filter((v) => v > lastPlay.mainValue).sort((a, b) => b - a);
    if (bigger.length === 0) return null;
    // Bias toward higher values based on aggression
    const idx = Math.floor(Math.random() * bigger.length * (1 - this.strategy.aggression));
    const v = bigger[Math.max(0, Math.min(idx, bigger.length - 1))];
    return [groups.get(v)![0]];
  }

  private betterPair(groups: Map<number, number[]>, vals: number[], lastPlay: PlayResult): number[] | null {
    const bigger = vals.filter((v) => v > lastPlay.mainValue && groups.get(v)!.length >= 2);
    if (bigger.length === 0) return null;
    const idx = Math.floor(Math.random() * bigger.length * (1 - this.strategy.aggression));
    const v = bigger[Math.max(0, Math.min(idx, bigger.length - 1))];
    const cards = groups.get(v)!;
    return cards.slice(0, 2);
  }

  private betterTriple(hand: number[], groups: Map<number, number[]>, vals: number[], lastPlay: PlayResult): number[] | null {
    const bigger = vals.filter((v) => v > lastPlay.mainValue && groups.get(v)!.length >= 3);
    if (bigger.length === 0) return null;
    const v = bigger[bigger.length - 1]; // Play highest triple
    const cards = groups.get(v)!.slice(0, 3);

    // Add kicker if needed
    if (lastPlay.type === PlayType.TripleOne) {
      const kicker = this.findKicker(hand, v, 1);
      if (kicker) return [...cards, ...kicker];
      return null;
    }
    if (lastPlay.type === PlayType.TriplePair) {
      const kicker = this.findKicker(hand, v, 2);
      if (kicker) return [...cards, ...kicker];
      return null;
    }
    return cards;
  }

  private betterStraight(hand: number[], groups: Map<number, number[]>, vals: number[], lastPlay: PlayResult): number[] | null {
    const length = lastPlay.chainLength;
    // Find a higher straight of same length
    for (let start = lastPlay.mainValue - length + 2; start <= 14 - length + 1; start++) {
      const end = start + length - 1;
      if (end <= lastPlay.mainValue) continue;
      if (end > 14) break;
      const cards: number[] = [];
      let valid = true;
      for (let v = start; v <= end; v++) {
        const g = groups.get(v);
        if (!g || g.length < 1) { valid = false; break; }
        cards.push(g[0]);
      }
      if (valid) return cards;
    }
    return null;
  }

  private findKicker(hand: number[], excludeVal: number, count: number): number[] | null {
    const kickers: number[] = [];
    const groups = new Map<number, number[]>();
    for (const c of hand) {
      const v = value(c);
      if (v === excludeVal) continue;
      const g = groups.get(v);
      if (g) g.push(c);
      else groups.set(v, [c]);
    }

    // Find smallest possible kickers
    const vals = [...groups.keys()].sort((a, b) => a - b);
    for (const v of vals) {
      const g = groups.get(v)!;
      if (count === 1) {
        return [g[0]];
      } else if (count === 2 && g.length >= 2) {
        return [g[0], g[1]];
      }
    }
    return null;
  }
}

export function createAI(strategy?: Partial<AIStrategy>): SimpleAI {
  return new SimpleAI(strategy);
}
