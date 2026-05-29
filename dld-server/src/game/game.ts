import { newDeck, shuffle, deal, sortCards } from '../engine/card';
import { analyze, PlayType, PlayResult, canBeat } from '../engine/rules';
import { hasAnyPlay, getHint } from '../engine/hand';
import { Room } from './room';
import { GamePhase, GameState, PlayerRole, SeatInfo } from './state';

export interface GameEvent {
  type: string;
  payload: any;
}

const BID_TIMEOUT_MS = 30000;
const PLAY_TIMEOUT_MS = 60000;

export class GameManager {
  room: Room;

  constructor(room: Room) {
    this.room = room;
  }

  get state(): GameState {
    return this.room.game;
  }

  // ---- Game lifecycle ----

  startGame(): { events: GameEvent[]; error?: string } {
    const room = this.room;
    if (room.playerCount() < 3) {
      return { events: [], error: '玩家不足 3 人' };
    }
    if (!room.allReady()) {
      return { events: [], error: '有玩家未准备' };
    }

    const deck = shuffle(newDeck());
    const { hands, bottom } = deal(deck);

    for (let i = 0; i < 3; i++) {
      const p = room.players[i]!;
      p.hand = sortCards(hands[i]);
    }

    room.game = {
      ...room.game,
      phase: GamePhase.Bidding,
      bottomCards: bottom,
      baseScore: 1,
      multiplier: 1,
    };

    // Random starting bidder
    const startSeat = Math.floor(Math.random() * 3);
    room.game.currentTurnSeat = startSeat;

    return {
      events: [
        { type: 'game_start', payload: this.buildGameStartPayload() },
        { type: 'bid_turn', payload: { seat: startSeat, currentScore: 0, maxScore: 3 } },
      ],
    };
  }

  // ---- Bidding Phase ----

  bid(playerId: string, score: number): { events: GameEvent[]; error?: string } {
    const state = this.state;
    if (state.phase !== GamePhase.Bidding) {
      return { events: [], error: '不在叫地主阶段' };
    }

    const player = this.room.getPlayer(playerId);
    if (!player) return { events: [], error: '玩家不存在' };
    if (player.seat !== state.currentTurnSeat) {
      return { events: [], error: '还没轮到你叫地主' };
    }
    if (score < 0 || score > 3) {
      return { events: [], error: '叫分必须是 0-3' };
    }

    const currentScore = state.baseScore;
    if (score > 0 && score <= currentScore) {
      return { events: [], error: `叫分必须大于当前最高分 ${currentScore}` };
    }

    const events: GameEvent[] = [];

    if (score > 0) {
      state.baseScore = score;
      state.landlordSeat = player.seat;
      events.push({
        type: 'bid_update',
        payload: { seat: player.seat, score, currentMaxScore: score },
      });
    } else {
      events.push({
        type: 'bid_update',
        payload: { seat: player.seat, score: 0, currentMaxScore: state.baseScore },
      });
    }

    // Check if bidding is over
    // Bidding ends when:
    // 1. Someone bid 3 (max), OR
    // 2. All 3 players have bid and someone has bid > 0
    // 3. All 3 players passed (no one bid) — need re-deal
    const bidCount = this.countPlayersWhoBid();
    const nextSeat = (player.seat + 1) % 3;

    if (score === 3) {
      // Immediate end, landlord is this player
      return this.finishBidding(events);
    }

    if (bidCount >= 3) {
      if (state.landlordSeat !== null) {
        return this.finishBidding(events);
      } else {
        // No one bid — re-deal
        events.push({ type: 'no_bidder', payload: { message: '无人叫地主，重新发牌' } });
        state.phase = GamePhase.Waiting;
        state.currentTurnSeat = null;
        return { events, error: undefined };
      }
    }

    // Continue bidding
    state.currentTurnSeat = nextSeat;
    events.push({
      type: 'bid_turn',
      payload: { seat: nextSeat, currentScore: state.baseScore, maxScore: 3 },
    });

    return { events };
  }

  private countPlayersWhoBid(): number {
    // Count players who have bid (we track this by checking if the bidding has gone around)
    // Simplified: we use baseScore tracking - if baseScore > 0, at least one person bid
    return this.room.players.filter((p) => p !== null).length;
  }

