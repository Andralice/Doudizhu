import { value, suit, cardName, sortCards, newDeck } from '../engine/card';
import { analyze, PlayType, PLAY_TYPE_NAMES, PlayResult, canBeat } from '../engine/rules';
import { getHint } from '../engine/hand';
import { SimpleAI } from './simple';

// ============================================================
// AI Memory — 算牌 + 对局记忆
// ============================================================

export class AIMemory {
  fullDeck: Set<number>;          // all 54 cards
  myHand: Set<number> = new Set();
  playedCards: number[] = [];     // all cards that have been played (chronological)
  bottomCards: number[] = [];     // 底牌 (revealed after bidding)
  playLog: PlayLogEntry[] = [];   // structured play history
  landlordSeat: number = -1;
  mySeat: number = -1;
  opponentSeats: number[] = [];
  isLandlord: boolean = false;

  constructor() {
    this.fullDeck = new Set(newDeck());
  }

  reset() {
    this.myHand.clear();
    this.playedCards = [];
    this.bottomCards = [];
    this.playLog = [];
    this.landlordSeat = -1;
  }

  setHand(cards: number[]) {
    this.myHand = new Set(cards);
  }

  setRole(mySeat: number, landlordSeat: number) {
    this.mySeat = mySeat;
    this.landlordSeat = landlordSeat;
    this.isLandlord = mySeat === landlordSeat;
    this.opponentSeats = [0, 1, 2].filter((s) => s !== mySeat);
  }

  recordPlay(seat: number, cards: number[], playType: PlayType) {
    for (const c of cards) this.playedCards.push(c);
    this.playLog.push({
      seat,
      cards: [...cards],
      playType,
      timestamp: Date.now(),
    });
    // Remove from my hand if it was me
    if (seat === this.mySeat) {
      for (const c of cards) this.myHand.delete(c);
    }
  }

  recordPass(seat: number) {
    this.playLog.push({
      seat,
      cards: [],
      playType: PlayType.Invalid, // means pass
      timestamp: Date.now(),
    });
  }

  // Deduce remaining cards that opponents might have
  getRemainingUnknown(): number[] {
    const known = new Set([
      ...Array.from(this.myHand),
      ...this.playedCards,
      ...this.bottomCards,
    ]);
    return Array.from(this.fullDeck).filter((c) => !known.has(c));
  }

  // Group remaining unknown cards by value for analysis
  getRemainingAnalysis(): string {
    const remaining = this.getRemainingUnknown();
    const byValue = new Map<number, number>();
    for (const c of remaining) {
      const v = value(c);
      byValue.set(v, (byValue.get(v) || 0) + 1);
    }

    const parts: string[] = [];
    const sortedVals = [...byValue.keys()].sort((a, b) => a - b);
    for (const v of sortedVals) {
      const count = byValue.get(v)!;
      const rankName = valName(v);
      parts.push(`${rankName}×${count}`);
    }
    return parts.join(' ') || '无剩余牌';
  }

  // Get cards that are guaranteed to NOT be in opponents' hands
  getPlayedCardAnalysis(): string {
    const byValue = new Map<number, number>();
    for (const c of this.playedCards) {
      const v = value(c);
      byValue.set(v, (byValue.get(v) || 0) + 1);
    }
    // Cards where all 4 are played = 绝张 (none left)
    const exhausted: string[] = [];
    for (const [v, count] of byValue) {
      if (count === 4) exhausted.push(valName(v));
    }
    if (exhausted.length > 0) return `已绝张: ${exhausted.join(' ')}`;
    return '';
  }

  // Recent play history for context
  getRecentHistory(n: number = 8): string {
    const recent = this.playLog.slice(-n);
    if (recent.length === 0) return '（本局刚开始，暂无出牌记录）';
    return recent
      .map((entry) => {
        if (entry.playType === PlayType.Invalid) {
          return `座位${entry.seat}: 不出`;
        }
        const names = entry.cards.map((c) => cardName(c)).join(' ');
        const typeName = PLAY_TYPE_NAMES[entry.playType] || '未知';
        return `座位${entry.seat}: ${names} (${typeName})`;
      })
      .join('\n');
  }
}

