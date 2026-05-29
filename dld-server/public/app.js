const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const SUITS = ['♠', '♥', '♣', '♦'];
const RANK_NAMES = { 3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小',17:'大' };

function cardSuit(c) { return c % 10; }
function cardValue(c) { return Math.floor(c / 10); }
function cardDisplay(c) {
  const v = cardValue(c), s = cardSuit(c);
  if (v === 16) return { rank: '小', suit: '王', cls: 'red' };
  if (v === 17) return { rank: '大', suit: '王', cls: 'red' };
  return { rank: RANK_NAMES[v] || v, suit: SUITS[s], cls: s === 1 || s === 3 ? 'red' : 'black' };
}

createApp({
  setup() {
    // ---- State ----
    const screen = ref('login');
    const toast = ref({ show: false, message: '', type: 'info' });
    let toastTimer = null;

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
    const readySent = ref(false);
    const roomError = ref('');
    const roomStatus = computed(() => {
      const cnt = roomPlayers.value.length;
      const rdy = roomPlayers.value.filter(p => p.ready).length;
      if (cnt < 3) return `等待玩家加入... (${cnt}/3)`;
      if (rdy < 3) return `已准备: ${rdy}/3`;
      return '全部准备就绪，即将开始...';
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
    const gamePlayers = ref([null, null, null]); // full player info including handCounts

    // Derived
    const leftSeat = computed(() => mySeat.value >= 0 ? (mySeat.value + 1) % 3 : 0);
    const rightSeat = computed(() => mySeat.value >= 0 ? (mySeat.value + 2) % 3 : 2);
    const canPlay = computed(() => currentTurn.value === mySeat.value && selectedCards.value.size > 0);
    const canPass = computed(() => currentTurn.value === mySeat.value && lastPlaySeat.value !== null && lastPlaySeat.value !== mySeat.value);

    // ---- WebSocket ----
    let ws = null;
    let reconnectTimer = null;
    let reconnectAttempts = 0;

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${location.host}`);

      ws.onopen = () => {
        reconnectAttempts = 0;
        // Auto-login if we have token
        if (authToken.value) {
          sendWS('login', { token: authToken.value });
        } else if (screen.value === 'login') {
          autoLogging.value = false;
        }
      };

      ws.onclose = () => {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        reconnectTimer = setTimeout(connect, delay);
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

    // ---- Toast ----
    function showToast(msg, type = 'info') {
      if (toastTimer) clearTimeout(toastTimer);
      toast.value = { show: true, message: msg, type };
      toastTimer = setTimeout(() => { toast.value.show = false; }, 2500);
    }

    // ---- Login ----
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

    // ---- Home ----
    function createRoom() {
      homeError.value = '';
      sendWS('create_room');
    }

    function joinRoom() {
      if (joinRoomId.value.length !== 6) return;
      homeError.value = '';
      sendWS('join_room', { roomId: joinRoomId.value });
    }

    // ---- Room ----
    function leaveRoom() {
      sendWS('leave_room');
    }

    function addAI() {
      sendWS('add_ai');
    }

    function playerReady() {
      if (readySent.value) return;
      sendWS('ready');
      readySent.value = true;
    }

    // ---- Game ----
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
      sendWS('ready');
      readySent.value = true;
      screen.value = 'room';
    }

    function getPlayerName(seat) {
      const p = gamePlayers.value[seat];
      return p ? p.name : '';
    }

    function getPlayerHandCount(seat) {
      const p = gamePlayers.value[seat];
      if (!p) return 0;
      if (seat === mySeat.value) return myHand.value.length;
      return p.handCount || 0;
    }

    // ---- Message Handler ----
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
          loggingIn.value = false;
          autoLogging.value = false;
          loginError.value = '';
          screen.value = 'home';
          showToast(`欢迎回来，${payload.playerName}`, 'success');
          break;

        case 'error':
          if (screen.value === 'login') {
            loggingIn.value = false;
            autoLogging.value = false;
            loginError.value = payload.message;
          } else {
            showToast(payload.message, 'error');
          }
          break;

        case 'room_joined':
          roomId.value = payload.roomId;
          roomPlayers.value = payload.players || [];
          readySent.value = false;
          roomError.value = '';
          screen.value = 'room';
          mySeat.value = payload.seat;
          gamePlayers.value = payload.players || [];
          break;

        case 'room_left':
          roomId.value = '';
          roomPlayers.value = [];
          readySent.value = false;
          mySeat.value = -1;
          screen.value = 'home';
          break;

        case 'player_joined':
        case 'player_left':
        case 'player_ready':
        case 'player_offline':
        case 'player_reconnected':
          if (payload.players) {
            roomPlayers.value = payload.players;
            gamePlayers.value = payload.players;
          }
          if (type === 'player_joined' && payload.isAI) showToast(`AI玩家 ${payload.playerName} 加入了`, 'info');
          break;

        case 'game_start':
          myHand.value = (payload.hand || []).sort((a, b) => {
            const dv = cardValue(b) - cardValue(a);
            return dv !== 0 ? dv : cardSuit(a) - cardSuit(b);
          });
          bottomCards.value = [];
          landlordSeat.value = null;
          currentTurn.value = null;
          lastPlaySeat.value = null;
          myPlayed.value = [];
          leftPlayed.value = [];
          rightPlayed.value = [];
          selectedCards.value = new Set();
          phaseText.value = '发牌中...';
          screen.value = 'game';
          break;

        case 'bid_turn':
          if (payload.seat === mySeat.value) {
            showBidOverlay.value = true;
            bidMessage.value = `请叫地主 (当前最高: ${payload.currentScore || 0}分)`;
            bidCurrentScore.value = payload.currentScore || 0;
          } else {
            showBidOverlay.value = false;
            phaseText.value = `叫地主中... 当前最高: ${payload.currentScore || 0}分`;
          }
          currentTurn.value = payload.seat;
          break;

        case 'bid_update':
          phaseText.value = `座位${payload.seat+1}: ${payload.score > 0 ? '叫'+payload.score+'分' : '不叫'} · 最高: ${payload.currentMaxScore}分`;
          break;

        case 'bid_result':
          showBidOverlay.value = false;
          landlordSeat.value = payload.landlordSeat;
          baseScore.value = payload.baseScore;
          bottomCards.value = payload.bottomCards || [];
          phaseText.value = `${payload.landlordName} 是地主 · 底牌已公开`;
          // Add bottom cards to hand if we're landlord
          if (payload.landlordSeat === mySeat.value) {
            myHand.value = [...myHand.value, ...(payload.bottomCards || [])].sort((a, b) => {
              const dv = cardValue(b) - cardValue(a);
              return dv !== 0 ? dv : cardSuit(a) - cardSuit(b);
            });
          }
          break;

        case 'double_turn':
          if (payload.seat === mySeat.value) {
            showDoubleOverlay.value = true;
          } else {
            phaseText.value = '加倍阶段...';
          }
          currentTurn.value = payload.seat;
          break;

        case 'double_update':
          multiplier.value = payload.currentMultiplier;
          phaseText.value = `座位${payload.seat+1}: ${payload.level === 0 ? '不加倍' : payload.level === 1 ? '加倍' : '超级加倍'}`;
          break;

        case 'playing_start':
          phaseText.value = '游戏开始!';
          break;

        case 'play_turn':
          currentTurn.value = payload.seat;
          lastPlaySeat.value = payload.lastPlaySeat;
          if (payload.isNewRound) {
            myPlayed.value = [];
            leftPlayed.value = [];
            rightPlayed.value = [];
          }
          selectedCards.value = new Set();
          break;

        case 'play_result':
          if (payload.seat === mySeat.value) {
            // Remove played cards
            const played = new Set(payload.cards);
            myHand.value = myHand.value.filter(c => !played.has(c));
            selectedCards.value = new Set();
            myPlayed.value = payload.cards;
          } else if (payload.seat === leftSeat.value) {
            leftPlayed.value = payload.cards;
          } else if (payload.seat === rightSeat.value) {
            rightPlayed.value = payload.cards;
          }
          // Update hand counts
          const pp = gamePlayers.value[payload.seat];
          if (pp) pp.handCount = payload.handCount;
          break;

        case 'pass_result':
          if (payload.seat === mySeat.value) {
            selectedCards.value = new Set();
          }
          break;

        case 'hint_result':
          if (payload.cards && payload.cards.length > 0) {
            selectedCards.value = new Set(payload.cards);
            showToast('已为你推荐出牌', 'info');
          } else {
            showToast('无牌可出', 'error');
          }
          break;

        case 'game_end':
          showResult.value = true;
          resultTitle.value = payload.isLandlordWin ? '🎉 地主获胜!' : '🎉 农民获胜!';
          resultDetail.value = `赢家: ${payload.winnerName}\n底分: ${payload.baseScore} × ${payload.multiplier} = ${payload.finalScore}分`;
          // Save history
          const won = (payload.isLandlordWin && landlordSeat.value === mySeat.value) || (!payload.isLandlordWin && landlordSeat.value !== mySeat.value);
          const h = history.value;
          h.unshift({
            date: new Date().toLocaleDateString(),
            won,
            detail: `${won ? '胜' : '负'} · ${payload.isLandlordWin ? '地主赢' : '农民赢'} · ${payload.finalScore}分`,
          });
          if (h.length > 50) h.length = 50;
          history.value = [...h];
          localStorage.setItem('dld_history', JSON.stringify(h));
          break;

        case 'room_state':
          // Reconnect: full state sync
          roomId.value = payload.roomId;
          mySeat.value = payload.seat;
          myHand.value = (payload.hand || []).sort((a, b) => {
            const dv = cardValue(b) - cardValue(a);
            return dv !== 0 ? dv : cardSuit(a) - cardSuit(b);
          });
          currentTurn.value = payload.currentTurnSeat;
          landlordSeat.value = payload.landlordSeat;
          lastPlaySeat.value = payload.lastPlaySeat;
          bottomCards.value = payload.bottomCards || [];
          baseScore.value = payload.baseScore;
          multiplier.value = payload.multiplier;
          gamePlayers.value = payload.players || [];
          if (payload.phase === 'waiting') {
            screen.value = 'room';
          } else {
            screen.value = 'game';
            phaseText.value = '已重新连接';
          }
          showToast('已恢复游戏状态', 'success');
          break;

        case 'pong': break;
      }
    }

    // ---- Init ----
    onMounted(() => {
      const token = localStorage.getItem('dld_token');
      if (token) {
        authToken.value = token;
        autoLogging.value = true;
      }
      connect();
    });

    // Heartbeat
    setInterval(() => sendWS('ping'), 15000);

    return {
      screen, toast,
      loginAccount, loginName, loggingIn, autoLogging, loginError, accountId, playerName,
      joinRoomId, homeError, history,
      roomId, roomPlayers, readySent, roomError, roomStatus,
      mySeat, myHand, selectedCards, currentTurn, landlordSeat, bottomCards, multiplier, baseScore,
      lastPlaySeat, showBidOverlay, bidMessage, bidCurrentScore, showDoubleOverlay,
      showResult, resultTitle, resultDetail, phaseText,
      myPlayed, leftPlayed, rightPlayed, gamePlayers,
      leftSeat, rightSeat, canPlay, canPass,
      doLogin, logout, createRoom, joinRoom, leaveRoom, addAI, playerReady,
      toggleCard, doPlay, doPass, doHint, doBid, doDouble, continueGame,
      getPlayerName, getPlayerHandCount, cardDisplay,
    };
  }
}).mount('#app');