  private finishBidding(prevEvents: GameEvent[]): { events: GameEvent[] } {
    const state = this.state;
    const landlordSeat = state.landlordSeat!;

    // Give bottom cards to landlord
    const landlord = this.room.getPlayerBySeat(landlordSeat)!;
    landlord.hand = sortCards([...landlord.hand, ...state.bottomCards]);

    // Set roles
    for (let i = 0; i < 3; i++) {
      const p = this.room.players[i]!;
      // We track role through the game state
    }

    state.phase = GamePhase.Doubling;
    prevEvents.push({
      type: 'bid_result',
      payload: {
        landlordSeat,
        landlordName: this.room.getPlayerBySeat(landlordSeat)!.name,
        bottomCards: state.bottomCards,
        baseScore: state.baseScore,
      },
    });

    // Start doubling phase
    prevEvents.push({
      type: 'double_turn',
      payload: { seat: landlordSeat, message: '请选择是否加倍' },
    });
    state.currentTurnSeat = landlordSeat;

    return { events: prevEvents };
  }

  // ---- Doubling Phase ----

  double(playerId: string, level: number): { events: GameEvent[]; error?: string } {
    const state = this.state;
    if (state.phase !== GamePhase.Doubling) {
      return { events: [], error: '不在加倍阶段' };
    }

    const player = this.room.getPlayer(playerId);
    if (!player) return { events: [], error: '玩家不存在' };
    if (player.seat !== state.currentTurnSeat) {
      return { events: [], error: '还没轮到你加倍' };
    }
    if (level < 0 || level > 2) {
      return { events: [], error: '加倍等级无效 (0=不加倍, 1=加倍, 2=超级加倍)' };
    }

    const events: GameEvent[] = [];

    if (level === 1) state.multiplier *= 2;
    if (level === 2) state.multiplier *= 4;

    events.push({
      type: 'double_update',
      payload: { seat: player.seat, level, currentMultiplier: state.multiplier },
    });

    // Move to next seat; after all 3, start playing
    const nextSeat = (player.seat + 1) % 3;
    if (nextSeat === state.landlordSeat) {
      // Back to landlord — doubling done, start playing
      return this.startPlaying(events);
    }

    state.currentTurnSeat = nextSeat;
    events.push({
      type: 'double_turn',
      payload: { seat: nextSeat, message: '请选择是否加倍' },
    });

    return { events };
  }

  private startPlaying(prevEvents: GameEvent[]): { events: GameEvent[] } {
    const state = this.state;
    state.phase = GamePhase.Playing;
    state.currentTurnSeat = state.landlordSeat;
    state.lastPlaySeat = null;
    state.lastPlayCards = [];

    prevEvents.push({
      type: 'playing_start',
      payload: {
        currentTurn: state.landlordSeat,
        landlordSeat: state.landlordSeat,
        handCounts: [20, 17, 17], // landlord has 20, others 17
      },
    });

    prevEvents.push({
      type: 'play_turn',
      payload: {
        seat: state.landlordSeat,
        isNewRound: true,
      },
    });

    return { events: prevEvents };
  }

  // ---- Playing Phase ----

  play(playerId: string, cards: number[]): { events: GameEvent[]; error?: string } {
    const state = this.state;
    if (state.phase !== GamePhase.Playing) {
      return { events: [], error: '不在出牌阶段' };
    }

    const player = this.room.getPlayer(playerId);
    if (!player) return { events: [], error: '玩家不存在' };
    if (player.seat !== state.currentTurnSeat) {
      return { events: [], error: '还没轮到你出牌' };
    }

    // Validate play
    const playResult = analyze(cards);
    if (!playResult || playResult.type === PlayType.Invalid) {
      return { events: [], error: '无效的牌型' };
    }

    // Check if this is a new round (no last play or last play was by this player)
    const isNewRound = state.lastPlaySeat === null || state.lastPlaySeat === player.seat;

    if (!isNewRound) {
      const lastResult = analyze(state.lastPlayCards);
      if (!lastResult) {
        return { events: [], error: '内部错误：上一手牌无效' };
      }
      if (!canBeat(lastResult, playResult)) {
        return { events: [], error: '打不过上一手牌' };
      }
    }

    // Remove cards from hand
    for (const c of cards) {
      const idx = player.hand.indexOf(c);
      if (idx === -1) {
        return { events: [], error: '你手中没有这张牌' };
      }
      player.hand.splice(idx, 1);
    }

    // Update bomb/rocket multiplier
    if (playResult.type === PlayType.Bomb) state.multiplier *= 2;
    if (playResult.type === PlayType.Rocket) state.multiplier *= 2;

    // Update state
    state.lastPlaySeat = player.seat;
    state.lastPlayCards = cards;

    const events: GameEvent[] = [];
    events.push({
      type: 'play_result',
      payload: {
        seat: player.seat,
        cards,
        playType: playResult.type,
        handCount: player.hand.length,
      },
    });

    // Check win condition
    if (player.hand.length === 0) {
      return this.gameOver(events, player.seat);
    }

    // Next turn
    const nextSeat = (player.seat + 1) % 3;
    state.currentTurnSeat = nextSeat;

    // Check if next player has any valid play
    const nextPlayer = this.room.getPlayerBySeat(nextSeat)!;
    const nextHasPlay = hasAnyPlay(nextPlayer.hand, playResult);

    events.push({
      type: 'play_turn',
      payload: {
        seat: nextSeat,
        isNewRound: false,
        lastPlaySeat: player.seat,
        lastPlayCards: cards,
        canPass: true,
      },
    });

    return { events };
  }

