// ========== Card utilities ==========
const SUITS = ['♠', '♥', '♣', '♦'];
const SUIT_CLASS = ['black', 'red', 'black', 'red'];
const RANKS = { 3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小',17:'大' };

function cardSuit(code) { return code % 10; }
function cardValue(code) { return Math.floor(code / 10); }
function isRed(code) { const s = cardSuit(code); return s === 1 || s === 3 || s === 4; }
function cardDisplay(code) {
  const v = cardValue(code);
  const s = cardSuit(code);
  if (v === 16) return { rank: '小', suit: '王', cls: 'red' };
  if (v === 17) return { rank: '大', suit: '王', cls: 'red' };
  return { rank: RANKS[v] || v, suit: SUITS[s], cls: SUIT_CLASS[s] };
}

// ========== State ==========
const state = {
  ws: null,
  playerId: '',
  playerName: '',
  seat: -1,
  roomId: '',
  hand: [],
  selectedCards: new Set(),
  game: {
    phase: '',
    landlordSeat: null,
    currentTurnSeat: null,
    lastPlaySeat: null,
    lastPlayCards: [],
    bottomCards: [],
    baseScore: 1,
    multiplier: 1,
    players: [null, null, null],
  },
  reconnectTimer: null,
  reconnectAttempts: 0,
};

// ========== DOM References ==========
const $ = (id) => document.getElementById(id);
const screenHome = $('screen-home');
const screenRoom = $('screen-room');
const screenGame = $('screen-game');

// ========== WebSocket ==========
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;
  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    $('server-status').textContent = '已连接';
    $('server-status').style.color = '#4caf50';
    state.reconnectAttempts = 0;
  };

  state.ws.onclose = () => {
    $('server-status').textContent = '断开，重连中...';
    $('server-status').style.color = '#ff6b6b';
    scheduleReconnect();
  };

  state.ws.onerror = () => {};

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.error('Invalid message:', event.data);
    }
  };
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
  state.reconnectAttempts++;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

function send(type, payload = {}) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({
    type,
    payload: { ...payload, playerId: state.playerId, playerName: state.playerName },
  }));
}

// ========== Heartbeat ==========
setInterval(() => { send('ping'); }, 15000);

// ========== Screen Management ==========
function showScreen(name) {
  [screenHome, screenRoom, screenGame].forEach((s) => s.classList.remove('active'));
  if (name === 'home') screenHome.classList.add('active');
  if (name === 'room') screenRoom.classList.add('active');
  if (name === 'game') screenGame.classList.add('active');
}

// ========== Message Handler ==========
function handleMessage(msg) {
  const { type, payload } = msg;
  switch (type) {
    case 'room_joined':
      state.roomId = payload.roomId;
      state.seat = payload.seat;
      state.game.players = payload.players;
      showScreen('room');
      updateRoomUI();
      break;
    case 'player_joined':
    case 'player_left':
    case 'player_ready':
    case 'player_offline':
    case 'player_reconnected':
      if (payload.players) state.game.players = payload.players;
      updateRoomUI();
      if (type === 'player_ready') updateRoomUI();
      break;
    case 'game_start':
      state.hand = payload.hand || [];
      state.game.phase = 'playing';
      state.game.bottomCards = [];
      state.game.landlordSeat = null;
      showScreen('game');
      updateGamePlayers();
      renderHand();
      break;
    case 'bid_turn':
      showBidOverlay(payload);
      break;
    case 'bid_update':
      updateBidInfo(payload);
      break;
    case 'bid_result':
      handleBidResult(payload);
      break;
    case 'no_bidder':
      hideOverlay('overlay-bid');
      showError('room-error', '无人叫地主，重新发牌');
      break;
    case 'double_turn':
      showDoubleOverlay(payload);
      break;
    case 'double_update':
      break;
    case 'playing_start':
      state.game.phase = 'playing';
      updateGamePlayers();
      break;
    case 'play_turn':
      handlePlayTurn(payload);
      break;
    case 'play_result':
      handlePlayResult(payload);
      break;
    case 'pass_result':
      handlePassResult(payload);
      break;
    case 'hint_result':
      highlightHintCards(payload.cards || []);
      break;
    case 'game_end':
      handleGameEnd(payload);
      break;
    case 'room_state':
      handleRoomState(payload);
      break;
    case 'error':
      showError('home-error', payload.message);
      showError('room-error', payload.message);
      break;
    case 'pong':
      break;
  }
}

