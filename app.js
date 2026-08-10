/* =====================================================================
   FACE-OFF: SECURITY+  —  application
   Roles:  #/          launcher
           #/host      host console (projector)
           #/play/CODE student device
   ===================================================================== */
(function () {
'use strict';

var QB  = window.FACEOFF_QUESTIONS;
var FB  = window.FACEOFF_FIREBASE || { enabled: false };
var app = document.getElementById('app');

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid() { return Math.random().toString(36).slice(2, 10); }
function roomCode() {
  var L = 'ABCDEFGHJKLMNPQRSTUVWXYZ', s = '';
  for (var i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
  return s;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function fmt(n) { return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString(); }
function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
/* per-TAB identity: two tabs on one machine = two different players,
   and a refresh keeps you in your seat */
function ssGet(k, d) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

var COLORS = [
  { id: 'blue',   name: 'Royal',   hex: '#2f4fb0' },
  { id: 'red',    name: 'Crimson', hex: '#b91c1c' },
  { id: 'green',  name: 'Emerald', hex: '#15803d' },
  { id: 'purple', name: 'Violet',  hex: '#6d28d9' },
  { id: 'yellow', name: 'Gold',    hex: '#eab308' },
  { id: 'orange', name: 'Ember',   hex: '#c2410c' },
  { id: 'cyan',   name: 'Ice',     hex: '#0e7490' },
  { id: 'pink',   name: 'Magenta', hex: '#a21caf' },
  { id: 'lime',   name: 'Lime',    hex: '#4d7c0f' },
  { id: 'rose',   name: 'Rose',    hex: '#e11d48' },
  { id: 'sky',    name: 'Sky',     hex: '#0284c7' },
  { id: 'sand',   name: 'Sand',    hex: '#a16207' },
  { id: 'teal',   name: 'Teal',    hex: '#0d9488' },
  { id: 'indigo', name: 'Indigo',  hex: '#4338ca' },
  { id: 'amber',  name: 'Amber',   hex: '#d97706' },
  { id: 'slate',  name: 'Slate',   hex: '#475569' }
];
var MAX_TEAMS = 16, MAX_TEAM_SIZE = 8;
/* host-keyboard buzzers, in team order: 1-9, then 0, then - and = */
var BUZZ_KEYS = ['1','2','3','4','5','6','7','8','9','0','-','=','q','w','e','r'];

/* keep caret/focus across re-renders */
function withFocus(fn) {
  var el = document.activeElement, id = el && el.id, ss = null, se = null;
  try { ss = el.selectionStart; se = el.selectionEnd; } catch (e) {}
  fn();
  if (id) {
    var n = document.getElementById(id);
    if (n) { n.focus(); try { if (ss != null) n.setSelectionRange(ss, se); } catch (e) {} }
  }
}

function flash(msg, kind) {
  var host = $('#flash-host');
  host.innerHTML = '<div class="flash ' + (kind || '') + '">' + esc(msg) + '</div>';
  clearTimeout(flash._t);
  flash._t = setTimeout(function () { host.innerHTML = ''; }, 1800);
}

/* ------------------------------------------------------------------ */
/* sound                                                               */
/* ------------------------------------------------------------------ */
var Snd = {
  on: true, ctx: null,
  ac: function () {
    if (!this.on) return null;
    if (!this.ctx) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; this.ctx = new C(); }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone: function (freq, dur, type, vol, delay) {
    var c = this.ac(); if (!c) return;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.03);
  },
  buzz:    function () { this.tone(200, .28, 'square', .16); this.tone(150, .3, 'square', .12, .02); },
  correct: function () { this.tone(660, .13, 'sine', .18); this.tone(880, .22, 'sine', .18, .12); },
  wrong:   function () { this.tone(200, .3, 'sawtooth', .13); this.tone(140, .35, 'sawtooth', .12, .1); },
  dd:      function () { [523, 659, 784, 1047].forEach(function (f, i) { Snd.tone(f, .3, 'triangle', .16, i * .1); }); },
  tick:    function () { this.tone(1100, .04, 'square', .05); },
  timeup:  function () { this.tone(120, .6, 'sawtooth', .16); }
};

/* ------------------------------------------------------------------ */
/* transports                                                          */
/* ------------------------------------------------------------------ */
/* Local transport: works across browser TABS (BroadcastChannel) *and* across
   same-page frames (a shared in-page bus). Messages are deduped, so both
   channels can run at once without doubling up. */
function sharedBus() {
  var w = window;
  try { if (window.top && window.top.document) w = window.top; } catch (e) { w = window; }
  if (!w.__FO_BUS) {
    w.__FO_BUS = {
      subs: [],
      post: function (m) { this.subs.slice().forEach(function (f) { try { f(m); } catch (e) {} }); },
      sub: function (f) { this.subs.push(f); }
    };
  }
  return w.__FO_BUS;
}

function LocalTransport(room) {
  this.room = room;
  this.self = uid();
  this.seen = {};
  try { this.ch = ('BroadcastChannel' in window) ? new BroadcastChannel('faceoff:' + room) : null; }
  catch (e) { this.ch = null; }
  this.bus = sharedBus();
  this.kPub = 'fo:pub:' + room; this.kTim = 'fo:tim:' + room;
}
LocalTransport.prototype = {
  name: 'local',
  _post: function (msg) {
    msg.__room = this.room; msg.__from = this.self; msg.__id = uid();
    try { if (this.ch) this.ch.postMessage(msg); } catch (e) {}
    try { this.bus.post(msg); } catch (e) {}
  },
  _listen: function (fn) {
    var self = this;
    var handler = function (msg) {
      if (!msg || msg.__room !== self.room) return;
      if (msg.__from === self.self) return;          // ignore our own echo
      if (self.seen[msg.__id]) return;
      self.seen[msg.__id] = 1;
      fn(msg);
    };
    try { if (this.ch) this.ch.onmessage = function (e) { handler(e.data); }; } catch (e) {}
    try { this.bus.sub(handler); } catch (e) {}
  },
  hostInit: function (onAction) {
    var self = this;
    this._listen(function (d) {
      if (d.k === 'action') onAction(d.v);
      if (d.k === 'hello') { if (self.last) self._post({ k: 'pub', v: self.last }); if (self.lastT) self._post({ k: 'timer', v: self.lastT }); }
    });
    return Promise.resolve();
  },
  publish: function (pub) { this.last = pub; lsSet(this.kPub, pub); this._post({ k: 'pub', v: pub }); },
  publishTimer: function (t) { this.lastT = t; lsSet(this.kTim, t); this._post({ k: 'timer', v: t }); },
  playerInit: function (onPub, onTimer) {
    this._listen(function (d) {
      if (d.k === 'pub') onPub(d.v);
      if (d.k === 'timer') onTimer(d.v);
    });
    var p = lsGet(this.kPub, null); if (p) onPub(p);
    var t = lsGet(this.kTim, null); if (t) onTimer(t);
    this._post({ k: 'hello' });
    return Promise.resolve();
  },
  send: function (a) { this._post({ k: 'action', v: a }); }
};

function FirebaseTransport(room) { this.room = room; }
FirebaseTransport.prototype = {
  name: 'firebase',
  _load: function () {
    if (this._p) return this._p;
    var self = this;
    this._p = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js')
    ]).then(function (m) {
      self.A = m[0]; self.D = m[1];
      self.appRef = self.A.initializeApp(FB.config);
      self.db = self.D.getDatabase(self.appRef);
      self.base = 'rooms/sec-' + self.room;
    });
    return this._p;
  },
  hostInit: function (onAction) {
    var self = this;
    return this._load().then(function () {
      var D = self.D;
      return D.set(D.ref(self.db, self.base + '/actions'), null).then(function () {
        D.onChildAdded(D.ref(self.db, self.base + '/actions'), function (snap) {
          var v = snap.val();
          D.remove(snap.ref);
          if (v) onAction(v);
        });
        D.set(D.ref(self.db, self.base + '/meta'), { created: Date.now() });
      });
    });
  },
  publish: function (pub) {
    var self = this;
    this._load().then(function () { self.D.set(self.D.ref(self.db, self.base + '/pub'), pub); });
  },
  publishTimer: function (t) {
    var self = this;
    this._load().then(function () { self.D.set(self.D.ref(self.db, self.base + '/timer'), t); });
  },
  playerInit: function (onPub, onTimer) {
    var self = this;
    return this._load().then(function () {
      var D = self.D;
      D.onValue(D.ref(self.db, self.base + '/pub'), function (s) { if (s.val()) onPub(s.val()); });
      D.onValue(D.ref(self.db, self.base + '/timer'), function (s) { if (s.val()) onTimer(s.val()); });
    });
  },
  send: function (a) {
    var self = this;
    this._load().then(function () { self.D.push(self.D.ref(self.db, self.base + '/actions'), a); });
  }
};

/* Checks firebase-config.js for the mistakes that actually happen, and
   explains them in plain English instead of dying in the console. */
function fbConfigProblem() {
  if (!FB.enabled) return null;                       // Local Mode on purpose
  var c = FB.config || {};
  if (!c.apiKey || String(c.apiKey).indexOf('PASTE') === 0) {
    return 'Firebase is turned on, but the apiKey in firebase-config.js is still the placeholder text.';
  }
  if (!c.databaseURL) {
    return 'Firebase is turned on, but firebase-config.js has no <b>databaseURL</b>. ' +
           'Firebase only puts that line in your config once a Realtime Database exists. ' +
           'In the Firebase console go to <b>Build → Realtime Database → Create Database</b> ' +
           '(Realtime Database, NOT Firestore), then copy the URL it shows and add it to the config.';
  }
  if (!/firebaseio\.com|firebasedatabase\.app/.test(String(c.databaseURL))) {
    return 'The <b>databaseURL</b> in firebase-config.js doesn\'t look like a Realtime Database address. ' +
           'It should end in <span class="mono">firebaseio.com</span> or <span class="mono">firebasedatabase.app</span>.';
  }
  return null;
}
var FB_PROBLEM = fbConfigProblem();
var FB_RUNTIME_ERROR = null;

function makeTransport(room) {
  return liveMode() ? new FirebaseTransport(room) : new LocalTransport(room);
}
function liveMode() {
  /* a broken config falls back to Local Mode so the class still runs */
  return !!FB.enabled && !FB_PROBLEM;
}

/* persistent, dismissible explanation — not a toast that vanishes */
function fbBanner() {
  var msg = FB_RUNTIME_ERROR || FB_PROBLEM;
  if (!msg) return '';
  return '<div class="fbwarn"><div class="ic">⚠</div><div><b>Students can\'t join from their phones — ' +
    'the game fell back to Local Mode.</b><br>' + msg +
    '<br><span style="opacity:.75">Everything else still works: run it off the projector and use the ' +
    'number keys to buzz for each team.</span></div></div>';
}

/* ------------------------------------------------------------------ */
/* board construction                                                  */
/* ------------------------------------------------------------------ */
var POOL = (QB && QB.categories) || [];
var LIGHTNING = (QB && QB.lightning) || [];

/* Tournament length preset -> board shape. Categories x rows per board,
   plus how many questions the head-to-head Lightning Final runs. */
var LENGTHS = {
  30:  { cats: 3, rows: 3, lightning: 8  },
  45:  { cats: 4, rows: 3, lightning: 10 },
  60:  { cats: 4, rows: 4, lightning: 10 },
  90:  { cats: 5, rows: 5, lightning: 12 },
  120: { cats: 6, rows: 5, lightning: 15 }
};
function lengthPlan(mins) { return LENGTHS[mins] || LENGTHS[60]; }

/* Ranking for eliminations: fewest points goes out first. On a tie, fewer
   correct answers goes first. Still level? The team that BUZZED LESS goes out —
   a team that tried and missed beats a team that never risked it. Consistent
   with points not being deducted for wrong answers. */
function worstFirst(a, b) {
  if (a.score !== b.score) return a.score - b.score;
  if ((a.right || 0) !== (b.right || 0)) return (a.right || 0) - (b.right || 0);
  return (a.wrong || 0) - (b.wrong || 0);
}
function trulyLevel(a, b) {
  return a.score === b.score && (a.right || 0) === (b.right || 0) && (a.wrong || 0) === (b.wrong || 0);
}

/* Solo bracket: cut to the last 2, who then face off.
   Class vs class: cut each class down to 1, and those two champions face off. */
function boardsNeeded(teams, classMode, aCount, bCount) {
  if (classMode) {
    return Math.max(1, Math.ceil((Math.max(aCount, bCount) - 1) / 2));
  }
  return Math.max(1, Math.ceil((teams - 2) / 2));
}
function cutSize(alive) { return Math.max(0, Math.min(2, alive - 2)); }
function classCutSize(aliveInClass) { return Math.max(0, Math.min(2, aliveInClass - 1)); }

function newDeck() { return { used: {}, cursor: 0 }; }

/* Draw one board from the pool. Categories rotate round to round and no
   clue is ever repeated inside a game. */
function drawBoard(deck, nCats, nRows, mult, recycled) {
  if (!POOL.length) return [];
  nCats = Math.min(nCats, POOL.length);
  var board = [], seen = 0;
  while (board.length < nCats && seen < POOL.length) {
    var ci = deck.cursor % POOL.length;
    deck.cursor++; seen++;
    var cat = POOL[ci], free = [];
    for (var k = 0; k < cat.clues.length; k++) if (!deck.used[ci + ':' + k]) free.push(k);
    if (free.length < nRows) continue;                    // this category is spent
    var picks = free.slice(0, nRows);
    picks.forEach(function (k) { deck.used[ci + ':' + k] = true; });
    board.push({
      name: cat.name,
      clues: picks.map(function (k, row) {
        var cl = cat.clues[k];
        return { q: cl.q, a: cl.a, alt: cl.alt || [], obj: cl.obj || cat.obj || '',
                 value: (row + 1) * 100 * mult, done: false, dd: false };
      })
    });
  }
  if (board.length < nCats && !recycled) {                // pool ran dry mid-game
    deck.used = {};
    return drawBoard(deck, nCats, nRows, mult, true);
  }
  placeDailyDoubles(board, (board.length * nRows) >= 20 ? 2 : 1);
  return board;
}

function placeDailyDoubles(board, count) {
  var pool = [];
  board.forEach(function (cat, c) {
    var floor = Math.min(2, cat.clues.length - 1);        // never in the cheapest rows
    cat.clues.forEach(function (cl, i) { if (i >= floor) pool.push([c, i]); });
  });
  var usedCats = {};
  for (var k = 0; k < count && pool.length; k++) {
    var pick, tries = 0;
    do { pick = pool[Math.floor(Math.random() * pool.length)]; tries++; }
    while (usedCats[pick[0]] && tries < 40);
    usedCats[pick[0]] = true;
    board[pick[0]].clues[pick[1]].dd = true;
    pool = pool.filter(function (x) { return !(x[0] === pick[0] && x[1] === pick[1]); });
  }
}

function shuffled(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */
var currentTeardown = null;
function route() {
  if (currentTeardown) { try { currentTeardown(); } catch (e) {} currentTeardown = null; }
  var h = (location.hash || '#/').replace(/^#/, '');
  var mh = h.match(/^\/host\/?([A-Za-z0-9]*)/);
  var m  = h.match(/^\/play\/?([A-Za-z0-9]*)\/?([0-9]*)/);
  if (mh) { currentTeardown = Host((mh[1] || '').toUpperCase() || null); }
  else if (m) { currentTeardown = Player((m[1] || '').toUpperCase(), m[2] || ''); }
  else { Launcher(); }
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------------ */
/* launcher                                                            */
/* ------------------------------------------------------------------ */
function Launcher() {
  var live = liveMode();
  app.innerHTML =
  '<div class="launch"><div class="launch-inner">' +
    '<div class="brand" style="justify-content:center"><div class="mark">⚔</div>' +
      '<div><div class="t1">CYBER WARRIOR</div><div class="t2">COMMAND CENTER</div></div></div>' +
    '<h1>FACE-OFF</h1>' +
    '<div class="sub">Security+ &nbsp;·&nbsp; SY0-701 &nbsp;·&nbsp; Team Review</div>' +
    '<div class="launch-cards">' +
      '<div class="card" data-go="host"><h3>🎬 Host a Game</h3>' +
        '<div class="hint">Open this on the projector. Generates a room code + QR for students to join.</div></div>' +
      '<div class="card" data-go="play"><h3>📱 Join as a Player</h3>' +
        '<div class="hint">Students tap here (or scan the QR) to pick a team, name it, and get a buzzer.</div></div>' +
    '</div>' +
    '<div class="mode-pill ' + (live ? 'live' : '') + '">' +
      (live ? '● LIVE MODE — students can join from any device'
            : '○ LOCAL MODE — works across tabs on this computer only. See FIREBASE-SETUP.md to go live.') +
    '</div>' +
  '</div></div>';
  app.onclick = function (e) {
    var c = e.target.closest('[data-go]'); if (!c) return;
    location.hash = c.getAttribute('data-go') === 'host' ? '#/host' : '#/play';
  };
}

/* ================================================================== */
/* HOST                                                                */
/* ================================================================== */
function Host(forcedCode) {
  var saved = lsGet('fo:host', null);
  var S = {
    room: forcedCode || (saved && saved.room) || roomCode(),
    settings: Object.assign({
      teamCount: 8, teamSize: 5, answerSecs: 15, lightningSecs: 10,
      lengthMinutes: 60, minWager: 100, deduct: false, sound: true,
      classMode: false, classA: 'CLASS A', classB: 'CLASS B'
    }, (saved && saved.settings) || {}),
    phase: 'lobby',
    teams: [],
    deck: newDeck(),
    tour: null,           /* set when the tournament starts */
    lightning: false,     /* true once the last two teams are heads-up */
    active: null, control: null,
    buzzOrder: [], lockedOut: [], current: null,
    answers: {}, reveal: false, ddWager: null,
    timer: { running: false, endsAt: 0, total: 0 },
    settingsOpen: false
  };
  Snd.on = S.settings.sound;

  function makeTeams(n) {
    var old = S.teams.slice();
    S.teams = [];
    for (var i = 0; i < n; i++) {
      var t = old[i] || {
        id: 't' + (i + 1), slot: i + 1, name: 'Team ' + (i + 1),
        color: COLORS[i % COLORS.length].hex, colorId: COLORS[i % COLORS.length].id,
        members: [], score: 0, right: 0, wrong: 0, captain: null, locked: false, cls: 'A'
      };
      if (t.right == null) { t.right = 0; t.wrong = 0; }
      if (!t.cls) t.cls = 'A';
      S.teams.push(t);
    }
    autoSplitClasses();
  }

  /* default class split: first half CLASS A, second half CLASS B */
  function autoSplitClasses() {
    if (!S.settings.classMode) { S.teams.forEach(function (t) { t.cls = 'A'; }); return; }
    var half = Math.ceil(S.teams.length / 2);
    S.teams.forEach(function (t, i) { if (!t.clsPinned) t.cls = i < half ? 'A' : 'B'; });
  }
  function classOf(t) { return S.settings.classMode ? (t.cls || 'A') : 'A'; }
  function className(c) { return c === 'B' ? S.settings.classB : S.settings.classA; }
  function teamsInClass(c) { return S.teams.filter(function (t) { return classOf(t) === c; }); }
  function classTotal(c) {
    return teamsInClass(c).reduce(function (a, t) { return a + t.score; }, 0);
  }
  makeTeams(S.settings.teamCount);

  var T = makeTransport(S.room);
  var tickHandle = null;

  function team(id) { for (var i = 0; i < S.teams.length; i++) if (S.teams[i].id === id) return S.teams[i]; return null; }
  function buzzKeyHint() {
    var n = Math.min(S.teams.length, BUZZ_KEYS.length);
    if (n <= 9) return '1-' + n;
    return '1-9 then ' + BUZZ_KEYS.slice(9, n).join(' ');
  }
  function persist() { lsSet('fo:host', { room: S.room, settings: S.settings }); }

  /* ---------- publish ---------- */
  function pubState() {
    var q = null;
    if (S.active && ['clue', 'answering', 'judge', 'ddclue', 'ddjudge', 'reveal'].indexOf(S.phase) >= 0) {
      q = { cat: S.active.cat, text: S.active.clue.q, value: S.active.value,
            dd: !!S.active.clue.dd, lightning: !!S.lightning };
    }
    var answered = {};
    Object.keys(S.answers).forEach(function (k) { answered[k] = true; });
    var T2 = S.tour;
    var p = {
      ts: Date.now(),
      phase: S.phase, room: S.room,
      teams: S.teams.map(function (t) {
        return { id: t.id, slot: t.slot, name: t.name, color: t.color, colorId: t.colorId,
                 score: t.score, right: t.right || 0, wrong: t.wrong || 0,
                 members: t.members, captain: t.captain, locked: t.locked };
      }),
      q: q, control: S.control, current: S.current,
      buzzOrder: S.buzzOrder, lockedOut: S.lockedOut, answered: answered,
      reveal: S.reveal && S.active ? { a: S.active.clue.a } : null,
      ddTeam: (S.phase === 'ddwager' || S.phase === 'ddclue' || S.phase === 'ddjudge') ? S.control : null,
      ddWager: S.ddWager,
      minWager: S.settings.minWager,
      teamSize: S.settings.teamSize,
      roundMax: S.active ? Math.max(500, S.active.value) : 500,
      answerSecs: S.settings.answerSecs,
      alive: T2 ? T2.alive : S.teams.map(function (t) { return t.id; }),
      out: T2 ? T2.out : [],
      stage: T2 ? T2.stage + 1 : 0,
      totalBoards: T2 ? T2.totalBoards : 0,
      isLightning: !!S.lightning,
      lq: (S.lightning && T2) ? { asked: T2.lqAsked, total: T2.lqTotal } : null,
      cut: (S.phase === 'cut' && T2) ? T2.cut : null,
      classMode: S.settings.classMode,
      classNames: { A: S.settings.classA, B: S.settings.classB },
      classTotals: { A: classTotal('A'), B: classTotal('B') },
      teamClass: S.teams.reduce(function (o, t) { o[t.id] = classOf(t); return o; }, {})
    };
    T.publish(clone(p));
  }

  function pubTimer() {
    T.publishTimer({ running: S.timer.running, endsAt: S.timer.endsAt, total: S.timer.total, hostNow: Date.now() });
  }
  function sync() { pubState(); pubTimer(); render(); }

  /* ---------- timer ---------- */
  function startTimer(secs) {
    S.timer = { running: true, endsAt: Date.now() + secs * 1000, total: secs };
    if (tickHandle) clearInterval(tickHandle);
    var lastWhole = secs;
    tickHandle = setInterval(function () {
      var left = S.timer.endsAt - Date.now();
      var whole = Math.ceil(left / 1000);
      if (whole !== lastWhole && whole > 0 && whole <= 5) Snd.tick();
      lastWhole = whole;
      paintTimer();
      if (left <= 0) { stopTimer(); Snd.timeup(); onExpire(); }
    }, 100);
    pubTimer();
  }
  function stopTimer() {
    S.timer.running = false;
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    pubTimer();
  }
  function timeLeft() { return S.timer.running ? Math.max(0, S.timer.endsAt - Date.now()) : 0; }
  function paintTimer() {
    var ring = $('#ring'); if (!ring) return;
    var total = S.timer.total * 1000, left = timeLeft(), frac = total ? left / total : 0;
    var C = 2 * Math.PI * 40;
    var fg = $('.fg', ring); if (fg) fg.setAttribute('stroke-dashoffset', String(C * (1 - frac)));
    var num = $('.num', ring); if (num) num.textContent = Math.ceil(left / 1000);
    ring.className = 'ring' + (frac <= .25 ? ' crit' : frac <= .5 ? ' warn' : '');
  }
  function onExpire() {
    if (S.phase === 'clue' && S.lightning) {       // nobody buzzed in time
      S.reveal = true; S.phase = 'reveal'; sync(); return;
    }
    if (S.phase === 'answering') { S.phase = 'judge'; sync(); }
    else if (S.phase === 'ddclue') { S.phase = 'ddjudge'; sync(); }
  }

  /* ---------- actions from players ---------- */
  function onAction(a) {
    if (!a || !a.type) return;
    var t;
    switch (a.type) {
      case 'join':
        t = team(a.teamId); if (!t) return;
        var lower = String(a.name || '').trim().toLowerCase();
        var byId = t.members.filter(function (m) { return m.id === a.memberId; })[0];
        var byName = t.members.filter(function (m) { return m.name.trim().toLowerCase() === lower; })[0];
        if (byId) {
          byId.name = a.name;
        } else if (byName) {                       // same student rejoining after a refresh/close
          if (t.captain === byName.id) t.captain = a.memberId;
          byName.id = a.memberId;
        } else {
          if (t.members.length >= S.settings.teamSize) return;
          t.members.push({ id: a.memberId, name: a.name });
          if (!t.captain) t.captain = a.memberId;
        }
        sync(); break;

      case 'leave':
        t = team(a.teamId); if (!t) return;
        t.members = t.members.filter(function (m) { return m.id !== a.memberId; });
        if (t.captain === a.memberId) t.captain = t.members.length ? t.members[0].id : null;
        sync(); break;

      case 'teamname':
        t = team(a.teamId); if (!t || t.locked) return;
        if (t.captain && a.memberId !== t.captain) return;
        t.name = String(a.name || '').slice(0, 26) || t.name; sync(); break;

      case 'teamcolor':
        t = team(a.teamId); if (!t || t.locked) return;
        if (t.captain && a.memberId !== t.captain) return;
        if (S.teams.some(function (x) { return x.id !== t.id && x.colorId === a.colorId; })) return;
        var col = COLORS.filter(function (c) { return c.id === a.colorId; })[0];
        if (col) { t.color = col.hex; t.colorId = col.id; } sync(); break;

      case 'buzz':      doBuzz(a.teamId); break;
      case 'answer':    doAnswer(a.teamId, a.text, a.by); break;
      case 'wager':     doWager(a.teamId, a.amount); break;
    }
  }

  function answerSecondsNow() { return S.lightning ? S.settings.lightningSecs : S.settings.answerSecs; }

  function doBuzz(teamId) {
    if (S.phase !== 'clue') return;
    if (!team(teamId)) return;
    if (!isAlive(teamId)) return;                       // eliminated teams can't buzz
    if (S.lockedOut.indexOf(teamId) >= 0) return;
    if (S.buzzOrder.indexOf(teamId) >= 0) return;
    S.buzzOrder.push(teamId);
    if (!S.current) {
      S.current = teamId; S.phase = 'answering'; Snd.buzz(); startTimer(answerSecondsNow());
    }
    sync();
  }
  function doAnswer(teamId, text, by) {
    var ok = (S.phase === 'answering' && teamId === S.current) ||
             (S.phase === 'ddclue' && teamId === S.control);
    if (!ok) return;
    S.answers[teamId] = { text: String(text || '').slice(0, 300), by: by || '' };
    stopTimer();
    S.phase = (S.phase === 'ddclue') ? 'ddjudge' : 'judge';
    sync();
  }
  function doWager(teamId, amt) {
    if (S.phase !== 'ddwager' || teamId !== S.control) return;
    var t = team(teamId);
    var max = Math.max(t.score, S.active ? Math.max(500, S.active.value) : 500);
    var min = Math.min(S.settings.minWager, max);
    S.ddWager = Math.max(min, Math.min(max, parseInt(amt, 10) || min));
    S.active.value = S.ddWager;
    S.phase = 'ddclue';
    startTimer(answerSecondsNow());
    sync();
  }

  /* ---------- host game control ---------- */
  function openClue(c, i) {
    var b = currentBoard();
    if (!b[c] || !b[c].clues[i]) return;
    var cl = b[c].clues[i];
    if (cl.done) return;
    S.active = { c: c, i: i, cat: b[c].name, clue: cl, value: cl.value };
    S.answers = {}; S.buzzOrder = []; S.lockedOut = []; S.current = null; S.reveal = false; S.ddWager = null;
    if (cl.dd) {
      if (!S.control) { flash('Pick which team has control first (click a team card)', 'bad'); S.active = null; return; }
      S.phase = 'ddwager'; Snd.dd();
    } else {
      S.phase = 'clue';
    }
    sync();
  }
  function judge(correct) {
    var val = S.active.value;
    var isDDp = (S.phase === 'ddclue' || S.phase === 'ddjudge');
    var who = isDDp ? S.control : S.current;
    var t = team(who); if (!t) return;
    if (correct) {
      t.score += val; t.right = (t.right || 0) + 1; Snd.correct();
      if (!S.lightning) { S.control = who; S.active.clue.done = true; }
      S.reveal = true; S.phase = 'reveal'; stopTimer();
    } else {
      Snd.wrong();
      t.wrong = (t.wrong || 0) + 1;
      if (S.settings.deduct) t.score -= val;
      if (isDDp) {                                    // no steal on a Daily Double
        if (!S.lightning) S.active.clue.done = true;
        S.reveal = true; S.phase = 'reveal'; stopTimer();
      } else {
        S.lockedOut.push(who);
        delete S.answers[who];
        S.current = null;
        S.buzzOrder = S.buzzOrder.filter(function (x) { return x !== who; });
        var remaining = aliveTeams().filter(function (x) { return S.lockedOut.indexOf(x.id) < 0; });
        if (remaining.length) {
          S.phase = 'clue'; stopTimer();
          if (S.lightning) startTimer(S.settings.lightningSecs);
          flash(S.lightning ? 'Open to the other finalist' : 'STEAL — open to all other teams', 'bad');
        }
        else {
          if (!S.lightning) S.active.clue.done = true;
          S.reveal = true; S.phase = 'reveal'; stopTimer();
        }
      }
    }
    sync();
  }
  function revealNow() {
    if (!S.lightning) S.active.clue.done = true;
    S.reveal = true; S.phase = 'reveal'; stopTimer(); sync();
  }
  function backToBoard() {
    S.active = null; S.reveal = false; S.answers = {};
    S.buzzOrder = []; S.lockedOut = []; S.current = null; stopTimer();
    if (S.lightning) { nextLightning(); return; }
    S.phase = 'board';
    sync();
    if (roundCleared()) endRound();
  }
  /* ---------- tournament ---------- */
  function aliveIds() { return S.tour ? S.tour.alive : S.teams.map(function (t) { return t.id; }); }
  function isAlive(id) { return aliveIds().indexOf(id) >= 0; }
  function aliveTeams() {
    return S.teams.filter(function (t) { return isAlive(t.id); });
  }
  function currentBoard() { return (S.tour && S.tour.board) || []; }
  function roundCleared() {
    var b = currentBoard();
    return b.length > 0 && b.every(function (c) { return c.clues.every(function (x) { return x.done; }); });
  }

  function aliveInClass(c) {
    return aliveTeams().filter(function (t) { return classOf(t) === c; });
  }

  function startTournament() {
    var plan = lengthPlan(S.settings.lengthMinutes);
    S.deck = newDeck();
    S.teams.forEach(function (t) { t.score = 0; t.right = 0; t.wrong = 0; });
    autoSplitClasses();
    S.tour = {
      stage: 0,
      totalBoards: boardsNeeded(S.teams.length, S.settings.classMode,
                                teamsInClass('A').length, teamsInClass('B').length),
      plan: plan,
      board: [],
      alive: S.teams.map(function (t) { return t.id; }),
      out: [],
      cut: [],
      lq: [], lqAsked: 0, lqTotal: plan.lightning
    };
    S.lightning = false;
    S.control = null;
    dealBoard();
  }

  function dealBoard() {
    var plan = S.tour.plan;
    S.tour.board = drawBoard(S.deck, plan.cats, plan.rows, S.tour.stage + 1);
    S.phase = 'board';
    S.active = null; S.reveal = false;
    S.buzzOrder = []; S.lockedOut = []; S.current = null; S.answers = {};
    stopTimer(); sync();
  }

  /* how many go out of each class (or overall, in solo mode) this round */
  function neededCuts() {
    if (!S.settings.classMode) return { A: cutSize(aliveTeams().length) };
    return { A: classCutSize(aliveInClass('A').length),
             B: classCutSize(aliveInClass('B').length) };
  }
  function totalNeededCuts() {
    var n = neededCuts();
    return (n.A || 0) + (n.B || 0);
  }

  function bracketDone() {
    if (S.settings.classMode) {
      return aliveInClass('A').length <= 1 && aliveInClass('B').length <= 1;
    }
    return aliveTeams().length <= 2;
  }

  /* end of a board: propose the bottom teams of each class for elimination */
  function endRound() {
    if (S.lightning) return;
    if (bracketDone()) { startLightning(); return; }
    var need = neededCuts(), cut = [];
    Object.keys(need).forEach(function (c) {
      var pool = (S.settings.classMode ? aliveInClass(c) : aliveTeams()).slice().sort(worstFirst);
      cut = cut.concat(pool.slice(0, need[c]).map(function (t) { return t.id; }));
    });
    if (!cut.length) { startLightning(); return; }
    S.tour.cut = cut;
    S.phase = 'cut';
    stopTimer(); sync();
  }

  function toggleCut(id) {
    if (S.phase !== 'cut' || !isAlive(id)) return;
    var i = S.tour.cut.indexOf(id);
    if (i >= 0) S.tour.cut.splice(i, 1);
    else S.tour.cut.push(id);
    sync();
  }

  function applyCut() {
    var need = neededCuts();
    if (S.settings.classMode) {
      var byClass = { A: 0, B: 0 };
      S.tour.cut.forEach(function (id) { var t = team(id); if (t) byClass[classOf(t)]++; });
      if (byClass.A !== need.A || byClass.B !== need.B) {
        flash('Eliminate exactly ' + need.A + ' from ' + className('A') +
              ' and ' + need.B + ' from ' + className('B'), 'bad');
        return;
      }
    } else if (S.tour.cut.length !== need.A) {
      flash('Pick exactly ' + need.A + ' team' + (need.A === 1 ? '' : 's') + ' to eliminate', 'bad');
      return;
    }
    S.tour.cut.forEach(function (id) {
      S.tour.alive = S.tour.alive.filter(function (x) { return x !== id; });
      S.tour.out.unshift(id);                    /* most recent elimination first */
    });
    S.tour.cut = [];
    if (S.control && !isAlive(S.control)) S.control = null;
    Snd.wrong();
    if (bracketDone()) { startLightning(); return; }
    S.tour.stage++;
    dealBoard();
  }

  /* ---------- lightning final ---------- */
  function startLightning() {
    S.lightning = true;
    S.tour.lq = shuffled(LIGHTNING);
    S.tour.lqAsked = 0;
    S.tour.board = [];
    S.control = null;
    S.phase = 'board';
    Snd.dd();
    stopTimer(); sync();
  }

  function nextLightning() {
    var T2 = S.tour;
    if (!T2.lq.length) { finishGame(); return; }
    /* out of questions: stop unless the finalists are tied */
    if (T2.lqAsked >= T2.lqTotal) {
      var top = aliveTeams().slice().sort(function (a, b) { return b.score - a.score; });
      if (!(top.length === 2 && top[0].score === top[1].score)) { finishGame(); return; }
      flash('Tied — sudden death!', 'bad');
    }
    var cl = T2.lq[T2.lqAsked % T2.lq.length];
    T2.lqAsked++;
    S.active = {
      c: -1, i: -1, cat: 'LIGHTNING · Q' + T2.lqAsked,
      clue: { q: cl.q, a: cl.a, alt: cl.alt || [], obj: cl.obj || '', dd: false, done: false },
      value: 500
    };
    S.answers = {}; S.buzzOrder = []; S.lockedOut = []; S.current = null; S.reveal = false;
    S.phase = 'clue';
    startTimer(S.settings.lightningSecs);        /* buzz window */
    sync();
  }

  function finishGame() {
    S.phase = 'gameover';
    var winner = aliveTeams().slice().sort(function (a, b) { return b.score - a.score; })[0];
    if (winner && S.tour) {
      S.tour.out = S.tour.alive
        .filter(function (id) { return id !== winner.id; })
        .concat(S.tour.out);
      S.tour.alive = [winner.id];
    }
    Snd.correct();
    stopTimer(); sync();
  }

  function newGame() {
    if (!confirm('Start a brand new tournament? Every team is back in and scores reset. Rosters stay.')) return;
    startTournament();
  }
  function demoTeams() {
    var names = ['PACKET PIRATES', 'BLUE SCREEN CREW', 'ROOT ACCESS', 'THE FIREWALLS', 'CTRL ALT DEFEAT',
                 'SUDO SQUAD', 'NULL POINTERS', 'BIT BENDERS', 'CACHE MONEY', 'THE DEFRAGGERS',
                 'PING OF DEATH', 'SEGFAULT SEVEN'];
    var people = ['Alex', 'Jordan', 'Sam', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Drew', 'Jamie', 'Quinn'];
    S.teams.forEach(function (t, i) {
      if (t.members.length) return;          // never clobber real students
      if (i >= S.settings.teamCount) return;
      t.name = names[i % names.length];
      t.members = [];
      var n = Math.max(1, S.settings.teamSize - (i % 2));
      for (var k = 0; k < n; k++) t.members.push({ id: uid(), name: people[(i * 3 + k) % people.length] });
      t.captain = t.members[0].id;
    });
    sync();
  }

  /* ---------- render ---------- */
  function render() { withFocus(_render); }

  function scoreStrip() {
    if (S.settings.classMode) {
      return '<div class="clsgrid">' + ['A', 'B'].map(function (c) {
        var rows = teamsInClass(c).slice().sort(function (a, b) {
          var aa = isAlive(a.id), ba = isAlive(b.id);
          if (aa !== ba) return aa ? -1 : 1;
          return b.score - a.score;
        });
        return '<div class="clscol cls' + c + '">' +
          '<div class="clshead">' + esc(className(c)) + ' <b>' + fmt(classTotal(c)) + '</b></div>' +
          '<div class="scores many">' + rows.map(cardFor).join('') + '</div></div>';
      }).join('') + '</div>';
    }
    var list = S.tour ? S.teams.slice().sort(function (a, b) {
      var aa = isAlive(a.id), ba = isAlive(b.id);
      if (aa !== ba) return aa ? -1 : 1;             /* live teams first */
      return b.score - a.score;
    }) : S.teams;
    return '<div class="scores' + (list.length > 8 ? ' many' : '') + '">' + list.map(cardFor).join('') + '</div>';
  }

  function cardFor(t) {
    var dead = S.tour && !isAlive(t.id);
    return '<div class="scard' + (S.control === t.id ? ' control' : '') + (dead ? ' dead' : '') +
      '" data-ctl="' + t.id + '" title="Click to give this team board control">' +
      '<div class="bar" style="background:' + t.color + '"></div>' +
      '<div class="adj"><button data-adj="' + t.id + '" data-d="-100">−</button>' +
      '<button data-adj="' + t.id + '" data-d="100">+</button></div>' +
      '<div class="nm">' + esc(t.name) + (dead ? ' <span style="opacity:.7">✕</span>' : '') + '</div>' +
      '<div class="sc' + (t.score < 0 ? ' neg' : '') + '">' + fmt(t.score) + '</div>' +
      '<div class="mem">' + (dead ? 'eliminated'
        : (t.members.length ? esc(t.members.map(function (m) { return m.name; }).join(', '))
                            : '<span style="opacity:.5">no players yet</span>')) + '</div>' +
    '</div>';
  }

  function classBar() {
    if (!S.settings.classMode) return '';
    var a = classTotal('A'), b = classTotal('B');
    var pa, pos = Math.max(a, 0) + Math.max(b, 0);
    if (pos <= 0) pa = 50;                       /* both on zero reads as level */
    else pa = Math.max(4, Math.min(96, (Math.max(a, 0) / pos) * 100));
    var aliveA = aliveInClass('A').length, aliveB = aliveInClass('B').length;
    return '<div class="classbar">' +
      '<div class="cside ca"><div class="cnm">' + esc(className('A')) + '</div>' +
        '<div class="cval">' + fmt(a) + '</div>' +
        '<div class="cin">' + aliveA + ' team' + (aliveA === 1 ? '' : 's') + ' left</div></div>' +
      '<div class="cmeter"><i style="width:' + pa + '%"></i>' +
        '<span class="clead">' + (a === b ? 'DEAD EVEN' : (a > b ? esc(className('A')) : esc(className('B'))) +
          ' +' + fmt(Math.abs(a - b))) + '</span></div>' +
      '<div class="cside cb"><div class="cnm">' + esc(className('B')) + '</div>' +
        '<div class="cval">' + fmt(b) + '</div>' +
        '<div class="cin">' + aliveB + ' team' + (aliveB === 1 ? '' : 's') + ' left</div></div>' +
    '</div>';
  }

  function stageLabel() {
    if (!S.tour) return 'Setup';
    if (S.lightning) return 'Lightning Final';
    return 'Round ' + (S.tour.stage + 1) + ' of ' + S.tour.totalBoards;
  }

  function topbar() {
    return '<div class="topbar">' +
      '<div class="brand"><div class="mark">⚔</div><div><div class="t1">FACE-OFF</div>' +
      '<div class="t2">SECURITY+ · SY0-701</div></div></div>' +
      '<div class="roundchip' + (S.lightning ? ' hot' : '') + '">' + stageLabel() + '</div>' +
      (S.tour && !S.lightning ? '<div class="roundchip">' + S.tour.alive.length + ' teams in</div>' : '') +
      (S.control && team(S.control) ? '<div class="roundchip" style="border-color:' + team(S.control).color + '">' +
        esc(team(S.control).name) + ' picks</div>' : '') +
      '<div class="spacer"></div>' +
      '<div class="codechip">' + S.room + '</div>' +
      '<button class="btn sm" data-act="lobby">Join screen</button>' +
      '<button class="btn sm" data-act="settings">⚙</button>' +
      '<button class="btn sm" data-act="full">⛶</button>' +
    '</div>';
  }

  function lobbyView() {
    var joinUrl = location.origin + location.pathname + '#/play/' + S.room;
    var total = S.teams.reduce(function (a, t) { return a + t.members.length; }, 0);
    return '<div class="wrap">' + fbBanner() + '<div class="lobbygrid">' +
      '<div class="card joinbox">' +
        '<div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.75">Scan to join</div>' +
        '<div class="qr" id="qr"></div>' +
        '<div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.75;margin-top:14px">Room code</div>' +
        '<div class="bigcode">' + S.room + '</div>' +
        '<div class="joinurl mono">' + esc(joinUrl) + '</div>' +
        '<div class="row" style="justify-content:center;margin-top:14px">' +
          '<button class="btn sm" data-act="copy">Copy link</button>' +
          '<button class="btn sm" data-act="newcode">New code</button>' +
        '</div>' +
        (liveMode() ? '' : '<div class="notice" style="margin-top:14px;text-align:left">Running in <b>LOCAL MODE</b> — the join link only works in another tab on this same computer. See <span class="mono">FIREBASE-SETUP.md</span> to let phones join.</div>') +
      '</div>' +
      '<div>' +
        '<div class="row" style="margin-bottom:12px">' +
          '<h2 style="margin:0;font-size:22px">Teams <span style="opacity:.6;font-weight:600;font-size:15px">' + total +
            ' / ' + (S.settings.teamCount * S.settings.teamSize) + ' seats filled</span></h2>' +
          '<div class="spacer"></div>' +
          '<button class="btn sm" data-act="demo">Fill demo teams</button>' +
          '<button class="btn primary" data-act="start">Start Game →</button>' +
        '</div>' +
        '<div class="tgrid">' + S.teams.map(function (t) {
          return '<div class="tcard"><div class="bar" style="background:' + t.color + '"></div>' +
            '<h4>' + esc(t.name) + ' <span style="opacity:.55;font-weight:600;font-size:12px">' +
              t.members.length + '/' + S.settings.teamSize + '</span>' +
              (S.settings.classMode ? '<button class="clsbtn cls' + classOf(t) + '" data-cls="' + t.id + '" title="Click to move this team to the other class">' + classOf(t) + '</button>' : '') +
            '</h4>' +
            (t.members.length
              ? '<div class="roster" style="margin-left:8px">' + t.members.map(function (m) {
                  return '<span class="rchip' + (m.id === t.captain ? ' cap' : '') + '">' + esc(m.name) + '</span>';
                }).join('') + '</div>'
              : '<div class="waiting">waiting for players…</div>') +
          '</div>';
        }).join('') + '</div>' +
        '<div class="hint" style="margin-top:14px">★ = team captain (first to join). The captain sets the team name and color; everyone else just types their own name.</div>' +
      '</div>' +
    '</div></div>';
  }

  function lightningView() {
    var f = aliveTeams().slice().sort(function (a, b) { return b.score - a.score; });
    var T2 = S.tour;
    return '<div class="boardwrap">' +
      classBar() +
      '<div class="lightwrap">' +
        '<div class="lighthead">⚡ LIGHTNING FINAL</div>' +
        '<div class="lightsub">' + (S.settings.classMode ? 'Class vs class · ' : '') +
          'Fastest buzz wins it · ' + S.settings.lightningSecs + ' seconds · 500 points a question</div>' +
        '<div class="duel">' + f.map(function (t) {
          return '<div class="duelcard" style="border-color:' + t.color + ';background:' + t.color + '22">' +
            (S.settings.classMode ? '<div class="dcls">' + esc(className(classOf(t))) + '</div>' : '') +
            '<div class="dn">' + esc(t.name) + '</div>' +
            '<div class="ds">' + fmt(t.score) + '</div>' +
            '<div class="dm">' + esc(t.members.map(function (m) { return m.name; }).join(', ')) + '</div></div>';
        }).join('<div class="vs">VS</div>') + '</div>' +
        '<div class="lightprog">Question ' + Math.min(T2.lqAsked + 1, T2.lqTotal) + ' of ' + T2.lqTotal +
          (T2.lqAsked >= T2.lqTotal ? ' · SUDDEN DEATH' : '') + '</div>' +
        '<button class="btn primary lg" data-act="lq">' +
          (T2.lqAsked === 0 ? 'Start the Lightning Final →' : 'Next question →') + '</button>' +
      '</div>' +
      scoreStrip() +
    '</div>';
  }

  function boardView() {
    if (S.lightning) return lightningView();
    var b = currentBoard();
    if (!b.length) {
      return '<div class="wrap"><div class="card"><h2>No questions loaded</h2>' +
        '<div class="hint">Add categories to <span class="mono">questions-security.js</span>.</div></div></div>';
    }
    var rows = b[0].clues.length;
    return '<div class="boardwrap">' +
      classBar() +
      '<div class="board" style="grid-template-columns:repeat(' + b.length + ',1fr)">' + b.map(function (cat, c) {
        return '<div class="bcol" style="grid-template-rows:auto repeat(' + rows + ',1fr)">' +
          '<div class="bcat">' + esc(cat.name) + '</div>' +
          cat.clues.map(function (cl, i) {
            return '<div class="btile' + (cl.done ? ' done' : '') + '" data-clue="' + c + ',' + i + '">' +
              (cl.done ? '' : fmt(cl.value)) + '</div>';
          }).join('') + '</div>';
      }).join('') + '</div>' +
      scoreStrip() +
      '<div class="row" style="justify-content:center">' +
        '<button class="btn' + (roundCleared() ? ' primary' : ' ghost sm') + '" data-act="endround">' +
          (roundCleared() ? 'Board cleared — go to eliminations →' : 'End this round early') + '</button>' +
        '<button class="btn ghost sm" data-act="new">New tournament</button>' +
        '<span class="hint">Keys: <b>' + buzzKeyHint() + '</b> buzz · <b>Y</b>/<b>N</b> judge · <b>Space</b> continue</span>' +
      '</div>' +
    '</div>';
  }

  function ringHTML() {
    var C = 2 * Math.PI * 40;
    return '<div class="ring" id="ring"><svg viewBox="0 0 100 100">' +
      '<circle class="bg" cx="50" cy="50" r="40" fill="none" stroke-width="9"/>' +
      '<circle class="fg" cx="50" cy="50" r="40" fill="none" stroke-width="9" stroke-linecap="round" ' +
      'stroke-dasharray="' + C + '" stroke-dashoffset="0"/></svg><div class="num">' + S.settings.answerSecs + '</div></div>';
  }

  function queueHTML() {
    if (!S.buzzOrder.length && !S.lockedOut.length) return '<div class="queue"><span class="hint">Waiting for a buzz…</span></div>';
    return '<div class="queue">' +
      S.buzzOrder.map(function (id, n) {
        var t = team(id);
        return '<div class="qchip' + (n === 0 ? ' first' : '') + '" style="background:' + t.color + '">' +
          '<span class="ord">#' + (n + 1) + '</span>' + esc(t.name) + '</div>';
      }).join('') +
      S.lockedOut.map(function (id) { return '<div class="lockchip">' + esc(team(id).name) + '</div>'; }).join('') +
    '</div>';
  }

  function clueOverlay() {
    var A = S.active, cl = A.clue;
    var isDD = (S.phase === 'ddclue' || S.phase === 'ddjudge');
    var whoId = isDD ? S.control : S.current;
    var who = whoId ? team(whoId) : null;
    var ans = S.answers[whoId] || null;
    var isJudge = (S.phase === 'judge' || S.phase === 'ddjudge');
    var isLive = (S.phase === 'answering' || S.phase === 'ddclue');
    return '<div class="overlay">' +
      '<div class="ovtop">' +
        '<div><div class="ovcat">' + esc(A.cat) + (isDD ? ' · DAILY DOUBLE' : '') + '</div><div class="ovval">' + fmt(A.value) + ' pts</div></div>' +
        '<div class="spacer"></div>' +
        '<div class="objtag">Obj ' + esc(cl.obj) + '</div>' +
        '<button class="btn sm ghost" data-act="close">Esc ✕</button>' +
      '</div>' +
      '<div class="qbox"><div class="qtext">' + esc(cl.q) + '</div></div>' +
      (isLive || isJudge ?
        '<div class="row" style="align-items:stretch">' +
          (isLive ? '<div class="timer">' + ringHTML() + '</div>' : '') +
          '<div style="flex:1;min-width:260px">' +
            '<div class="subans' + (ans ? '' : ' empty') + '" style="height:100%">' +
              '<div class="who">' + (who ? esc(who.name) : '') + (ans && ans.by ? ' — typed by ' + esc(ans.by) : '') + '</div>' +
              '<div class="txt">' + (ans ? esc(ans.text) : (isJudge ? 'No answer submitted — time expired' : 'typing…')) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' : '') +
      (isDD ? '' : queueHTML()) +
      '<div class="row">' +
        (isLive || isJudge ?
          '<button class="btn good lg" data-act="ok">✓ Correct <span style="opacity:.7;font-size:13px">(Y)</span></button>' +
          '<button class="btn bad lg" data-act="no">✕ Incorrect <span style="opacity:.7;font-size:13px">(N)</span></button>' : '') +
        '<div class="spacer"></div>' +
        '<button class="btn" data-act="show">Reveal answer &amp; move on</button>' +
      '</div>' +
      scoreStrip() +
      '<div class="hostans"><span style="opacity:.6">Host only —</span> <b>' + esc(cl.a) + '</b>' +
        (cl.alt && cl.alt.length ? '<span style="opacity:.7"> &nbsp;·&nbsp; also accept: ' + esc(cl.alt.join(' / ')) + '</span>' : '') + '</div>' +
    '</div>';
  }

  function revealOverlay() {
    var A = S.active, cl = A.clue;
    return '<div class="overlay">' +
      '<div class="ovtop"><div><div class="ovcat">' + esc(A.cat) + '</div>' +
      '<div class="ovval">' + fmt(A.value) + ' pts</div></div><div class="spacer"></div>' +
      '<div class="objtag">Obj ' + esc(cl.obj) + '</div></div>' +
      '<div class="qbox"><div><div class="qtext" style="font-size:clamp(18px,2.6vw,34px);opacity:.72;font-weight:650">' + esc(cl.q) + '</div>' +
      '<div class="abox" style="margin-top:26px"><div class="lbl">Answer</div><div class="txt">' + esc(cl.a) + '</div></div></div></div>' +
      '<div class="row" style="justify-content:center"><button class="btn primary lg" data-act="back">Back to board <span style="opacity:.7;font-size:13px">(Space)</span></button></div>' +
      scoreStrip() +
    '</div>';
  }

  function ddOverlay() {
    var t = team(S.control);
    var max = Math.max(t.score, S.active ? Math.max(500, S.active.value) : 500);
    var min = Math.min(S.settings.minWager, max);
    return '<div class="dd"><div>' +
      '<h1>DAILY<br>DOUBLE</h1>' +
      '<p>' + esc(t.name) + (min >= max ? ' — wager is locked at ' + fmt(max) + ' points'
            : ' — wager anywhere from ' + fmt(min) + ' up to ' + fmt(max) + ' points') + '</p>' +
      '<div class="row" style="justify-content:center">' +
        '<input id="ddw" type="number" onfocus="this.select()" style="width:190px;text-align:center;font-size:26px;font-weight:900" value="' + min + '" min="' + min + '" max="' + max + '">' +
        '<button class="btn primary lg" data-act="ddgo">Lock it in</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:16px;opacity:.85">' + esc(t.name) + ' can also enter this on their own device. No buzzing, no steal — this one is theirs alone.</div>' +
    '</div></div>';
  }

  function cutRow(t, i) {
    var doomed = S.tour.cut.indexOf(t.id) >= 0;
    return '<div class="rankrow' + (doomed ? ' doomed' : '') + '" data-cut="' + t.id + '">' +
      '<span class="rk">' + (i + 1) + '</span>' +
      '<span class="dot" style="background:' + t.color + '"></span>' +
      '<b class="nm">' + esc(t.name) + '</b>' +
      '<span class="rec">' + (t.right || 0) + '<i>✓</i> ' + (t.wrong || 0) + '<i>✗</i></span>' +
      '<span class="sc">' + fmt(t.score) + '</span>' +
      '<span class="tag">' + (doomed ? 'OUT' : 'ADVANCES') + '</span>' +
    '</div>';
  }

  /* a warning is only worth showing when points AND record are identical
     across the cut line — anything else the tiebreaker already settled */
  function tieAtLine(pool) {
    var doomed = pool.filter(function (t) { return S.tour.cut.indexOf(t.id) >= 0; });
    var safe = pool.filter(function (t) { return S.tour.cut.indexOf(t.id) < 0; });
    return doomed.some(function (d) {
      return safe.some(function (sv) { return trulyLevel(d, sv); });
    });
  }

  function sortForCut(pool) {
    return pool.slice().sort(function (a, b) {
      var ad = S.tour.cut.indexOf(a.id) >= 0, bd = S.tour.cut.indexOf(b.id) >= 0;
      if (ad !== bd) return ad ? 1 : -1;
      return worstFirst(b, a);
    });
  }

  function cutView() {
    var need = neededCuts();
    var anyTie, columns;
    if (S.settings.classMode) {
      anyTie = tieAtLine(aliveInClass('A')) || tieAtLine(aliveInClass('B'));
      columns = ['A', 'B'].map(function (c) {
        var pool = sortForCut(aliveInClass(c));
        return '<div class="cutcol cls' + c + '">' +
          '<div class="cuthead">' + esc(className(c)) + ' <span>' + pool.length + ' in · ' +
            (need[c] || 0) + ' out</span></div>' +
          (pool.length ? pool.map(cutRow).join('')
                       : '<div class="hint" style="padding:10px">Champion decided</div>') +
        '</div>';
      }).join('');
    } else {
      var pool0 = sortForCut(aliveTeams());
      anyTie = tieAtLine(pool0);
      columns = '<div class="cutcol">' + pool0.map(cutRow).join('') + '</div>';
    }
    var goingToFinal = totalNeededCuts() > 0
      ? (S.settings.classMode
          ? (aliveInClass('A').length - (need.A || 0) <= 1 && aliveInClass('B').length - (need.B || 0) <= 1)
          : (aliveTeams().length - (need.A || 0) <= 2))
      : true;
    return '<div class="overlay">' +
      '<div class="ovtop"><div class="ovcat">END OF ROUND ' + (S.tour.stage + 1) + '</div>' +
        '<div class="spacer"></div><div class="objtag">' + totalNeededCuts() + ' going out</div></div>' +
      '<div class="qbox" style="align-items:flex-start"><div style="width:min(1080px,100%)">' +
        '<h1 style="font-size:clamp(24px,3.4vw,40px);margin:0 0 4px;text-align:center">STANDINGS</h1>' +
        '<div class="hint" style="text-align:center;margin-bottom:14px">' +
          (anyTie
            ? '<b style="color:var(--royal-yellow)">DEAD HEAT</b> — same points AND same record across the cut line. Click any team to choose who goes out.'
            : 'Ties break on record: fewer ✓ goes out first; still level, the team that buzzed less goes out. Click any team to override.') + '</div>' +
        '<div class="cutgrid' + (S.settings.classMode ? ' two' : '') + '">' + columns + '</div>' +
      '</div></div>' +
      '<div class="row" style="justify-content:center">' +
        '<button class="btn primary lg" data-act="applycut">' +
          (goingToFinal ? 'Eliminate & start the Lightning Final →'
                        : 'Eliminate & start Round ' + (S.tour.stage + 2) + ' →') + '</button>' +
      '</div>' +
    '</div>';
  }

  function gameoverView() {
    var order = S.tour
      ? S.tour.alive.concat(S.tour.out).map(team).filter(Boolean)
      : S.teams.slice().sort(function (a, b) { return b.score - a.score; });
    var champ = order[0], rest = order.slice(1);
    return '<div class="wrap" style="text-align:center;padding-top:26px">' +
      '<h1 style="font-size:clamp(30px,5vw,54px);margin:0;color:var(--royal-yellow)">🏆 TOURNAMENT CHAMPION</h1>' +
      (S.settings.classMode ? (function () {
        var a = classTotal('A'), b = classTotal('B');
        var win = a === b ? null : (a > b ? 'A' : 'B');
        return '<div class="clswin">' + (win
          ? '<b>' + esc(className(win)) + '</b> takes the class trophy — ' + fmt(Math.max(a, b)) +
            ' to ' + fmt(Math.min(a, b))
          : 'Classes finished dead even at ' + fmt(a)) + '</div>';
      })() : '') +
      (champ ? '<div class="champ" style="border-color:' + champ.color + ';background:' + champ.color + '33">' +
        (S.settings.classMode ? '<div class="dcls">' + esc(className(classOf(champ))) + '</div>' : '') +
        '<div class="cn">' + esc(champ.name) + '</div>' +
        '<div class="cs">' + fmt(champ.score) + '</div>' +
        '<div class="cm">' + esc(champ.members.map(function (m) { return m.name; }).join(' · ')) + '</div>' +
      '</div>' : '') +
      '<div style="max-width:560px;margin:24px auto 0;text-align:left">' + rest.map(function (t, n) {
        return '<div class="rankrow" style="cursor:default">' +
          '<span class="rk">' + (n + 2) + '</span>' +
          '<span class="dot" style="background:' + t.color + '"></span>' +
          '<b class="nm">' + esc(t.name) + '</b>' +
          '<span class="sc">' + fmt(t.score) + '</span></div>';
      }).join('') + '</div>' +
      '<div class="row" style="justify-content:center;margin-top:28px">' +
        '<button class="btn primary lg" data-act="new">New tournament</button>' +
        '<button class="btn lg" data-act="lobby">Back to join screen</button>' +
      '</div></div>';
  }

  function settingsModal() {
    var plan = lengthPlan(S.settings.lengthMinutes);
    var half = Math.ceil(S.settings.teamCount / 2);
    var boards = boardsNeeded(S.settings.teamCount, S.settings.classMode,
                              half, S.settings.teamCount - half);
    return '<div class="modal"><div class="card">' +
      '<div class="row"><h2 style="margin:0;flex:1">Game settings</h2><button class="btn sm ghost" data-act="closeset">✕</button></div>' +
      '<div class="grid2" style="margin-top:14px">' +
        '<div><label class="fld">Number of teams</label><input id="setTeams" type="number" min="2" max="' + MAX_TEAMS + '" value="' + S.settings.teamCount + '"></div>' +
        '<div><label class="fld">Students per team</label><input id="setSize" type="number" min="2" max="' + MAX_TEAM_SIZE + '" value="' + S.settings.teamSize + '"></div>' +
        '<div><label class="fld">Tournament length</label><select id="setLen">' +
          [30, 45, 60, 90, 120].map(function (m) {
            return '<option value="' + m + '"' + (S.settings.lengthMinutes === m ? ' selected' : '') + '>' + m + ' minutes</option>';
          }).join('') + '</select></div>' +
        '<div><label class="fld">Seconds to answer</label><input id="setSecs" type="number" min="5" max="120" value="' + S.settings.answerSecs + '"></div>' +
        '<div><label class="fld">Lightning Final seconds</label><input id="setLight" type="number" min="5" max="60" value="' + S.settings.lightningSecs + '"></div>' +
        '<div><label class="fld">Minimum Daily Double wager</label><input id="setMin" type="number" min="0" step="100" value="' + S.settings.minWager + '"></div>' +
      '</div>' +
      '<div class="row" style="margin-top:13px">' +
        '<label><input type="checkbox" id="setClass"' + (S.settings.classMode ? ' checked' : '') + '> <b>Class vs Class</b> — split the teams into two classes</label>' +
      '</div>' +
      (S.settings.classMode ? '<div class="grid2" style="margin-top:10px">' +
        '<div><label class="fld">First class name</label><input id="setClsA" type="text" maxlength="18" value="' + esc(S.settings.classA) + '"></div>' +
        '<div><label class="fld">Second class name</label><input id="setClsB" type="text" maxlength="18" value="' + esc(S.settings.classB) + '"></div>' +
      '</div>' : '') +
      '<div class="row" style="margin-top:13px;gap:20px">' +
        '<label><input type="checkbox" id="setDeduct"' + (S.settings.deduct ? ' checked' : '') + '> Deduct points for a wrong answer</label>' +
        '<label><input type="checkbox" id="setSound"' + (S.settings.sound ? ' checked' : '') + '> Sound effects</label>' +
      '</div>' +
      '<div class="notice" style="margin-top:13px">' +
        '<b>Room:</b> ' + (S.settings.teamCount * S.settings.teamSize) + ' students (' +
          S.settings.teamCount + ' teams × ' + S.settings.teamSize + ')' +
          (S.settings.classMode ? ' — <b>' + half + ' teams vs ' + (S.settings.teamCount - half) + ' teams</b>' : '') + '.<br>' +
        '<b>Bracket:</b> ' + boards + ' board' + (boards === 1 ? '' : 's') + ' of ' + plan.cats + ' × ' + plan.rows +
          (S.settings.classMode
            ? ', dropping the bottom 2 of EACH class each round, until one champion per class. Then a ' +
              plan.lightning + '-question Lightning Final: ' + esc(S.settings.classA) + ' vs ' + esc(S.settings.classB) + '.'
            : ', dropping the bottom 2 each round, then a ' + plan.lightning +
              '-question Lightning Final between the last two.') +
        (function () {
          var per = (plan.cats * plan.rows) / Math.max(1, S.settings.teamCount);
          if (per >= 1.5) return '';
          return '<br><br><b style="color:var(--royal-yellow)">Short boards for this many teams.</b> ' +
            'Each team gets about ' + per.toFixed(1) + ' scoring chances a round, so a lot of teams ' +
            'finish on zero. Pick <b>90</b> or <b>120 minutes</b> for a cleaner bracket.';
        })() +
        ((S.settings.teamCount * S.settings.teamSize) > 90
          ? '<br><br><b>Heads up:</b> Firebase\'s free plan allows 100 devices at once.'
          : '') +
      '</div>' +
      '<div class="row" style="margin-top:16px"><button class="btn primary" data-act="saveset">Save</button>' +
        '<button class="btn ghost" data-act="closeset">Cancel</button></div>' +
    '</div></div>';
  }

  function _render() {
    var body;
    if (S.phase === 'lobby') body = topbar() + lobbyView();
    else if (S.phase === 'gameover') body = topbar() + gameoverView();
    else if (S.phase === 'cut') body = topbar() + boardView() + cutView();
    else if (S.phase === 'ddwager') body = topbar() + boardView() + ddOverlay();
    else if (S.phase === 'reveal') body = topbar() + boardView() + revealOverlay();
    else if (S.active) body = topbar() + boardView() + clueOverlay();
    else body = topbar() + boardView();
    if (S.settingsOpen) body += settingsModal();
    app.innerHTML = '<div class="host">' + body + '</div>';
    if (S.phase === 'lobby') {
      var q = $('#qr');
      if (q && window.QR) QR.render(q, location.origin + location.pathname + '#/play/' + S.room, 230, '#ffffff', '#0f1f4d');
    }
    paintTimer();
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var el;
    if ((el = e.target.closest('[data-clue]'))) {
      var p = el.getAttribute('data-clue').split(','); openClue(+p[0], +p[1]); return;
    }
    if ((el = e.target.closest('[data-adj]'))) {
      e.stopPropagation();
      var t = team(el.getAttribute('data-adj')); t.score += parseInt(el.getAttribute('data-d'), 10); sync(); return;
    }
    if ((el = e.target.closest('[data-cls]'))) {
      e.stopPropagation();
      var ct = team(el.getAttribute('data-cls'));
      if (ct) { ct.cls = classOf(ct) === 'A' ? 'B' : 'A'; ct.clsPinned = true; sync(); }
      return;
    }
    if ((el = e.target.closest('[data-cut]'))) {
      toggleCut(el.getAttribute('data-cut')); return;
    }
    if ((el = e.target.closest('[data-ctl]'))) {
      S.control = el.getAttribute('data-ctl'); sync();
      flash(team(S.control).name + ' has board control'); return;
    }
    el = e.target.closest('[data-act]'); if (!el) return;
    var a = el.getAttribute('data-act');
    switch (a) {
      case 'lobby':   S.phase = 'lobby'; sync(); break;
      case 'start':   startTournament(); break;
      case 'settings':S.settingsOpen = true; render(); break;
      case 'closeset':S.settingsOpen = false; render(); break;
      case 'saveset':
        var wantCount = Math.max(2, Math.min(MAX_TEAMS, parseInt($('#setTeams').value, 10) || 8));
        var wantSize = Math.max(2, Math.min(MAX_TEAM_SIZE, parseInt($('#setSize').value, 10) || 5));

        // never silently strand a student who has already joined
        var biggest = S.teams.reduce(function (m, t) { return Math.max(m, t.members.length); }, 0);
        if (wantSize < biggest) {
          wantSize = biggest;
          flash('Kept ' + biggest + ' per team — a team already has that many students', 'bad');
        }
        var dropping = S.teams.slice(wantCount).filter(function (t) { return t.members.length; });
        if (dropping.length && !confirm(
              'That removes ' + dropping.length + ' team(s) that already have students on them:\n\n' +
              dropping.map(function (t) { return '  • ' + t.name + ' (' + t.members.length + ')'; }).join('\n') +
              '\n\nThey will have to rejoin another team. Continue?')) {
          return;
        }
        S.settings.teamCount = wantCount;
        S.settings.teamSize = wantSize;
        S.settings.answerSecs = Math.max(5, parseInt($('#setSecs').value, 10) || 15);
        S.settings.lightningSecs = Math.max(5, parseInt($('#setLight').value, 10) || 10);
        S.settings.lengthMinutes = parseInt($('#setLen').value, 10) || 60;
        S.settings.minWager = Math.max(0, parseInt($('#setMin').value, 10) || 0);
        S.settings.deduct = $('#setDeduct').checked;
        S.settings.sound = $('#setSound').checked; Snd.on = S.settings.sound;
        S.settings.classMode = $('#setClass').checked;
        if ($('#setClsA')) S.settings.classA = ($('#setClsA').value || 'CLASS A').slice(0, 18);
        if ($('#setClsB')) S.settings.classB = ($('#setClsB').value || 'CLASS B').slice(0, 18);
        makeTeams(S.settings.teamCount); persist(); S.settingsOpen = false; sync(); break;
      case 'full':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
        break;
      case 'copy':
        var u = location.origin + location.pathname + '#/play/' + S.room;
        (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject())
          .then(function () { flash('Join link copied', 'good'); }, function () { prompt('Copy this link:', u); });
        break;
      case 'newcode': location.reload(); break;
      case 'demo':    demoTeams(); break;
      case 'ok':      judge(true); break;
      case 'no':      judge(false); break;
      case 'show':    revealNow(); break;
      case 'back':    backToBoard(); break;
      case 'close':   backToBoard(); break;
      case 'ddgo':    doWager(S.control, $('#ddw').value); break;
      case 'endround':endRound(); break;
      case 'applycut':applyCut(); break;
      case 'lq':      nextLightning(); break;
      case 'new':     newGame(); break;
    }
  }
  function onKey(e) {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
    var n = parseInt(e.key, 10);
    var slot = BUZZ_KEYS.indexOf(e.key);
    if (slot >= 0 && slot < S.teams.length && S.phase === 'clue') { doBuzz(S.teams[slot].id); e.preventDefault(); return; }
    if (['answering', 'judge', 'ddclue', 'ddjudge'].indexOf(S.phase) >= 0) {
      if (e.key === 'y' || e.key === 'Y') { judge(true); e.preventDefault(); return; }
      if (e.key === 'n' || e.key === 'N') { judge(false); e.preventDefault(); return; }
    }
    if (e.key === ' ') {
      if (S.phase === 'reveal') { backToBoard(); e.preventDefault(); }
      else if (S.phase === 'board' && S.lightning) { nextLightning(); e.preventDefault(); }
      else if (S.phase === 'cut') { applyCut(); e.preventDefault(); }
      else if (S.phase === 'clue' || S.phase === 'answering' || S.phase === 'judge') { revealNow(); e.preventDefault(); }
    }
    if (e.key === 'Escape' && S.active) backToBoard();
  }
  app.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);

  T.hostInit(onAction).then(sync, function (err) {
    console.error(err);
    FB_RUNTIME_ERROR = 'Couldn\'t reach Firebase. Either the network is blocking ' +
      '<span class="mono">*.firebaseio.com</span> / <span class="mono">gstatic.com</span>, ' +
      'or the database rules deny access. Details are in the browser console (F12).';
    S.phase = 'lobby'; render();
  });
  sync();
  window.__FO_HOST = S;          // exposed for automated testing
  window.__FO_TEST_ACTION = onAction;   // ditto — harmless in class

  return function () {
    app.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    if (tickHandle) clearInterval(tickHandle);
  };
}

/* ================================================================== */
/* PLAYER                                                              */
/* ================================================================== */
function Player(code, seat) {
  if (!code) return CodeEntry();

  /* seat lets ONE machine drive more than one player (testing, shared laptop):
     #/play/ABCD/2 is a separate identity from #/play/ABCD/1 */
  var KEY = 'fo:me:' + code + (seat ? ':' + seat : '');
  var me = ssGet(KEY, null) || { memberId: uid(), teamId: null, name: '' };
  ssSet(KEY, me);

  var T = makeTransport(code);
  var P = null;                    // published state
  var timer = { running: false, endsAt: 0, total: 0, offset: 0 };
  var draft = { answer: '', tname: '', wager: '', myname: '' };
  var tickHandle = null;

  /* my team = the team I am actually a MEMBER of (not merely one I tapped) */
  function myTeam() {
    if (!P) return null;
    return P.teams.filter(function (t) {
      return (t.members || []).some(function (m) { return m.id === me.memberId; });
    })[0] || null;
  }
  function amCaptain() { var t = myTeam(); return t && (!t.captain || t.captain === me.memberId); }
  function send(a) { a.memberId = me.memberId; T.send(a); }
  function left() {
    if (!timer.running) return 0;
    return Math.max(0, timer.endsAt - (Date.now() + timer.offset));
  }

  function onPub(p) { P = p; render(); }
  function onTimer(t) {
    timer.running = t.running;
    timer.endsAt = t.endsAt;
    timer.total = t.total;
    timer.offset = (t.hostNow || Date.now()) - Date.now();
    paint();
  }
  function paint() {
    var bar = $('#tbar'); if (!bar) return;
    var frac = timer.total ? left() / (timer.total * 1000) : 0;
    $('i', bar).style.width = (frac * 100) + '%';
    bar.className = 'tbar' + (frac <= .25 ? ' crit' : frac <= .5 ? ' warn' : '');
    var s = $('#tsecs'); if (s) s.textContent = Math.ceil(left() / 1000) + 's';
  }

  /* ---------- views ---------- */
  function header() {
    var t = myTeam();
    if (!t) return '';
    var dead = P.out && P.out.indexOf(t.id) >= 0;
    var finalist = P.isLightning && P.alive && P.alive.indexOf(t.id) >= 0;
    return '<div class="phead' + (dead ? ' dead' : '') + '"><div class="bar" style="background:' + t.color + '"></div>' +
      '<div><div class="nm">' + esc(t.name) +
        (P.classMode && P.teamClass ? ' <span class="badge cls' + P.teamClass[t.id] + '">' +
           esc((P.classNames || {})[P.teamClass[t.id]] || '') + '</span>' : '') +
        (dead ? ' <span class="badge out">OUT</span>' : finalist ? ' <span class="badge fin">FINALIST</span>' : '') + '</div>' +
      '<div class="me">' + esc(me.name || 'you') + (amCaptain() ? ' ★ captain' : '') + '</div></div>' +
      '<div class="sc">' + fmt(t.score) + '</div></div>';
  }

  function joinView() {
    return '<div class="card"><h2 style="margin:0 0 4px">Join the game</h2>' +
      '<div class="hint" style="margin-bottom:16px">Room <b class="mono">' + esc(code) + '</b> — pick the team your instructor assigned you to.</div>' +
      '<label class="fld">Your name</label>' +
      '<input id="myname" type="text" maxlength="18" placeholder="First name + last initial" value="' + esc(draft.myname || me.name) + '">' +
      '<label class="fld" style="margin-top:16px">Your team</label>' +
      '<div class="slots">' + P.teams.map(function (t) {
        var cap = P.teamSize || 5;
        var full = t.members.length >= cap && !t.members.some(function (m) { return m.id === me.memberId; });
        return '<button class="slot' + (me.teamId === t.id ? ' sel' : '') + '" data-team="' + t.id + '"' + (full ? ' disabled' : '') + '>' +
          '<div class="bar" style="background:' + t.color + '"></div>' +
          '<div class="n">' + esc(t.name) + '</div>' +
          '<div class="c">' + t.members.length + '/' + cap + (full ? ' · FULL' : '') + '</div></button>';
      }).join('') + '</div>' +
      '<button class="btn primary lg" data-act="join" style="width:100%;margin-top:18px">Join team</button></div>';
  }

  function lobbyView() {
    var t = myTeam();
    var takenColors = P.teams.filter(function (x) { return x.id !== t.id; }).map(function (x) { return x.colorId; });
    return header() +
      '<div class="card">' +
        (amCaptain()
          ? '<h3 style="margin:0 0 4px">You\'re the captain ★</h3><div class="hint" style="margin-bottom:14px">Pick your team name and color. Everyone else on your team just adds their name.</div>' +
            '<label class="fld">Team name</label>' +
            '<div class="row"><input id="tname" type="text" maxlength="26" onfocus="this.select()" placeholder="e.g. PACKET PIRATES" value="' + esc(draft.tname || t.name) + '">' +
            '<button class="btn" data-act="setname">Set</button></div>' +
            '<label class="fld" style="margin-top:16px">Team color</label>' +
            '<div class="swatches">' + COLORS.map(function (c) {
              var taken = takenColors.indexOf(c.id) >= 0;
              return '<button class="sw' + (t.colorId === c.id ? ' sel' : '') + '" style="background:' + c.hex + '" ' +
                'data-color="' + c.id + '"' + (taken ? ' disabled' : '') + ' title="' + c.name + (taken ? ' — taken by another team' : '') + '">' +
                (taken ? '<span class="swx">✕</span>' : '') + '</button>';
            }).join('') + '</div>'
          : '<h3 style="margin:0 0 4px">You\'re on ' + esc(t.name) + '</h3><div class="hint">Your captain is setting the team name and color.</div>') +
        '<label class="fld" style="margin-top:18px">Squad (' + t.members.length + '/' + (P.teamSize || 5) + ')</label>' +
        '<div class="roster">' + t.members.map(function (m) {
          return '<span class="rchip' + (m.id === t.captain ? ' cap' : '') + '">' + esc(m.name) + '</span>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="card" style="text-align:center"><div style="font-size:15px;opacity:.85">Waiting for your instructor to start…</div>' +
      '<div class="hint" style="margin-top:8px">Keep this page open. Your buzzer appears here.</div></div>' +
      '<button class="btn ghost sm" data-act="leave" style="align-self:center">Leave team</button>';
  }

  function questionCard() {
    if (!P.q) return '';
    return '<div class="pq"><div class="cat"><span class="val">' + fmt(P.q.value) + '</span>' + esc(P.q.cat) + (P.q.dd ? ' · DAILY DOUBLE' : '') + '</div>' +
      '<div class="txt">' + esc(P.q.text) + '</div></div>';
  }
  function timerBar() {
    return '<div class="row"><div class="tbar" id="tbar" style="flex:1"><i style="width:100%"></i></div>' +
      '<b id="tsecs" style="width:44px;text-align:right">' + Math.ceil(left() / 1000) + 's</b></div>';
  }

  function classBlock() {
    if (!P.classMode) return '';
    var a = (P.classTotals || {}).A || 0, b = (P.classTotals || {}).B || 0;
    var n = P.classNames || {};
    return '<div class="card pclass"><label class="fld">Class scoreboard</label>' +
      '<div class="prow"><span class="dot clsA"></span><b>' + esc(n.A) + '</b><span class="s">' + fmt(a) + '</span></div>' +
      '<div class="prow"><span class="dot clsB"></span><b>' + esc(n.B) + '</b><span class="s">' + fmt(b) + '</span></div></div>';
  }

  function standingsBlock(title) {
    var rows = (P.teams || []).slice().sort(function (a, b) {
      var aa = (P.alive || []).indexOf(a.id) >= 0, ba = (P.alive || []).indexOf(b.id) >= 0;
      if (aa !== ba) return aa ? -1 : 1;
      return b.score - a.score;
    });
    return '<div class="card"><label class="fld">' + esc(title) + '</label>' + rows.map(function (x, i) {
      var dead = (P.out || []).indexOf(x.id) >= 0;
      return '<div class="prow' + (dead ? ' dead' : '') + '">' +
        '<span class="dot" style="background:' + x.color + '"></span>' +
        '<b>' + esc(x.name) + '</b><span class="s">' + fmt(x.score) + '</span>' +
        (dead ? '<span class="o">out</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function playView() {
    var t = myTeam(), ph = P.phase;
    var iAmOut = (P.out || []).indexOf(t.id) >= 0;

    /* eliminated: keep the questions and answers coming so they can still review */
    if (iAmOut) {
      var body0 = '';
      if (P.q) {
        body0 += questionCard();
        if (ph === 'reveal' && P.reveal) {
          body0 += '<div class="card" style="border-color:var(--royal-green);background:rgba(21,128,61,.2)">' +
            '<div class="hint" style="letter-spacing:.16em;text-transform:uppercase">Answer</div>' +
            '<div style="font-size:19px;font-weight:800;margin-top:6px">' + esc(P.reveal.a) + '</div></div>';
        } else {
          body0 += '<div class="card" style="text-align:center"><div class="hint">Answer appears here when the host reveals it — keep quizzing yourself.</div></div>';
        }
      } else {
        body0 += '<div class="card" style="text-align:center"><h3 style="margin:0 0 6px">You\'re out of the bracket</h3>' +
          '<div class="hint">Questions and answers still show up here so you can keep reviewing. Cheer loud.</div></div>';
      }
      return header() + body0 + classBlock() + standingsBlock('Tournament standings');
    }

    if (ph === 'cut') {
      return header() + '<div class="card" style="text-align:center">' +
        '<h3 style="margin:0 0 6px">End of the round</h3>' +
        '<div class="hint">Your instructor is announcing who advances.</div></div>' +
        classBlock() + standingsBlock('Standings');
    }
    var iAmCurrent = P.current === t.id;
    var iAmLocked = (P.lockedOut || []).indexOf(t.id) >= 0;
    var iBuzzed = (P.buzzOrder || []).indexOf(t.id) >= 0;
    var pos = (P.buzzOrder || []).indexOf(t.id);
    var body = '', status = '';

    /* daily double — control team only */
    if (ph === 'ddwager') {
      if (P.ddTeam === t.id) {
        var max = Math.max(t.score, P.roundMax || 500);
        var min = Math.min(P.minWager || 0, max);
        body = '<div class="card" style="text-align:center;background:linear-gradient(135deg,rgba(109,40,217,.5),rgba(185,28,28,.5))">' +
          '<h2 style="margin:0 0 6px;font-size:30px">DAILY DOUBLE</h2>' +
          '<div class="hint" style="margin-bottom:14px">' + (min >= max ? 'Your wager is locked at ' + fmt(max) + '.'
              : 'Wager anywhere from ' + fmt(min) + ' up to ' + fmt(max) + '.') + ' No steal — this one is yours alone.</div>' +
          '<input id="wager" type="number" onfocus="this.select()" style="text-align:center;font-size:28px;font-weight:900" min="' + min + '" max="' + max + '" value="' + (draft.wager || min) + '">' +
          '<button class="btn primary lg" data-act="wager" style="width:100%;margin-top:12px">Lock in wager</button></div>';
      } else {
        body = '<div class="card" style="text-align:center"><h2 style="margin:0">DAILY DOUBLE</h2>' +
          '<div class="hint" style="margin-top:8px">' + esc((P.teams.filter(function (x) { return x.id === P.ddTeam; })[0] || {}).name || '') +
          ' found it. Sit tight — no steal on this one.</div></div>';
      }
      return header() + body;
    }

    if (ph === 'ddclue' || ph === 'ddjudge') {
      if (P.ddTeam === t.id) {
        body = questionCard() + (ph === 'ddclue' ? timerBar() : '') +
          '<textarea id="ans" rows="3" placeholder="Type your team\'s answer…"' + (ph !== 'ddclue' ? ' disabled' : '') + '>' + esc(draft.answer) + '</textarea>' +
          '<button class="btn primary lg" data-act="answer" style="width:100%"' + (ph !== 'ddclue' ? ' disabled' : '') + '>Submit answer</button>';
        status = ph === 'ddjudge' ? 'Locked in — waiting on your instructor.' : 'Your Daily Double. Talk it out, then submit.';
      } else {
        body = '<div class="card" style="text-align:center"><div style="font-size:16px">Daily Double in progress…</div></div>';
      }
      return header() + body + '<div class="statusline">' + status + '</div>';
    }

    /* final face-off */
    if (ph === 'finalwager') {
      var maxF = Math.max(t.score, 0);
      var done = P.final && P.final.wagers && P.final.wagers[t.id];
      body = '<div class="card"><h2 style="margin:0 0 4px">FINAL FACE-OFF</h2>' +
        '<div class="hint">Category: <b>' + esc(P.final.cat) + '</b></div>' +
        '<label class="fld" style="margin-top:16px">Your wager (0 – ' + fmt(maxF) + ')</label>' +
        (done ? '<div style="font-size:26px;font-weight:900;color:var(--royal-yellow)">✔ Wager locked</div>'
              : '<input id="wager" type="number" onfocus="this.select()" min="0" max="' + maxF + '" value="' + (draft.wager || 0) + '" style="text-align:center;font-size:26px;font-weight:900">' +
                '<button class="btn primary lg" data-act="finalwager" style="width:100%;margin-top:12px">Lock in wager</button>') +
        (maxF <= 0 ? '<div class="hint" style="margin-top:10px">You\'re at or below zero, so your wager is 0.</div>' : '') +
      '</div>';
      return header() + body;
    }
    if (ph === 'finalclue' || ph === 'finaljudge') {
      var doneF = P.final && P.final.answeredF && P.final.answeredF[t.id];
      body = '<div class="pq"><div class="cat">FINAL · ' + esc(P.final.cat) + '</div><div class="txt">' + esc(P.final.text || '') + '</div></div>' +
        (ph === 'finalclue' ? timerBar() : '') +
        '<textarea id="ans" rows="5" placeholder="Type your team\'s final answer…"' + (ph !== 'finalclue' || doneF ? ' disabled' : '') + '>' + esc(draft.answer) + '</textarea>' +
        '<button class="btn primary lg" data-act="finalanswer" style="width:100%"' + (ph !== 'finalclue' || doneF ? ' disabled' : '') + '>' + (doneF ? '✔ Locked in' : 'Lock in answer') + '</button>';
      return header() + body;
    }

    if (ph === 'gameover') {
      var rank = P.teams.slice().sort(function (a, b) { return b.score - a.score; })
        .findIndex(function (x) { return x.id === t.id; }) + 1;
      return header() + '<div class="card" style="text-align:center">' +
        '<h2 style="margin:0">' + (rank === 1 ? '🏆 CHAMPIONS' : 'Finished #' + rank) + '</h2>' +
        '<div style="font-size:44px;font-weight:900;color:var(--royal-yellow);margin-top:10px">' + fmt(t.score) + '</div></div>';
    }

    /* board / clue / answering / judge / reveal */
    if (ph === 'board' || ph === 'lobby') {
      if (P.isLightning) {
        return header() + '<div class="card" style="text-align:center;background:linear-gradient(135deg,rgba(109,40,217,.45),rgba(194,65,12,.45))">' +
          '<h2 style="margin:0;font-size:26px">⚡ LIGHTNING FINAL</h2>' +
          '<div class="hint" style="margin-top:8px">Question ' + Math.min((P.lq ? P.lq.asked : 0) + 1, P.lq ? P.lq.total : 0) +
          ' of ' + (P.lq ? P.lq.total : 0) + ' · fastest buzz wins · 500 a question</div>' +
          '<div class="hint" style="margin-top:6px">Fingers on the buzzer.</div></div>' +
          standingsBlock('Head to head');
      }
      var ctl = P.control === t.id;
      body = '<div class="card" style="text-align:center"><div style="font-size:17px;font-weight:750">' +
        (ctl ? 'Your team picks the next clue' : 'Watch the big screen') + '</div>' +
        '<div class="hint" style="margin-top:8px">' + (ctl ? 'Call out a category and a point value.' : 'Your buzzer wakes up when the next question goes live.') + '</div>' +
        (P.stage ? '<div class="hint" style="margin-top:10px">Round ' + P.stage + ' of ' + P.totalBoards +
          ' · ' + (P.alive || []).length + ' teams still in</div>' : '') + '</div>';
      return header() + body;
    }

    if (ph === 'reveal') {
      body = questionCard() +
        '<div class="card" style="border-color:var(--royal-green);background:rgba(21,128,61,.2);text-align:center">' +
        '<div class="hint" style="letter-spacing:.16em;text-transform:uppercase">Answer</div>' +
        '<div style="font-size:20px;font-weight:800;margin-top:6px">' + esc((P.reveal && P.reveal.a) || '') + '</div></div>';
      return header() + body;
    }

    /* clue / answering / judge */
    var canBuzz = ph === 'clue' && !iAmLocked && !iBuzzed;
    var label, cls = 'buzz';
    if (iAmCurrent && (ph === 'answering' || ph === 'judge')) { label = 'YOU\'RE UP'; cls += ' mine'; }
    else if (iAmLocked) label = 'LOCKED OUT — this one\'s gone';
    else if (iBuzzed && ph === 'clue') label = 'BUZZED IN · #' + (pos + 1) + ' in line';
    else if (ph === 'clue') label = 'BUZZ';
    else label = 'ANOTHER TEAM HAS IT';

    body = questionCard() +
      '<button class="' + cls + '" data-act="buzz"' + (canBuzz ? '' : ' disabled') + '>' + label + '</button>';

    if (iAmCurrent && ph === 'answering') {
      body += timerBar() +
        '<textarea id="ans" rows="3" placeholder="Type your team\'s answer…">' + esc(draft.answer) + '</textarea>' +
        '<button class="btn primary lg" data-act="answer" style="width:100%">Submit answer</button>';
      status = 'Anyone on your team can type. Talk fast.';
    } else if (iAmCurrent && ph === 'judge') {
      status = 'Locked in — your instructor is judging.';
    } else if (ph === 'clue' && (P.buzzOrder || []).length) {
      var f = P.teams.filter(function (x) { return x.id === P.buzzOrder[0]; })[0];
      status = (f ? f.name : 'Another team') + ' buzzed first.';
    } else if (ph === 'clue') {
      status = iAmLocked ? 'You already had your shot on this one.' : 'Buzz when your team knows it.';
    }
    return header() + body + '<div class="statusline">' + status + '</div>';
  }

  function render() { withFocus(_render); }
  function _render() {
    if (!P) {
      app.innerHTML = '<div class="play"><div class="card" style="text-align:center">' +
        '<div class="brand" style="justify-content:center"><div class="mark">⚔</div><div><div class="t1">FACE-OFF</div><div class="t2">SECURITY+</div></div></div>' +
        (FB_PROBLEM ? '<div class="fbwarn" style="text-align:left;margin:14px 0"><div class="ic">⚠</div><div>' +
          'This game isn\'t set up for phone joining yet — ask your instructor.</div></div>' : '') +
        '<h3 style="margin:18px 0 6px">Looking for room <span class="mono">' + esc(code) + '</span>…</h3>' +
        '<div class="hint">Make sure your instructor has the host screen open.' +
        (liveMode() ? '' : '<br><br><b>Local mode:</b> this join link only works in another tab on the host computer.') + '</div>' +
        '<button class="btn sm ghost" data-act="recode" style="margin-top:14px">Enter a different code</button></div></div>';
      return;
    }
    var inner = myTeam() ? (P.phase === 'lobby' ? lobbyView() : playView()) : joinView();
    app.innerHTML = '<div class="play">' + inner + '</div>';
    paint();
  }

  function onClick(e) {
    var el;
    if ((el = e.target.closest('[data-team]'))) {
      me.teamId = el.getAttribute('data-team'); ssSet(KEY, me); render(); return;
    }
    if ((el = e.target.closest('[data-color]'))) {
      var mt = myTeam(); if (!mt) return;
      send({ type: 'teamcolor', teamId: mt.id, colorId: el.getAttribute('data-color') }); return;
    }
    el = e.target.closest('[data-act]'); if (!el) return;
    var a = el.getAttribute('data-act'), t = myTeam();
    switch (a) {
      case 'recode': location.hash = '#/play'; break;
      case 'join':
        var nm = (($('#myname') && $('#myname').value) || draft.myname || '').trim();
        if (!nm) { flash('Enter your name first', 'bad'); return; }
        if (!me.teamId) { flash('Pick your team', 'bad'); return; }
        me.name = nm.slice(0, 18); ssSet(KEY, me);
        send({ type: 'join', teamId: me.teamId, name: me.name });
        Snd.ac(); break;
      case 'leave':
        send({ type: 'leave', teamId: t ? t.id : me.teamId }); me.teamId = null; ssSet(KEY, me); render(); break;
      case 'setname':
        draft.tname = $('#tname').value;
        send({ type: 'teamname', teamId: t.id, name: draft.tname }); flash('Team name set', 'good'); break;
      case 'buzz':
        send({ type: 'buzz', teamId: t.id }); Snd.buzz();
        el.disabled = true; el.textContent = 'BUZZED!'; break;
      case 'answer':
        draft.answer = $('#ans').value;
        send({ type: 'answer', teamId: t.id, text: draft.answer, by: me.name });
        draft.answer = ''; break;
      case 'wager':
        draft.wager = $('#wager').value;
        send({ type: 'wager', teamId: t.id, amount: draft.wager }); break;
      case 'finalwager':
        draft.wager = $('#wager').value;
        send({ type: 'finalwager', teamId: t.id, amount: draft.wager }); break;
      case 'finalanswer':
        draft.answer = $('#ans').value;
        send({ type: 'finalanswer', teamId: t.id, text: draft.answer, by: me.name }); break;
    }
  }
  app.addEventListener('click', onClick);
  app.addEventListener('input', function (e) {
    if (e.target.id === 'ans') draft.answer = e.target.value;
    if (e.target.id === 'myname') draft.myname = e.target.value;
    if (e.target.id === 'tname') draft.tname = e.target.value;
    if (e.target.id === 'wager') draft.wager = e.target.value;
  });

  render();
  T.playerInit(onPub, onTimer);
  tickHandle = setInterval(paint, 100);
  window.__FO_PLAYER = { send: send, me: me, get pub() { return P; } };

  return function () { app.removeEventListener('click', onClick); if (tickHandle) clearInterval(tickHandle); };
}

function CodeEntry() {
  app.innerHTML = '<div class="launch"><div class="launch-inner" style="max-width:440px">' +
    '<div class="brand" style="justify-content:center"><div class="mark">⚔</div><div><div class="t1">FACE-OFF</div><div class="t2">SECURITY+</div></div></div>' +
    '<h1 style="font-size:44px">JOIN</h1>' +
    '<div class="card" style="text-align:left">' +
      '<label class="fld">Room code</label>' +
      '<input id="code" type="text" maxlength="4" placeholder="ABCD" style="text-transform:uppercase;text-align:center;font-size:34px;font-weight:900;letter-spacing:.3em">' +
      '<button class="btn primary lg" data-act="go" style="width:100%;margin-top:14px">Enter</button>' +
      '<div class="hint" style="margin-top:12px">Your instructor has the code on the big screen — or just scan the QR.</div>' +
    '</div></div></div>';
  app.onclick = function (e) {
    if (!e.target.closest('[data-act=go]')) return;
    var v = ($('#code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length !== 4) { flash('4 letters, like ABCD', 'bad'); return; }
    location.hash = '#/play/' + v;
  };
  app.onkeydown = function (e) { if (e.key === 'Enter') { var b = $('[data-act=go]'); b && b.click(); } };
  return null;
}

/* boot */
route();
})();