  pass(playerId: string): { events: GameEvent[]; error?: string } {
    const state = this.state;
    if (state.phase !== GamePhase.Playing) {
      return { events: [], error: '不在出牌阶段' };
    }

    const player = this.room.getPlayer(playerId);
    if (!player) return { events: [], error: '玩家不存在' };
    if (player.seat !== state.currentTurnSeat) {
      return { events: [], error: '还没轮到你' };
    }

    const isNewRound = state.lastPlaySeat === null || state.lastPlaySeat === player.seat;
    if (isNewRound) {
      return { events: [], error: '新一轮不能过牌，必须出牌' };
    }

    const events: GameEvent[] = [];
    events.push({
      type: 'pass_result',
      payload: { seat: player.seat },
    });

    // Next turn
    let nextSeat = (player.seat + 1) % 3;

    // If next player is the one who last played, this starts a new round
    if (nextSeat === state.lastPlaySeat) {
      state.lastPlayCards = [];
      state.lastPlaySeat = null;
      events.push({
        type: 'play_turn',
        payload: {
          seat: nextSeat,
          isNewRound: true,
          canPass: false,
        },
      });
    } else {
      events.push({
        type: 'play_turn',
        payload: {
          seat: nextSeat,
          isNewRound: false,
          lastPlaySeat: state.lastPlaySeat,
          lastPlayCards: state.lastPlayCards,
          canPass: true,
        },
      });
    }

    state.currentTurnSeat = nextSeat;
    return { events };
  }

  hint(playerId: string): { cards: number[] | null; error?: string } {
    const state = this.state;
    if (state.phase !== GamePhase.Playing) {
      return { cards: null, error: '不在出牌阶段' };
    }

    const player = this.room.getPlayer(playerId);
    if (!player) return { cards: null, error: '玩家不存在' };
    if (player.seat !== state.currentTurnSeat) {
      return { cards: null, error: '还没轮到你' };
    }

    const isNewRound = state.lastPlaySeat === null || state.lastPlaySeat === player.seat;
    const lastPlay = isNewRound ? null : analyze(state.lastPlayCards);
    const hintCards = getHint(player.hand, lastPlay);

    return { cards: hintCards };
  }

  private gameOver(prevEvents: GameEvent[], winnerSeat: number): { events: GameEvent[] } {
    const state = this.state;
    state.phase = GamePhase.Finished;
    state.winnerSeat = winnerSeat;

    const landlordSeat = state.landlordSeat!;
    const isLandlordWin = winnerSeat === landlordSeat;
    const landlord = this.room.getPlayerBySeat(landlordSeat)!;

    // Calculate score
    let score = state.baseScore * state.multiplier;

    prevEvents.push({
      type: 'game_end',
      payload: {
        winnerSeat,
        winnerName: this.room.getPlayerBySeat(winnerSeat)!.name,
        isLandlordWin,
        landlordSeat,
        baseScore: state.baseScore,
        multiplier: state.multiplier,
        finalScore: score,
        roles: {
          [landlordSeat]: 'landlord',
          [(landlordSeat + 1) % 3]: 'farmer',
          [(landlordSeat + 2) % 3]: 'farmer',
        },
      },
    });

    return { events: prevEvents };
  }

  // ---- Reset for new game ----

  resetForNewGame(): void {
    const state = this.state;
    state.phase = GamePhase.Waiting;
    state.bottomCards = [];
    state.currentTurnSeat = null;
    state.lastPlaySeat = null;
    state.lastPlayCards = [];
    state.landlordSeat = null;
    state.baseScore = 1;
    state.multiplier = 1;
    state.winnerSeat = null;

    for (const p of this.room.players) {
      if (p) {
        p.hand = [];
        p.ready = false;
      }
    }
  }

  // ---- Helpers ----

  private buildGameStartPayload() {
    const state = this.state;
    const players: any[] = [];
    for (let i = 0; i < 3; i++) {
      const p = this.room.players[i]!;
      players.push({
        seat: i,
        name: p.name,
        hand: p.hand, // Client will only see their own hand (filtered by network layer)
        handCount: p.hand.length,
      });
    }

    return {
      hands: [
        this.room.players[0]!.hand,
        this.room.players[1]!.hand,
        this.room.players[2]!.hand,
      ],
      bidStartSeat: state.currentTurnSeat,
    };
  }
}