// ========== Home Screen ==========
$('btn-create').addEventListener('click', () => {
  const name = $('input-name').value.trim();
  if (!name) { showError('home-error', '请输入昵称'); return; }
  state.playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  state.playerName = name;
  send('create_room');
  $('home-error').textContent = '';
});

$('btn-join').addEventListener('click', () => {
  const name = $('input-name').value.trim();
  const roomId = $('input-room').value.trim();
  if (!name) { showError('home-error', '请输入昵称'); return; }
  if (!roomId || roomId.length !== 6) { showError('home-error', '请输入6位房间号'); return; }
  state.playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  state.playerName = name;
  send('join_room', { roomId });
  $('home-error').textContent = '';
});

// ========== Room Screen ==========
$('btn-leave').addEventListener('click', () => {
  send('leave_room');
  state.roomId = '';
  state.seat = -1;
  state.game.players = [null, null, null];
  showScreen('home');
});

$('btn-ready').addEventListener('click', () => {
  send('ready');
  $('btn-ready').disabled = true;
  $('btn-ready').textContent = '已准备';
});

function updateRoomUI() {
  $('room-id-display').textContent = state.roomId;
  const list = $('player-list');
  list.innerHTML = '';

  for (const p of state.game.players) {
    if (!p) {
      list.innerHTML += '<div class="player-slot"><div class="avatar">?</div><div class="info"><div class="name">等待加入...</div></div></div>';
    } else {
      const status = p.online ? (p.ready ? '<span class="ready-badge">已准备</span>' : '未准备') : '<span style="color:#ff6b6b">离线</span>';
      list.innerHTML += `<div class="player-slot">
        <div class="avatar">${p.name[0]}</div>
        <div class="info"><div class="name">${p.name} ${p.seat === state.seat ? '(你)' : ''}</div>
        <div class="status">座位${p.seat + 1} · ${status}</div></div>
      </div>`;
    }
  }

  const readyCount = state.game.players.filter((p) => p && p.ready).length;
  const total = state.game.players.filter((p) => p !== null).length;
  $('room-info').textContent = `已准备: ${readyCount}/${total} (需要3人全部准备)`;

  if (total === 3 && readyCount === 3) {
    $('room-info').textContent = '所有玩家已准备，游戏即将开始...';
  }
}

