import { value, sortCards } from './card';
import { analyze, PlayType, PlayResult } from './rules';

export function groupByValue(cards: number[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const c of cards) {
    const v = value(c);
    const g = map.get(v);
    if (g) g.push(c);
    else map.set(v, [c]);
  }
  return map;
}

export function findPlayableCards(
  hand: number[],
  selectedCards: number[],
  lastPlay: PlayResult | null,
): number[] {
  if (selectedCards.length === 0) return [];

  const result = analyze(selectedCards);
  if (!result) return [];

  // New round: any valid play is OK
  if (!lastPlay) return [...selectedCards];

  // Same type: find ALL possible plays of this type that beat lastPlay
  if (lastPlay.type === result.type) {
    return findBetterSameType(hand, lastPlay);
  }

  // Different type: only bomb/rocket can beat non-bomb
  if (lastPlay.type !== PlayType.Bomb && lastPlay.type !== PlayType.Rocket) {
    // Can play bomb or rocket
    const bombs = findAllBombs(hand);
    if (result.type === PlayType.Bomb) {
      return bombs.find((b) => b.result.mainValue > lastPlay.mainValue)?.cards ?? [];
    }
    if (result.type === PlayType.Rocket) {
      return findAllRocket(hand) ?? [];
    }
  }

  return [];
}

interface ScoredPlay {
  cards: number[];
  result: PlayResult;
  score: number; // lower = better (smaller cards first)
}

export function getHint(
  hand: number[],
  lastPlay: PlayResult | null,
): number[] | null {
  const sorted = sortCards(hand);

  if (!lastPlay) {
    // New round: play the smallest valid play
    // Prefer: single smallest > pair smallest > triple smallest > straight
    const single = sorted[sorted.length - 1];
    if (single !== undefined) return [single];

    // Try smallest pair
    const groups = groupByValue(sorted);
    for (const [v, cards] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      if (cards.length >= 2) return cards.slice(0, 2);
    }

    return null;
  }

  // Must beat last play
  const candidates = findAllBetterPlays(sorted, lastPlay);
  if (candidates.length === 0) return null;

  // Return the "smallest" winning play (lowest score)
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0].cards;
}

function findAllBetterPlays(hand: number[], lastPlay: PlayResult): ScoredPlay[] {
  const results: ScoredPlay[] = [];
  const groups = groupByValue(hand);
  const sortedVals = [...groups.keys()].sort((a, b) => a - b);

  // For each type, find better plays
  switch (lastPlay.type) {
    case PlayType.Single:
    case PlayType.Pair:
    case PlayType.Triple:
      findBetterSinglesPairsTriples(hand, groups, sortedVals, lastPlay, results);
      break;
    case PlayType.TripleOne:
      findBetterTripleKicker(groups, sortedVals, lastPlay, 1, results);
      break;
    case PlayType.TriplePair:
      findBetterTripleKicker(groups, sortedVals, lastPlay, 2, results);
      break;
    case PlayType.Straight:
      findBetterStraights(hand, groups, sortedVals, lastPlay, results);
      break;
    case PlayType.ConsecPair:
      findBetterConsecPairs(groups, sortedVals, lastPlay, results);
      break;
    case PlayType.Airplane:
      findBetterAirplanes(groups, sortedVals, lastPlay, false, false, results);
      break;
    case PlayType.AirplaneSingle:
      findBetterAirplanes(groups, sortedVals, lastPlay, true, false, results);
      break;
    case PlayType.AirplanePair:
      findBetterAirplanes(groups, sortedVals, lastPlay, false, true, results);
      break;
    case PlayType.FourTwo:
      findBetterFourTwo(hand, groups, sortedVals, lastPlay, results);
      break;
    case PlayType.FourTwoPair:
      findBetterFourTwoPair(hand, groups, sortedVals, lastPlay, results);
      break;
    case PlayType.Bomb:
      findBetterBombs(groups, sortedVals, lastPlay, results);
      break;
  }

  // Bombs and rocket can always beat non-bomb/non-rocket
  if (lastPlay.type !== PlayType.Bomb && lastPlay.type !== PlayType.Rocket) {
    for (const [v, cards] of groups) {
      if (cards.length === 4) {
        results.push({
          cards: [...cards],
          result: { type: PlayType.Bomb, mainValue: v, chainLength: 0 },
          score: v,
        });
      }
    }
    if (groups.has(16) && groups.has(17)) {
      results.push({
        cards: [groups.get(16)![0], groups.get(17)![0]],
        result: { type: PlayType.Rocket, mainValue: 17, chainLength: 0 },
        score: 0,
      });
    }
  }

  return results;
}

