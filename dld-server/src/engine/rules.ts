import { value } from './card';

export enum PlayType {
  Invalid = 0,
  Single = 1,
  Pair = 2,
  Triple = 3,
  TripleOne = 4,
  TriplePair = 5,
  Straight = 6,
  ConsecPair = 7,
  Airplane = 8,
  AirplaneSingle = 9,
  AirplanePair = 10,
  FourTwo = 11,
  FourTwoPair = 12,
  Bomb = 13,
  Rocket = 14,
}

export const PLAY_TYPE_NAMES: Record<PlayType, string> = {
  [PlayType.Invalid]: '无效',
  [PlayType.Single]: '单张',
  [PlayType.Pair]: '对子',
  [PlayType.Triple]: '三条',
  [PlayType.TripleOne]: '三带一',
  [PlayType.TriplePair]: '三带二',
  [PlayType.Straight]: '顺子',
  [PlayType.ConsecPair]: '连对',
  [PlayType.Airplane]: '飞机',
  [PlayType.AirplaneSingle]: '飞机带单',
  [PlayType.AirplanePair]: '飞机带双',
  [PlayType.FourTwo]: '四带二',
  [PlayType.FourTwoPair]: '四带两对',
  [PlayType.Bomb]: '炸弹',
  [PlayType.Rocket]: '火箭',
};

export interface PlayResult {
  type: PlayType;
  mainValue: number;
  chainLength: number; // straights: card count, consecPairs: pair count, airplanes: triple count
}

// Types that require matching chainLength
const CHAIN_TYPES = new Set([
  PlayType.Straight,
  PlayType.ConsecPair,
  PlayType.Airplane,
  PlayType.AirplaneSingle,
  PlayType.AirplanePair,
]);

function mk(type: PlayType, mainValue: number, chainLength = 0): PlayResult {
  return { type, mainValue, chainLength };
}

function groupByValue(cards: number[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const c of cards) {
    const v = value(c);
    const g = map.get(v);
    if (g) g.push(c);
    else map.set(v, [c]);
  }
  return map;
}

function isConsecutive(vals: number[]): boolean {
  if (vals.length < 2) return true;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] !== vals[i - 1] + 1) return false;
  }
  return true;
}

function findConsecutiveTriples(groups: Map<number, number[]>): number[][] {
  const tripleValues: number[] = [];
  for (const [v, cards] of groups) {
    if (cards.length >= 3) tripleValues.push(v);
  }
  tripleValues.sort((a, b) => a - b);

  const sequences: number[][] = [];
  let seq: number[] = [];
  for (let i = 0; i < tripleValues.length; i++) {
    if (seq.length === 0 || tripleValues[i] === seq[seq.length - 1] + 1) {
      seq.push(tripleValues[i]);
    } else {
      if (seq.length >= 2) sequences.push(seq);
      seq = [tripleValues[i]];
    }
  }
  if (seq.length >= 2) sequences.push(seq);
  return sequences;
}