// ========== Game Screen ==========
function updateGamePlayers() {
  const positions = ['left', 'top', 'right'];
  const allPlayers = [];
  // Arrange players relative to my seat
  for (let i = 0; i < 3; i++) {
    const relativeSeat = (state.seat + i) % 3;
    const pos = i === 0 ? 'bottom' : positions[i - 1 + (i > 0 ? 2 : 0)];
    // Simpler: 0 = left, 1 = top/center, 2 = right for opponents
    // And bottom for self
    const p = state.game.players[relativeSeat];
    allPlayers.push({ ...p, relativePos: pos, actualSeat: relativeSeat });
  }

  // My player (bottom)
  const me = state.game.players[state.seat];
  if (me) {
    $('name-bottom').textContent = me.name + ' (你)';
    $('count-bottom').textContent = state.hand.length + '张';
  }

  // Left player (next player)
  const leftSeat = (state.seat + 1) % 3;
  const leftP = state.game.players[leftSeat];
  if (leftP) {
    $('name-left').textContent = leftP.name;
    $('count-left').textContent = (leftP.handCount || 17) + '张';
    $('role-left').className = 'player-role-tag';
    if (state.game.landlordSeat === leftSeat) {
      $('role-left').textContent = '地主';
      $('role-left').classList.add('landlord');
    } else if (state.game.landlordSeat !== null) {
      $('role-left').textContent = '农民';
      $('role-left').classList.add('farmer');
    } else {
      $('role-left').textContent = '';
    }
  }

  // Right player
  const rightSeat = (state.seat + 2) % 3;
  const rightP = state.game.players[rightSeat];
  if (rightP) {
    $('name-right').textContent = rightP.name;
    $('count-right').textContent = (rightP.handCount || 17) + '张';
    $('role-right').className = 'player-role-tag';
    if (state.game.landlordSeat === rightSeat) {
      $('role-right').textContent = '地主';
      $('role-right').classList.add('landlord');
    } else if (state.game.landlordSeat !== null) {
      $('role-right').textContent = '农民';
      $('role-right').classList.add('farmer');
    } else {
      $('role-right').textContent = '';
    }
  }

  // Role tag for me
  $('role-bottom').className = 'player-role-tag';
  if (state.game.landlordSeat === state.seat) {
    $('role-bottom').textContent = '地主';
    $('role-bottom').classList.add('landlord');
  } else if (state.game.landlordSeat !== null) {
    $('role-bottom').textContent = '农民';
    $('role-bottom').classList.add('farmer');
  } else {
    $('role-bottom').textContent = '';
  }

  // Highlight current turn
  $('player-left').style.opacity = leftSeat === state.game.currentTurnSeat ? '1' : '0.5';
  $('player-right').style.opacity = rightSeat === state.game.currentTurnSeat ? '1' : '0.5';
  $('player-bottom').style.opacity = state.seat === state.game.currentTurnSeat ? '1' : '0.5';
}

function renderHand() {
  const container = $('hand-cards');
  container.innerHTML = '';
  state.selectedCards.clear();

  state.hand.sort((a, b) => {
    const dv = cardValue(b) - cardValue(a);
    if (dv !== 0) return dv;
    return cardSuit(a) - cardSuit(b);
  });

  for (const card of state.hand) {
    const el = createCardElement(card);
    el.addEventListener('click', () => toggleCard(card, el));
    container.appendChild(el);
  }

  updateCardCounts();
}

function createCardElement(card, sizeClass = '') {
  const d = cardDisplay(card);
  const el = document.createElement('div');
  el.className = `card ${d.cls} ${sizeClass}`;
  el.dataset.card = card;
  el.innerHTML = `<span class="rank">${d.rank}</span><span class="suit">${d.suit}</span>`;
  return el;
}

function renderSmallCards(cards) {
  const row = document.createElement('div');
  row.className = 'cards-row';
  for (const c of cards) {
    row.appendChild(createCardElement(c, 'small'));
  }
  return row;
}

function toggleCard(card, el) {
  if (state.game.currentTurnSeat !== state.seat) return;
  if (state.selectedCards.has(card)) {
    state.selectedCards.delete(card);
    el.classList.remove('selected');
  } else {
    state.selectedCards.add(card);
    el.classList.add('selected');
  }
}

function highlightHintCards(cards) {
  // Deselect all first
  state.selectedCards.clear();
  document.querySelectorAll('.card.selected').forEach((el) => el.classList.remove('selected'));
  // Select hint cards
  for (const c of cards) {
    state.selectedCards.add(c);
    const el = document.querySelector(`.card[data-card="${c}"]`);
    if (el) el.classList.add('selected');
  }
}

function getSelectedCards() {
  return [...state.selectedCards];
}

function updateCardCounts() {
  $('count-bottom').textContent = state.hand.length + '张';
}

