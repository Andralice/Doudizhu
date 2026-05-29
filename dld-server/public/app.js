// ---- Card Utilities ----
const SUITS = ['♠','♥','♣','♦'];
const RNAME = {3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小',17:'大'};
function cv(c) { return Math.floor(c / 10) || 0; }
function cs(c) { return (c % 10) || 0; }
function cd(c) {
  if (typeof c !== 'number') return { rank: '?', suit: '?', cls: 'black' };
  const v = cv(c), s = cs(c);
  if (v === 16) return { rank: '小', suit: '王', cls: 'red' };
  if (v === 17) return { rank: '大', suit: '王', cls: 'red' };
  return { rank: RNAME[v] || '?', suit: SUITS[s] || '?', cls: (s === 1 || s === 3) ? 'red' : 'black' };
}
function sortHand(cards) {
  return [...cards].sort((a, b) => { const dv = cv(b) - cv(a); return dv !== 0 ? dv : cs(a) - cs(b); });
}

// ---- State ----
const state = {
  screen: 'login',
  // Login
  loginAccount: '', loginName: '', loggingIn: false, autoLogging: false, loginError: '',
  accountId: '', playerName: '', authToken: '',
  // Home
  joinRoomId: '', homeError: '', history: [],
  // Room
  roomId: '', roomPlayers: [], mySeat: -1, readyState: false, roomError: '',
  // Game
  myHand: [], selectedCards: [],
  currentTurn: null, landlordSeat: null, bottomCards: [],
  multiplier: 1, baseScore: 1, lastPlaySeat: null,
  showBid: false, bidMsg: '', bidCurScore: 0, showDouble: false,
  showResult: false, resultTitle: '', resultDetail: '', phaseText: '',
  myPlayed: [], leftPlayed: [], rightPlayed: [],
  gamePlayers: [null, null, null],
  toast: { show: false, message: '', type: 'info' },
};

let toastTimer = null;
function showToast(msg, type) {
  if (toastTimer) clearTimeout(toastTimer);
  state.toast = { show: true, message: msg, type: type || 'info' };
  toastTimer = setTimeout(() => { state.toast.show = false; updateView(); }, 2500);
}

// ---- WebSocket ----
let ws = null;
let reconnectTries = 0;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host);
  ws.onopen = () => {
    reconnectTries = 0;
    if (state.authToken) {
      sendWS('login', { token: state.authToken });
    } else {
      state.autoLogging = false;
      updateView();
    }
  };
  ws.onclose = () => {
    const d = Math.min(1000 * Math.pow(2, reconnectTries), 30000);
    reconnectTries++;
    setTimeout(connectWS, d);
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleWS(msg);
      updateView();
    } catch (err) {
      console.error('WS msg error:', err);
    }
  };
}

function sendWS(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload: payload || {} }));
  }
}

