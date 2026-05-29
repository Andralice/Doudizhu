// Card encoding: value * 10 + suit
// value: 3=3, 4=4, ..., 13=K, 14=A, 15=2, 16=SmallJoker, 17=BigJoker
// suit: 0=Spade, 1=Heart, 2=Club, 3=Diamond, 4=Joker

export const enum Suit {
  Spade = 0,
  Heart = 1,
  Club = 2,
  Diamond = 3,
  Joker = 4,
}

export const SUIT_NAMES = ['♠', '♥', '♣', '♦', '🃏'] as const;

export function suit(card: number): Suit {
  return card % 10 as Suit;
}

export function value(card: number): number {
  return Math.floor(card / 10);
}

export function encode(suit: Suit, value: number): number {
  return value * 10 + suit;
}

export function cardName(card: number): string {
  const v = value(card);
  const s = suit(card);
  if (v === 16) return '小王';
  if (v === 17) return '大王';
  const rank = v <= 10 ? String(v) : ['J', 'Q', 'K', 'A', '2'][v - 11];
  return SUIT_NAMES[s] + rank;
}

export function newDeck(): number[] {
  const deck: number[] = [];
  for (let v = 3; v <= 15; v++) {
    for (let s = 0; s < 4; s++) {
      deck.push(encode(s as Suit, v));
    }
  }
  deck.push(encode(Suit.Joker, 16)); // 小王
  deck.push(encode(Suit.Joker, 17)); // 大王
  return deck;
}

export function shuffle(deck: number[]): number[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function deal(shuffled: number[]): { hands: number[][]; bottom: number[] } {
  // 54 cards: 3 players x 17 + 3 bottom (last 3 are bottom cards)
  return {
    hands: [
      shuffled.slice(0, 17),
      shuffled.slice(17, 34),
      shuffled.slice(34, 51),
    ],
    bottom: shuffled.slice(51, 54),
  };
}

export function sortCards(cards: number[]): number[] {
  return [...cards].sort((a, b) => {
    const dv = value(b) - value(a);
    if (dv !== 0) return dv;
    return suit(a) - suit(b);
  });
}