// ========== Play Turn ==========
function handlePlayTurn(payload) {
  state.game.currentTurnSeat = payload.seat;
  state.game.lastPlaySeat = payload.lastPlaySeat;
  state.game.lastPlayCards = payload.lastPlayCards || [];

  // Clear previous play displays if new round
  if (payload.isNewRound) {
    $('cards-left').innerHTML = '';
    $('cards-top').innerHTML = '';
    $('cards-mine-played').innerHTML = '';
    $('turn-indicator').textContent = '';
  }

  // Show last played cards in appropriate area
  if (state.game.lastPlaySeat !== null && !payload.isNewRound) {
    renderLastPlay(state.game.lastPlaySeat, state.game.lastPlayCards);
  }

  updateTurnIndicator();
  updateGamePlayers();
  updateActionButtons(payload.canPass !== false, payload.isNewRound);

  // Enable/disable card selection
  if (state.game.currentTurnSeat === state.seat) {
    document.querySelectorAll('.card').forEach((el) => el.style.pointerEvents = 'auto');
  } else {
    document.querySelectorAll('.card').forEach((el) => el.style.pointerEvents = 'none');
    state.selectedCards.clear();
    document.querySelectorAll('.card.selected').forEach((el) => el.classList.remove('selected'));
  }
}

function renderLastPlay(seat, cards) {
  const targetMap = {};
  targetMap[state.seat] = 'cards-mine-played';
  targetMap[(state.seat + 1) % 3] = 'cards-left';
  targetMap[(state.seat + 2) % 3] = 'cards-top';

  const targetId = targetMap[seat];
  if (targetId) {
    const el = $(targetId);
    el.innerHTML = '';
    el.appendChild(renderSmallCards(cards));
  }
}

function updateTurnIndicator() {
  const turn = state.game.currentTurnSeat;
  if (turn === state.seat) {
    $('turn-indicator').textContent = '轮到你出牌';
  } else {
    const p = state.game.players[turn];
    $('turn-indicator').textContent = p ? `等待 ${p.name} 出牌...` : '';
  }
}

function updateActionButtons(canPass, isNewRound) {
  $('btn-play').disabled = state.game.currentTurnSeat !== state.seat;
  $('btn-pass').disabled = state.game.currentTurnSeat !== state.seat || isNewRound;
  $('btn-hint').disabled = state.game.currentTurnSeat !== state.seat;
}

function handlePlayResult(payload) {
  if (payload.seat === state.seat) {
    // Remove played cards from hand
    const played = new Set(payload.cards || []);
    state.hand = state.hand.filter((c) => !played.has(c));
    state.selectedCards.clear();
    renderHand();
  }

  // Update player card counts
  const p = state.game.players[payload.seat];
  if (p) p.handCount = payload.handCount;

  renderLastPlay(payload.seat, payload.cards);
  updateGamePlayers();
}

function handlePassResult(payload) {
  if (payload.seat === state.seat) {
    state.selectedCards.clear();
    document.querySelectorAll('.card.selected').forEach((el) => el.classList.remove('selected'));
  }
}

// ========== Action Buttons ==========
$('btn-play').addEventListener('click', () => {
  const selected = getSelectedCards();
  if (selected.length === 0) {
    showError('room-error', '请先选择要出的牌');
    return;
  }
  send('play', { cards: selected });
});

$('btn-pass').addEventListener('click', () => {
  send('pass');
});

$('btn-hint').addEventListener('click', () => {
  send('hint');
});

// ========== Bidding ==========
function showBidOverlay(payload) {
  if (payload.seat !== state.seat) {
    hideOverlay('overlay-bid');
    $('phase-indicator').textContent = `等待玩家出价... 当前最高: ${payload.currentScore || 0}分`;
    return;
  }
  $('overlay-bid').style.display = 'flex';
  $('bid-buttons').style.display = 'flex';
  $('double-buttons').style.display = 'none';
  $('bid-message').textContent = `请叫分 (当前最高: ${payload.currentScore || 0}分)`;

  // Disable bid buttons that are too low
  document.querySelectorAll('.bid-btn').forEach((btn) => {
    const score = parseInt(btn.dataset.score);
    btn.disabled = score > 0 && score <= (payload.currentScore || 0);
  });
}

function updateBidInfo(payload) {
  $('phase-indicator').textContent = `座位${payload.seat + 1}: ${payload.score > 0 ? '叫' + payload.score + '分' : '不叫'} · 当前最高: ${payload.currentMaxScore}分`;
}

