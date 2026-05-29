// ---- Card utils ----
const S = ['♠','♥','♣','♦'];
const RN = {3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A',15:'2',16:'小',17:'大'};
function cv(c){return Math.floor(c/10)||0}
function cs(c){return(c%10)||0}
function cd(c){
  if(typeof c!=='number')return{rank:'?',suit:'?',cls:'black'};
  var v=cv(c),s=cs(c);
  if(v===16)return{rank:'小',suit:'王',cls:'red'};
  if(v===17)return{rank:'大',suit:'王',cls:'red'};
  return{rank:RN[v]||'?',suit:S[s]||'?',cls:(s===1||s===3)?'red':'black'};
}
function sortH(a){return[...a].sort(function(x,y){var d=cv(y)-cv(x);return d!==0?d:cs(x)-cs(y)})}

// ---- State ----
var st={
  screen:'login',
  loginAcc:'',loginName:'',loggingIn:false,autoLog:false,loginErr:'',
  acc:'',name:'',token:'',
  joinId:'',homeErr:'',history:[],
  roomId:'',players:[],mySeat:-1,ready:false,roomErr:'',
  phase:'',  // 'bidding'|'doubling'|'playing'|'finished'
  hand:[],sel:[],
  turn:null,landlord:null,bottom:[],mult:1,score:1,lastPlay:null,
  showBid:false,bidMsg:'',bidCur:0,showDouble:false,
  showResult:false,resTitle:'',resDetail:'',phaseText:'',
  myPlayed:[],leftPlayed:[],rightPlayed:[],
  gPlayers:[null,null,null],
  toast:{show:false,msg:'',type:'info'}
};
var toastTmr=null;
function toast(m,t){clearTimeout(toastTmr);st.toast={show:true,msg:m,type:t||'info'};toastTmr=setTimeout(function(){st.toast.show=false;up()},2200)}

// ---- WebSocket ----
var ws=null,rc=0;
function conn(){
  var p=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(p+'//'+location.host);
  ws.onopen=function(){rc=0;if(st.token){send('login',{token:st.token})}else{st.autoLog=false;up()}};
  ws.onclose=function(){var d=Math.min(1e3*Math.pow(2,rc),3e4);rc++;setTimeout(conn,d)};
  ws.onmessage=function(e){try{handle(JSON.parse(e.data));up()}catch(err){console.error(err)}};
}
function send(t,p){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:t,payload:p||{}}))}