// ---- WS Handler ----
function handleWS(msg) {
  const { type, payload } = msg;
  const p = payload || {};

  switch (type) {
    case 'login_ok':
      state.authToken = p.token; state.accountId = p.accountId; state.playerName = p.playerName;
      localStorage.setItem('dld_token', p.token);
      localStorage.setItem('dld_account', p.accountId);
      localStorage.setItem('dld_name', p.playerName);
      state.loggingIn = false; state.autoLogging = false; state.loginError = '';
      state.screen = 'home';
      showToast('欢迎回来，' + p.playerName, 'success');
      break;

    case 'error':
      if (state.screen === 'login') { state.loggingIn = false; state.autoLogging = false; state.loginError = p.message; }
      else showToast(p.message, 'error');
      break;

    case 'room_joined':
      if (p.roomId) state.roomId = p.roomId;
      if (p.seat !== undefined) state.mySeat = p.seat;
      if (p.players) { state.roomPlayers = p.players; state.gamePlayers = p.players; }
      state.readyState = false; state.roomError = ''; state.screen = 'room';
      break;

    case 'room_left':
      state.roomId = ''; state.roomPlayers = []; state.readyState = false; state.mySeat = -1;
      state.screen = 'home'; state.roomError = '';
      break;

    case 'ready_state':
      if (p.ready !== undefined) state.readyState = p.ready;
      if (p.players) { state.roomPlayers = p.players; state.gamePlayers = p.players; }
      break;

    case 'player_joined':
    case 'player_left':
    case 'player_ready':
    case 'player_offline':
    case 'player_reconnected':
      if (p.players) { state.roomPlayers = p.players; state.gamePlayers = p.players; }
      if (type === 'player_joined' && p.isAI) showToast('AI玩家 ' + p.playerName + ' 加入', 'info');
      else if (type === 'player_joined') showToast(p.playerName + ' 加入房间', 'info');
      break;

    case 'game_start':
      state.myHand = sortHand(p.hand || []);
      // Don't clear gamePlayers - keep room player info
      state.bottomCards = []; state.landlordSeat = null; state.currentTurn = null;
      state.lastPlaySeat = null; state.myPlayed = []; state.leftPlayed = []; state.rightPlayed = [];
      state.selectedCards = []; state.phaseText = '发牌完成';
      state.showBid = false; state.showDouble = false; state.showResult = false;
      state.screen = 'game';
      console.log('game_start hand:', state.myHand.length, 'cards, screen:', state.screen);
      showToast('游戏开始！', 'success');
      break;

    case 'bid_turn':
      state.currentTurn = p.seat;
      if (p.seat === state.mySeat) {
        state.showBid = true; state.bidMsg = '请叫地主 (当前最高: ' + (p.currentScore || 0) + '分)';
        state.bidCurScore = p.currentScore || 0;
      } else {
        state.showBid = false; state.phaseText = '叫地主中... 最高: ' + (p.currentScore || 0) + '分';
      }
      break;

    case 'bid_update':
      state.phaseText = '座位' + (p.seat + 1) + ': ' + (p.score > 0 ? '叫' + p.score + '分' : '不叫') + ' · 最高: ' + p.currentMaxScore + '分';
      break;

    case 'no_bidder':
      state.showBid = false; showToast('无人叫地主，重新发牌', 'info');
      break;

    case 'bid_result':
      state.showBid = false; state.landlordSeat = p.landlordSeat;
      state.baseScore = p.baseScore; state.bottomCards = p.bottomCards || [];
      state.phaseText = p.landlordName + ' 是地主 · 底牌已公开';
      if (p.landlordSeat === state.mySeat && p.bottomCards) {
        state.myHand = sortHand([...state.myHand, ...p.bottomCards]);
      }
      break;

    case 'double_turn':
      state.currentTurn = p.seat;
      if (p.seat === state.mySeat) state.showDouble = true;
      else state.phaseText = '加倍阶段...';
      break;

    case 'double_update':
      state.multiplier = p.currentMultiplier;
      state.phaseText = '座位' + (p.seat + 1) + ': ' + (p.level === 0 ? '不加倍' : p.level === 1 ? '加倍' : '超级加倍');
      break;

    case 'playing_start':
      state.phaseText = '开始出牌！';
      break;

    case 'play_turn':
      state.currentTurn = p.seat; state.lastPlaySeat = p.lastPlaySeat;
      if (p.isNewRound) { state.myPlayed = []; state.leftPlayed = []; state.rightPlayed = []; }
      state.selectedCards = [];
      break;

    case 'play_result':
      if (p.seat === state.mySeat) {
        const ps = new Set(p.cards);
        state.myHand = state.myHand.filter(c => !ps.has(c));
        state.myPlayed = p.cards;
      } else if (p.seat === leftSeat()) {
        state.leftPlayed = p.cards;
      } else if (p.seat === rightSeat()) {
        state.rightPlayed = p.cards;
      }
      if (state.gamePlayers[p.seat]) state.gamePlayers[p.seat].handCount = p.handCount;
      state.selectedCards = [];
      break;

    case 'pass_result':
      if (p.seat === state.mySeat) state.selectedCards = [];
      break;

    case 'hint_result':
      if (p.cards && p.cards.length > 0) {
        state.selectedCards = p.cards;
        showToast('已推荐出牌方案', 'info');
      } else showToast('无牌可出', 'error');
      break;

    case 'game_end':
      state.showResult = true;
      state.resultTitle = p.isLandlordWin ? '地主获胜!' : '农民获胜!';
      state.resultDetail = '赢家: ' + p.winnerName + ' | ' + p.baseScore + ' × ' + p.multiplier + ' = ' + p.finalScore + '分';
      const isL = state.landlordSeat === state.mySeat;
      const won = (p.isLandlordWin && isL) || (!p.isLandlordWin && !isL);
      state.history.unshift({
        date: new Date().toLocaleDateString(), won,
        detail: (won ? '胜' : '负') + ' · ' + (p.isLandlordWin ? '地主赢' : '农民赢') + ' · ' + p.finalScore + '分',
      });
      if (state.history.length > 50) state.history.length = 50;
      localStorage.setItem('dld_history', JSON.stringify(state.history));
      break;

    case 'room_state':
      state.roomId = p.roomId; state.mySeat = p.seat;
      state.myHand = sortHand(p.hand || []);
      state.currentTurn = p.currentTurnSeat; state.landlordSeat = p.landlordSeat;
      state.lastPlaySeat = p.lastPlaySeat; state.bottomCards = p.bottomCards || [];
      state.baseScore = p.baseScore; state.multiplier = p.multiplier;
      if (p.players) { state.gamePlayers = p.players; state.roomPlayers = p.players; }
      state.screen = p.phase === 'waiting' ? 'room' : 'game';
      if (state.screen === 'game') state.phaseText = '已重新连接';
      showToast('已恢复游戏状态', 'success');
      break;
  }
}

