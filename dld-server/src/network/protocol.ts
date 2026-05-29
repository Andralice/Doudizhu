// All messages have the format: { type: string, payload: any }

export interface ServerMessage {
  type: string;
  payload: any;
}

// Client -> Server message types
export const C2S = {
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  READY: 'ready',
  BID: 'bid',
  DOUBLE: 'double',
  PLAY: 'play',
  PASS: 'pass',
  HINT: 'hint',
  PING: 'ping',
  RECONNECT: 'reconnect',
} as const;

// Server -> Client message types
export const S2C = {
  ROOM_JOINED: 'room_joined',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_READY: 'player_ready',
  GAME_START: 'game_start',
  BID_TURN: 'bid_turn',
  BID_UPDATE: 'bid_update',
  BID_RESULT: 'bid_result',
  NO_BIDDER: 'no_bidder',
  DOUBLE_TURN: 'double_turn',
  DOUBLE_UPDATE: 'double_update',
  PLAYING_START: 'playing_start',
  PLAY_TURN: 'play_turn',
  PLAY_RESULT: 'play_result',
  PASS_RESULT: 'pass_result',
  HINT_RESULT: 'hint_result',
  GAME_END: 'game_end',
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',
  ERROR: 'error',
  PONG: 'pong',
  ROOM_STATE: 'room_state', // Full state sync for reconnect
  PLAYER_OFFLINE: 'player_offline',
} as const;

export function buildMessage(type: string, payload: any): string {
  return JSON.stringify({ type, payload });
}
