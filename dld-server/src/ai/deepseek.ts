import { value, cardName, sortCards } from '../engine/card';
import { PlayType, PLAY_TYPE_NAMES, PlayResult } from '../engine/rules';
import { AIStrategy, SimpleAI } from './simple';

// DeepSeek API is OpenAI-compatible: https://api.deepseek.com/v1/chat/completions
// Set env var DEEPSEEK_API_KEY to enable. If not set, falls back to rule-based AI.

interface GameContext {
  isLandlord: boolean;
  handSize: number;
  opponentLeftSize: number;
  opponentRightSize: number;
  multiplier: number;
  roundNumber: number; // 0 = first round (free play)
  lastPlayType: string | null;
  lastPlayValue: number | null;
  bombCount: number; // estimated bombs from hand
}

export class DeepSeekAdvisor {
  private apiKey: string;
  private baseUrl: string;
  private strategyCache: Map<string, { strategy: AIStrategy; timestamp: number }> = new Map();
  private cacheTtl = 60000; // 60s cache for strategy

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    this.baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  async getStrategy(
    hand: number[],
    context: GameContext,
    playerId: string,
  ): Promise<AIStrategy> {
    // Return default if no API key
    if (!this.isAvailable) {
      return this.defaultStrategy(context);
    }

    // Check cache
    const cached = this.strategyCache.get(playerId);
    if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
      return cached.strategy;
    }

    try {
      const strategy = await this.callDeepSeek(hand, context);
      this.strategyCache.set(playerId, { strategy, timestamp: Date.now() });
      return strategy;
    } catch {
      // Fallback to rule-based on error
      return this.defaultStrategy(context);
    }
  }

  private async callDeepSeek(hand: number[], ctx: GameContext): Promise<AIStrategy> {
    const handSummary = this.summarizeHand(hand);

    const prompt = `你是一个斗地主AI玩家。根据当前局面，返回你的策略参数。

当前局面：
- 身份：${ctx.isLandlord ? '地主' : '农民'}
- 手牌剩余：${ctx.handSize}张
- 对手剩余牌数：左${ctx.opponentLeftSize}张 / 右${ctx.opponentRightSize}张
- 当前倍数：${ctx.multiplier}
- 轮次：${ctx.roundNumber === 0 ? '新一轮（自由出牌）' : '需要压过上一手'}
- 上一手牌型：${ctx.lastPlayType || '无'}
- 上一手牌值：${ctx.lastPlayValue || '无'}
- 手牌摘要：${handSummary}

请返回JSON格式的策略参数（仅返回JSON，不要其他文字）：
{
  "aggression": <0到1之间的数字>,
  "bombThreshold": <0到1之间的数字>,
  "reasoning": "<简短的中文策略说明>"
}

参数说明：
- aggression：0=保守（出最小牌），1=激进（出大牌压制）。手牌少时应该更激进。
- bombThreshold：使用炸弹的阈值。0=永远不用炸弹，1=毫不犹豫用炸弹。手牌快出完时应该更高。`;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一个斗地主AI，只返回JSON。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        aggression: clamp(parsed.aggression ?? 0.5, 0, 1),
        bombThreshold: clamp(parsed.bombThreshold ?? 0.5, 0, 1),
      };
    }

    return this.defaultStrategy(ctx);
  }

  private summarizeHand(hand: number[]): string {
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
      const name = v <= 15 ? (v <= 10 ? String(v) : ['J','Q','K','A','2'][v-11]) : v === 16 ? '小王' : '大王';
      if (count === 4) bombs.push(name);
      else if (count === 3) triples.push(name);
      else if (count === 2) pairs.push(name);
      else singles.push(name);
    }

    const parts: string[] = [];
    if (bombs.length > 0) parts.push(`炸弹:${bombs.join(',')}`);
    if (triples.length > 0) parts.push(`三条:${triples.join(',')}`);
    if (pairs.length > 0) parts.push(`对子:${pairs.join(',')}`);
    parts.push(`单牌:${singles.length}张`);

    return parts.join('; ');
  }

  private defaultStrategy(ctx: GameContext): AIStrategy {
    // Heuristic: more aggressive when close to winning
    const cardsLeft = ctx.handSize;
    let aggression = 0.5;
    let bombThreshold = 0.6;

    if (cardsLeft <= 3) {
      aggression = 0.9;
      bombThreshold = 0.9;
    } else if (cardsLeft <= 6) {
      aggression = 0.7;
      bombThreshold = 0.7;
    } else if (cardsLeft <= 10) {
      aggression = 0.5;
      bombThreshold = 0.5;
    }

    // Landlord plays more conservatively at start
    if (ctx.isLandlord && cardsLeft > 15) {
      aggression = 0.4;
    }

    // Farmers play more aggressively together
    if (!ctx.isLandlord && ctx.roundNumber > 0) {
      aggression += 0.1;
    }

    return { aggression, bombThreshold };
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// Singleton
let instance: DeepSeekAdvisor | null = null;

export function getAdvisor(): DeepSeekAdvisor {
  if (!instance) instance = new DeepSeekAdvisor();
  return instance;
}
