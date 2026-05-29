import { value, suit, sortCards } from '../engine/card';
import { analyze, PlayType, PlayResult, canBeat } from '../engine/rules';

export interface AIStrategy {
  aggression: number;
  bombThreshold: number;
}

export class SimpleAI {
  strategy: AIStrategy;

  constructor(strategy?: Partial<AIStrategy>) {
    this.strategy = { aggression: 0.55, bombThreshold: 0.65, ...strategy };
  }

  decide(hand: number[], lastPlay: PlayResult | null): number[] | null {
    const sorted = sortCards(hand);
    if (!lastPlay) return this.playFree(sorted);

    // Must beat last play
    const sameType = this.findSameTypeBeater(sorted, lastPlay);
    if (sameType) return sameType;

    // Try bomb/rocket
    if (this.strategy.bombThreshold > 0) {
      const bomb = this.useBomb(sorted, lastPlay);
      if (bomb) return bomb;
    }

    return null; // pass
  }

  private playFree(hand: number[]): number[] | null {
    const groups = this.groupByVal(hand);
    const vals = [...groups.keys()].sort((a, b) => a - b);

    // If ≤ 2 cards left, play all
    if (hand.length <= 2) return [...hand];
    if (hand.length === 3) {
      const g = [...groups.entries()];
      if (g.length === 1) return [...hand]; // triple
    }
    if (hand.length === 4) {
      const g = [...groups.entries()];
      if (g.length === 1) return [...hand]; // bomb - don't split if last cards
      if (g.some(([, c]) => c.length >= 3)) {
        // Triple + 1
        const tv = g.find(([, c]) => c.length >= 3)![0];
        const kv = g.find(([v]) => v !== tv)![0];
        return [...groups.get(tv)!.slice(0, 3), groups.get(kv)![0]];
      }
    }

    // Play smallest single if many singles (>3)
    const singles = vals.filter(v => groups.get(v)!.length >= 1);
    const pairs = vals.filter(v => groups.get(v)!.length >= 2);
    const triples = vals.filter(v => groups.get(v)!.length >= 3);

    if (singles.length >= 4 && hand.length > 8) {
      const sv = singles[0];
      return [groups.get(sv)![0]];
    }

    // Play smallest pair if we have several
    if (pairs.length >= 3) {
      const pv = pairs[0];
      return groups.get(pv)!.slice(0, 2);
    }

    // Play triple+1 if available
    if (triples.length > 0 && hand.length > 6) {
      const tv = triples[0];
      const cards = groups.get(tv)!.slice(0, 3);
      const kicker = vals.find(v => v !== tv && groups.get(v)!.length >= 1);
      if (kicker) return [...cards, groups.get(kicker)![0]];
      return cards;
    }

    // Play smallest single
    const sv = singles[0];
    return [groups.get(sv)![0]];
  }

  private findSameTypeBeater(hand: number[], last: PlayResult): number[] | null {
    const groups = this.groupByVal(hand);
    const vals = [...groups.keys()].sort((a, b) => a - b);

    switch (last.type) {
      case PlayType.Single:
        const biggerSingle = vals.find(v => v > last.mainValue && groups.get(v)!.length >= 1);
        if (biggerSingle) return [groups.get(biggerSingle)![0]];
        return null;

      case PlayType.Pair:
        const biggerPair = vals.find(v => v > last.mainValue && groups.get(v)!.length >= 2);
        if (biggerPair) return groups.get(biggerPair)!.slice(0, 2);
        return null;

      case PlayType.Triple:
        const biggerT = vals.find(v => v > last.mainValue && groups.get(v)!.length >= 3);
        if (biggerT) return groups.get(biggerT)!.slice(0, 3);
        return null;

      case PlayType.TripleOne: {
        const bt = vals.find(v => v > last.mainValue && groups.get(v)!.length >= 3);
        if (!bt) return null;
        const kicker = vals.find(v => v !== bt && groups.get(v)!.length >= 1);
        if (!kicker) return null;
        return [...groups.get(bt)!.slice(0, 3), groups.get(kicker)![0]];
      }

      case PlayType.TriplePair: {
        const bt = vals.find(v => v > last.mainValue && groups.get(v)!.length >= 3);
        if (!bt) return null;
        const kicker = vals.find(v => v !== bt && groups.get(v)!.length >= 2);
        if (!kicker) return null;
        return [...groups.get(bt)!.slice(0, 3), ...groups.get(kicker)!.slice(0, 2)];
      }

      case PlayType.Straight:
        return this.beatStraight(hand, groups, last);

      case PlayType.ConsecPair:
        return this.beatConsecPairs(hand, groups, last);

      default:
        // For complex types, try all possible plays
        return this.bruteForce(hand, last);
    }
  }