// ---- Derived helpers ----
function leftSeat() { return state.mySeat >= 0 ? (state.mySeat + 1) % 3 : 0; }
function rightSeat() { return state.mySeat >= 0 ? (state.mySeat + 2) % 3 : 2; }
function getPlayer(seat) { return (state.gamePlayers && state.gamePlayers[seat]) || null; }
function getPlayerName(seat) { const p = getPlayer(seat); return p ? p.name : '?'; }
function getHandCount(seat) {
  if (seat === state.mySeat) return state.myHand.length;
  const p = getPlayer(seat); return p ? (p.handCount || 0) : 0;
}
function canPlay() { return state.currentTurn === state.mySeat && state.selectedCards.length > 0; }
function canPass() { return state.currentTurn === state.mySeat && state.lastPlaySeat !== null && state.lastPlaySeat !== state.mySeat; }
function roomPlayerCount() { return state.roomPlayers.filter(p => p !== null).length; }
function roomReadyCount() { return state.roomPlayers.filter(p => p && p.ready).length; }

// ---- Actions ----
function doLogin() {
  if (!state.loginAccount || !state.loginName) return;
  state.loggingIn = true; state.loginError = '';
  state.accountId = state.loginAccount; state.playerName = state.loginName;
  sendWS('login', { accountId: state.loginAccount, playerName: state.loginName });
}
function logout() { state.authToken = ''; localStorage.removeItem('dld_token'); state.screen = 'login'; }
function doCreateRoom() { state.homeError = ''; sendWS('create_room'); }
function doJoinRoom() { if (state.joinRoomId.length === 6) { state.homeError = ''; sendWS('join_room', { roomId: state.joinRoomId }); } }
function doLeaveRoom() { sendWS('leave_room'); }
function doAddAI() { state.roomError = ''; sendWS('add_ai'); showToast('添加AI玩家...', 'info'); }
function doToggleReady() { sendWS('ready', { ready: !state.readyState }); }
function toggleCard(c) {
  if (state.currentTurn !== state.mySeat) return;
  const idx = state.selectedCards.indexOf(c);
  if (idx >= 0) state.selectedCards.splice(idx, 1);
  else state.selectedCards.push(c);
}
function doPlay() {
  if (state.selectedCards.length === 0) { showToast('请选择要出的牌', 'error'); return; }
  sendWS('play', { cards: [...state.selectedCards] });
}
function doPass() { sendWS('pass'); }
function doHint() { sendWS('hint'); }
function doBid(score) { sendWS('bid', { score }); state.showBid = false; }
function doDouble(level) { sendWS('double', { level }); state.showDouble = false; }
function doContinue() { state.showResult = false; sendWS('ready', { ready: true }); state.readyState = true; state.screen = 'room'; }

// ---- Init ----
state.loginAccount = localStorage.getItem('dld_account') || '';
state.loginName = localStorage.getItem('dld_name') || '';
state.authToken = localStorage.getItem('dld_token') || '';
state.history = JSON.parse(localStorage.getItem('dld_history') || '[]');
if (state.authToken) state.autoLogging = true;

connectWS();
setInterval(() => sendWS('ping'), 15000);

// ---- Vanilla DOM Render ----
const $ = (id) => document.getElementById(id);

