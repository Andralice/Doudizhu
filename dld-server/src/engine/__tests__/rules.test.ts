import { value, encode, Suit } from '../card';
import { analyze, PlayType, canBeat, validatePlay } from '../rules';

function c(suit: Suit, v: number): number {
  return encode(suit, v);
}

const S = Suit.Spade;
const H = Suit.Heart;
const C = Suit.Club;
const D = Suit.Diamond;
const J = Suit.Joker;

function passed(msg: string) {
  console.log(`  ✓ ${msg}`);
}

function failed(msg: string, expected: any, got: any) {
  console.error(`  ✗ ${msg}`);
  console.error(`    expected: ${JSON.stringify(expected)}`);
  console.error(`    got:      ${JSON.stringify(got)}`);
  process.exitCode = 1;
}

function assert(condition: boolean, msg: string) {
  if (condition) passed(msg);
  else { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
}

function assertEq(actual: any, expected: any, msg: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed(msg);
  else failed(msg, expected, actual);
}

function assertType(actual: any, expectedType: PlayType, expectedMainVal: number | null, msg: string) {
  if (actual === null) {
    if (expectedType === null) passed(msg);
    else failed(msg, { type: expectedType }, null);
    return;
  }
  if (actual.type === expectedType && actual.mainValue === expectedMainVal) passed(msg);
  else failed(msg, { type: expectedType, mainValue: expectedMainVal }, { type: actual.type, mainValue: actual.mainValue });
}

// ==================== Single ====================
console.log('\n--- 单张 ---');
{
  const r = analyze([c(S, 5)]);
  assertEq(r?.type, PlayType.Single, 'single 5');
  assertEq(r?.mainValue, 5, 'single 5 mainValue=5');
}

// ==================== Pair ====================
console.log('\n--- 对子 ---');
{
  const r = analyze([c(S, 9), c(H, 9)]);
  assertEq(r?.type, PlayType.Pair, 'pair 99');
  assertEq(r?.mainValue, 9, 'pair 99 mainValue=9');
}

// ==================== Triple ====================
console.log('\n--- 三不带 ---');
{
  const r = analyze([c(S, 7), c(H, 7), c(C, 7)]);
  assertEq(r?.type, PlayType.Triple, 'triple 777');
  assertEq(r?.mainValue, 7, 'triple mainValue=7');
}

// ==================== Triple + 1 ====================
console.log('\n--- 三带一 ---');
{
  const r = analyze([c(S, 7), c(H, 7), c(C, 7), c(S, 3)]);
  assertEq(r?.type, PlayType.TripleOne, '777+3');
  assertEq(r?.mainValue, 7, 'tripleOne mainValue=7');
}

// ==================== Triple + Pair ====================
console.log('\n--- 三带二 ---');
{
  const r = analyze([c(S, 7), c(H, 7), c(C, 7), c(S, 3), c(H, 3)]);
  assertEq(r?.type, PlayType.TriplePair, '777+33');
  assertEq(r?.mainValue, 7, 'triplePair mainValue=7');
}

// ==================== Straight ====================
console.log('\n--- 顺子 ---');
{
  // 34567
  const r = analyze([c(S,3), c(H,4), c(S,5), c(H,6), c(S,7)]);
  assertEq(r?.type, PlayType.Straight, 'straight 3-7');
  assertEq(r?.mainValue, 7, 'straight 3-7 highest=7');
}
{
  // 10 J Q K A
  const r = analyze([c(S,10), c(H,11), c(S,12), c(H,13), c(S,14)]);
  assertEq(r?.type, PlayType.Straight, 'straight 10-A');
  assertEq(r?.mainValue, 14, 'straight 10-A highest=14');
}
{
  // Invalid: contains 2
  const r = analyze([c(S,11), c(H,12), c(S,13), c(H,14), c(S,15)]);
  assertEq(r, null, 'straight with 2 should be invalid');
}

// ==================== Consecutive Pairs ====================
console.log('\n--- 连对 ---');
{
  // 33 44 55
  const r = analyze([c(S,3), c(H,3), c(S,4), c(H,4), c(S,5), c(H,5)]);
  assertEq(r?.type, PlayType.ConsecPair, 'consecPair 334455');
  assertEq(r?.mainValue, 5, 'consecPair highest=5');
}
{
  // Only 2 pairs = not enough (need >= 3)
  const r = analyze([c(S,3), c(H,3), c(S,4), c(H,4)]);
  assertEq(r, null, 'only 2 pairs should be invalid');
}

// ==================== Airplane ====================
console.log('\n--- 飞机 ---');
{
  // 333 444 (pure airplane)
  const r = analyze([c(S,3), c(H,3), c(C,3), c(S,4), c(H,4), c(C,4)]);
  assertEq(r?.type, PlayType.Airplane, 'airplane 333444');
  assertEq(r?.mainValue, 4, 'airplane highest=4');
}
{
  // 333 444 + 5 6 (airplane + singles)
  const r = analyze([c(S,3), c(H,3), c(C,3), c(S,4), c(H,4), c(C,4), c(S,5), c(S,6)]);
  assertEq(r?.type, PlayType.AirplaneSingle, 'airplaneSingle 333444+5+6');
  assertEq(r?.mainValue, 4, 'airplaneSingle highest=4');
}
{
  // 333 444 + 55 66 (airplane + pairs)
  const r = analyze([
    c(S,3), c(H,3), c(C,3), c(S,4), c(H,4), c(C,4),
    c(S,5), c(H,5), c(S,6), c(H,6),
  ]);
  assertEq(r?.type, PlayType.AirplanePair, 'airplanePair 333444+55+66');
  assertEq(r?.mainValue, 4, 'airplanePair highest=4');
}

// ==================== Four + 2 ====================
console.log('\n--- 四带二 ---');
{
  const r = analyze([c(S,8), c(H,8), c(C,8), c(D,8), c(S,3), c(S,5)]);
  assertEq(r?.type, PlayType.FourTwo, 'fourTwo 8888+3+5');
  assertEq(r?.mainValue, 8, 'fourTwo mainValue=8');
}
{
  // 8888 + 33 (pair as the 2)
  const r = analyze([c(S,8), c(H,8), c(C,8), c(D,8), c(S,3), c(H,3)]);
  assertEq(r?.type, PlayType.FourTwo, 'fourTwo 8888+33');
}

// ==================== Four + 2 Pairs ====================
console.log('\n--- 四带两对 ---');
{
  const r = analyze([
    c(S,8), c(H,8), c(C,8), c(D,8),
    c(S,3), c(H,3), c(S,5), c(H,5),
  ]);
  assertEq(r?.type, PlayType.FourTwoPair, 'fourTwoPair 8888+33+55');
  assertEq(r?.mainValue, 8, 'fourTwoPair mainValue=8');
}

// ==================== Bomb ====================
console.log('\n--- 炸弹 ---');
{
  const r = analyze([c(S,9), c(H,9), c(C,9), c(D,9)]);
  assertEq(r?.type, PlayType.Bomb, 'bomb 9999');
  assertEq(r?.mainValue, 9, 'bomb mainValue=9');
}

// ==================== Rocket ====================
console.log('\n--- 火箭 ---');
{
  const r = analyze([c(J,16), c(J,17)]);
  assertEq(r?.type, PlayType.Rocket, 'rocket');
  assertEq(r?.mainValue, 17, 'rocket mainValue=17');
}
{
  // 2 non-jokers are just a pair
  const r = analyze([c(S,3), c(H,3)]);
  assert(r?.type !== PlayType.Rocket, 'pair 33 is not rocket');
}

// ==================== Comparison ====================
console.log('\n--- 出牌比较 ---');
{
  // Same type: bigger beats smaller
  const a = analyze([c(S, 5)])!;
  const b = analyze([c(S, 8)])!;
  assert(canBeat(a, b), '8 beats 5');
  assert(!canBeat(b, a), '5 cannot beat 8');
}
{
  // Same type pair
  const a = analyze([c(S,5), c(H,5)])!;
  const b = analyze([c(S,8), c(H,8)])!;
  assert(canBeat(a, b), '88 beats 55');
  assert(!canBeat(b, a), '55 cannot beat 88');
}
{
  // Same type straight: 45678 beats 34567
  const a = analyze([c(S,3),c(H,4),c(S,5),c(H,6),c(S,7)])!;
  const b = analyze([c(S,4),c(H,5),c(S,6),c(H,7),c(S,8)])!;
  assert(canBeat(a, b), '45678 beats 34567');
}
{
  // Bomb beats single
  const single = analyze([c(S, 3)])!;
  const bomb = analyze([c(S,5), c(H,5), c(C,5), c(D,5)])!;
  assert(canBeat(single, bomb), 'bomb beats single');
  assert(!canBeat(bomb, single), 'single cannot beat bomb');
}
{
  // Rocket beats bomb
  const bomb = analyze([c(S,5), c(H,5), c(C,5), c(D,5)])!;
  const rocket = analyze([c(J,16), c(J,17)])!;
  assert(canBeat(bomb, rocket), 'rocket beats bomb');
  assert(!canBeat(rocket, bomb), 'bomb cannot beat rocket');
}
{
  // Bigger bomb beats smaller bomb
  const b1 = analyze([c(S,3),c(H,3),c(C,3),c(D,3)])!;
  const b2 = analyze([c(S,7),c(H,7),c(C,7),c(D,7)])!;
  assert(canBeat(b1, b2), 'bomb 7777 beats bomb 3333');
}
{
  // Different non-bomb types: can't beat
  const single = analyze([c(S, 8)])!;
  const pair = analyze([c(S,3), c(H,3)])!;
  assert(!canBeat(single, pair), 'pair cannot beat different type single');
}

// ==================== validatePlay ====================
console.log('\n--- 出牌校验 ---');
{
  const hand = [c(S,3), c(H,4), c(S,9), c(H,9), c(C,9), c(D,9)];
  const result = validatePlay(hand, [c(S,3)], null);
  assert(result.valid, 'play single from hand (new round)');
}
{
  const hand = [c(S,3), c(H,4)];
  const result = validatePlay(hand, [c(S,9)], null);
  assert(!result.valid, 'cannot play card not in hand');
}
{
  // Must beat last play
  const hand = [c(S,3), c(H,4), c(S,9)];
  const lastPlay = analyze([c(S, 5)])!;
  const result = validatePlay(hand, [c(S,9)], lastPlay);
  assert(result.valid, '9 beats 5');
}
{
  // Cannot beat with smaller
  const hand = [c(S,3)];
  const lastPlay = analyze([c(S, 5)])!;
  const result = validatePlay(hand, [c(S,3)], lastPlay);
  assert(!result.valid, '3 cannot beat 5');
}

console.log('\n' + (process.exitCode ? '❌ 某些测试失败' : '✅ 所有测试通过'));