// ---- Message handler ----
function handle(m){
  var t=m.type,p=m.payload||{};
  switch(t){
    case'login_ok':
      st.token=p.token;st.acc=p.accountId;st.name=p.playerName;
      localStorage.setItem('dld_token',p.token);localStorage.setItem('dld_acc',p.accountId);localStorage.setItem('dld_name',p.playerName);
      st.loggingIn=false;st.autoLog=false;st.loginErr='';st.screen='home';toast('欢迎，'+p.playerName,'success');break;
    case'error':
      if(st.screen==='login'){st.loggingIn=false;st.autoLog=false;st.loginErr=p.message}
      else toast(p.message,'error');break;
    case'room_joined':
      if(p.roomId)st.roomId=p.roomId;if(p.seat!==undefined)st.mySeat=p.seat;
      if(p.players){st.players=p.players;st.gPlayers=p.players}
      st.ready=false;st.roomErr='';st.screen='room';break;
    case'room_left':st.roomId='';st.players=[];st.ready=false;st.mySeat=-1;st.screen='home';st.roomErr='';break;
    case'ready_state':if(p.ready!==undefined)st.ready=p.ready;if(p.players){st.players=p.players;st.gPlayers=p.players}break;
    case'player_joined':case'player_left':case'player_ready':case'player_offline':case'player_reconnected':
      if(p.players){st.players=p.players;st.gPlayers=p.players}
      if(t==='player_joined')toast((p.isAI?'AI ':'')+p.playerName+' 加入',p.isAI?'info':'success');break;
    case'game_start':
      st.hand=sortH(p.hand||[]);st.phase='bidding';st.bottom=[];st.landlord=null;st.turn=null;
      st.lastPlay=null;st.myPlayed=[];st.leftPlayed=[];st.rightPlayed=[];st.sel=[];
      st.phaseText='发牌完成 · 叫地主阶段';st.showBid=false;st.showDouble=false;st.showResult=false;
      st.screen='game';toast('游戏开始！','success');break;
    case'bid_turn':
      st.turn=p.seat;st.phase='bidding';
      if(p.seat===st.mySeat){st.showBid=true;st.bidMsg='请叫地主 (最高:'+(p.currentScore||0)+'分)';st.bidCur=p.currentScore||0}
      else{st.showBid=false;st.phaseText='叫地主中 · 最高:'+(p.currentScore||0)+'分'}break;
    case'bid_update':st.phaseText='座位'+(p.seat+1)+':'+(p.score>0?'叫'+p.score+'分':'不叫')+' · 最高:'+p.currentMaxScore+'分';break;
    case'no_bidder':st.showBid=false;toast('无人叫地主，重新发牌','info');break;
    case'bid_result':
      st.showBid=false;st.landlord=p.landlordSeat;st.score=p.baseScore;st.bottom=p.bottomCards||[];
      st.phase='doubling';st.phaseText=p.landlordName+' 是地主 · 加倍阶段';
      if(p.landlordSeat===st.mySeat&&p.bottomCards)st.hand=sortH(st.hand.concat(p.bottomCards));break;
    case'double_turn':
      st.turn=p.seat;st.phase='doubling';
      if(p.seat===st.mySeat)st.showDouble=true;else st.phaseText='加倍阶段...';break;
    case'double_update':st.mult=p.currentMultiplier;st.phaseText='座位'+(p.seat+1)+':'+(p.level===0?'不加倍':p.level===1?'加倍':'超级加倍');break;
    case'playing_start':st.phase='playing';st.phaseText='开始出牌！';break;
    case'play_turn':
      st.turn=p.seat;st.lastPlay=p.lastPlaySeat;st.phase='playing';
      if(p.isNewRound){st.myPlayed=[];st.leftPlayed=[];st.rightPlayed=[]}st.sel=[];break;
    case'play_result':
      if(p.seat===st.mySeat){var ps=new Set(p.cards);st.hand=st.hand.filter(function(c){return!ps.has(c)});st.myPlayed=p.cards}
      else if(p.seat===ls())st.leftPlayed=p.cards;else if(p.seat===rs())st.rightPlayed=p.cards;
      if(st.gPlayers[p.seat])st.gPlayers[p.seat].handCount=p.handCount;st.sel=[];break;
    case'pass_result':if(p.seat===st.mySeat)st.sel=[];break;
    case'hint_result':
      if(p.cards&&p.cards.length>0){st.sel=p.cards;toast('推荐出牌方案','info')}else toast('无牌可出','error');break;
    case'game_end':
      st.showResult=true;st.phase='finished';
      st.resTitle=p.isLandlordWin?'地主获胜！':'农民获胜！';
      st.resDetail='赢家:'+p.winnerName+' | '+p.baseScore+' × '+p.multiplier+' = '+p.finalScore+'分';
      var isL=st.landlord===st.mySeat,won=(p.isLandlordWin&&isL)||(!p.isLandlordWin&&!isL);
      st.history.unshift({date:new Date().toLocaleDateString(),won:won,detail:(won?'胜':'负')+' · '+(p.isLandlordWin?'地主赢':'农民赢')+' · '+p.finalScore+'分'});
      if(st.history.length>50)st.history.length=50;
      localStorage.setItem('dld_hist',JSON.stringify(st.history));break;
    case'room_state':
      st.roomId=p.roomId;st.mySeat=p.seat;st.hand=sortH(p.hand||[]);
      st.turn=p.currentTurnSeat;st.landlord=p.landlordSeat;st.lastPlay=p.lastPlaySeat;
      st.bottom=p.bottomCards||[];st.score=p.baseScore;st.mult=p.multiplier;
      if(p.players){st.gPlayers=p.players;st.players=p.players}
      st.screen=p.phase==='waiting'?'room':'game';
      st.phase=p.phase==='playing'?'playing':p.phase==='bidding'?'bidding':p.phase==='doubling'?'doubling':'';
      if(st.screen==='game')st.phaseText='已重新连接';toast('已恢复','success');break;
  }
}