function updateView() {
  const s = state;
  // Toast
  const toastEl = document.querySelector('.toast');
  if (toastEl) {
    if (s.toast.show) { toastEl.textContent = s.toast.message; toastEl.className = 'toast ' + s.toast.type + ' show'; }
    else toastEl.className = 'toast';
  }

  // Login screen
  const loginEl = $('screen-login');
  if (loginEl) loginEl.style.display = s.screen === 'login' ? 'flex' : 'none';
  if (s.screen === 'login') {
    const autoEl = $('login-auto');
    if (autoEl) autoEl.style.display = s.autoLogging ? 'block' : 'none';
    const errEl = $('login-error');
    if (errEl) errEl.textContent = s.loginError;
    // Disable button during login
    const btn = document.querySelector('#screen-login .btn-primary');
    if (btn) btn.disabled = s.loggingIn || s.autoLogging;
    if (btn) btn.textContent = s.loggingIn ? '登录中...' : (s.autoLogging ? '请稍候...' : '进入游戏');
  }

  // Home screen
  const homeEl = $('screen-home');
  if (homeEl) {
    homeEl.style.display = s.screen === 'home' ? 'block' : 'none';
    if (s.screen === 'home') renderHome();
  }

  // Room screen
  const roomEl = $('screen-room');
  if (roomEl) {
    roomEl.style.display = s.screen === 'room' ? 'flex' : 'none';
    if (s.screen === 'room') renderRoom();
  }

  // Game screen
  const gameEl = $('screen-game');
  if (gameEl) {
    gameEl.style.display = s.screen === 'game' ? 'flex' : 'none';
    if (s.screen === 'game') renderGame();
  }
}

function renderHome() {
  $('home-player-name').textContent = state.playerName;
  $('home-account-id').textContent = state.accountId;
  const histEl = $('history-list');
  const histPanel = $('history-panel');
  if (state.history.length > 0) {
    if (histPanel) histPanel.style.display = 'block';
    if (histEl) {
      histEl.innerHTML = state.history.slice(0, 10).map(h =>
        '<div class="history-item"><span class="history-date">' + h.date + '</span><span class="history-result ' + (h.won ? 'win' : 'lose') + '">' + (h.won ? '胜' : '负') + '</span><span class="history-detail">' + h.detail + '</span></div>'
      ).join('');
    }
  } else {
    if (histPanel) histPanel.style.display = 'none';
  }
  const homeErr = $('home-error');
  if (homeErr) homeErr.textContent = state.homeError;
}

function renderRoom() {
  $('room-id-display').textContent = state.roomId;
  const players = state.roomPlayers;

  for (let i = 0; i < 3; i++) {
    const slot = $('room-slot-' + i);
    if (!slot) continue;
    const p = players[i];
    if (p) {
      slot.className = 'player-slot' + (p.isAI ? ' ai' : '');
      slot.innerHTML = '<div class="player-avatar">' + (p.isAI ? '\u{1F916}' : (p.name || '?')[0]) + '</div>' +
        '<div class="player-info"><div class="player-name">' + p.name + (p.name === state.playerName ? ' (你)' : '') + (p.isAI ? ' (AI)' : '') + '</div>' +
        '<div class="player-status"><span class="badge ' + (p.ready ? 'badge-ready' : 'badge-wait') + '">' + (p.ready ? '已准备' : '未准备') + '</span></div></div>';
    } else {
      slot.className = 'player-slot empty';
      slot.innerHTML = '<div class="player-avatar empty-slot">?</div><div class="player-info"><div class="player-name">空位</div></div>';
    }
  }

  // Room status text
  const statusEl = $('room-status');
  if (statusEl) {
    const cnt = roomPlayerCount();
    const rdy = roomReadyCount();
    if (cnt < 3) statusEl.textContent = '等待玩家加入... (' + cnt + '/3) — 点 "+AI玩家" 添加机器人';
    else if (rdy < 3) statusEl.textContent = '已准备: ' + rdy + '/3';
    else statusEl.textContent = '全部就绪，游戏开始！';
  }

  const readyBtn = $('btn-ready');
  if (readyBtn) {
    readyBtn.textContent = state.readyState ? '取消准备' : '准备';
    readyBtn.className = 'btn btn-lg ' + (state.readyState ? 'btn-secondary' : 'btn-primary');
  }

  const aiBtn = $('btn-add-ai');
  if (aiBtn) aiBtn.disabled = roomPlayerCount() >= 3 || state.roomId === '';

  const errEl = $('room-error');
  if (errEl) errEl.textContent = state.roomError;
}