export function analyze(cards: number[]): PlayResult | null {
  const n = cards.length;
  if (n === 0) return null;

  const groups = groupByValue(cards);
  const sortedVals = [...groups.keys()].sort((a, b) => a - b);
  const counts = [...groups.values()].map((g) => g.length);

  // --- Single ---
  if (n === 1) return mk(PlayType.Single, value(cards[0]));

  // --- Pair ---
  if (n === 2 && groups.size === 1 && counts[0] === 2) {
    return mk(PlayType.Pair, sortedVals[0]);
  }

  // --- Rocket (王炸) ---
  if (n === 2 && sortedVals[0] === 16 && sortedVals[1] === 17) {
    return mk(PlayType.Rocket, 17);
  }

  // --- Triple ---
  if (n === 3 && groups.size === 1) {
    return mk(PlayType.Triple, sortedVals[0]);
  }

  // --- Bomb ---
  if (n === 4 && groups.size === 1) {
    return mk(PlayType.Bomb, sortedVals[0]);
  }

  // --- Triple + 1 (三带一) ---
  if (n === 4 && groups.size === 2) {
    const three = sortedVals.find((v) => groups.get(v)!.length === 3);
    const one = sortedVals.find((v) => groups.get(v)!.length === 1);
    if (three !== undefined && one !== undefined) return mk(PlayType.TripleOne, three);
  }

  // --- Triple + Pair (三带二) ---
  if (n === 5 && groups.size === 2) {
    const three = sortedVals.find((v) => groups.get(v)!.length === 3);
    const two = sortedVals.find((v) => groups.get(v)!.length === 2);
    if (three !== undefined && two !== undefined) return mk(PlayType.TriplePair, three);
  }

  // --- Straight (顺子): 5+ singles, consecutive, values 3-14 ---
  if (n >= 5 && groups.size === n && isConsecutive(sortedVals) && sortedVals[n - 1] <= 14) {
    return mk(PlayType.Straight, sortedVals[n - 1], n);
  }

  // --- Consecutive Pairs (连对): 3+ pairs, consecutive, values 3-14 ---
  if (n >= 6 && n % 2 === 0 && counts.every((c) => c === 2)) {
    const pairCount = sortedVals.length;
    if (isConsecutive(sortedVals) && pairCount >= 3 && sortedVals[pairCount - 1] <= 14) {
      return mk(PlayType.ConsecPair, sortedVals[pairCount - 1], pairCount);
    }
  }

  // --- Airplane (飞机) variants ---
  const tripleSeqs = findConsecutiveTriples(groups);
  for (const seq of tripleSeqs) {
    const tripleCount = seq.length;
    const highestTriple = seq[seq.length - 1];
    if (highestTriple > 14) continue;

    // Pure airplane
    if (n === tripleCount * 3 && groups.size === tripleCount) {
      const allTriples = sortedVals.every((v) => groups.get(v)!.length === 3);
      if (allTriples) return mk(PlayType.Airplane, highestTriple, tripleCount);
    }

    // Airplane + singles
    if (n === tripleCount * 4) {
      const nonTriples: number[] = [];
      for (const [v, g] of groups) {
        if (!seq.includes(v)) {
          for (let i = 0; i < g.length; i++) nonTriples.push(v);
        } else if (g.length > 3) {
          for (let i = 3; i < g.length; i++) nonTriples.push(v);
        }
      }
      if (nonTriples.length === tripleCount) return mk(PlayType.AirplaneSingle, highestTriple, tripleCount);
    }

    // Airplane + pairs
    if (n === tripleCount * 5) {
      let pairCount = 0;
      let valid = true;
      for (const [v, g] of groups) {
        if (seq.includes(v)) {
          if (g.length < 3) { valid = false; break; }
          const extra = g.length - 3;
          if (extra === 1) { valid = false; break; }
          if (extra === 2) pairCount++;
        } else {
          if (g.length === 2) pairCount++;
          else if (g.length === 4) pairCount += 2;
          else if (g.length !== 0) { valid = false; break; }
        }
      }
      if (valid && pairCount === tripleCount) return mk(PlayType.AirplanePair, highestTriple, tripleCount);
    }
  }

  // --- Four + 2 singles (四带二) ---
  if (n === 6) {
    const fourVal = sortedVals.find((v) => groups.get(v)!.length === 4);
    if (fourVal !== undefined) return mk(PlayType.FourTwo, fourVal);
  }

  // --- Four + 2 pairs (四带两对) ---
  if (n === 8) {
    const fourVal = sortedVals.find((v) => groups.get(v)!.length === 4);
    if (fourVal !== undefined) {
      let pairCount = 0;
      let valid = true;
      for (const [v, g] of groups) {
        if (v === fourVal) continue;
        if (g.length === 2) pairCount++;
        else if (g.length === 4) pairCount += 2;
        else if (g.length !== 0) { valid = false; break; }
      }
      if (valid && pairCount === 2) return mk(PlayType.FourTwoPair, fourVal);
    }
  }

  return null;
}

export function canBeat(lastPlay: PlayResult, currentPlay: PlayResult): boolean {
  if (currentPlay.type === PlayType.Rocket) return true;
  if (lastPlay.type === PlayType.Rocket) return false;

  if (currentPlay.type === PlayType.Bomb) {
    if (lastPlay.type !== PlayType.Bomb) return true;
    return currentPlay.mainValue > lastPlay.mainValue;
  }
  if (lastPlay.type === PlayType.Bomb) return false;

  if (currentPlay.type === lastPlay.type) {
    // Chain types must match length
    if (CHAIN_TYPES.has(currentPlay.type)) {
      if (currentPlay.chainLength !== lastPlay.chainLength) return false;
    }
    return currentPlay.mainValue > lastPlay.mainValue;
  }

  return false;
}

export function validatePlay(
  hand: number[],
  play: number[],
  lastPlay: PlayResult | null,
): { valid: boolean; result?: PlayResult; error?: string } {
  const handCopy = [...hand];
  for (const c of play) {
    const idx = handCopy.findIndex((h) => h === c);
    if (idx === -1) return { valid: false, error: '出牌中包含不在手牌中的牌' };
    handCopy.splice(idx, 1);
  }

  const result = analyze(play);
  if (!result || result.type === PlayType.Invalid) {
    return { valid: false, error: '无效的牌型' };
  }

  if (!lastPlay) return { valid: true, result };

  if (!canBeat(lastPlay, result)) {
    return { valid: false, error: '牌型不匹配或不够大，无法压过上一手牌' };
  }

  return { valid: true, result };
}