// ---- Helpers ----
function ls(){return st.mySeat>=0?(st.mySeat+1)%3:0}
function rs(){return st.mySeat>=0?(st.mySeat+2)%3:2}
function gp(s){return(st.gPlayers&&st.gPlayers[s])||null}
function gpn(s){var p=gp(s);return p?p.name:'?'}
function ghc(s){if(s===st.mySeat)return st.hand.length;var p=gp(s);return p?(p.handCount||0):0}
function pc(){return st.players.filter(function(p){return p!==null}).length}
function prc(){return st.players.filter(function(p){return p&&p.ready}).length}

// ---- Actions ----
function doLogin(){
  if(!st.loginAcc||!st.loginName)return;st.loggingIn=true;st.loginErr='';
  st.acc=st.loginAcc;st.name=st.loginName;send('login',{accountId:st.loginAcc,playerName:st.loginName});
}
function logout(){st.token='';localStorage.removeItem('dld_token');st.screen='login';up()}
function doCreateRoom(){st.homeErr='';send('create_room')}
function doJoinRoom(){if(st.joinId.length===6){st.homeErr='';send('join_room',{roomId:st.joinId})}}
function doLeaveRoom(){send('leave_room')}
function doAddAI(){st.roomErr='';send('add_ai');toast('添加AI...','info')}
function doToggleReady(){send('ready',{ready:!st.ready})}
function toggleCard(c){
  if(st.phase!=='playing'||st.turn!==st.mySeat)return;
  var i=st.sel.indexOf(c);if(i>=0)st.sel.splice(i,1);else st.sel.push(c);up()
}
function doPlay(){
  if(st.phase!=='playing'){toast('请先完成叫地主和加倍','error');return}
  if(st.sel.length===0){toast('请选择要出的牌','error');return}
  send('play',{cards:st.sel.slice()});
}
function doPass(){if(st.phase!=='playing')return;send('pass')}
function doHint(){send('hint')}
function doBid(s){send('bid',{score:s});st.showBid=false;up()}
function doDouble(l){send('double',{level:l});st.showDouble=false;up()}
function doContinue(){st.showResult=false;send('ready',{ready:true});st.ready=true;st.screen='room';up()}

// ---- Render ----
function $(id){return document.getElementById(id)}
function tx(id,v){var e=$(id);if(e)e.textContent=v}
function hm(id,v){var e=$(id);if(e)e.innerHTML=v}
function dp(id,v){var e=$(id);if(e)e.style.display=v}
function up(){
  var s=st;
  // Toast
  var te=$('toast');if(te){if(s.toast.show){te.textContent=s.toast.msg;te.className='toast '+s.toast.type+' show'}else te.className='toast'}

  // Login
  dp('screen-login',s.screen==='login'?'flex':'none');
  if(s.screen==='login'){
    dp('login-auto',s.autoLog?'block':'none');tx('login-error',s.loginErr);
    var lb=$('login-btn');if(lb){lb.disabled=s.loggingIn||s.autoLog;lb.textContent=s.loggingIn?'登录中...':(s.autoLog?'请稍候...':'进入游戏')}
  }

  // Home
  dp('screen-home',s.screen==='home'?'block':'none');
  if(s.screen==='home'){
    tx('home-user',s.name+' · '+s.acc);
    var hp=$('history-panel'),hl=$('history-list');
    if(s.history.length>0){if(hp)hp.style.display='block';if(hl)hl.innerHTML=s.history.slice(0,10).map(function(h){return'<div class="item"><span class="dt">'+h.date+'</span><span class="rs '+(h.won?'win':'lose')+'">'+(h.won?'胜':'负')+'</span><span class="det">'+h.detail+'</span></div>'}).join('')}
    else{if(hp)hp.style.display='none'}
    tx('home-error',s.homeErr);
  }

  // Room
  dp('screen-room',s.screen==='room'?'flex':'none');
  if(s.screen==='room'){
    tx('room-id',s.roomId);
    for(var i=0;i<3;i++){renderSeat(i)}
    var rse=$('room-status');if(rse){var c=pc(),r=prc();rse.textContent=c<3?'等待加入 ('+c+'/3) — 点"+AI"添加机器人':r<3?'已准备: '+r+'/3':'全部就绪，游戏开始！'}
    var rb=$('ready-btn');if(rb){rb.textContent=s.ready?'取消准备':'准备';rb.className='btn full big '+(s.ready?'secondary':'primary')}
    var ab=$('add-ai-btn');if(ab)ab.disabled=pc()>=3||!s.roomId;
    tx('room-error',s.roomErr);
  }

  // Game
  dp('screen-game',s.screen==='game'?'flex':'none');
  if(s.screen==='game')renderGame();
}