function findBetterSinglesPairsTriples(
  hand: number[],
  groups: Map<number, number[]>,
  sortedVals: number[],
  lastPlay: PlayResult,
  results: ScoredPlay[],
) {
  const minCount = lastPlay.type === PlayType.Single ? 1
    : lastPlay.type === PlayType.Pair ? 2
    : 3; // Triple

  for (const v of sortedVals) {
    if (v > lastPlay.mainValue && (groups.get(v)?.length ?? 0) >= minCount) {
      const cards = groups.get(v)!;
      results.push({
        cards: cards.slice(0, minCount),
        result: { type: lastPlay.type, mainValue: v, chainLength: 0 },
        score: v,
      });
    }
  }
}

function findBetterTripleKicker(
  groups: Map<number, number[]>,
  sortedVals: number[],
  lastPlay: PlayResult,
  kickerType: 1 | 2, // 1 = single kicker, 2 = pair kicker
  results: ScoredPlay[],
) {
  const neededKicker = kickerType;
  const type = kickerType === 1 ? PlayType.TripleOne : PlayType.TriplePair;

  for (const v of sortedVals) {
    const g = groups.get(v);
    if (!g || g.length < 3 || v <= lastPlay.mainValue) continue;

    // Find kicker(s): any card(s) not of the triple value
    const kickers: number[] = [];
    for (const [kv, kg] of groups) {
      if (kv === v) continue;
      if (kickerType === 1 && kg.length >= 1) {
        kickers.push(kg[0]);
        break;
      } else if (kickerType === 2 && kg.length >= 2) {
        kickers.push(kg[0], kg[1]);
        break;
      }
    }

    if (kickers.length === neededKicker) {
      results.push({
        cards: [...g.slice(0, 3), ...kickers],
        result: { type, mainValue: v, chainLength: 0 },
        score: v,
      });
    }
  }
}

function findBetterStraights(
  hand: number[],
  groups: Map<number, number[]>,
  sortedVals: number[],
  lastPlay: PlayResult,
  results: ScoredPlay[],
) {
  const length = 0; // We need to know the length of the last straight
  // Since we don't store the length, we check all straights 5..12
  // But we only consider straights of the SAME length as last play
  // Actually, we don't know the exact length from lastPlay alone.
  // Let's just find any straight with highest value > lastPlay.mainValue
  // and record it — the classify function will validate the exact type match.

  // For simplicity, find all possible straights
  for (let start = 3; start <= 10; start++) {
    for (let len = 5; len <= 12; len++) {
      const end = start + len - 1;
      if (end > 14) break;
      const cards: number[] = [];
      let valid = true;
      for (let v = start; v <= end; v++) {
        const g = groups.get(v);
        if (!g || g.length < 1) { valid = false; break; }
        cards.push(g[0]);
      }
      if (valid && end > lastPlay.mainValue) {
        results.push({
          cards,
          result: { type: PlayType.Straight, mainValue: end, chainLength: len },
          score: end * 100 + start,
        });
      }
    }
  }
}

function findBetterConsecPairs(
  groups: Map<number, number[]>,
  sortedVals: number[],
  lastPlay: PlayResult,
  results: ScoredPlay[],
) {
  for (let start = 3; start <= 12; start++) {
    for (let len = 3; len <= 10; len++) {
      const end = start + len - 1;
      if (end > 14) break;
      const cards: number[] = [];
      let valid = true;
      for (let v = start; v <= end; v++) {
        const g = groups.get(v);
        if (!g || g.length < 2) { valid = false; break; }
        cards.push(g[0], g[1]);
      }
      if (valid && end > lastPlay.mainValue) {
        results.push({
          cards,
          result: { type: PlayType.ConsecPair, mainValue: end, chainLength: len },
          score: end * 100 + start,
        });
      }
    }
  }
}