function setText(id, text) { const e = $(id); if (e) e.textContent = text; }
function setHtml(id, html) { const e = $(id); if (e) e.innerHTML = html; }
function showEl(id, show) { const e = $(id); if (e) e.style.display = show ? '' : 'none'; }
function setDisplay(id, d) { const e = $(id); if (e) e.style.display = d; }

function renderGame() {
  try {
    const s = state;
    setText('phase-bar', s.phaseText || '');

    // Bottom cards
    const bcEl = $('bottom-cards-bar');
    if (bcEl) {
      if (s.bottomCards.length > 0) {
        bcEl.style.display = 'block';
        bcEl.innerHTML = '底牌: ' + s.bottomCards.map(c => { const d = cd(c); return '<span class="mini-card ' + d.cls + '">' + d.rank + d.suit + '</span>'; }).join('');
      } else { bcEl.style.display = 'none'; }
    }

    // Opponents
    renderOpponent('left', leftSeat());
    renderOpponent('right', rightSeat());

    // My info bar
    setText('my-info-name', s.playerName + ' (你)');
    const myRoleEl = $('my-info-role');
    if (myRoleEl) {
      if (s.landlordSeat !== null) {
        myRoleEl.style.display = 'inline-block';
        myRoleEl.textContent = s.landlordSeat === s.mySeat ? '地主' : '农民';
        myRoleEl.className = 'my-role ' + (s.landlordSeat === s.mySeat ? 'landlord' : 'farmer');
      } else { myRoleEl.style.display = 'none'; }
    }
    setText('my-info-count', s.myHand.length + '张');

    // Hand
    const handEl = $('hand-cards-row');
    if (handEl) {
      handEl.innerHTML = s.myHand.map(c => {
        const d = cd(c);
        const sel = s.selectedCards.indexOf(c) >= 0 ? ' selected' : '';
        return '<div class="card-el ' + d.cls + sel + '" data-card="' + c + '" onclick="window.toggleCard(' + c + ')"><span class="card-rank">' + d.rank + '</span><span class="card-suit">' + d.suit + '</span></div>';
      }).join('');
    }
    showEl('hand-area', s.myHand.length > 0);

    // Played cards
    setHtml('played-left-cards', s.leftPlayed.map(c => { const d = cd(c); return '<span class="played-card ' + d.cls + '">' + d.rank + d.suit + '</span>'; }).join(''));
    setHtml('played-right-cards', s.rightPlayed.map(c => { const d = cd(c); return '<span class="played-card ' + d.cls + '">' + d.rank + d.suit + '</span>'; }).join(''));
    setHtml('played-mine-cards', s.myPlayed.map(c => { const d = cd(c); return '<span class="played-card ' + d.cls + '">' + d.rank + d.suit + '</span>'; }).join(''));

    // Turn indicator
    const turnEl = $('turn-indicator');
    if (turnEl) {
      if (s.currentTurn === s.mySeat) turnEl.textContent = '轮到你出牌';
      else if (s.currentTurn !== null) turnEl.textContent = '等待 ' + getPlayerName(s.currentTurn) + ' 出牌...';
      else turnEl.textContent = '';
    }

    // Action buttons
    const playBtn = $('btn-play');
    if (playBtn) playBtn.disabled = !canPlay();
    const passBtn = $('btn-pass');
    if (passBtn) passBtn.disabled = !canPass();
    const hintBtn = $('btn-hint');
    if (hintBtn) hintBtn.disabled = s.currentTurn !== s.mySeat;

    // Overlays
    setDisplay('overlay-bid', s.showBid ? 'flex' : 'none');
    if (s.showBid) {
      setText('bid-message', s.bidMsg);
      document.querySelectorAll('.bid-btn').forEach(btn => {
        const score = parseInt(btn.dataset.score);
        if (score > 0) btn.disabled = score <= s.bidCurScore;
        else btn.disabled = false;
      });
    }
    setDisplay('overlay-double', s.showDouble ? 'flex' : 'none');
    setDisplay('overlay-result', s.showResult ? 'flex' : 'none');
    if (s.showResult) {
      setText('result-title', s.resultTitle);
      setText('result-details', s.resultDetail);
    }
  } catch (err) {
    console.error('renderGame error:', err);
    const pb = $('phase-bar');
    if (pb) pb.textContent = '渲染错误: ' + err.message;
  }
}