interface PlayLogEntry {
  seat: number;
  cards: number[];
  playType: PlayType;
  timestamp: number;
}

function valName(v: number): string {
  if (v === 16) return '小王';
  if (v === 17) return '大王';
  if (v <= 10) return String(v);
  return ['J', 'Q', 'K', 'A', '2'][v - 11];
}

// ============================================================
// System Prompt — 完整的斗地主规则说明书
// ============================================================

const SYSTEM_PROMPT = `你是一个专业的斗地主AI玩家。你精通算牌、记牌和策略。下面是完整的游戏规则。

## 牌的编码
每张牌用一个数字表示：value * 10 + suit
- suit: 0=♠黑桃, 1=♥红桃, 2=♣梅花, 3=♦方块, 4=🃏王牌
- value: 3=3, 4=4, 5=5, 6=6, 7=7, 8=8, 9=9, 10=10, 11=J, 12=Q, 13=K, 14=A, 15=2, 16=小王, 17=大王
- 例如: 黑桃A = 14*10+0 = 140, 红桃3 = 3*10+1 = 31, 大王 = 17*10+4 = 174

大小排序: 3<4<5<6<7<8<9<10<J<Q<K<A<2<小王<大王

## 牌型 (共14种)

| # | 名称 | 说明 | 示例 |
|---|------|------|------|
| 1 | 单张 | 1张牌 | 黑桃3 |
| 2 | 对子 | 2张相同value | 红桃3+梅花3 |
| 3 | 三条 | 3张相同value | 三个5 |
| 4 | 三带一 | 3张相同 + 1张单牌 | 三个5+一张3 |
| 5 | 三带二 | 3张相同 + 1个对子 | 三个5+一对3 |
| 6 | 顺子 | 5~12张连续value(3~A) | 34567/10JQKA |
| 7 | 连对 | 3+对连续value(3~A) | 334455/JJQQKKAA |
| 8 | 飞机不带 | 2+个连续三条(3~A) | 333444 |
| 9 | 飞机带单 | N个连续三条 + N张单牌 | 333444+5+6 |
|10 | 飞机带双 | N个连续三条 + N个对子 | 333444+55+66 |
|11 | 四带二 | 4张相同 + 2张单牌 | 8888+3+5 |
|12 | 四带两对 | 4张相同 + 2个对子 | 8888+33+55 |
|13 | 炸弹 | 4张相同value | 四个9 |
|14 | 火箭/王炸 | 小王+大王 | 16*10+4 + 17*10+4 |

## 比较规则
- 只有同类型牌型才能比较（炸弹和火箭除外）
- 顺子/连对/飞机必须长度相同才能比较
- 同类型比较: mainValue大的获胜
- 炸弹可以大过任何非炸弹牌型
- 火箭可以大过任何牌（包括炸弹）
- 炸弹之间比value大小

## 出牌规则
- 地主先出牌（新一轮）
- 新一轮: 可以出任意合法牌型
- 跟牌: 必须出同类型且更大的牌，或炸弹/火箭
- 过牌(Pass): 选择不出，让给下一家
- 如果两人都Pass，第三家开始新一轮（自由出牌）

## 胜负
- 任意玩家出完手牌即获胜
- 地主赢 = 地主先出完
- 农民赢 = 任一农民先出完（两个农民算一边）

## 核心目标：赢得胜利！
- 你赢的条件：自己手牌出完 = 赢。如果你是农民，队友先出完也算你赢！
- 不要一味压牌！有时放过队友让他出牌更重要
- 如果你是地主：尽快清掉单张和小对子，压制农民
- 如果你是农民：队友出牌时，除非必要不要压
- 手牌≤3张时，毫不犹豫用炸弹拿回牌权清空手牌
- 新一轮优先出小单张或小对子拆掉弱牌
- 算牌：关注已出的2/王/A，推断剩余威胁`;

// ============================================================
// DeepSeek Player — 完整决策AI
// ============================================================

export interface AIDecision {
  action: 'play' | 'pass';
  cards: number[];
  reasoning: string;
}

export class DeepSeekPlayer {
  memory: AIMemory;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  fallbackAI: SimpleAI;