function renderSeat(i){
  var sl=$( 'seat-'+i);if(!sl)return;var p=st.players[i];
  if(p){sl.className='seat'+(p.isAI?' ai':'');sl.innerHTML='<div class="av">'+(p.isAI?'🤖':(p.name||'?')[0])+'</div><div><div class="nm">'+p.name+(p.name===st.name?' (你)':'')+(p.isAI?' (AI)':'')+'</div><div class="st"><span class="badge '+(p.ready?'ok':'wait')+'">'+(p.ready?'已准备':'未准备')+'</span></div></div>'}
  else{sl.className='seat empty';sl.innerHTML='<div class="av empt">?</div><div><div class="nm">空位</div></div>'}
}

function renderGame(){
  try{
    var s=st;
    tx('game-phase',s.phaseText||'');
    // Bottom cards
    var be=$('bottom-bar');if(be){if(s.bottom.length){be.style.display='block';be.innerHTML='底牌: '+s.bottom.map(function(c){var d=cd(c);return'<span class="mc">'+d.rank+d.suit+'</span>'}).join('')}else be.style.display='none'}

    // Opponents
    renderOpp('left',ls());renderOpp('right',rs());

    // My bar
    tx('my-name',s.name+' (你)');
    var mr=$('my-role');if(mr){if(s.landlord!==null){mr.className=(s.landlord===s.mySeat?'lord':'farmer')+' show';mr.textContent=s.landlord===s.mySeat?'地主':'农民'}else{mr.className='';mr.style.display='none'}}
    tx('my-count',s.hand.length+'张');

    // Hand
    var hr=$('hand-row');if(hr)hr.innerHTML=s.hand.map(function(c){var d=cd(c),sel=s.sel.indexOf(c)>=0?' sel':'';return'<div class="card '+d.cls+sel+'" data-c="'+c+'" ontouchstart="tcStart(event,'+c+')" onclick="toggleCard('+c+')"><span class="rk">'+d.rank+'</span><span class="st">'+d.suit+'</span></div>'}).join('');
    dp('hand-wrap',s.hand.length>0?'block':'none');

    // Played
    hm('pz-left',s.leftPlayed.map(function(c){var d=cd(c);return'<span class="pz-card '+d.cls+'">'+d.rank+d.suit+'</span>'}).join(''));
    hm('pz-right',s.rightPlayed.map(function(c){var d=cd(c);return'<span class="pz-card '+d.cls+'">'+d.rank+d.suit+'</span>'}).join(''));
    hm('pz-mine',s.myPlayed.map(function(c){var d=cd(c);return'<span class="pz-card '+d.cls+'">'+d.rank+d.suit+'</span>'}).join(''));

    // Turn hint
    var th=$('turn-hint');if(th){
      if(s.phase==='bidding')th.textContent=s.turn===s.mySeat?'轮到你叫地主':s.turn!==null?'等待其他玩家叫地主...':'';
      else if(s.phase==='doubling')th.textContent=s.turn===s.mySeat?'轮到你加倍':s.turn!==null?'等待其他玩家加倍...':'';
      else if(s.phase==='playing')th.textContent=s.turn===s.mySeat?'轮到你出牌':s.turn!==null?'等待 '+gpn(s.turn)+' 出牌...':'';
      else th.textContent='';
    }

    // Action buttons - ONLY enable during 'playing' phase
    var playBtn=$('btn-play'),passBtn=$('btn-pass'),hintBtn=$('btn-hint');
    var isMyTurn=s.turn===s.mySeat&&s.phase==='playing';
    if(playBtn)playBtn.disabled=!(isMyTurn&&s.sel.length>0);
    if(passBtn)passBtn.disabled=!(isMyTurn&&s.lastPlay!==null&&s.lastPlay!==s.mySeat);
    if(hintBtn)hintBtn.disabled=!isMyTurn;

    // Overlays
    dp('ov-bid',s.showBid?'flex':'none');
    if(s.showBid){tx('bid-msg',s.bidMsg);document.querySelectorAll('#ov-bid .btn').forEach(function(b){var sc=parseInt(b.textContent);if(sc>0)b.disabled=sc<=s.bidCur})}
    dp('ov-double',s.showDouble?'flex':'none');
    dp('ov-result',s.showResult?'flex':'none');
    if(s.showResult){tx('res-title',s.resTitle);tx('res-detail',s.resDetail)}
  }catch(err){console.error('renderGame:',err)}
}

