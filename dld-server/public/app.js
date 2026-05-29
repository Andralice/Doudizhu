const { createApp, ref, computed, watch, onMounted } = Vue;
const SUITS = ['♠', '♥', '♣', '♦'];
const RNAME = { 3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小',17:'大' };
function cv(c) { return Math.floor(c / 10); }
function cs(c) { return c % 10; }
function cd(c) {
  const v = cv(c), s = cs(c);
  if (v === 16) return { rank: '小', suit: '王', cls: 'red' };
  if (v === 17) return { rank: '大', suit: '王', cls: 'red' };
  const red = s === 1 || s === 3;
  return { rank: RNAME[v] || v, suit: SUITS[s], cls: red ? 'red' : 'black' };
}

createApp({
  setup() {
    const screen = ref('login');
    const toast = ref({ show: false, message: '', type: 'info' });
    let toastTimer = null;
    function showToast(msg, type = 'info') {
      if (toastTimer) clearTimeout(toastTimer);
      toast.value = { show: true, message: msg, type };
      toastTimer = setTimeout(() => { toast.value.show = false; }, 2500);
    }

    // Login
    const loginAccount = ref(localStorage.getItem('dld_account') || '');
    const loginName = ref(localStorage.getItem('dld_name') || '');
    const loggingIn = ref(false);
    const autoLogging = ref(false);
    const loginError = ref('');
    const accountId = ref('');
    const playerName = ref('');
    const authToken = ref('');

    // Home
    const joinRoomId = ref('');
    const homeError = ref('');
    const history = ref(JSON.parse(localStorage.getItem('dld_history') || '[]'));

    // Room
    const roomId = ref('');
    const roomPlayers = ref([]);
    const readyState = ref(false);
    const roomError = ref('');
    const roomStatus = computed(() => {
      const cnt = roomPlayers.value.length;
      const rdy = roomPlayers.value.filter(p => p && p.ready).length;
      if (cnt < 3) return `等待玩家加入... (${cnt}/3) — 点 "+AI玩家" 添加机器人`;
      if (rdy < 3) return `已准备: ${rdy}/3`;
      return '全部就绪，游戏开始！';
    });

    // Game
    const mySeat = ref(-1);
    const myHand = ref([]);
    const selectedCards = ref(new Set());
    const currentTurn = ref(null);
    const landlordSeat = ref(null);
    const bottomCards = ref([]);
    const multiplier = ref(1);
    const baseScore = ref(1);
    const lastPlaySeat = ref(null);
    const showBidOverlay = ref(false);
    const bidMessage = ref('');
    const bidCurrentScore = ref(0);
    const showDoubleOverlay = ref(false);
    const showResult = ref(false);
    const resultTitle = ref('');
    const resultDetail = ref('');
    const phaseText = ref('');
    const myPlayed = ref([]);
    const leftPlayed = ref([]);
    const rightPlayed = ref([]);
    const gamePlayers = ref([null, null, null]);

    const leftSeat = computed(() => mySeat.value >= 0 ? (mySeat.value + 1) % 3 : 0);
    const rightSeat = computed(() => mySeat.value >= 0 ? (mySeat.value + 2) % 3 : 2);
    const canPlay = computed(() => currentTurn.value === mySeat.value && selectedCards.value.size > 0);
    const canPass = computed(() => currentTurn.value === mySeat.value && lastPlaySeat.value !== null && lastPlaySeat.value !== mySeat.value);

    // WebSocket
    let ws = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${location.host}`);
      ws.onopen = () => {
        reconnectAttempts = 0;
        if (authToken.value) {
          sendWS('login', { token: authToken.value });
        } else {
          autoLogging.value = false;
        }
      };
      ws.onclose = () => {
        const d = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        reconnectTimer = setTimeout(connect, d);
      };
      ws.onmessage = (e) => {
        try { handleMessage(JSON.parse(e.data)); } catch (err) { console.error(err); }
      };
    }

    function sendWS(type, payload = {}) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
      }
    }

    // Login
    function doLogin() {
      if (!loginAccount.value || !loginName.value) return;
      loggingIn.value = true;
      loginError.value = '';
      accountId.value = loginAccount.value;
      playerName.value = loginName.value;
      sendWS('login', { accountId: loginAccount.value, playerName: loginName.value });
    }
    function logout() {
      authToken.value = '';
      localStorage.removeItem('dld_token');
      screen.value = 'login';
    }

    // Home
    function createRoom() { homeError.value = ''; sendWS('create_room'); }
    function joinRoom() {
      if (joinRoomId.value.length !== 6) return;
      homeError.value = '';
      sendWS('join_room', { roomId: joinRoomId.value });
    }

    // Room
    function leaveRoom() { sendWS('leave_room'); }
    function addAI() {
      roomError.value = '';
      sendWS('add_ai');
      showToast('正在添加AI玩家...', 'info');
    }
    function playerReady() {
      const newState = !readyState.value;
      sendWS('ready', { ready: newState });
    }

    // Game
    function toggleCard(c) {
      if (currentTurn.value !== mySeat.value) return;
      const s = new Set(selectedCards.value);
      if (s.has(c)) s.delete(c); else s.add(c);
      selectedCards.value = s;
    }
    function doPlay() {
      const cards = [...selectedCards.value];
      if (cards.length === 0) { showToast('请选择要出的牌', 'error'); return; }
      sendWS('play', { cards });
    }
    function doPass() { sendWS('pass'); }
    function doHint() { sendWS('hint'); }
    function doBid(score) { sendWS('bid', { score }); showBidOverlay.value = false; }
    function doDouble(level) { sendWS('double', { level }); showDoubleOverlay.value = false; }
    function continueGame() {
      showResult.value = false;
      sendWS('ready', { ready: true });
      readyState.value = true;
      screen.value = 'room';
    }
    function getPlayerName(seat) {
      const p = gamePlayers.value[seat];
      return p ? p.name : '';
    }
    function getHandCount(seat) {
      const p = gamePlayers.value[seat];
      if (!p) return 0;
      if (seat === mySeat.value) return myHand.value.length;
      return p.handCount || 0;
    }

    // Message Handler
    function handleMessage(msg) {
      const { type, payload } = msg;

      switch (type) {
        case 'login_ok':
          authToken.value = payload.token;
          accountId.value = payload.accountId;
          playerName.value = payload.playerName;
          localStorage.setItem('dld_token', payload.token);
          localStorage.setItem('dld_account', payload.accountId);
          localStorage.setItem('dld_name', payload.playerName);
          loggingIn.value = false; autoLogging.value = false; loginError.value = '';
          screen.value = 'home';
          showToast(`欢迎回来，${payload.playerName}`, 'success');
          break;

        case 'error':
          if (screen.value === 'login') {
            loggingIn.value = false; autoLogging.value = false;
            loginError.value = payload.message;
          } else {
            showToast(payload.message, 'error');
          }
          break;

        case 'room_joined':
          // Only update if payload has meaningful data
          if (payload.roomId) roomId.value = payload.roomId;
          if (payload.seat !== undefined) mySeat.value = payload.seat;
          if (payload.players) {
            roomPlayers.value = payload.players;
            gamePlayers.value = payload.players;
          }
          readyState.value = false;
          roomError.value = '';
          screen.value = 'room';
          break;

        case 'room_left':
          roomId.value = ''; roomPlayers.value = []; readyState.value = false;
          mySeat.value = -1;
          screen.value = 'home';
          break;

        case 'ready_state':
          if (payload.ready !== undefined) readyState.value = payload.ready;
          if (payload.players) { roomPlayers.value = payload.players; gamePlayers.value = payload.players; }
          break;

        case 'player_joined':
        case 'player_left':
        case 'player_ready':
        case 'player_offline':
        case 'player_reconnected':
          if (payload.players) { roomPlayers.value = payload.players; gamePlayers.value = payload.players; }
          if (type === 'player_joined') {
            if (payload.isAI) showToast(`AI玩家 ${payload.playerName} 加入了`, 'info');
            else showToast(`${payload.playerName} 加入了房间`, 'info');
          }
          if (type === 'player_ready' && payload.ready !== undefined) {
            // Update ready state display
          }
          break;

        case 'game_start':
          myHand.value = sortHand(payload.hand || []);
          bottomCards.value = [];
          landlordSeat.value = null;
          currentTurn.value = null;
          lastPlaySeat.value = null;
          myPlayed.value = []; leftPlayed.value = []; rightPlayed.value = [];
          selectedCards.value = new Set();
          phaseText.value = '发牌中...';
          screen.value = 'game';
          showToast('游戏开始！', 'success');
          break;

        case 'bid_turn':
          currentTurn.value = payload.seat;
          if (payload.seat === mySeat.value) {
            showBidOverlay.value = true;
            bidMessage.value = `请叫地主 (当前最高: ${payload.currentScore || 0}分)`;
            bidCurrentScore.value = payload.currentScore || 0;
          } else {
            showBidOverlay.value = false;
            phaseText.value = `叫地主中... 当前最高: ${payload.currentScore || 0}分`;
          }
          break;

        case 'bid_update':
          phaseText.value = `座位${payload.seat+1}: ${payload.score > 0 ? '叫'+payload.score+'分' : '不叫'} · 最高: ${payload.currentMaxScore}分`;
          break;

        case 'no_bidder':
          showToast('无人叫地主，重新发牌', 'info');
          break;

        case 'bid_result':
          showBidOverlay.value = false;
          landlordSeat.value = payload.landlordSeat;
          baseScore.value = payload.baseScore;
          bottomCards.value = payload.bottomCards || [];
          phaseText.value = `${payload.landlordName} 是地主 · 底牌已公开`;
          if (payload.landlordSeat === mySeat.value) {
            myHand.value = sortHand([...myHand.value, ...(payload.bottomCards || [])]);
          }
          break;

        case 'double_turn':
          currentTurn.value = payload.seat;
          if (payload.seat === mySeat.value) {
            showDoubleOverlay.value = true;
          } else {
            phaseText.value = '加倍阶段...';
          }
          break;

        case 'double_update':
          multiplier.value = payload.currentMultiplier;
          phaseText.value = `座位${payload.seat+1}: ${payload.level === 0 ? '不加倍' : payload.level === 1 ? '加倍' : '超级加倍'}`;
          break;

        case 'playing_start':
          phaseText.value = '开始出牌！';
          break;

        case 'play_turn':
          currentTurn.value = payload.seat;
          lastPlaySeat.value = payload.lastPlaySeat;
          if (payload.isNewRound) {
            myPlayed.value = []; leftPlayed.value = []; rightPlayed.value = [];
          }
          selectedCards.value = new Set();
          break;

        case 'play_result': {
          if (payload.seat === mySeat.value) {
            const playedSet = new Set(payload.cards);
            myHand.value = myHand.value.filter(c => !playedSet.has(c));
            myPlayed.value = payload.cards;
          } else if (payload.seat === leftSeat.value) {
            leftPlayed.value = payload.cards;
          } else if (payload.seat === rightSeat.value) {
            rightPlayed.value = payload.cards;
          }
          const pp = gamePlayers.value[payload.seat];
          if (pp) pp.handCount = payload.handCount;
          selectedCards.value = new Set();
          break;
        }

        case 'pass_result':
          if (payload.seat === mySeat.value) selectedCards.value = new Set();
          break;

        case 'hint_result':
          if (payload.cards && payload.cards.length > 0) {
            selectedCards.value = new Set(payload.cards);
            showToast('已推荐出牌方案', 'info');
          } else {
            showToast('无牌可出', 'error');
          }
          break;

        case 'game_end': {
          showResult.value = true;
          resultTitle.value = payload.isLandlordWin ? '地主获胜!' : '农民获胜!';
          resultDetail.value = `赢家: ${payload.winnerName} | ${payload.baseScore} × ${payload.multiplier} = ${payload.finalScore}分`;
          const isLandlord = landlordSeat.value === mySeat.value;
          const won = (payload.isLandlordWin && isLandlord) || (!payload.isLandlordWin && !isLandlord);
          const h = [...history.value];
          h.unshift({
            date: new Date().toLocaleDateString(),
            won,
            detail: `${won ? '胜' : '负'} · ${payload.isLandlordWin ? '地主赢' : '农民赢'} · ${payload.finalScore}分`,
          });
          if (h.length > 50) h.length = 50;
          history.value = h;
          localStorage.setItem('dld_history', JSON.stringify(h));
          break;
        }

        case 'room_state':
          roomId.value = payload.roomId;
          mySeat.value = payload.seat;
          myHand.value = sortHand(payload.hand || []);
          currentTurn.value = payload.currentTurnSeat;
          landlordSeat.value = payload.landlordSeat;
          lastPlaySeat.value = payload.lastPlaySeat;
          bottomCards.value = payload.bottomCards || [];
          baseScore.value = payload.baseScore;
          multiplier.value = payload.multiplier;
          if (payload.players) { gamePlayers.value = payload.players; }
          screen.value = payload.phase === 'waiting' ? 'room' : 'game';
          if (screen.value === 'game') phaseText.value = '已重新连接';
          showToast('已恢复游戏状态', 'success');
          break;

        case 'pong': break;
      }
    }

    function sortHand(cards) {
      return [...cards].sort((a, b) => {
        const dv = cv(b) - cv(a);
        return dv !== 0 ? dv : cs(a) - cs(b);
      });
    }

    onMounted(() => {
      const token = localStorage.getItem('dld_token');
      if (token) { authToken.value = token; autoLogging.value = true; }
      connect();
    });

    setInterval(() => sendWS('ping'), 15000);

    return {
      screen, toast,
      loginAccount, loginName, loggingIn, autoLogging, loginError, accountId, playerName,
      joinRoomId, homeError, history,
      roomId, roomPlayers, readyState, roomError, roomStatus,
      mySeat, myHand, selectedCards, currentTurn, landlordSeat, bottomCards, multiplier, baseScore,
      lastPlaySeat, showBidOverlay, bidMessage, bidCurrentScore, showDoubleOverlay,
      showResult, resultTitle, resultDetail, phaseText,
      myPlayed, leftPlayed, rightPlayed, gamePlayers,
      leftSeat, rightSeat, canPlay, canPass,
      doLogin, logout, createRoom, joinRoom, leaveRoom, addAI, playerReady,
      toggleCard, doPlay, doPass, doHint, doBid, doDouble, continueGame,
      getPlayerName, getHandCount, cd,
    };
  }
}).mount('#app');