function renderOpponent(side, seat) {
  const name = getPlayerName(seat);
  setText('name-' + side, name);
  const avatarEl = document.querySelector('.opponent-area.' + side + ' .opp-avatar');
  if (avatarEl) avatarEl.textContent = name ? name[0] : '?';
  setText('count-' + side, getHandCount(seat) + '张');

  const roleEl = $('role-' + side);
  if (roleEl) {
    if (state.landlordSeat !== null) {
      roleEl.style.display = 'block';
      roleEl.textContent = state.landlordSeat === seat ? '地主' : '农民';
      roleEl.className = 'opp-role ' + (state.landlordSeat === seat ? 'landlord' : 'farmer');
    } else { roleEl.style.display = 'none'; }
  }

  const area = document.querySelector('.opponent-area.' + side);
  if (area) area.style.opacity = state.currentTurn === seat ? '1' : '0.5';

  const tinyEl = $('tiny-' + side);
  if (tinyEl) {
    const played = side === 'left' ? state.leftPlayed : state.rightPlayed;
    if (played.length > 0) {
      tinyEl.style.display = 'block';
      tinyEl.innerHTML = played.map(c => { const d = cd(c); return '<span class="tiny-card ' + d.cls + '">' + d.rank + d.suit + '</span>'; }).join('');
    } else { tinyEl.style.display = 'none'; }
  }
}

function renderOpponent(side, seat) {
  const name = getPlayerName(seat);
  const nameEl = $('name-' + side);
  if (nameEl) nameEl.textContent = name;
  const avatarEl = document.querySelector('.opponent-area.' + side + ' .opp-avatar');
  if (avatarEl) avatarEl.textContent = name ? name[0] : '?';
  const countEl = $('count-' + side);
  if (countEl) countEl.textContent = getHandCount(seat) + '张';

  const roleEl = $('role-' + side);
  if (roleEl && state.landlordSeat !== null) {
    roleEl.style.display = 'block';
    roleEl.textContent = state.landlordSeat === seat ? '地主' : '农民';
    roleEl.className = 'opp-role ' + (state.landlordSeat === seat ? 'landlord' : 'farmer');
  } else if (roleEl) { roleEl.style.display = 'none'; }

  const area = document.querySelector('.opponent-area.' + side);
  if (area) area.style.opacity = state.currentTurn === seat ? '1' : '0.5';

  // Tiny cards for opponent
  const tinyEl = $('tiny-' + side);
  if (tinyEl) {
    const played = side === 'left' ? state.leftPlayed : state.rightPlayed;
    if (played.length > 0) {
      tinyEl.style.display = 'block';
      tinyEl.innerHTML = played.map(c => { const d = cd(c); return '<span class="tiny-card ' + d.cls + '">' + d.rank + d.suit + '</span>'; }).join('');
    } else { tinyEl.style.display = 'none'; }
  }
}

// Expose to global scope for onclick handlers
window.toggleCard = toggleCard;
window.doPlay = doPlay;
window.doPass = doPass;
window.doHint = doHint;
window.doBid = doBid;
window.doDouble = doDouble;
window.doContinue = doContinue;
window.doLogin = doLogin;
window.logout = logout;
window.doCreateRoom = doCreateRoom;
window.doJoinRoom = doJoinRoom;
window.doLeaveRoom = doLeaveRoom;
window.doAddAI = doAddAI;
window.doToggleReady = doToggleReady;
window.updateView = updateView;

// Bind input events
document.addEventListener('DOMContentLoaded', () => {
  // Login inputs
  const loginAcc = $('input-login-account');
  if (loginAcc) { loginAcc.value = state.loginAccount; loginAcc.addEventListener('input', e => state.loginAccount = e.target.value); }
  const loginName = $('input-login-name');
  if (loginName) { loginName.value = state.loginName; loginName.addEventListener('input', e => state.loginName = e.target.value); }
  // Join room input
  const joinInp = $('input-join-room');
  if (joinInp) joinInp.addEventListener('input', e => state.joinRoomId = e.target.value);

  // Initial render
  updateView();
  // Poll for state changes (simple reactivity)
  setInterval(updateView, 500);
});