function findBetterAirplanes(
  groups: Map<number, number[]>,
  sortedVals: number[],
  lastPlay: PlayResult,
  withSingles: boolean,
  withPairs: boolean,
  results: ScoredPlay[],
) {
  // Find all consecutive triples
  for (let start = 3; start <= 13; start++) {
    for (let n = 2; n <= 6; n++) { // 2 to 6 consecutive triples
      const end = start + n - 1;
      if (end > 14) break;

      const tripleCards: number[] = [];
      let valid = true;
      for (let v = start; v <= end; v++) {
        const g = groups.get(v);
        if (!g || g.length < 3) { valid = false; break; }
        tripleCards.push(g[0], g[1], g[2]);
      }
      if (!valid || end <= lastPlay.mainValue) continue;

      // Now find kickers
      if (!withSingles && !withPairs) {
        // Pure airplane: just triples
        // Check no extra cards in triple groups (all exactly 3)
        const allExact3 = [...groups.entries()]
          .filter(([v]) => v >= start && v <= end)
          .every(([_, g]) => g.length === 3);
        if (allExact3 && tripleCards.length === n * 3) {
          results.push({
            cards: tripleCards,
            result: { type: PlayType.Airplane, mainValue: end, chainLength: n },
            score: end * 100 + start,
          });
        }
        continue;
      }

      // Find kicker cards (simplified: just try to grab available cards)
      const usedVals = new Set<number>();
      for (let v = start; v <= end; v++) usedVals.add(v);

      const availableSingles: number[] = [];
      const availablePairs: number[][] = [];

      // Extra cards from triple groups
      for (let v = start; v <= end; v++) {
        const g = groups.get(v)!;
        if (g.length > 3) {
          for (let i = 3; i < g.length; i++) availableSingles.push(g[i]);
        }
      }

      // Cards from non-triple groups
      for (const [v, g] of groups) {
        if (usedVals.has(v)) continue;
        if (g.length >= 2) availablePairs.push([g[0], g[1]]);
        if (g.length >= 1) availableSingles.push(g[0]);
        if (g.length >= 3) {
          // Can also add more singles from this group
          for (let i = 1; i < g.length; i++) availableSingles.push(g[i]);
        }
      }

      if (withSingles && availableSingles.length >= n) {
        const kickers = availableSingles.slice(0, n);
        results.push({
          cards: [...tripleCards, ...kickers],
          result: { type: PlayType.AirplaneSingle, mainValue: end, chainLength: n },
          score: end * 100 + start,
        });
      }

      if (withPairs && availablePairs.length >= n) {
        const kickers = availablePairs.slice(0, n).flat();
        results.push({
          cards: [...tripleCards, ...kickers],
          result: { type: PlayType.AirplanePair, mainValue: end, chainLength: n },
          score: end * 100 + start,
        });
      }
    }
  }
}

function findBetterFourTwo(
  hand: number[],
  groups: Map<number, number[]>,
  sortedVals: number[],
  lastPlay: PlayResult,
  results: ScoredPlay[],
) {
  for (const [v, g] of groups) {
    if (g.length < 4 || v <= lastPlay.mainValue) continue;
    // Find 2 singles
    const singles: number[] = [];
    for (const [kv, kg] of groups) {
      if (kv === v) continue;
      for (const c of kg) {
        singles.push(c);
        if (singles.length >= 2) break;
      }
      if (singles.length >= 2) break;
    }
    if (singles.length >= 2) {
      results.push({
        cards: [...g.slice(0, 4), ...singles],
        result: { type: PlayType.FourTwo, mainValue: v, chainLength: 0 },
        score: v,
      });
    }
  }
}

function findBetterFourTwoPair(
  hand: number[],
  groups: Map<number, number[]>,
  sortedVals: number[],
  lastPlay: PlayResult,
  results: ScoredPlay[],
) {
  for (const [v, g] of groups) {
    if (g.length < 4 || v <= lastPlay.mainValue) continue;
    // Find 2 pairs
    const pairs: number[][] = [];
    for (const [kv, kg] of groups) {
      if (kv === v) continue;
      if (kg.length >= 2) pairs.push([kg[0], kg[1]]);
    }
    if (pairs.length >= 2) {
      results.push({
        cards: [...g.slice(0, 4), ...pairs[0], ...pairs[1]],
        result: { type: PlayType.FourTwoPair, mainValue: v, chainLength: 0 },
        score: v,
      });
    }
  }
}

function findBetterBombs(
  groups: Map<number, number[]>,
  sortedVals: number[],
  lastPlay: PlayResult,
  results: ScoredPlay[],
) {
  for (const [v, g] of groups) {
    if (g.length === 4 && v > lastPlay.mainValue) {
      results.push({
        cards: [...g],
        result: { type: PlayType.Bomb, mainValue: v, chainLength: 0 },
        score: v,
      });
    }
  }
  // Rocket beats any bomb
  if (groups.has(16) && groups.has(17)) {
    results.push({
      cards: [groups.get(16)![0], groups.get(17)![0]],
      result: { type: PlayType.Rocket, mainValue: 17, chainLength: 0 },
      score: 0,
    });
  }
}

function findBetterSameType(
  hand: number[],
  lastPlay: PlayResult,
): number[] {
  const candidates = findAllBetterPlays(hand, lastPlay);
  if (candidates.length === 0) return [];
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0].cards;
}

function findAllBombs(hand: number[]): ScoredPlay[] {
  const groups = groupByValue(hand);
  const results: ScoredPlay[] = [];
  for (const [v, g] of groups) {
    if (g.length === 4) {
      results.push({
        cards: [...g],
        result: { type: PlayType.Bomb, mainValue: v, chainLength: 0 },
        score: v,
      });
    }
  }
  return results;
}

function findAllRocket(hand: number[]): number[] | null {
  const groups = groupByValue(hand);
  if (groups.has(16) && groups.has(17)) {
    return [groups.get(16)![0], groups.get(17)![0]];
  }
  return null;
}

export function hasAnyPlay(hand: number[], lastPlay: PlayResult | null): boolean {
  return getHint(hand, lastPlay) !== null;
}