function handleBidResult(payload) {
  hideOverlay('overlay-bid');
  state.game.landlordSeat = payload.landlordSeat;
  state.game.baseScore = payload.baseScore;
  state.game.bottomCards = payload.bottomCards || [];

  // Show bottom cards
  const display = $('bottom-cards-display');
  display.innerHTML = '';
  display.appendChild(renderSmallCards(state.game.bottomCards));

  $('phase-indicator').textContent = `${payload.landlordName} 是地主 · 底牌已公开`;

  // If I'm the landlord, add bottom cards to my hand
  if (payload.landlordSeat === state.seat) {
    state.hand = [...state.hand, ...state.game.bottomCards];
    renderHand();
  }

  updateGamePlayers();
}

// ========== Doubling ==========
function showDoubleOverlay(payload) {
  if (payload.seat !== state.seat) {
    hideOverlay('overlay-bid');
    return;
  }
  $('overlay-bid').style.display = 'flex';
  $('bid-buttons').style.display = 'none';
  $('double-buttons').style.display = 'flex';
  $('bid-message').textContent = '请选择加倍';
}

// ========== Bid/Double buttons ==========
document.querySelectorAll('.bid-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const score = parseInt(btn.dataset.score);
    send('bid', { score });
    hideOverlay('overlay-bid');
  });
});

document.querySelectorAll('.double-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const level = parseInt(btn.dataset.level);
    send('double', { level });
    hideOverlay('overlay-bid');
  });
});

// ========== Game End ==========
function handleGameEnd(payload) {
  $('overlay-result').style.display = 'flex';
  $('result-title').textContent = payload.isLandlordWin ? '地主获胜!' : '农民获胜!';
  $('result-details').innerHTML = `
    <p>赢家: ${payload.winnerName}</p>
    <p>底分: ${payload.baseScore} × ${payload.multiplier} = ${payload.finalScore}分</p>
  `;
  $('turn-indicator').textContent = '';
}

$('btn-continue').addEventListener('click', () => {
  $('overlay-result').style.display = 'none';
  send('ready');
  $('btn-ready').disabled = true;
  $('btn-ready').textContent = '准备下一局';
  showScreen('room');
});

// ========== Reconnect State ==========
function handleRoomState(payload) {
  state.seat = payload.seat;
  state.roomId = payload.roomId;
  state.hand = payload.hand || [];
  state.game.phase = payload.phase;
  state.game.landlordSeat = payload.landlordSeat;
  state.game.currentTurnSeat = payload.currentTurnSeat;
  state.game.lastPlaySeat = payload.lastPlaySeat;
  state.game.lastPlayCards = payload.lastPlayCards || [];
  state.game.bottomCards = payload.bottomCards || [];
  state.game.baseScore = payload.baseScore;
  state.game.multiplier = payload.multiplier;
  state.game.players = payload.players;

  if (payload.phase === 'waiting') {
    showScreen('room');
    updateRoomUI();
  } else {
    showScreen('game');
    renderHand();
    updateGamePlayers();
    updateTurnIndicator();
    updateActionButtons(
      state.game.lastPlaySeat !== state.seat,
      state.game.lastPlaySeat === null || state.game.lastPlaySeat === state.seat
    );

    // Show bottom cards
    if (state.game.bottomCards.length > 0) {
      const display = $('bottom-cards-display');
      display.innerHTML = '';
      display.appendChild(renderSmallCards(state.game.bottomCards));
    }

    // Show last play
    if (state.game.lastPlaySeat !== null && state.game.lastPlayCards.length > 0) {
      renderLastPlay(state.game.lastPlaySeat, state.game.lastPlayCards);
    }
  }
}

// ========== Helpers ==========
function hideOverlay(id) {
  $(id).style.display = 'none';
}

function showError(id, msg) {
  const el = $(id);
  if (el) {
    el.textContent = msg;
    setTimeout(() => { el.textContent = ''; }, 3000);
  }
}

// ========== Init ==========
connect();