  constructor() {
    this.memory = new AIMemory();
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.fallbackAI = new SimpleAI({ aggression: 0.6, bombThreshold: 0.6 });
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  // ---- Main decision entry point ----

  async decide(
    hand: number[],
    lastPlay: PlayResult | null,
    seat: number,
    isNewRound: boolean,
  ): Promise<AIDecision> {
    // Update memory
    this.memory.setHand(hand);

    // If API not available, use fallback immediately
    if (!this.isAvailable) {
      return this.fallbackDecide(hand, lastPlay, isNewRound);
    }

    // Try DeepSeek (single attempt)
    try {
      const decision = await this.callDeepSeek(hand, lastPlay, seat, isNewRound);
      const validation = this.validateDecision(hand, lastPlay, isNewRound, decision);
      if (validation.valid) return decision;
      console.log(`[AI] Invalid: ${validation.error} | AI returned cards=[${decision.cards.join(',')}] | hand=[${hand.slice(0,8).join(',')}...] | lastPlay=${lastPlay?lastPlay.type+' v='+lastPlay.mainValue:'none'}`);
    } catch (err: any) {
      console.log(`[AI] API error: ${err.message}, using fallback`);
    }

    return this.fallbackDecide(hand, lastPlay, isNewRound);
  }

  // ---- API Call ----

  private async callDeepSeek(
    hand: number[],
    lastPlay: PlayResult | null,
    seat: number,
    isNewRound: boolean,
  ): Promise<AIDecision> {
    const userMessage = this.buildGameStateMessage(hand, lastPlay, seat, isNewRound);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      signal: controller.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2, max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content || '{}';

    return this.parseDecision(content, hand);
  }

  // ---- Build Game State Message ----

  private buildGameStateMessage(
    hand: number[],
    lastPlay: PlayResult | null,
    seat: number,
    isNewRound: boolean,
  ): string {
    const sortedHand = sortCards(hand);
    const handWithNames = sortedHand.map((c) => `${c}(${cardName(c)})`).join(', ');

    const handSummary = this.summarizeHandByType(hand);

    // Opponent info
    const opponent1 = this.memory.opponentSeats[0];
    const opponent2 = this.memory.opponentSeats[1];
    // Estimate opponent card counts from remaining unknown
    const remaining = this.memory.getRemainingUnknown();
    const opp1Count = Math.floor(remaining.length / 2);
    const opp2Count = remaining.length - opp1Count;

    let message = `## 当前局面

**你的身份**: ${this.memory.isLandlord ? '地主' : '农民'}
**你的座位**: ${seat}
**你的手牌** (${hand.length}张): ${handWithNames}
**手牌结构**: ${handSummary}
`;

    if (isNewRound) {
      message += `\n**这是新一轮**，你可以自由出任意合法牌型。`;
    } else if (lastPlay) {
      const lastCards = this.memory.playLog.length > 0
        ? this.memory.playLog[this.memory.playLog.length - 1]
        : null;
      message += `\n**需要压过上一手牌**:
- 上一手牌型: ${PLAY_TYPE_NAMES[lastPlay.type]} (type=${lastPlay.type})
- mainValue: ${lastPlay.mainValue} (${valName(lastPlay.mainValue)})
- chainLength: ${lastPlay.chainLength}
- 你必须出同样的牌型且更大，或出炸弹/火箭，或选择Pass`;
    }

    message += `\n\n## 对手信息
- 座位${opponent1}: 约${opp1Count}张手牌
- 座位${opponent2}: 约${opp2Count}张手牌`;

    // Card counting analysis
    const playedAnalysis = this.memory.getPlayedCardAnalysis();
    const remainingAnalysis = this.memory.getRemainingAnalysis();
    const remainingCards = this.memory.getRemainingUnknown();

    message += `\n\n## 算牌分析
- 已出牌数: ${this.memory.playedCards.length}张
- 未出现牌: ${remainingCards.length}张
- 未出现牌明细: ${remainingAnalysis}
${playedAnalysis ? '- ' + playedAnalysis : ''}`;

    // History
    message += `\n\n## 最近出牌记录
${this.memory.getRecentHistory(10)}`;

    // Instruction
    message += `\n\n## 你的任务
分析局面，决定出牌策略。请返回JSON:

{
  "action": "play" 或 "pass",
  "cards": [卡牌编码列表，如 [140, 130, 120, 110, 100]],
  "reasoning": "<简短说明你的策略思路>"
}

注意:
- 如果选择pass，cards设为 []
- cards中的编码必须来自你的手牌
- 如果是新一轮，出你认为最有利的牌型（通常优先出小单张或小对子拆掉弱牌）
- 如果必须压牌，用最小的能压过的牌
- 如果手牌快出完了(≤3张)，果断用炸弹/火箭拿回牌权
- 作为农民且队友牌少时，尽量帮队友创造牌权`;

    return message;
  }

  // ---- Parse & Validate ----

  private parseDecision(content: string, hand: number[]): AIDecision {
    try {
      const parsed = JSON.parse(content);
      const action = parsed.action === 'pass' ? 'pass' : 'play';
      const cards: number[] = Array.isArray(parsed.cards) ? parsed.cards.map(Number) : [];
      const reasoning: string = parsed.reasoning || '';
      return { action, cards, reasoning };
    } catch {
      return { action: 'pass', cards: [], reasoning: '' };
    }
  }

  private validateDecision(
    hand: number[],
    lastPlay: PlayResult | null,
    isNewRound: boolean,
    decision: AIDecision,
  ): { valid: boolean; error?: string } {
    if (decision.action === 'pass') {
      if (isNewRound) {
        return { valid: false, error: '新一轮不能过牌' };
      }
      // Check if can pass (has playable cards? actually passing is always valid in non-new-round)
      return { valid: true };
    }

    // Check all cards are in hand
    const handCopy = [...hand];
    for (const c of decision.cards) {
      const idx = handCopy.indexOf(c);
      if (idx === -1) {
        return { valid: false, error: `卡牌 ${c}(${cardName(c)}) 不在手牌中` };
      }
      handCopy.splice(idx, 1);
    }

    // Check valid play type
    const result = analyze(decision.cards);
    if (!result || result.type === PlayType.Invalid) {
      return { valid: false, error: '无效的牌型' };
    }

    // If not new round, must beat last play
    if (!isNewRound && lastPlay) {
      if (!canBeat(lastPlay, result)) {
        return { valid: false, error: `无法用 ${PLAY_TYPE_NAMES[result.type]}(${result.mainValue}) 压过 ${PLAY_TYPE_NAMES[lastPlay.type]}(${lastPlay.mainValue})` };
      }
    }

    return { valid: true };
  }

  // ---- Fallback ----

  private fallbackDecide(
    hand: number[],
    lastPlay: PlayResult | null,
    isNewRound: boolean,
  ): AIDecision {
    if (isNewRound || !lastPlay) {
      const cards = this.fallbackAI.decide(hand, null);
      return { action: cards ? 'play' : 'pass', cards: cards || [], reasoning: '规则引擎默认出牌' };
    }
    const cards = this.fallbackAI.decide(hand, lastPlay);
    return { action: cards ? 'play' : 'pass', cards: cards || [], reasoning: cards ? '规则引擎跟牌' : '无牌可出' };
  }

  // ---- Helpers ----

  private summarizeHandByType(hand: number[]): string {
    const groups = new Map<number, number>();
    for (const c of hand) {
      const v = value(c);
      groups.set(v, (groups.get(v) || 0) + 1);
    }

    const bombs: string[] = [];
    const triples: string[] = [];
    const pairs: string[] = [];
    const singles: string[] = [];

    for (const [v, count] of groups) {
      const name = valName(v);
      if (count === 4) bombs.push(name);
      else if (count === 3) triples.push(name);
      else if (count === 2) pairs.push(name);
      else if (count === 1) singles.push(name);
    }

    const parts: string[] = [];
    if (bombs.length > 0) parts.push(`炸弹(${bombs.join('')})`);
    if (triples.length > 0) parts.push(`三条(${triples.join('')})`);
    if (pairs.length > 0) parts.push(`对子(${pairs.join('')})`);
    parts.push(`单牌${singles.length}张`);
    return parts.join('; ');
  }
}

// Singleton
let instance: DeepSeekPlayer | null = null;

export function getDeepSeekPlayer(): DeepSeekPlayer {
  if (!instance) instance = new DeepSeekPlayer();
  return instance;
}