function renderOpp(side,seat){
  var nm=gpn(seat);tx('nm-'+side,nm||'等待');
  var av=document.querySelector('#ply-'+side+' .ply-avatar');if(av)av.textContent=nm?nm[0]:'?';
  tx('ct-'+side,ghc(seat)+'张');
  var rl=$('rl-'+side);if(rl){if(st.landlord!==null){rl.className='ply-role show '+(st.landlord===seat?'lord':'farmer');rl.textContent=st.landlord===seat?'地主':'农民'}else{rl.className='ply-role';rl.style.display='none'}}
  var pl=$('ply-'+side);if(pl)pl.className='ply ply-'+side+(st.turn===seat?' active':'');
  var ty=$('ty-'+side);if(ty){var played=side==='left'?st.leftPlayed:st.rightPlayed;if(played.length){ty.style.display='block';ty.innerHTML=played.map(function(c){var d=cd(c);return'<span class="tc '+d.cls+'">'+d.rank+d.suit+'</span>'}).join('')}else ty.style.display='none'}
}

// ---- Touch swipe for card selection ----
var touchState={active:false,startX:0,startY:0,cards:[]};
function tcStart(e,c){
  if(st.phase!=='playing'||st.turn!==st.mySeat)return;
  e.preventDefault();touchState.active=true;touchState.startX=e.touches[0].clientX;touchState.startY=e.touches[0].clientY;
  touchState.cards=document.querySelectorAll('.card');toggleCard(c);
}
document.addEventListener('touchmove',function(e){
  if(!touchState.active)return;
  var tx=e.touches[0].clientX,ty=e.touches[0].clientY;
  var el=document.elementFromPoint(tx,ty);if(el&&el.classList.contains('card')){
    var c=parseInt(el.dataset.c);if(!isNaN(c)&&st.sel.indexOf(c)<0)toggleCard(c)
  }
},{passive:false});
document.addEventListener('touchend',function(){touchState.active=false});

// ---- Init ----
st.loginAcc=localStorage.getItem('dld_acc')||'';st.loginName=localStorage.getItem('dld_name')||'';
st.token=localStorage.getItem('dld_token')||'';st.history=JSON.parse(localStorage.getItem('dld_hist')||'[]');
if(st.token)st.autoLog=true;
conn();setInterval(function(){send('ping')},15000);

document.addEventListener('DOMContentLoaded',function(){
  var la=$('login-account');if(la){la.value=st.loginAcc;la.addEventListener('input',function(){st.loginAcc=this.value})}
  var ln=$('login-name');if(ln){ln.value=st.loginName;ln.addEventListener('input',function(){st.loginName=this.value})}
  var ji=$('join-input');if(ji)ji.addEventListener('input',function(){st.joinId=this.value});
  up();setInterval(up,400);
});

// Expose
window.tcStart=tcStart;
window.doLogin=doLogin;window.logout=logout;window.doCreateRoom=doCreateRoom;window.doJoinRoom=doJoinRoom;
window.doLeaveRoom=doLeaveRoom;window.doAddAI=doAddAI;window.doToggleReady=doToggleReady;
window.toggleCard=toggleCard;window.doPlay=doPlay;window.doPass=doPass;window.doHint=doHint;
window.doBid=doBid;window.doDouble=doDouble;window.doContinue=doContinue;