  private beatStraight(hand: number[], groups: Map<number, number[]>, last: PlayResult): number[] | null {
    const len = last.chainLength;
    for (let start = last.mainValue - len + 2; start <= 14 - len + 1; start++) {
      const end = start + len - 1;
      if (end <= last.mainValue || end > 14) continue;
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

  private beatConsecPairs(hand: number[], groups: Map<number, number[]>, last: PlayResult): number[] | null {
    const len = last.chainLength;
    for (let start = last.mainValue - len + 2; start <= 14 - len + 1; start++) {
      const end = start + len - 1;
      if (end <= last.mainValue || end > 14) continue;
      const cards: number[] = [];
      let valid = true;
      for (let v = start; v <= end; v++) {
        const g = groups.get(v);
        if (!g || g.length < 2) { valid = false; break; }
        cards.push(g[0], g[1]);
      }
      if (valid) return cards;
    }
    return null;
  }

  private bruteForce(hand: number[], last: PlayResult): number[] | null {
    // Try all possible combinations (limited to reasonable sizes)
    const n = hand.length;
    // For airplane types, try triple combinations
    if ([PlayType.Airplane, PlayType.AirplaneSingle, PlayType.AirplanePair].includes(last.type)) {
      // Find bigger triples
      const groups = this.groupByVal(hand);
      const triples = [...groups.entries()].filter(([, c]) => c.length >= 3).map(([v]) => v).sort((a, b) => a - b);
      // Find consecutive sequences
      for (let i = 0; i < triples.length; i++) {
        let seq = [triples[i]];
        for (let j = i + 1; j < triples.length && seq.length < last.chainLength; j++) {
          if (triples[j] === seq[seq.length - 1] + 1) seq.push(triples[j]);
          else break;
        }
        if (seq.length >= last.chainLength && seq[seq.length - 1] > last.mainValue) {
          return null; // Complex - skip brute force for now
        }
      }
    }
    return null;
  }

  private useBomb(hand: number[], last: PlayResult): number[] | null {
    if (last.type === PlayType.Rocket) return null; // can't beat rocket
    const groups = this.groupByVal(hand);
    const vals = [...groups.keys()].sort((a, b) => a - b);

    // If we're close to winning (≤4 cards), use any bomb
    if (hand.length <= 4 && this.strategy.bombThreshold > 0.3) {
      const bomb = vals.find(v => groups.get(v)!.length === 4);
      if (bomb) return groups.get(bomb)!;
    }

    // Use bomb if threshold met
    if (Math.random() < this.strategy.bombThreshold) {
      const bomb = vals.find(v => {
        if (groups.get(v)!.length < 4) return false;
        if (last.type === PlayType.Bomb) return v > last.mainValue;
        return true;
      });
      if (bomb) return groups.get(bomb)!;
    }

    // Use rocket as last resort
    if (groups.has(16) && groups.has(17) && hand.length <= 5) {
      return [groups.get(16)![0], groups.get(17)![0]];
    }

    return null;
  }

  private groupByVal(hand: number[]): Map<number, number[]> {
    const m = new Map<number, number[]>();
    for (const c of hand) {
      const v = value(c);
      const g = m.get(v);
      if (g) g.push(c);
      else m.set(v, [c]);
    }
    return m;
  }
}
