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
/* The host's answer music, kept in THIS browser (IndexedDB) and never
   uploaded. One store for every Face-Off game on purpose: they share the
   github.io origin, so loading it once in one game loads it in all five. */
/* The answer-music row of Game settings. Repainted on its own when a
   file is loaded or removed, so the rest of the unsaved form survives. */
function clipRowHtml() {
  return '<div class="row" style="gap:12px;margin-top:12px;align-items:center;flex-wrap:wrap" id="clipRow">' +
'<span><b>Answer music:</b> ' + (Snd.clipReady()
? '<span id="clipName">' + esc(Snd.clipName) + '</span> (' + Math.round(Snd.clipDur) + ' s)'
: '<span id="clipName">none loaded</span> — the built-in countdown plays') + '</span>' +
'<button class="btn" data-act="clippick" type="button">Load answer music…</button>' +
'<input id="setClip" type="file" accept="audio/*" hidden>' +
(Snd.clipReady() ? '<button class="btn" data-act="clipclear" type="button">Remove</button>' : '') +
'</div>';
}
function paintClipRow() { var r = document.getElementById('clipRow'); if (r) r.outerHTML = clipRowHtml(); }
var MusicStore = {
  _db: function () {
    return new Promise(function (ok, no) {
      if (!window.indexedDB) { no(new Error('no IndexedDB')); return; }
      var r = indexedDB.open('fo-answer-music', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('music'); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); };
    });
  },
  _tx: function (mode, fn) {
    return this._db().then(function (db) { return new Promise(function (ok, no) {
      var t = db.transaction('music', mode), st = t.objectStore('music'), req = fn(st);
      t.oncomplete = function () { ok(req && req.result); db.close(); }; t.onerror = function () { no(t.error); db.close(); };
    }); });
  },
  load: function () { return this._tx('readonly', function (st) { return st.get('answer'); }).catch(function () { return null; }); },
  save: function (blob, name) { return this._tx('readwrite', function (st) { return st.put({ blob: blob, name: name }, 'answer'); }); },
  clear: function () { return this._tx('readwrite', function (st) { return st.delete('answer'); }).catch(function () {}); }
};
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
var MAX_ROUNDS = 20;              /* ceiling on the host's round count */

/* Every Face-Off game deploys to the same github.io origin, and localStorage
   is keyed per ORIGIN, not per folder. Sharing one 'fo:host' key meant these
   games trod on each other's saved settings — and now on each other's deck of
   used clues, which would reset whichever game you were part way through
   every time you opened another one. The Firebase room paths were already
   namespaced this way; local storage now matches. */
var GAME_ID  = 'sec';
var HOST_KEY = 'fo:host:' + GAME_ID;
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

/* ==================================================================== */
/* SOUND                                                                */
/*                                                                      */
/* EVERYTHING HERE IS GENERATED, NOT RECORDED. There is not one audio    */
/* file in this repository. Every sound is built live in the browser     */
/* out of oscillators and filtered noise, which means: nothing to        */
/* download, nothing to go missing, it works with no internet, and it    */
/* cannot be anybody else's recording even by accident.                  */
/*                                                                      */
/* ON THE GAME SHOW THESE ARE MODELLED AFTER: the think cue, the         */
/* buzzer, the Daily Double sting and the theme are owned property.      */
/* What is written below borrows the JOB each sound does and the         */
/* character it does it with — a harsh low buzzer, a rising harp-like    */
/* flourish for the big one, a steady ticking bed that runs the whole    */
/* clock and resolves when it hits zero. The melodies are ours. Close    */
/* in feel, not a copy, and if a licensed recording is ever bought,      */
/* each cue is a single function to swap out.                            */
/*                                                                      */
/* --------------------------------------------------------------------*/
/* THE BED IS THE PART THAT NEEDS CARE                                   */
/*                                                                      */
/* A one-shot cue cannot outlive itself. A music bed can, and when it    */
/* does it plays underneath the next clue, or two of them stack up and   */
/* the room gets a wall of noise. So the bed has exactly ONE owner:      */
/* the answer clock. bedStart is called from startTimer and bedStop      */
/* from stopTimer, and nowhere else. Every way a clue can end — judged   */
/* right, judged wrong, stolen, revealed, timed out, host closes it,     */
/* round ends, final starts, game over — already funnels through         */
/* stopTimer, so there is no exit path that can leave it running.        */
/*                                                                      */
/* It is scheduled with a LOOK-AHEAD rather than laid out in advance.    */
/* Booking two minutes of notes up front means two minutes of nodes to   */
/* hunt down and cancel when the host judges an answer after four        */
/* seconds. This way only the next fifth of a second exists at any       */
/* moment, and stopping is a single gain ramp.                           */
/* ==================================================================== */
var Snd = {
  on: true,          /* master switch — the host's "Sound effects"      */
  music: true,       /* the countdown bed, switchable on its own        */
  volume: 0.7,
  ctx: null, master: null, cueBus: null, musicBus: null,
  _noiseBuf: null, _bed: null,

  /* The context is built on first use and resumed every time, because a
     browser will not let a page make noise until somebody has clicked
     something, and a context created before that gesture starts life
     suspended. Note this does NOT check `on` — a muted host still needs
     a live context ready for when they unmute. */
  ac: function () {
    if (!this.ctx) {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      try { this.ctx = new C(); } catch (e) { return null; }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.cueBus = this.ctx.createGain();
      this.cueBus.gain.value = 1;
      this.cueBus.connect(this.master);
      /* The bed sits under the cues on purpose. It plays for fifteen
         seconds straight; a buzzer plays for a quarter of one. Level
         them the same and the room stops hearing the buzzer. */
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.5;
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
    return this.ctx;
  },

  setVolume: function (v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master) this.master.gain.value = this.volume;
  },

  /* ---- raw material ------------------------------------------------ */

  /* One two-second buffer of white noise, reused for every crash,
     handclap and woodblock in here. Generating a fresh one per hit is
     the sort of thing that makes a classroom laptop stutter. */
  noiseBuffer: function (c) {
    if (!this._noiseBuf) {
      var n = Math.floor(c.sampleRate * 2);
      var b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = b;
    }
    return this._noiseBuf;
  },

  /* A pitched note. `glide` bends to a second frequency across the note,
     which is what turns a beep into a siren, a swoop or a fall. */
  tone: function (freq, dur, type, vol, delay, glide, bus) {
    if (!this.on) return null;
    var c = this.ac(); if (!c) return null;
    var t0 = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(1, glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol || 0.18), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(bus || this.cueBus);
    o.start(t0); o.stop(t0 + dur + 0.03);
    return o;
  },

  /* A band of noise. Sweeping the filter is how you get a whoosh; a
     short high band is a stick hit; a long wide band is a crowd. */
  noise: function (dur, vol, delay, f0, f1, q, bus) {
    if (!this.on) return null;
    var c = this.ac(); if (!c) return null;
    var t0 = c.currentTime + (delay || 0);
    var s = c.createBufferSource(); s.buffer = this.noiseBuffer(c);
    s.loop = true;
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = q || 1;
    bp.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) bp.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(bp); bp.connect(g); g.connect(bus || this.cueBus);
    s.start(t0); s.stop(t0 + dur + 0.03);
    return s;
  },

  /* ---- the cues ----------------------------------------------------- */
  /* Named for the moment, not the sound, so a hook reads as what just
     happened in the game rather than as a noise. */
  cues: {

    /* A team hits their buzzer. Harsh, low, electrical, and the loudest
       thing in the room — it has to cut across thirty students. */
    buzz: function (S) {
      S.tone(196, 0.30, 'square', 0.20);
      S.tone(148, 0.32, 'square', 0.16, 0.015);
      S.tone(99,  0.34, 'sawtooth', 0.10, 0.01);
      S.noise(0.05, 0.10, 0, 1800, 700, 1.2);        /* the contact click */
    },

    /* Right answer. Two notes up, and a third that lands on the octave
       so it sounds finished rather than merely interrupted. */
    correct: function (S) {
      S.tone(659, 0.12, 'sine', 0.20);
      S.tone(880, 0.13, 'sine', 0.20, 0.10);
      S.tone(1319, 0.30, 'sine', 0.16, 0.20);
      S.tone(1319, 0.30, 'triangle', 0.06, 0.20);
    },

    /* Wrong answer. Deliberately NOT the buzzer — a student needs to
       hear the difference between "your buzzer fired" and "that was
       wrong", and on a game show those are near-identical sounds. Here
       wrong falls, and the buzzer does not. */
    wrong: function (S) {
      S.tone(233, 0.28, 'sawtooth', 0.15, 0, 175);
      S.tone(175, 0.34, 'sawtooth', 0.13, 0.09, 131);
    },

    /* Locked out — buzzed and got it wrong, so this team is out of this
       clue. A short dead thud. Distinct from `wrong` because it lands on
       a different team than the one being judged, and the room needs to
       tell them apart. */
    lockout: function (S) {
      S.tone(110, 0.16, 'square', 0.10, 0, 82);
      S.noise(0.10, 0.06, 0, 420, 180, 0.8);
    },

    /* The clue is live again for somebody else. Two quick notes that
       hand it across. */
    steal: function (S) {
      S.tone(523, 0.08, 'triangle', 0.14);
      S.tone(784, 0.14, 'triangle', 0.14, 0.07);
    },

    /* A tile opens. A short upward whoosh — the board moving, not a
       musical note. */
    clueOpen: function (S) {
      S.noise(0.26, 0.09, 0, 300, 2600, 0.7);
      S.tone(330, 0.18, 'triangle', 0.07, 0, 660);
    },

    /* DAILY DOUBLE. The big reveal. A fast rising flourish — harp-like,
       which is the character the show uses — topped with a bell. */
    dailyDouble: function (S) {
      var scale = [392, 494, 587, 659, 784, 988, 1175, 1568];
      scale.forEach(function (f, i) {
        S.tone(f, 0.45, 'triangle', 0.13, i * 0.055);
        S.tone(f * 2, 0.30, 'sine', 0.045, i * 0.055);
      });
      S.tone(1568, 0.9, 'sine', 0.16, 0.46);
      S.tone(2349, 0.7, 'sine', 0.07, 0.46);
      S.noise(0.5, 0.05, 0.46, 5000, 9000, 0.6);      /* the shimmer */
    },

    /* The wager is in. A mechanical two-part clunk — something committed
       and cannot be taken back. */
    wagerLocked: function (S) {
      S.noise(0.05, 0.11, 0, 900, 500, 2);
      S.noise(0.07, 0.09, 0.07, 500, 260, 2);
      S.tone(330, 0.10, 'square', 0.07, 0.07);
    },

    /* Points on the board. Up for a gain, down for a deduction — so a
       deduction is audible from the back of the room, which matters
       because it is the one score change students argue about. */
    pointsUp: function (S) {
      S.tone(1047, 0.06, 'square', 0.10);
      S.tone(1319, 0.09, 'square', 0.10, 0.05);
      S.tone(1568, 0.14, 'square', 0.09, 0.10);
    },
    pointsDown: function (S) {
      S.tone(660, 0.07, 'square', 0.10);
      S.tone(523, 0.09, 'square', 0.10, 0.06);
      S.tone(392, 0.16, 'square', 0.09, 0.12);
    },

    /* A student's phone has joined the room. Quiet on purpose — this one
       fires thirty times while the class files in. */
    join: function (S) {
      S.tone(784, 0.07, 'sine', 0.08);
      S.tone(1047, 0.12, 'sine', 0.08, 0.06);
    },

    /* A fresh board goes up. A rising sweep into a full chord — the
       curtain going back. */
    boardReveal: function (S) {
      S.noise(0.55, 0.07, 0, 200, 3000, 0.6);
      [262, 330, 392, 523].forEach(function (f, i) {
        S.tone(f, 0.9, 'triangle', 0.11, 0.42 + i * 0.03);
        S.tone(f, 0.9, 'sine', 0.05, 0.42 + i * 0.03);
      });
      S.tone(1047, 0.7, 'sine', 0.08, 0.52);
    },

    /* Board cleared. A short cadence that says "that is that one done"
       without claiming the game is over. */
    roundClear: function (S) {
      [523, 659, 784].forEach(function (f, i) { S.tone(f, 0.5, 'triangle', 0.12, i * 0.12); });
      S.tone(1047, 0.7, 'sine', 0.10, 0.36);
    },

    /* A team is out. Heavy, falling, and it takes its time — this is
       somebody's game ending in front of the class. */
    eliminated: function (S) {
      [392, 330, 262, 196].forEach(function (f, i) {
        S.tone(f, 0.45, 'sawtooth', 0.12, i * 0.16, f * 0.94);
      });
      S.tone(98, 1.1, 'triangle', 0.13, 0.62);
      S.noise(0.8, 0.05, 0.62, 260, 90, 0.7);
    },

    /* The Lightning Final. A build, then a hit. */
    finalStart: function (S) {
      S.noise(1.0, 0.09, 0, 180, 2400, 0.5);          /* the rise */
      for (var i = 0; i < 8; i++) S.tone(147 * (1 + i * 0.08), 0.12, 'sawtooth', 0.07, i * 0.11);
      [294, 370, 440, 587].forEach(function (f) {
        S.tone(f, 1.3, 'sawtooth', 0.11, 0.98);
        S.tone(f / 2, 1.3, 'triangle', 0.07, 0.98);
      });
      S.noise(0.9, 0.09, 0.98, 3000, 600, 0.5);       /* the crash */
    },

    /* Winner. A fanfare over a crowd. The applause is thirty-odd noise
       bursts at random offsets through two seconds — which is, near
       enough, what a room full of people clapping actually is. */
    winner: function (S) {
      [523, 659, 784, 1047].forEach(function (f, i) {
        S.tone(f, 0.28, 'square', 0.12, i * 0.10);
        S.tone(f, 0.28, 'triangle', 0.08, i * 0.10);
      });
      [1047, 1319, 1568].forEach(function (f, i) {
        S.tone(f, 1.4, 'square', 0.11, 0.44 + i * 0.02);
        S.tone(f / 2, 1.4, 'triangle', 0.08, 0.44 + i * 0.02);
      });
      S.noise(2.2, 0.05, 0.10, 1400, 2000, 0.35);     /* the body of the crowd */
      for (var i = 0; i < 34; i++) {
        S.noise(0.035, 0.030 + Math.random() * 0.02, 0.10 + Math.random() * 2.0,
                1600 + Math.random() * 2600, null, 1.4);
      }
    },

    /* Out of time. Falls and stops dead. */
    timeUp: function (S) {
      S.tone(220, 0.20, 'sawtooth', 0.16, 0, 165);
      S.tone(165, 0.55, 'sawtooth', 0.15, 0.16, 110);
      S.noise(0.4, 0.06, 0.16, 300, 100, 0.7);
    },

    /* Bare tick, for the few places that want one clock beat and no bed. */
    tick: function (S) { S.tone(1100, 0.04, 'square', 0.06); }
  },

  /** Fire a named cue. Unknown names are ignored rather than thrown, so
      a typo in a hook is a missing sound and not a dead game. */
  cue: function (name) {
    if (!this.on) return false;
    var f = this.cues[name];
    if (!f) return false;
    if (!this.ac()) return false;
    f(this);
    return true;
  },

  /* ==================================================================
     THE COUNTDOWN BED: THE FACE OFF THINK CUE (owner, 7 October 2026)

     An original think cue: a wooden tick-tock on every beat, a plucked
     bass on 1 and 3, soft chords on 2 and 4, a marimba tune of our own,
     and a "ba-DUM" button that lands exactly as the clock hits zero.
     128 bpm; 16 bars is 30 seconds. It is not the game show's cue and
     borrows none of its notes. The owner heard it as a preview first.

     It fits ANY window and always ends on zero, at the same tempo:
       - the tune is an opening (4 bars), a middle (8 bars) and an
         ending (4 bars + the button), 30 seconds in all
       - a longer window repeats the middle as often as it takes
         (45 s plays it twice, 120 s seven times)
       - it then starts part way in, so the DUM lands on zero: 15
         seconds to answer begins at bar 9 (cueScore)
     A file the host loads (below) plays instead, when there is one.
     ================================================================== */
  CUE_BPM: 128,

  /** Every note of the cue for a window of `secs`, as times from the
      buzz. Pure, so it can be checked without a browser. */
  cueScore: function (secs) {
    var BEAT = 60 / this.CUE_BPM, E = BEAT / 2, BAR = 4 * BEAT;
    var TUNE = [
      'C5 - A4 Bb4 C5 - F5 -', 'E5 - D5 C5 D5 - . .', 'C5 - A4 F4 G4 - A4 -', 'G4 - - - . . . .',
      'C5 - A4 Bb4 C5 - F5 -', 'G5 - F5 E5 F5 - D5 -', 'C5 - A4 G4 A4 - G4 -', 'F4 - - - . . . .',
      'D5 - E5 F5 E5 - D5 -', 'C5 - A4 C5 Bb4 - . .', 'Bb4 - C5 D5 C5 - Bb4 -', 'A4 - G4 - A4 - . .',
      'C5 - A4 Bb4 C5 - F5 -', 'G5 - F5 E5 D5 - C5 -', 'A4 - G4 - E4 - G4 -', 'A4 Bb4 B4 C5 D5 E5 . .'];
    var CH = ['F', 'Bb', 'F', 'C7', 'F', 'Bb', 'C7', 'F', 'Dm', 'F', 'Gm', 'C7', 'F', 'Bb', 'C7', 'C7'];
    var CHORDS = { F: ['F2', 'C3', ['A3', 'C4', 'F4']], Bb: ['Bb1', 'F2', ['Bb3', 'D4', 'F4']], C7: ['C2', 'G2', ['Bb3', 'E4', 'G4']],
                   Dm: ['D2', 'A2', ['A3', 'D4', 'F4']], Gm: ['G2', 'D3', ['Bb3', 'D4', 'G4']] };
    function hz(n) { var m = /^([A-G])(b|#)?(\d)$/.exec(n), st = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
      return 440 * Math.pow(2, (st + 12 * (+m[3] + 1) - 69) / 12); }
    secs = Math.max(1, Number(secs) || 0);
    var reps = Math.max(1, Math.ceil((secs - 15) / 15));
    var order = [0, 1, 2, 3]; for (var r = 0; r < reps; r++) order = order.concat([4, 5, 6, 7, 8, 9, 10, 11]);
    order = order.concat([12, 13, 14, 15]);
    var total = order.length * BAR, skip = total - secs, ev = [];
    function at(t, e) { if (t >= skip - 1e-6) { e.t = t - skip; ev.push(e); } }
    order.forEach(function (b, k) {
      var tb = k * BAR, c = CHORDS[CH[b]];
      at(tb, { k: 'bass', f: hz(c[0]) }); at(tb + 2 * BEAT, { k: 'bass', f: hz(c[1]) });
      if (b < 15) { at(tb + BEAT, { k: 'chord', fs: c[2].map(hz) }); at(tb + 3 * BEAT, { k: 'chord', fs: c[2].map(hz) }); }
      for (var q = 0; q < 4; q++) at(tb + q * BEAT, { k: 'tick', hi: q % 2 === 0 });
      var toks = TUNE[b].split(' ');
      toks.forEach(function (tk, i) { if (tk === '-' || tk === '.') return; var len = 1; while (toks[i + len] === '-') len++; at(tb + i * E, { k: 'mar', f: hz(tk), len: len * E }); });
    });
    /* the button: ba on the last beat, DUM on zero */
    at(total - BEAT, { k: 'brass', fs: ['C3', 'G3', 'Bb3', 'E4'].map(hz), len: 0.16, v: 0.05 }); at(total - BEAT, { k: 'timp', f: hz('C2') });
    at(total, { k: 'brass', fs: ['F2', 'C3', 'F3', 'A3', 'C4', 'F4'].map(hz), len: 1.1, v: 0.06, dum: true }); at(total, { k: 'timp', f: hz('F1') });
    at(total, { k: 'mar', f: hz('F5'), len: 4 * E }); at(total, { k: 'mar', f: hz('F4'), len: 4 * E });
    ev.sort(function (a, b) { return a.t - b.t; });
    return { events: ev, total: total, skip: skip, reps: reps, dumAt: secs };
  },

  /* ==================================================================
     ANSWER MUSIC THE HOST LOADS (owner, 7 October 2026)

     The owner wanted a recorded think cue to start on the buzzer. A
     recording of a TV show's cue is somebody else's property, so it
     never goes in this public repo: the host loads the file on their
     own computer (Game settings → Load answer music…), it is kept in
     that browser's IndexedDB, and it is never uploaded anywhere. With
     none loaded, the Face Off think cue above plays.

     It still has ONE owner, the answer clock: bedStart plays it and
     bedStop stops it, so every way a clue ends stops the music.

     It STRETCHES to the host's seconds-to-answer, ending as the clock
     hits zero (clipPlan):
       - a window up to the clip's length: the clip's last N seconds,
         or the whole clip a little faster (at most 1.25x)
       - a longer window: the clip slowed (pitch kept), or played
         through 2, 3 or 4 times at 0.67x to 1.33x, so the last pass
         ends on zero
     ================================================================== */
  clipName: '', clipDur: 0, _clipEl: null, _clipSrc: null, _clipUrl: null,

  /** How to fit a clip of L seconds into a W-second window: start at
      `offset` seconds, play `passes` times at `rate`. Pure, so it can
      be checked without a browser. */
  clipPlan: function (L, W) {
    L = Number(L) || 0; W = Math.max(1, Number(W) || 0);
    if (!L) return null;
    if (W <= L) {
      if (L / W <= 1.25) return { offset: 0, rate: L / W, passes: 1 };
      return { offset: L - W, rate: 1, passes: 1 };
    }
    var n = Math.max(1, Math.round(W / L)), rate = n * L / W;
    if (rate < 0.67) { n++; rate = n * L / W; }
    return { offset: 0, rate: rate, passes: n };
  },

  /** Take a loaded file (a Blob) as the answer music. Resolves with its
      length in seconds, or rejects if the browser can't play it. */
  clipSet: function (blob, name) {
    var self = this;
    this.clipClear();
    return new Promise(function (ok, no) {
      var el = new Audio(); el.preload = 'auto';
      /* slowed or sped up, it keeps its pitch rather than sounding like
         a tape at the wrong speed */
      el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true;
      var url = URL.createObjectURL(blob);
      el.addEventListener('loadedmetadata', function () {
        if (!isFinite(el.duration) || el.duration <= 0) { URL.revokeObjectURL(url); no(new Error('no length')); return; }
        self._clipEl = el; self._clipUrl = url; self.clipName = name || 'answer music'; self.clipDur = el.duration;
        ok(el.duration);
      }, { once: true });
      el.addEventListener('error', function () { URL.revokeObjectURL(url); no(new Error('unplayable')); }, { once: true });
      el.src = url;
    });
  },
  clipClear: function () {
    if (this._bed && this._bed.el) this.bedStop();
    if (this._clipSrc) { try { this._clipSrc.disconnect(); } catch (e) {} }
    if (this._clipEl) { try { this._clipEl.pause(); } catch (e) {} }
    if (this._clipUrl) URL.revokeObjectURL(this._clipUrl);
    this._clipEl = null; this._clipSrc = null; this._clipUrl = null; this.clipName = ''; this.clipDur = 0;
  },
  clipReady: function () { return !!(this._clipEl && this.clipDur); },

  _clipStart: function (secs) {
    var c = this.ac(); if (!c) return false;
    var el = this._clipEl, plan = this.clipPlan(this.clipDur, secs);
    var gate = c.createGain(); gate.gain.value = 1; gate.connect(this.musicBus);
    /* a media element can be routed into the context only once */
    if (!this._clipSrc) this._clipSrc = c.createMediaElementSource(el);
    try { this._clipSrc.disconnect(); } catch (e) {}
    this._clipSrc.connect(gate);
    var bed = { gate: gate, nodes: [], timer: null, el: el, plan: plan, pass: 1, total: secs };
    this._bed = bed;
    el.onended = function () {
      if (bed !== Snd._bed || bed.pass >= plan.passes) return;
      bed.pass++; el.currentTime = 0; el.play().catch(function () {});
    };
    el.playbackRate = plan.rate;
    el.currentTime = plan.offset;
    el.play().catch(function () {});
    return true;
  },

  bedStart: function (secs) {
    this.bedStop();                       /* one bed, ever. */
    if (!this.on || !this.music) return false;
    var c = this.ac(); if (!c) return false;
    secs = Math.max(1, Number(secs) || 0);
    if (this.clipReady()) return this._clipStart(secs);

    var t0 = c.currentTime + 0.03;
    var gate = c.createGain();            /* one handle to kill the lot */
    gate.gain.value = 1;
    gate.connect(this.musicBus);
    var score = this.cueScore(secs);
    var bed = { gate: gate, nodes: [], timer: null, t0: t0, ev: score.events, i: 0,
                dumAt: t0 + score.dumAt, total: secs };
    var self = this;
    bed.timer = setInterval(function () { self._bedTick(bed); }, 40);
    this._bed = bed;
    this._bedTick(bed);
    return true;
  },

  /* Schedules only what is about to be heard. Anything further out does
     not exist yet, so stopping never has to chase it down. */
  _bedTick: function (bed) {
    var c = this.ctx; if (!c || this._bed !== bed) return;
    var HORIZON = 0.2;
    while (bed.i < bed.ev.length && bed.t0 + bed.ev[bed.i].t < c.currentTime + HORIZON) {
      var e = bed.ev[bed.i++], at = Math.max(c.currentTime, bed.t0 + e.t);
      this._cueNote(bed, e, at);
    }
    if (bed.i >= bed.ev.length && bed.timer) { clearInterval(bed.timer); bed.timer = null; }
  },

  /* One note of the cue, into the bed's gate. Levels sit under the cues,
     as the old bed did: the buzzer must always be heard over it. */
  _cueNote: function (bed, e, at) {
    var c = this.ctx, self = this, V = 0.42;
    function voice(type, f, peak, a, d, lp, glideFrom) {
      var o = c.createOscillator(), g = c.createGain(), node = o;
      o.type = type;
      if (glideFrom) { o.frequency.setValueAtTime(glideFrom, at); o.frequency.exponentialRampToValueAtTime(f, at + 0.08); } else o.frequency.setValueAtTime(f, at);
      if (lp) { var fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl); node = fl; }
      node.connect(g); g.connect(bed.gate);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * V), at + a);
      g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
      o.start(at); o.stop(at + a + d + 0.05);
      bed.nodes.push(o);
    }
    if (e.k === 'mar') { var d = Math.min(0.9, 0.35 + e.len * 0.6); voice('sine', e.f, 0.30, 0.004, d); voice('sine', e.f * 3.93, 0.05, 0.002, 0.08); voice('sine', e.f * 2, 0.04, 0.003, d * 0.5); }
    else if (e.k === 'bass') { voice('triangle', e.f, 0.32, 0.006, 0.42, 900); voice('sine', e.f / 2, 0.14, 0.006, 0.3); }
    else if (e.k === 'chord') e.fs.forEach(function (f) { voice('sine', f, 0.045, 0.01, 0.28); });
    else if (e.k === 'tick') { var f = e.hi ? 1650 : 1250; voice('sine', f, 0.10, 0.001, 0.035); voice('square', f * 1.5, 0.012, 0.001, 0.012, 4000); }
    else if (e.k === 'brass') e.fs.forEach(function (f) { voice('sawtooth', f, e.v, 0.012, e.len, 1800); voice('sawtooth', f * 1.003, e.v * 0.6, 0.012, e.len, 1600); });
    else if (e.k === 'timp') voice('sine', e.f, 0.5, 0.005, 1.4, 0, e.f * 1.15);
    if (bed.nodes.length > 160) bed.nodes = bed.nodes.slice(-96);
  },

  /** True once the cue's DUM has sounded: the clock ran out on the music,
      so it rings out and the separate time's-up sound is not needed. */
  bedLanded: function () { var b = this._bed, c = this.ctx; return !!(b && b.dumAt && c && c.currentTime >= b.dumAt - 0.15); },

  /** Kill the bed. Safe to call when there is no bed, and safe to call
      twice — both happen, because stopTimer is called defensively all
      over the host. */
  bedStop: function () {
    var bed = this._bed;
    this._bed = null;
    if (!bed) return false;
    if (bed.timer) clearInterval(bed.timer);
    /* the loaded answer music: pause it just after the gate has faded */
    if (bed.el) { var el = bed.el; el.onended = null; setTimeout(function () { if (Snd._bed && Snd._bed.el === el) return; el.pause(); }, 90); }
    var c = this.ctx;
    /* The clock ran out on the cue's DUM: let it ring out, don't cut it */
    var ring = !!(c && bed.dumAt && c.currentTime >= bed.dumAt - 0.15);
    if (ring) {
      var tr = c.currentTime;
      try { bed.gate.gain.cancelScheduledValues(tr); bed.gate.gain.setValueAtTime(bed.gate.gain.value, tr); bed.gate.gain.exponentialRampToValueAtTime(0.0001, tr + 1.6); } catch (e) {}
      bed.nodes.length = 0; return true;
    }
    if (c && bed.gate) {
      /* A short ramp rather than a hard cut — pulling a drone to silence
         in one sample is an audible click. */
      var t = c.currentTime;
      try {
        bed.gate.gain.cancelScheduledValues(t);
        bed.gate.gain.setValueAtTime(bed.gate.gain.value, t);
        bed.gate.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      } catch (e) { bed.gate.gain.value = 0; }
    }
    bed.nodes.forEach(function (n) { try { n.stop(c ? c.currentTime + 0.09 : 0); } catch (e) {} });
    bed.nodes.length = 0;
    return true;
  },

  bedRunning: function () { return !!this._bed; },

  /** Level the room before the class arrives: a short run through the
      cues plus three seconds of the bed. */
  test: function () {
    var self = this;
    var order = ['boardReveal', 'clueOpen', 'buzz', 'correct', 'wrong', 'dailyDouble', 'winner'];
    order.forEach(function (name, i) { setTimeout(function () { self.cue(name); }, i * 850); });
    setTimeout(function () { self.bedStart(3); }, order.length * 850);
    setTimeout(function () { var landed = self.bedLanded(); self.bedStop(); if (!landed) self.cue('timeUp'); }, order.length * 850 + 3000);
  }
};

/* Browsers refuse to make noise until the page has been interacted
   with. Any first click or key anywhere wakes the context so the first
   real cue of the game is not the one that gets swallowed. */
(function () {
  function wake() {
    Snd.ac();
    document.removeEventListener('pointerdown', wake, true);
    document.removeEventListener('keydown', wake, true);
  }
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);
})();

/* A PUBLIC HANDLE ON THE AUDIO, FOR TWO REASONS.

   The practical one: if the sound misbehaves on a projector in front of
   a class, FACEOFF_SOUND.on = false from the console kills it in a
   second without reloading the game and losing the board.

   The other one: bedStart calls bedStop on itself before doing anything,
   so that two beds can never run at once. Nothing in the game reaches
   that guard today — every path that starts the clock has already
   stopped it — which means it is defensive code, and defensive code
   that cannot be reached also cannot be tested through the interface.
   Exposing the engine lets verify/sound.mjs call bedStart twice on
   purpose and prove the guard actually holds, rather than taking it on
   trust because nothing has broken yet. */
window.FACEOFF_SOUND = Snd;

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
  try { this.ch = ('BroadcastChannel' in window) ? new BroadcastChannel('faceoff:' + GAME_ID + ':' + room) : null; }
  catch (e) { this.ch = null; }
  this.bus = sharedBus();
  this.kPub = 'fo:pub:' + GAME_ID + ':' + room; this.kTim = 'fo:tim:' + GAME_ID + ':' + room;
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

  /* rooms/<game->CODE — namespaced so five games can share one project */
  _basePath: function () { return 'rooms/sec-' + this.room; },

  /* REST endpoint for a node, used when the SDK can't be loaded */
  _url: function (p) {
    return String(FB.config.databaseURL).replace(/\/+$/, '') + '/' + this._basePath() + p + '.json';
  },

  _load: function () {
    if (this._p) return this._p;
    var self = this;
    this._p = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js')
    ]).then(function (m) {
      self.mode = 'sdk';
      self.A = m[0]; self.D = m[1];
      self.appRef = self.A.initializeApp(FB.config);
      self.db = self.D.getDatabase(self.appRef);
      self.base = self._basePath();
    }).catch(function (err) {
      /* gstatic blocked (very common on school wi-fi). The database itself
         is usually still reachable over plain REST on its own domain. */
      console.warn('Firebase SDK could not load, falling back to REST:', err);
      return fetch(self._url('/meta'), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('REST reachability check failed: ' + r.status);
        self.mode = 'rest';
        self.base = self._basePath();
        FB_FELL_BACK = true;
      });
    });
    return this._p;
  },

  _get: function (p) {
    return fetch(this._url(p) + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  },
  _put: function (p, v) {
    return fetch(this._url(p), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v)
    }).catch(function () {});
  },
  _post: function (p, v) {
    return fetch(this._url(p), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v)
    }).catch(function () {});
  },
  _del: function (p) {
    return fetch(this._url(p), { method: 'DELETE' }).catch(function () {});
  },

  /* poll a node and fire cb whenever its contents change */
  _watch: function (p, cb, ms) {
    var self = this, last = null;
    var tick = function () {
      self._get(p).then(function (v) {
        if (v == null) return;
        var s = JSON.stringify(v);
        if (s !== last) { last = s; cb(v); }
      });
    };
    tick();
    setInterval(tick, ms || 900);
  },

  hostInit: function (onAction) {
    var self = this;
    return this._load().then(function () {
      if (self.mode === 'sdk') {
        var D = self.D;
        return D.set(D.ref(self.db, self.base + '/actions'), null).then(function () {
          D.onChildAdded(D.ref(self.db, self.base + '/actions'), function (snap) {
            var v = snap.val();
            D.remove(snap.ref);
            if (v) onAction(v);
          });
          D.set(D.ref(self.db, self.base + '/meta'), { created: Date.now() });
        });
      }
      /* REST: clear the queue, then drain it on a short poll */
      return self._del('/actions').then(function () {
        self._put('/meta', { created: Date.now() });
        setInterval(function () {
          self._get('/actions').then(function (kids) {
            if (!kids) return;
            Object.keys(kids).forEach(function (k) {
              self._del('/actions/' + k);
              if (kids[k]) onAction(kids[k]);
            });
          });
        }, 700);
      });
    });
  },

  publish: function (pub) {
    var self = this;
    this._load().then(function () {
      if (self.mode === 'sdk') self.D.set(self.D.ref(self.db, self.base + '/pub'), pub);
      else self._put('/pub', pub);
    });
  },

  publishTimer: function (t) {
    var self = this;
    this._load().then(function () {
      if (self.mode === 'sdk') self.D.set(self.D.ref(self.db, self.base + '/timer'), t);
      else self._put('/timer', t);
    });
  },

  playerInit: function (onPub, onTimer) {
    var self = this;
    return this._load().then(function () {
      if (self.mode === 'sdk') {
        var D = self.D;
        D.onValue(D.ref(self.db, self.base + '/pub'), function (s) { if (s.val()) onPub(s.val()); });
        D.onValue(D.ref(self.db, self.base + '/timer'), function (s) { if (s.val()) onTimer(s.val()); });
        return;
      }
      self._watch('/pub', onPub, 900);
      self._watch('/timer', onTimer, 900);
    });
  },

  send: function (a) {
    var self = this;
    this._load().then(function () {
      if (self.mode === 'sdk') self.D.push(self.D.ref(self.db, self.base + '/actions'), a);
      else self._post('/actions', a);
    });
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
var PLAYER_STALLED = false;
var FB_FELL_BACK = false;

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
   Class vs class: cut each class down to 1, and those two champions face off.

   Two teams is the exception. There is nobody to eliminate, so the bracket
   can't decide the length for you — the host picks how many boards to play
   before the head-to-head final. Every other team count is unchanged. */
function isHeadToHead(teams, classMode) { return !classMode && teams === 2; }

/* What the bracket WOULD take, if left to decide for itself. */
function bracketBoards(teams, classMode, aCount, bCount) {
  if (isHeadToHead(teams, classMode)) return 1;
  /* Duels knock out one team per matchup, so each class halves every round. */
  if (classMode) {
    return Math.max(1, Math.ceil(Math.log(Math.max(2, aCount, bCount)) / Math.log(2)));
  }
  return Math.max(1, Math.ceil((teams - 2) / 2));
}

/* THE HOST'S NUMBER WINS.

   This used to be the bracket's decision at every team count except two:
   the tournament ran however many boards it took to knock the room down
   to a final pair, and the rounds field was greyed out. That made the
   length of a lesson a consequence of how many teams turned up.

   Now `rounds` is null for "let the bracket decide" and a number for "play
   exactly this many". When the host's number is shorter than the bracket
   needs, the boards run out with more than two teams still in — and the
   top two by score go to the final. See neededCuts(), which trims to the
   final pair on the last scheduled board. */
function hostSetRounds(rounds) { return rounds !== null && rounds !== undefined && rounds !== ''; }
function boardsNeeded(teams, classMode, aCount, bCount, rounds) {
  if (hostSetRounds(rounds)) {
    return Math.max(1, Math.min(MAX_ROUNDS, parseInt(rounds, 10) || 1));
  }
  return bracketBoards(teams, classMode, aCount, bCount);
}
function cutSize(alive) { return Math.max(0, Math.min(2, alive - 2)); }
function classCutSize(aliveInClass) { return Math.max(0, Math.min(2, aliveInClass - 1)); }

/* The deck remembers which clues have been used. It outlives a single
   tournament on purpose: a class often plays two or three games back to
   back, and a deck that reset each time served the same questions every
   time. `fp` pins the memory to the question file it was built from, so
   editing questions-security.js starts the memory over instead of pointing
   stale indexes at different clues. */
function poolFingerprint() {
  return POOL.length + ':' + POOL.reduce(function (n, c) { return n + c.clues.length; }, 0);
}
function newDeck() {
  var d = { used: {}, cursor: 0, drawn: 0, lused: {}, fp: poolFingerprint() };
  reshuffleCategories(d);
  return d;
}
function loadDeck(saved) {
  if (!saved || saved.fp !== poolFingerprint() || !saved.used) return newDeck();
  saved.drawn = saved.drawn || Object.keys(saved.used).length;
  /* Decks saved before the Lightning Final had a memory get one now, rather
     than being thrown away — a host mid-way through a pool should not lose
     it to an update. */
  saved.lused = saved.lused || {};
  if (!saved.order || saved.order.length !== POOL.length) reshuffleCategories(saved);
  return saved;
}
/* Categories came off the pool in file order, so every game opened on the
   same four. Deal them in a fresh random order each tournament instead. */
function reshuffleCategories(deck) {
  deck.order = shuffled(POOL.map(function (_, i) { return i; }));
  deck.cursor = 0;
}
function deckTotal() {
  return POOL.reduce(function (n, c) { return n + c.clues.length; }, 0);
}

/* Pick one clue per row out of that row's slice of the category's difficulty
   ramp. Clues are authored easiest-first, so with 5 rows band 0 is the
   easiest fifth and band 4 the hardest: the column still climbs 100 to 500,
   but which question fills each row changes from game to game. Taking the
   first N unused clues, as this used to, meant a fresh deck always produced
   the identical board. */
function pickRows(deck, ci, total, nRows) {
  var taken = {}, picks = [];
  for (var row = 0; row < nRows; row++) {
    var lo = Math.floor(row * total / nRows);
    var hi = Math.max(lo + 1, Math.floor((row + 1) * total / nRows));
    var band = [], any = [], k;
    for (k = 0; k < total; k++) {
      if (deck.used[ci + ':' + k] || taken[k]) continue;
      any.push(k);
      if (k >= lo && k < hi) band.push(k);
    }
    var from = band.length ? band : any;              // band spent — borrow anywhere
    if (!from.length) return null;
    var pick = from[Math.floor(Math.random() * from.length)];
    taken[pick] = true;
    picks.push(pick);
  }
  return picks.sort(function (a, b) { return a - b; });   // easy at the top of the column
}

/* Draw one board from the pool. Categories rotate round to round and no
   clue is ever repeated inside a game — or across games, until the pool
   is genuinely spent. */
function drawBoard(deck, nCats, nRows, mult, recycled) {
  if (!POOL.length) return [];
  if (!deck.order || deck.order.length !== POOL.length) reshuffleCategories(deck);
  nCats = Math.min(nCats, POOL.length);
  var board = [], seen = 0;
  while (board.length < nCats && seen < POOL.length) {
    var ci = deck.order[deck.cursor % deck.order.length];
    deck.cursor++; seen++;
    var cat = POOL[ci];
    var picks = pickRows(deck, ci, cat.clues.length, nRows);
    if (!picks) continue;                                 // this category is spent
    picks.forEach(function (k) { deck.used[ci + ':' + k] = true; });
    deck.drawn = (deck.drawn || 0) + picks.length;
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
    deck.used = {}; deck.drawn = 0;
    reshuffleCategories(deck);
    return drawBoard(deck, nCats, nRows, mult, true);
  }
  placeDailyDoubles(board, (board.length * nRows) >= 20 ? 2 : 1);
  return board;
}

/* =====================================================================
   THE ACRONYM POOL

   A second deck, run on exactly the contract the question deck runs on:
   used clues remembered in localStorage, pinned to a fingerprint of the
   file they came from, carried across tournaments, and cleared only when
   the host asks. An acronym is not served twice until the pool is spent.

   The one thing acronyms do NOT have is a difficulty ramp. The question
   bank is authored easiest-first and that ordering IS the 100-to-500 climb
   down a column; nothing equivalent exists for MAC against SD-WAN. So the
   ramp here is the TASK rather than the item:

     cheap rows   EXPAND    — "TCP" -> "Transmission Control Protocol"
     middle rows  IDENTIFY  — a description -> which acronym is it
     dear rows    EXPLAIN   — "TCP" -> what it actually does

   That gives a column that genuinely gets harder, and it means one acronym
   can carry three different clues without ever being repeated inside a
   pool cycle: the deck marks the ACRONYM used, not the form, because "do
   not repeat the acronyms" is the rule that was asked for.
   ===================================================================== */
var AB = window.FACEOFF_ACRONYMS || null;
var ACRO_POOL = (AB && AB.categories) || [];

/* Which of the three forms a row gets. Boards run 3 to 5 rows, so this
   spreads the three bands across whatever height the board is rather than
   assuming five. */
function acroBand(row, nRows) {
  if (nRows <= 1) return 0;
  return Math.min(2, Math.floor(row * 3 / nRows));
}

/* The clue itself, built from the acronym rather than stored beside it.
   `alt` is what the host may also accept — on the cheap rows the acronym
   alone is not enough, on the dear rows an expansion alone is not either,
   and the host screen shows both so the call is consistent between rooms. */
function acroClue(it, band) {
  /* Some acronyms mean two things. Network+ has STP for both Spanning Tree
     Protocol and Shielded Twisted Pair, and both belong in the game — but
     "expand STP" then has two right answers, and a team giving the other
     one would be marked wrong for knowing more. Where the bank flags an
     acronym as ambiguous the clue names the field it wants, and the host
     line says the other reading exists so the call is the same in every
     room. */
  var where = it.amb ? ' (as used in ' + it.amb + ')' : '';
  var note = it.amb ? ['NOTE: "' + it.ac + '" also means something else on this exam — ' +
                       'this clue wants the ' + it.amb + ' one'] : [];
  if (band === 0) {
    return { q: 'Expand this acronym' + where + ': “' + it.ac + '”',
             a: it.ex,
             alt: [it.ex + ' — ' + it.df].concat(note) };
  }
  if (band === 1) {
    return { q: it.df + '  — which acronym is being described?',
             a: it.ac + ' (' + it.ex + ')',
             alt: [it.ac, it.ex] };
  }
  return { q: '“' + it.ac + '”' + where + ' — what does it actually do?',
           a: it.df,
           alt: [it.ex + ' — ' + it.df].concat(note) };
}

function acroFingerprint() {
  return ACRO_POOL.length + ':' + ACRO_POOL.reduce(function (n, c) { return n + c.items.length; }, 0);
}
function acroTotal() {
  return ACRO_POOL.reduce(function (n, c) { return n + c.items.length; }, 0);
}
function newAcroDeck() {
  var d = { used: {}, cursor: 0, drawn: 0, lused: {}, fp: acroFingerprint() };
  reshuffleAcroCategories(d);
  return d;
}
function loadAcroDeck(saved) {
  if (!saved || saved.fp !== acroFingerprint() || !saved.used) return newAcroDeck();
  saved.drawn = saved.drawn || Object.keys(saved.used).length;
  saved.lused = saved.lused || {};
  if (!saved.order || saved.order.length !== ACRO_POOL.length) reshuffleAcroCategories(saved);
  return saved;
}
function reshuffleAcroCategories(deck) {
  deck.order = shuffled(ACRO_POOL.map(function (_, i) { return i; }));
  deck.cursor = 0;
}

/* Unlike the question bank there is no difficulty ordering to respect
   inside a category, so a column is just nRows unused acronyms picked at
   random. Returns null when this category cannot fill a column — the
   caller skips it, which is how a four-entry category quietly sits out a
   five-row board instead of producing a short column. */
function pickAcroRows(deck, ci, total, nRows) {
  var free = [];
  for (var k = 0; k < total; k++) if (!deck.used[ci + ':' + k]) free.push(k);
  if (free.length < nRows) return null;
  var pick = shuffled(free).slice(0, nRows);
  return pick;
}

function drawAcroBoard(deck, nCats, nRows, mult, recycled) {
  if (!ACRO_POOL.length) return [];
  if (!deck.order || deck.order.length !== ACRO_POOL.length) reshuffleAcroCategories(deck);
  nCats = Math.min(nCats, ACRO_POOL.length);
  var board = [], seen = 0;
  while (board.length < nCats && seen < ACRO_POOL.length) {
    var ci = deck.order[deck.cursor % deck.order.length];
    deck.cursor++; seen++;
    var cat = ACRO_POOL[ci];
    var picks = pickAcroRows(deck, ci, cat.items.length, nRows);
    if (!picks) continue;
    picks.forEach(function (k) { deck.used[ci + ':' + k] = true; });
    deck.drawn = (deck.drawn || 0) + picks.length;
    board.push({
      name: cat.name,
      acro: true,
      clues: picks.map(function (k, row) {
        var c = acroClue(cat.items[k], acroBand(row, nRows));
        return { q: c.q, a: c.a, alt: c.alt, obj: '',
                 value: (row + 1) * 100 * mult, done: false, dd: false };
      })
    });
  }
  /* DRAIN THE POOL BEFORE RECYCLING IT.

     Dealing only whole categories meant the board gave up as soon as fewer
     than nCats categories still held a full column, and recycled the entire
     deck — measured, that happened at 96 of 135 acronyms, so more than a
     quarter of the bank was never served before it started repeating. On a
     build whose whole point is "do not repeat until I say so", quietly
     skipping 29% of the content is the bug.

     So the leftovers get pooled: whatever is still unused anywhere fills the
     remaining columns, and only a genuinely empty pool recycles. */
  if (board.length < nCats) {
    var left = [];
    ACRO_POOL.forEach(function (cat, ci) {
      cat.items.forEach(function (it, k) {
        if (!deck.used[ci + ':' + k]) left.push({ ci: ci, k: k, it: it });
      });
    });
    left = shuffled(left);
    while (board.length < nCats && left.length >= nRows) {
      var take = left.splice(0, nRows);
      take.forEach(function (x) { deck.used[x.ci + ':' + x.k] = true; });
      deck.drawn = (deck.drawn || 0) + take.length;
      board.push({
        name: 'ACRONYMS · MIXED BAG',
        acro: true,
        clues: take.map(function (x, row) {
          var c = acroClue(x.it, acroBand(row, nRows));
          return { q: c.q, a: c.a, alt: c.alt, obj: '',
                   value: (row + 1) * 100 * mult, done: false, dd: false };
        })
      });
    }
  }
  if (board.length < nCats && !recycled) {
    deck.used = {}; deck.drawn = 0;
    reshuffleAcroCategories(deck);
    return drawAcroBoard(deck, nCats, nRows, mult, true);
  }
  return board;
}

/* MIXED. Whole acronym categories sitting beside whole question
   categories, roughly a third of the board, never fewer than one and
   never the whole board. Whole columns rather than acronyms scattered
   through the question categories, so a heading still describes what is
   underneath it and the room can see what it is picking. */
function acroShare(nCats) {
  return Math.max(1, Math.min(nCats - 1, Math.round(nCats / 3)));
}

function drawMixedBoard(deck, adeck, nCats, nRows, mult) {
  var nAcro = ACRO_POOL.length ? acroShare(nCats) : 0;
  var acro = nAcro ? drawAcroBoard(adeck, nAcro, nRows, mult) : [];
  var qs = drawBoard(deck, nCats - acro.length, nRows, mult);
  /* Interleave rather than concatenate: two acronym columns bolted onto
     the right-hand end read as an optional annexe, and a team that wants
     to avoid them can. Shuffled together they cannot. */
  var board = shuffled(qs.concat(acro));
  placeDailyDoubles(board, (board.length * nRows) >= 20 ? 2 : 1);
  return board;
}

/* One entry point, so nothing downstream has to know which style is on. */
function drawStyledBoard(style, deck, adeck, nCats, nRows, mult) {
  if (style === 'acronyms') {
    var b = drawAcroBoard(adeck, nCats, nRows, mult);
    placeDailyDoubles(b, (b.length * nRows) >= 20 ? 2 : 1);
    return b;
  }
  if (style === 'mixed') return drawMixedBoard(deck, adeck, nCats, nRows, mult);
  return drawBoard(deck, nCats, nRows, mult);
}

/* The acronym Lightning Final, with the memory the board deck has. The
   question bank's own Lightning has none — it reshuffles every tournament
   and does repeat between games — but "do not repeat the acronyms" was
   asked for plainly, so this one remembers. Dear-row form throughout: by
   the final, expanding letters is not a championship question. */
function drawAcroLightning(deck, n) {
  var all = [];
  ACRO_POOL.forEach(function (cat, ci) {
    cat.items.forEach(function (it, k) { all.push({ ci: ci, k: k, it: it }); });
  });
  if (!all.length) return [];
  /* THE FINAL MUST NOT REPEAT THE BOARD.

     This filtered on `lused` alone, which is the acronyms the FINAL has
     used in previous games. `used` — the acronyms the BOARD has just put
     in front of the room — was not consulted, so a team could meet the
     same acronym twice in one sitting: once for points and again for the
     championship. Both tables are keyed the same way (`ci + ':' + k`), so
     this was one missing condition rather than a missing feature.

     Falling back has an order to it. Running short relaxes the
     cross-game memory first, because repeating a final question from
     LAST week is a small thing; repeating one from the board ten minutes
     ago is the thing that was actually complained about. Only a pool too
     small to fill a final any other way gives that up too. */
  var boardUsed = deck.used || {};
  var free = all.filter(function (x) {
    var key = x.ci + ':' + x.k;
    return !deck.lused[key] && !boardUsed[key];
  });
  if (free.length < n) {
    deck.lused = {};
    free = all.filter(function (x) { return !boardUsed[x.ci + ':' + x.k]; });
  }
  /* STILL short. The final gets SHORTER rather than repeating the board.
     "No board questions in the final" was the requirement, and a
     ten-question final is a smaller disappointment than meeting the same
     acronym twice in one sitting.

     A+ Core 1 and Core 2 share a 202-acronym pool, so a long session can
     genuinely run it down — eight boards of five-by-five is 200 of them.
     That is more than a class plays in one sitting, but it is reachable,
     and reachable is enough to design for.

     The one thing worse than a short final is no final at all, so a pool
     with nothing left is the single case that gives this up. */
  if (!free.length) free = all;
  var take = shuffled(free).slice(0, n);
  take.forEach(function (x) { deck.lused[x.ci + ':' + x.k] = true; });
  return take.map(function (x) {
    var c = acroClue(x.it, 2);
    return { q: c.q, a: c.a, alt: c.alt, obj: '' };
  });
}

/* THE LIGHTNING FINAL, WITH A MEMORY.

   The board deck has remembered its used clues across tournaments from the
   start; the Lightning Final did not. It reshuffled the whole pool every
   game, so a class playing back to back met the same championship questions
   two and three times while the board in front of them never repeated.

   Same rule as everywhere else: take what has not been used, mark it, and
   only start again once the pool is genuinely spent. Reset pool clears this
   along with the board clues, because it is the same pool. */
function drawLightning(deck, n) {
  if (!LIGHTNING.length) return [];
  deck.lused = deck.lused || {};
  var free = [];
  for (var i = 0; i < LIGHTNING.length; i++) if (!deck.lused[i]) free.push(i);
  if (free.length < n) {
    deck.lused = {};
    free = LIGHTNING.map(function (_, i) { return i; });
  }
  var take = shuffled(free).slice(0, n);
  take.forEach(function (i) { deck.lused[i] = true; });
  return take.map(function (i) { return LIGHTNING[i]; });
}

function lightningLeft(deck) {
  if (!LIGHTNING.length) return 0;
  return LIGHTNING.length - Object.keys((deck && deck.lused) || {}).length;
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
  /* falls back to the old shared key once, so an existing host keeps their
     settings the first time they load the namespaced build */
  var saved = lsGet(HOST_KEY, null) || lsGet('fo:host', null);
  var S = {
    room: forcedCode || (saved && saved.room) || roomCode(),
    settings: Object.assign({
      teamCount: 8, teamSize: 5, answerSecs: 15, lightningSecs: 10,
      lengthMinutes: 60, minWager: 100, deduct: false,
      /* sound = the cues. music = the countdown bed, which some rooms
         want off while keeping the buzzer. volume is the whole lot. */
      sound: true, music: true, volume: 0.7,
      /* null means "let the bracket decide". A number means the host has
         said how many boards to play, and that wins over the bracket. */
      rounds: null,
      /* Which pool the board is dealt from. 'normal' is the question bank
         this game shipped with; 'acronyms' is the acronym bank; 'mixed'
         puts whole acronym categories on a question board. Orthogonal to
         classMode on purpose — every style plays solo or class vs class. */
      gameStyle: 'normal',
      classMode: false, classA: 'CLASS A', classB: 'CLASS B'
    }, (saved && saved.settings) || {}),
    phase: 'lobby',
    teams: [],
    deck: loadDeck(saved && saved.deck),
    adeck: loadAcroDeck(saved && saved.adeck),
    tour: null,           /* set when the tournament starts */
    lightning: false,     /* true once the last two teams are heads-up */
    active: null, control: null,
    buzzOrder: [], lockedOut: [], current: null,
    answers: {}, reveal: false, ddWager: null,
    /* the answer key stays covered on the host screen until the host asks
       for it — a projector, a shoulder surfer or a screen share would
       otherwise hand the room the answer the moment the clue opens */
    hostPeek: false,
    timer: { running: false, endsAt: 0, total: 0 },
    settingsOpen: false
  };
  Snd.on = S.settings.sound;
  Snd.music = S.settings.music !== false;      /* older saved settings predate it */
  Snd.setVolume(S.settings.volume == null ? 0.7 : S.settings.volume);
  /* the host's own answer music, if they loaded one on this computer */
  MusicStore.load().then(function (r) {
    if (r && r.blob) Snd.clipSet(r.blob, r.name).then(paintClipRow, function () {});
  });

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
  /* the deck rides along so used clues survive a reload, not just a new
     tournament — a projector that gets refreshed mid-class shouldn't reset
     the class back to question one */
  function persist() {
    lsSet(HOST_KEY, { room: S.room, settings: S.settings, deck: S.deck, adeck: S.adeck });
  }

  /* ---------- publish ---------- */
  function pubState() {
    var q = null;
    if (S.active && ['clue', 'answering', 'judge', 'ddclue', 'ddjudge', 'reveal'].indexOf(S.phase) >= 0) {
      q = { cat: S.active.cat, text: S.active.clue.q, value: S.active.value,
            dd: !!S.active.clue.dd, lightning: !!S.lightning,
            /* the only two teams allowed to buzz on this one */
            duel: duelTeams() };
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
      pairs: (S.tour && S.tour.pairs) || [],
      nextPair: duelsActive() ? nextPair() : null,
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
  /* THE ANSWER CLOCK IS THE BED'S ONLY OWNER.

     Starting the clock starts the music and stopping the clock stops
     it, with no other caller on either side. That is what makes it
     impossible for the bed to play on under the next clue: every way a
     clue can end already runs through stopTimer. */
  function startTimer(secs) {
    S.timer = { running: true, endsAt: Date.now() + secs * 1000, total: secs };
    if (tickHandle) clearInterval(tickHandle);
    var lastWhole = secs;
    Snd.bedStart(secs);
    tickHandle = setInterval(function () {
      var left = S.timer.endsAt - Date.now();
      var whole = Math.ceil(left / 1000);
      /* With the bed on, the last five seconds are already urgent. With
         music switched off they would be silence, so the bare tick
         stands in — nobody should lose the clock because they turned
         the music down. */
      if (whole !== lastWhole && whole > 0 && whole <= 5 && !Snd.music) Snd.cue('tick');
      lastWhole = whole;
      paintTimer();
      /* the think cue's DUM is the time's-up sound when it has just played */
      if (left <= 0) { var landed = Snd.bedLanded(); stopTimer(); if (!landed) Snd.cue('timeUp'); onExpire(); }
    }, 100);
    pubTimer();
  }
  function stopTimer() {
    S.timer.running = false;
    if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
    Snd.bedStop();
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
          /* Only a NEW arrival. A refresh or a rejoin lands in the two
             branches above, and chiming for those would have the room
             pinging every time somebody's screen locks. */
          Snd.cue('join');
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
    if (!inDuel(teamId)) return;                        // this clue belongs to another matchup
    if (S.lockedOut.indexOf(teamId) >= 0) return;
    if (S.buzzOrder.indexOf(teamId) >= 0) return;
    S.buzzOrder.push(teamId);
    if (!S.current) {
      S.current = teamId; S.phase = 'answering'; Snd.cue('buzz'); startTimer(answerSecondsNow());
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
    Snd.cue('wagerLocked');
    startTimer(answerSecondsNow());
    sync();
  }

  /* ---------- host game control ---------- */
  function openClue(c, i) {
    var b = currentBoard();
    if (!b[c] || !b[c].clues[i]) return;
    var cl = b[c].clues[i];
    if (cl.done) return;
    S.active = { c: c, i: i, cat: b[c].name, clue: cl, value: cl.value, pair: null };
    S.answers = {}; S.buzzOrder = []; S.lockedOut = []; S.current = null; S.reveal = false; S.ddWager = null;
    S.hostPeek = false;

    /* Hand this clue to the next matchup in the rotation. Rotating per clue
       rather than pre-assigning tiles keeps the duels even however the host
       picks around the board. */
    if (duelsActive()) {
      S.active.pair = nextPair();
      S.tour.pairCursor = (S.tour.pairCursor || 0) + 1;
    }

    if (cl.dd) {
      /* In duel mode the Daily Double belongs to the matchup, so control is
         settled here instead of blocking on the host picking a team. */
      if (duelsActive()) {
        var d = duelTeams() || [];
        if (S.control && d.indexOf(S.control) >= 0) { /* keep it */ }
        else S.control = d.slice().sort(function (x, y) { return bestFirst(team(x), team(y)); })[0] || null;
      }
      if (!S.control) { flash('Pick which team has control first (click a team card)', 'bad'); S.active = null; return; }
      S.phase = 'ddwager'; Snd.cue('dailyDouble');
    } else {
      S.phase = 'clue';
      Snd.cue('clueOpen');
    }
    sync();
  }
  function judge(correct) {
    var val = S.active.value;
    var isDDp = (S.phase === 'ddclue' || S.phase === 'ddjudge');
    var who = isDDp ? S.control : S.current;
    var t = team(who); if (!t) return;
    if (correct) {
      t.score += val; t.right = (t.right || 0) + 1;
      Snd.cue('correct'); Snd.cue('pointsUp');
      if (!S.lightning) { S.control = who; S.active.clue.done = true; }
      S.reveal = true; S.phase = 'reveal'; stopTimer();
    } else {
      Snd.cue('wrong');
      t.wrong = (t.wrong || 0) + 1;
      if (S.settings.deduct) { t.score -= val; Snd.cue('pointsDown'); }
      if (isDDp) {                                    // no steal on a Daily Double
        if (!S.lightning) S.active.clue.done = true;
        S.reveal = true; S.phase = 'reveal'; stopTimer();
      } else {
        S.lockedOut.push(who);
        delete S.answers[who];
        S.current = null;
        S.buzzOrder = S.buzzOrder.filter(function (x) { return x !== who; });
        /* A steal only ever opens to teams eligible for this clue — in duel
           mode that is the other half of the matchup, not the whole room. */
        var eligible = duelTeams() ? duelTeams().map(team).filter(Boolean) : aliveTeams();
        var remaining = eligible.filter(function (x) { return S.lockedOut.indexOf(x.id) < 0; });
        if (remaining.length) {
          /* Two different things just happened to two different teams:
             one is shut out of this clue, and the clue is live again for
             somebody else. They get their own sounds. */
          Snd.cue('lockout');
          S.phase = 'clue'; stopTimer();
          Snd.cue('steal');
          if (S.lightning) startTimer(S.settings.lightningSecs);
          flash(S.lightning ? 'Open to the other finalist'
                : duelTeams() ? 'STEAL — open to ' + esc(remaining[0].name)
                : 'STEAL — open to all other teams', 'bad');
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
  /* Uncover the answer key on the host screen only — the clue stays live and
     the players' devices learn nothing. Toggles, so the host can check the
     key and immediately put it away again. */
  function peekAnswer() {
    if (!S.active) return;
    S.hostPeek = !S.hostPeek; render();
  }
  function backToBoard() {
    S.active = null; S.reveal = false; S.answers = {}; S.hostPeek = false;
    S.buzzOrder = []; S.lockedOut = []; S.current = null; stopTimer();
    if (S.lightning) { nextLightning(); return; }
    S.phase = 'board';
    sync();
    if (roundCleared()) { Snd.cue('roundClear'); endRound(); }
  }
  /* Redeal every student who has joined across the teams at random. Deals
     round-robin out of a shuffled pool so team sizes stay within one of each
     other, and starts dealing at a random team so Team 1 isn't always the one
     that gets the extra student. Captains go to whoever lands first on each
     team. Students' phones follow their member id, so they just see their new
     team appear — nobody has to rejoin. */
  function shuffleMembers() {
    if (S.phase !== 'lobby') return;
    var pool = [];
    S.teams.forEach(function (t) { pool = pool.concat(t.members); });
    if (pool.length < 2) { flash('Need at least two students to shuffle', 'bad'); return; }
    pool = shuffled(pool);
    S.teams.forEach(function (t) { t.members = []; t.captain = null; });

    /* never leave a student without a seat: if the room is over capacity the
       cap stretches rather than dropping somebody off the roster */
    var cap = Math.max(S.settings.teamSize, Math.ceil(pool.length / S.teams.length));
    var order = shuffled(S.teams.slice());
    var i = 0;
    pool.forEach(function (m) {
      var tries = 0;
      while (order[i % order.length].members.length >= cap && tries <= order.length) { i++; tries++; }
      var t = order[i % order.length];
      t.members.push(m);
      if (!t.captain) t.captain = m.id;
      i++;
    });
    Snd.tick();
    flash('Teams reshuffled', 'good');
    sync();
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

  /* ---------- class vs class: head-to-head duels ---------- */
  /* Class mode is a cross-class knockout. Every team left in one class is
     matched against a team in the other, each clue belongs to one of those
     matchups, and only the two teams in it may buzz. The loser of each
     matchup goes out at the end of the round, so both classes halve together
     down to one champion each — who then meet in the Lightning Final.
     The Lightning Final is already two teams, so duels stop there. */
  function duelMode() { return S.settings.classMode && !S.lightning; }
  /* Duels need a live team on both sides. If one class sweeps a round the
     other is wiped out entirely — there is nobody left to match against, so
     the survivors play it out among themselves down to the last two. */
  function duelsActive() { return duelMode() && fullPairs().length > 0; }

  /* Re-paired at the start of every round: best left in A against best left
     in B, second against second, and so on, so the matchups stay level as
     the field shrinks. An odd team out draws a BYE — it sits the round out
     and cannot be eliminated, the usual bracket convention. */
  function bestFirst(a, b) { return -worstFirst(a, b); }
  function makePairs() {
    if (!duelMode()) { S.tour.pairs = []; S.tour.pairCursor = 0; return; }
    var A = aliveInClass('A').slice().sort(bestFirst);
    var B = aliveInClass('B').slice().sort(bestFirst);
    var pairs = [], n = Math.max(A.length, B.length);
    for (var i = 0; i < n; i++) {
      pairs.push({ a: A[i] ? A[i].id : null, b: B[i] ? B[i].id : null });
    }
    S.tour.pairs = pairs;
    S.tour.pairCursor = 0;
  }
  function pairList() { return (S.tour && S.tour.pairs) || []; }
  function fullPairs() {
    return pairList().filter(function (p) { return p.a && p.b; });
  }
  function pairOf(teamId) {
    return pairList().filter(function (p) { return p.a === teamId || p.b === teamId; })[0] || null;
  }
  /* teams allowed to buzz on the clue that is open */
  function duelTeams() {
    if (!duelMode() || !S.active || !S.active.pair) return null;
    var p = S.active.pair;
    return [p.a, p.b].filter(function (id) { return id && isAlive(id); });
  }
  function inDuel(teamId) {
    var d = duelTeams();
    return !d || d.indexOf(teamId) >= 0;
  }
  /* the matchup the next clue will belong to */
  function nextPair() {
    var f = fullPairs();
    if (!f.length) return null;
    return f[(S.tour.pairCursor || 0) % f.length];
  }
  function pairLabel(p) {
    if (!p) return '';
    var a = p.a && team(p.a), b = p.b && team(p.b);
    if (!a || !b) return esc((a || b) ? (a || b).name : '') + ' — BYE';
    return esc(a.name) + ' vs ' + esc(b.name);
  }

  function startTournament() {
    var plan = lengthPlan(S.settings.lengthMinutes);
    /* Keep the used-clue memory — only the category order is redealt. This
       is what stops a second tournament replaying the first one. */
    reshuffleCategories(S.deck);
    reshuffleAcroCategories(S.adeck);
    S.teams.forEach(function (t) { t.score = 0; t.right = 0; t.wrong = 0; });
    autoSplitClasses();
    S.tour = {
      stage: 0,
      totalBoards: boardsNeeded(S.teams.length, S.settings.classMode,
                                teamsInClass('A').length, teamsInClass('B').length,
                                S.settings.rounds),
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
    S.tour.board = drawStyledBoard(S.settings.gameStyle, S.deck, S.adeck,
                                   plan.cats, plan.rows, S.tour.stage + 1);
    persist();                    /* remember what this board just used up */
    makePairs();                  /* re-seed the A-vs-B matchups for this round */
    S.phase = 'board';
    Snd.cue('boardReveal');
    S.active = null; S.reveal = false;
    S.buzzOrder = []; S.lockedOut = []; S.current = null; S.answers = {};
    stopTimer(); sync();
  }

  /* how many go out of each class (or overall, in solo mode) this round */
  function neededCuts() {
    /* Duels: exactly one team out of every full matchup. A bye survives. */
    if (duelsActive()) {
      var n = { A: 0, B: 0 };
      fullPairs().forEach(function (p) {
        var loser = duelLoser(p);
        if (loser) n[classOf(team(loser))]++;
      });
      return n;
    }
    /* LAST SCHEDULED BOARD, and more teams still in than a final can hold.
       The host said how long this game runs, so the field is trimmed
       straight to two rather than the game running on to satisfy the
       bracket. In class vs class that means one finalist per class where
       both classes still have somebody — the whole point of that mode is
       a champion from each side, and an early finish should not quietly
       turn it into two teams from the same class. */
    if (hostSetRounds(S.settings.rounds) && roundsSpent() && aliveTeams().length > 2) {
      if (S.settings.classMode) {
        var ca = aliveInClass('A').length, cb = aliveInClass('B').length;
        if (ca && cb) return { A: Math.max(0, ca - 1), B: Math.max(0, cb - 1) };
        return { A: ca ? aliveTeams().length - 2 : 0, B: cb ? aliveTeams().length - 2 : 0 };
      }
      return { A: aliveTeams().length - 2 };
    }
    if (!S.settings.classMode) return { A: cutSize(aliveTeams().length) };
    var na = aliveInClass('A').length, nb = aliveInClass('B').length;
    /* One class has been swept, so there is no second champion to crown.
       The survivors are just a field now — trim to the last two and let
       those two contest the final. classCutSize aims at one champion per
       class and would overshoot here, leaving a final with a single team. */
    if (!na || !nb) {
      var trim = cutSize(aliveTeams().length);
      return { A: na ? trim : 0, B: nb ? trim : 0 };
    }
    return { A: classCutSize(na), B: classCutSize(nb) };
  }
  /* Who loses a matchup: fewer points, then the record tiebreakers the
     bracket already used. Returns null once a class is down to a champion. */
  function duelLoser(p) {
    var a = p.a && team(p.a), b = p.b && team(p.b);
    if (!a || !b || !isAlive(a.id) || !isAlive(b.id)) return null;
    return worstFirst(a, b) <= 0 ? a.id : b.id;
  }
  function duelDefaultCuts() {
    return fullPairs().map(duelLoser).filter(Boolean);
  }
  function totalNeededCuts() {
    var n = neededCuts();
    return (n.A || 0) + (n.B || 0);
  }

  function headToHead() { return isHeadToHead(S.teams.length, S.settings.classMode); }
  /* Every scheduled board has been played. */
  function roundsSpent() {
    return !S.tour || (S.tour.stage + 1) >= S.tour.totalBoards;
  }
  function bracketDone() {
    /* Two teams: nothing to eliminate, so the bracket ends on rounds played. */
    if (headToHead()) return roundsSpent();
    /* THE HOST'S ROUND COUNT WINS. When the boards are spent, the
       tournament is over — neededCuts() has already trimmed the field to
       the final two on this board, so there is a proper final to play. */
    if (hostSetRounds(S.settings.rounds) && roundsSpent() && aliveTeams().length <= 2) return true;
    if (S.settings.classMode) {
      var na = aliveInClass('A').length, nb = aliveInClass('B').length;
      /* one class swept clean — no champion to crown on that side, so run
         the survivors down to two and let those two have the final */
      if (!na || !nb) return aliveTeams().length <= 2;
      return na <= 1 && nb <= 1;
    }
    return aliveTeams().length <= 2;
  }

  /* end of a board: propose the bottom teams of each class for elimination */
  function endRound() {
    if (S.lightning) return;
    if (bracketDone()) { startLightning(); return; }
    var need = neededCuts(), cut = [];
    if (duelsActive()) {
      cut = duelDefaultCuts();                 /* the loser of each matchup */
    } else {
      Object.keys(need).forEach(function (c) {
        var pool = (S.settings.classMode ? aliveInClass(c) : aliveTeams()).slice().sort(worstFirst);
        cut = cut.concat(pool.slice(0, need[c]).map(function (t) { return t.id; }));
      });
    }
    /* Nobody to eliminate but the bracket isn't finished — that's the
       head-to-head game partway through its rounds. Straight to the next
       board, no elimination screen. */
    if (!cut.length) { S.tour.stage++; dealBoard(); return; }
    S.tour.cut = cut;
    S.phase = 'cut';
    stopTimer(); sync();
  }

  function toggleCut(id) {
    if (S.phase !== 'cut' || !isAlive(id)) return;
    /* In a duel the two outcomes are linked: marking one team out puts its
       opponent through. Toggling them independently could only ever produce
       an invalid cut. */
    if (duelsActive()) {
      var p = pairOf(id);
      if (!p || !p.a || !p.b) return;                 /* a bye can't be cut */
      S.tour.cut = S.tour.cut.filter(function (x) { return x !== p.a && x !== p.b; });
      S.tour.cut.push(id);
      sync(); return;
    }
    var i = S.tour.cut.indexOf(id);
    if (i >= 0) S.tour.cut.splice(i, 1);
    else S.tour.cut.push(id);
    sync();
  }

  function applyCut() {
    var need = neededCuts();
    /* Duels: exactly one team out of each matchup, no more, no fewer. The
       host can flip which one, but can't take both or neither. */
    if (duelsActive()) {
      var bad = fullPairs().filter(function (p) {
        var n = (S.tour.cut.indexOf(p.a) >= 0 ? 1 : 0) + (S.tour.cut.indexOf(p.b) >= 0 ? 1 : 0);
        return n !== 1;
      });
      if (bad.length) {
        flash('Each matchup sends exactly one team out — check ' + pairLabel(bad[0]), 'bad');
        return;
      }
    } else if (S.settings.classMode) {
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
    Snd.cue('eliminated');
    if (bracketDone()) { startLightning(); return; }
    S.tour.stage++;
    dealBoard();
  }

  /* ---------- lightning final ---------- */
  function startLightning() {
    S.lightning = true;
    /* Acronym games finish on acronyms. Mixed games finish on the question
       bank, because the mixed board has already had its acronym columns. */
    S.tour.lq = (S.settings.gameStyle === 'acronyms' && ACRO_POOL.length)
      ? drawAcroLightning(S.adeck, Math.max(S.tour.lqTotal, 1))
      : drawLightning(S.deck, Math.max(S.tour.lqTotal, 1));
    persist();                    /* the acronym final spends pool too */
    S.tour.lqAsked = 0;
    S.tour.board = [];
    S.control = null;
    S.phase = 'board';
    Snd.cue('finalStart');
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
    S.hostPeek = false;
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
    Snd.cue('winner');
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
    /* A knockout can run long if one class sweeps a round, so the estimate
       stretches rather than showing "Round 4 of 2". */
    return 'Round ' + (S.tour.stage + 1) + ' of ' + Math.max(S.tour.totalBoards, S.tour.stage + 1);
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
          '<button class="btn' + (total < 2 ? ' ghost' : '') + '" data-act="shuffle"' +
            (total < 2 ? ' disabled' : '') + ' title="Randomly redeal every student across the teams">' +
            '🔀 Shuffle members</button>' +
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

  /* The matchup card rail: every A-vs-B duel this round, with the one the
     next clue belongs to lit up. Without this the host has no way to know
     whose clue is coming, and the room can't see the bracket. */
  function duelStrip() {
    if (!duelsActive()) return '';
    var up = nextPair(), f = fullPairs();
    return '<div class="duelstrip">' +
      '<div class="dshead">Matchups <span>' + f.length + ' duel' + (f.length === 1 ? '' : 's') +
        ' · clues rotate in order</span></div>' +
      '<div class="dsrow">' + pairList().map(function (p) {
        var a = p.a && team(p.a), b = p.b && team(p.b);
        var live = up && p === up;
        if (!a || !b) {
          var solo = a || b;
          return '<div class="dscard bye"><span class="dsn">' + esc(solo ? solo.name : '') + '</span>' +
            '<span class="dsvs">BYE</span></div>';
        }
        return '<div class="dscard' + (live ? ' live' : '') + '">' +
          '<span class="dsn" style="border-color:' + a.color + '">' + esc(a.name) + '</span>' +
          '<span class="dsvs">vs</span>' +
          '<span class="dsn" style="border-color:' + b.color + '">' + esc(b.name) + '</span>' +
          (live ? '<span class="dsup">UP NEXT</span>' : '') +
        '</div>';
      }).join('') + '</div>' +
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
      duelStrip() +
      scoreStrip() +
      '<div class="row" style="justify-content:center">' +
        '<button class="btn' + (roundCleared() ? ' primary' : ' ghost sm') + '" data-act="endround">' +
          (roundCleared() ? 'Board cleared — go to eliminations →' : 'End this round early') + '</button>' +
        '<button class="btn ghost sm" data-act="new">New tournament</button>' +
        '<span class="hint">Keys: <b>' + buzzKeyHint() + '</b> buzz · <b>Y</b>/<b>N</b> judge · <b>A</b> reveal answer · <b>Space</b> continue</span>' +
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
    if (!S.buzzOrder.length && !S.lockedOut.length) {
      var d = duelTeams();
      return '<div class="queue"><span class="hint">' +
        (d && d.length ? 'Waiting on ' + d.map(function (id) { return esc(team(id).name); }).join(' or ')
                       : 'Waiting for a buzz…') + '</span></div>';
    }
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
      /* whose clue this is — nobody else can buzz on it */
      (A.pair ? '<div class="duelnow">' + pairLabel(A.pair) +
        '<span> · only these two can buzz</span></div>' : '') +
      '<div class="qbox"><div class="qtext">' + esc(cl.q) + '</div></div>' +
      /* While a team is still working the clue the host sees the question and
         the clock, nothing else. Keystrokes were never sent anyway — the old
         "typing…" placeholder just implied they were. The panel appears the
         moment an answer is actually submitted. */
      (isLive || isJudge ?
        '<div class="row" style="align-items:stretch">' +
          (isLive ? '<div class="timer">' + ringHTML() + '</div>' : '') +
          '<div style="flex:1;min-width:260px">' +
            (ans || isJudge ?
              '<div class="subans' + (ans ? '' : ' empty') + '" style="height:100%">' +
                '<div class="who">' + (who ? esc(who.name) : '') + (ans && ans.by ? ' — typed by ' + esc(ans.by) : '') + '</div>' +
                '<div class="txt">' + (ans ? esc(ans.text) : 'No answer submitted — time expired') + '</div>' +
              '</div>'
            : '<div class="awaiting">' + (who ? esc(who.name) : 'The team') +
              ' is on the clock — their answer appears here once they submit it.</div>') +
          '</div>' +
        '</div>' : '') +
      (isDD ? '' : queueHTML()) +
      '<div class="row">' +
        (isLive || isJudge ?
          '<button class="btn good lg" data-act="ok">✓ Correct <span style="opacity:.7;font-size:13px">(Y)</span></button>' +
          '<button class="btn bad lg" data-act="no">✕ Incorrect <span style="opacity:.7;font-size:13px">(N)</span></button>' : '') +
        '<div class="spacer"></div>' +
        '<button class="btn" data-act="show">Show answer &amp; move on</button>' +
      '</div>' +
      scoreStrip() +
      /* Answer key stays covered until the host clicks Reveal. */
      '<div class="hostans' + (S.hostPeek ? '' : ' hidden') + '">' +
        '<span class="lbl">Host only —</span> ' +
        (S.hostPeek
          ? '<b>' + esc(cl.a) + '</b>' +
            (cl.alt && cl.alt.length ? '<span style="opacity:.7"> &nbsp;·&nbsp; also accept: ' + esc(cl.alt.join(' / ')) + '</span>' : '') +
            '<button class="btn sm" data-act="peek">🙈 Hide answer</button>'
          : '<span class="masked">answer hidden</span>' +
            '<button class="btn sm" data-act="peek">👁 Reveal answer</button>') +
      '</div>' +
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

  /* one half of a matchup row — clicking it sends that team out and puts
     its opponent through */
  function cutSide(t) {
    var doomed = S.tour.cut.indexOf(t.id) >= 0;
    return '<div class="rankrow' + (doomed ? ' doomed' : ' safe') + '" data-cut="' + t.id + '">' +
      '<span class="dot" style="background:' + t.color + '"></span>' +
      '<b class="nm">' + esc(t.name) + '</b>' +
      '<span class="rec">' + (t.right || 0) + '<i>✓</i> ' + (t.wrong || 0) + '<i>✗</i></span>' +
      '<span class="sc">' + fmt(t.score) + '</span>' +
      '<span class="tag">' + (doomed ? 'OUT' : 'ADVANCES') + '</span>' +
    '</div>';
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
    /* Duels: one row per matchup, so the room reads it as "this team beat
       that team" instead of two separate league tables. */
    if (duelsActive()) {
      anyTie = fullPairs().some(function (p) { return trulyLevel(team(p.a), team(p.b)); });
      columns = '<div class="cutcol duels">' + pairList().map(function (p) {
        var a = p.a && team(p.a), b = p.b && team(p.b);
        if (!a || !b) {
          var solo = a || b;
          if (!solo) return '';
          return '<div class="duelrow bye"><div class="dside">' + cutSide(solo) +
            '</div><div class="dmid">BYE</div><div class="dside"><span class="byetxt">no opponent — advances</span></div></div>';
        }
        return '<div class="duelrow">' +
          '<div class="dside">' + cutSide(a) + '</div>' +
          '<div class="dmid">' + (a.score === b.score ? 'LEVEL' : 'vs') + '</div>' +
          '<div class="dside right">' + cutSide(b) + '</div>' +
        '</div>';
      }).join('') + '</div>';
    } else if (S.settings.classMode) {
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
          (duelsActive()
            ? (anyTie
                ? '<b style="color:var(--royal-yellow)">DEAD HEAT</b> — a matchup is level on points AND record. Click the team you want out.'
                : 'Every matchup sends exactly one team out — the lower score. Click a team to flip its matchup.')
            : anyTie
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
                              half, S.settings.teamCount - half, S.settings.rounds);
    var h2h = isHeadToHead(S.settings.teamCount, S.settings.classMode);
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
        /* Only two teams means no eliminations, so the bracket can't work out
           the length on its own — the host says how many boards to play. It
           stays visible (greyed) at other team counts so it's findable, rather
           than a field that appears out of nowhere when you drop to 2. */
        /* Always editable now, at every team count and in every style.
           Empty means "let the bracket decide" and the placeholder shows
           what that would be, so the host can see the default without it
           being imposed. Typing a number overrides it. */
        '<div><label class="fld">Rounds before the final' +
          ' <span class="fldnote">— blank = auto (' + bracketBoards(S.settings.teamCount,
              S.settings.classMode, half, S.settings.teamCount - half) + ')</span>' +
          '</label><input id="setRounds" type="number" min="1" max="' + MAX_ROUNDS +
          '" placeholder="auto" value="' +
          (hostSetRounds(S.settings.rounds) ? S.settings.rounds : '') + '"></div>' +
      '</div>' +
      /* WHAT KIND OF GAME. Sits above Class vs Class because it is the
         bigger choice and because the two are independent — every style
         plays either way round. */
      (function () {
        var st = S.settings.gameStyle || 'normal';
        var have = ACRO_POOL.length > 0;
        function opt(v, label, note, on) {
          return '<label class="stylepick' + (st === v ? ' on' : '') + (on ? '' : ' off') + '">' +
            '<span class="stylepick__t">' +
              '<input type="radio" name="gstyle" value="' + v + '"' +
                (st === v ? ' checked' : '') + (on ? '' : ' disabled') + '>' +
              '<b>' + label + '</b></span>' +
            '<span class="stylepick__n">' + note + '</span></label>';
        }
        return '<div style="margin-top:16px"><label class="fld">What are we playing?</label>' +
          '<div class="stylerow">' +
            opt('normal', 'Normal', fmt(deckTotal()) + ' exam clues', true) +
            opt('acronyms', 'Acronyms', have ? fmt(acroTotal()) + ' acronyms' : 'no acronym file loaded', have) +
            opt('mixed', 'Mixed', have ? 'acronym columns on a normal board' : 'needs the acronym file', have) +
          '</div>' +
          (have ? '' : '<div class="hint" style="margin-top:6px">' +
            'Add <span class="mono">acronyms-security.js</span> to enable the other two styles.</div>') +
        '</div>';
      })() +
      '<div class="row" style="margin-top:13px">' +
        '<label><input type="checkbox" id="setClass"' + (S.settings.classMode ? ' checked' : '') + '> <b>Class vs Class</b> — split the teams into two classes</label>' +
      '</div>' +
      (S.settings.classMode ? '<div class="grid2" style="margin-top:10px">' +
        '<div><label class="fld">First class name</label><input id="setClsA" type="text" maxlength="18" value="' + esc(S.settings.classA) + '"></div>' +
        '<div><label class="fld">Second class name</label><input id="setClsB" type="text" maxlength="18" value="' + esc(S.settings.classB) + '"></div>' +
      '</div>' : '') +
      '<div class="row" style="margin-top:13px;gap:20px">' +
        '<label><input type="checkbox" id="setDeduct"' + (S.settings.deduct ? ' checked' : '') + '> Deduct points for a wrong answer</label>' +
      '</div>' +
      /* SOUND, WITH THE ROOM IN MIND.

         Two switches rather than one, because the buzzer and the
         countdown music are wanted in different amounts — a room next
         to another class often wants the cues and not the bed. And a
         Test button, so the level gets set against the actual speakers
         before thirty students walk in rather than during the first
         clue. */
      '<div class="notice" style="margin-top:13px">' +
        '<div class="row" style="gap:20px;flex-wrap:wrap">' +
          '<label><input type="checkbox" id="setSound"' + (S.settings.sound ? ' checked' : '') + '> <b>Sound effects</b> — buzzer, right, wrong, Daily Double</label>' +
          '<label><input type="checkbox" id="setMusic"' + (S.settings.music !== false ? ' checked' : '') + '> <b>Countdown music</b> — runs the whole answer clock</label>' +
        '</div>' +
        '<div class="row" style="gap:12px;margin-top:10px;align-items:center;flex-wrap:wrap">' +
          '<label class="fld" for="setVol" style="margin:0">Volume</label>' +
          '<input id="setVol" type="range" min="0" max="100" step="5" style="flex:1;min-width:180px" ' +
            'value="' + Math.round((S.settings.volume == null ? 0.7 : S.settings.volume) * 100) + '">' +
          '<span class="mono" id="setVolNum">' + Math.round((S.settings.volume == null ? 0.7 : S.settings.volume) * 100) + '%</span>' +
          '<button class="btn" data-act="testsnd" type="button">Test sounds</button>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:13px">Turning the music off leaves a plain tick on the last five seconds, ' +
          'so the clock is never silent. The game\'s own sounds are generated in the browser.</div>' +
        /* the host's own think music: starts on the buzzer, stretched to
           the seconds to answer, kept on this computer only */
        clipRowHtml() +
        '<div style="margin-top:6px;font-size:13px">It starts the moment a team buzzes and is stretched to fit the ' +
          'seconds to answer, ending as the clock hits zero. The file stays in this browser on this computer: ' +
          'it is never uploaded, and it works in every Face Off game here.</div>' +
      '</div>' +
      '<div class="notice" style="margin-top:13px">' +
        '<b>Room:</b> ' + (S.settings.teamCount * S.settings.teamSize) + ' students (' +
          S.settings.teamCount + ' teams × ' + S.settings.teamSize + ')' +
          (S.settings.classMode ? ' — <b>' + half + ' teams vs ' + (S.settings.teamCount - half) + ' teams</b>' : '') + '.<br>' +
        '<b>Bracket:</b> <span id="brBoards">' + boards + ' board' + (boards === 1 ? '' : 's') + '</span> of ' + plan.cats + ' × ' + plan.rows +
          (h2h
            ? ' head-to-head — no eliminations with only two teams — then a ' + plan.lightning +
              '-question Lightning Final. Change <b>Rounds before the final</b> to play more or fewer boards.'
            : S.settings.classMode
            ? ' — every team is matched <b>one against one</b> across the classes, best vs best, ' +
              'and only the two teams in a matchup may buzz on its clue. The loser of each matchup ' +
              'goes out, so both classes halve each round down to one champion apiece. Then a ' +
              plan.lightning + '-question Lightning Final: ' + esc(S.settings.classA) + ' vs ' + esc(S.settings.classB) + '.'
            : ', dropping the bottom 2 each round, then a ' + plan.lightning +
              '-question Lightning Final between the last two.') +
        /* A host-set count shorter than the bracket is not a mistake, but
           it does change what happens at the end, and the host should
           know before the room finds out. */
        (function () {
          if (!hostSetRounds(S.settings.rounds)) return '';
          var auto = bracketBoards(S.settings.teamCount, S.settings.classMode,
                                   half, S.settings.teamCount - half);
          if (boards >= auto || h2h) return '';
          return '<br><br><b>Short game:</b> the bracket would take ' + auto + ' boards to reach a final. ' +
            'On board ' + boards + ' the field is cut straight to the top two by score' +
            (S.settings.classMode ? ' — one from each class — ' : ' ') + 'and they play the final.';
        })() +
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
      /* Used clues carry over between tournaments, so the host needs to see
         how much of the pool is left and be able to put it all back. */
      (function () {
        var used = Math.min(S.deck.drawn || 0, deckTotal()), all = deckTotal();
        var pct = all ? Math.round(used / all * 100) : 0;
        return '<div class="notice" style="margin-top:10px">' +
          '<div class="row" style="gap:10px">' +
            '<div style="flex:1;min-width:200px"><b>Question pool:</b> ' + fmt(all - used) +
              ' of ' + fmt(all) + ' clues still unused (' + (100 - pct) + '%)' +
              (LIGHTNING.length
                ? ', and ' + fmt(lightningLeft(S.deck)) + ' of ' + fmt(LIGHTNING.length) +
                  ' Lightning Final questions'
                : '') + '.<br>' +
              '<span style="opacity:.75">Used clues carry over between tournaments, so back-to-back ' +
              'games don\'t repeat \u2014 the Lightning Final included. Reset when you want to start ' +
              'the whole pool over.</span></div>' +
            '<button class="btn sm ghost" data-act="resetpool">Reset pool</button>' +
          '</div>' +
          '<div class="poolbar"><i style="width:' + pct + '%"></i></div>' +
        '</div>';
      })() +
      /* The acronym pool gets the same meter and the same button. Separate
         memory and separate reset: a host who has worn out the acronyms
         should be able to put those back without also handing the class a
         question bank it has already seen. */
      (function () {
        if (!ACRO_POOL.length) return '';
        var used = Math.min(S.adeck.drawn || 0, acroTotal()), all = acroTotal();
        var pct = all ? Math.round(used / all * 100) : 0;
        return '<div class="notice" style="margin-top:10px">' +
          '<div class="row" style="gap:10px">' +
            '<div style="flex:1;min-width:200px"><b>Acronym pool:</b> ' + fmt(all - used) +
              ' of ' + fmt(all) + ' acronyms still unused (' + (100 - pct) + '%).<br>' +
              '<span style="opacity:.75">Used in Acronyms and Mixed games alike, so an acronym ' +
              'seen on a mixed board will not come back in an acronym game either. Reset when ' +
              'you want the whole set back.</span></div>' +
            '<button class="btn sm ghost" data-act="resetacro">Reset acronyms</button>' +
          '</div>' +
          '<div class="poolbar"><i style="width:' + pct + '%"></i></div>' +
        '</div>';
      })() +
      '<div class="row" style="margin-top:16px"><button class="btn primary" data-act="saveset">Save</button>' +
        '<button class="btn ghost" data-act="closeset">Cancel</button></div>' +
    '</div></div>';
  }

  /* Largest font size at which the whole clue still fits the space it has.
     Long clues on a short window would otherwise be clipped, and a clue the
     room can't finish reading is worse than a small one. */
  function fitClue() {
    var box = $('.qbox'), t = $('.qtext');
    if (!box || !t) return;
    /* clientHeight INCLUDES padding — measuring against it overshoots by a
       whole line, which is what kept clipping the last line of long clues */
    var cs = getComputedStyle(box);
    var avail = box.clientHeight - parseFloat(cs.paddingTop || 0)
                                 - parseFloat(cs.paddingBottom || 0) - 2;
    var lo = 12, hi = 76, best = lo, mid, i;
    for (i = 0; i < 14; i++) {
      mid = (lo + hi) / 2;
      t.style.fontSize = mid + 'px';
      /* measure the TEXT against the BOX — t.scrollHeight only reports the
         text overflowing itself, which it never does, so it always passed */
      if (t.getBoundingClientRect().height <= avail) { best = mid; lo = mid; }
      else { hi = mid; }
    }
    t.style.fontSize = best.toFixed(1) + 'px';
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
    fitClue();
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var el;
    if ((el = e.target.closest('[data-clue]'))) {
      var p = el.getAttribute('data-clue').split(','); openClue(+p[0], +p[1]); return;
    }
    if ((el = e.target.closest('[data-adj]'))) {
      e.stopPropagation();
      var t = team(el.getAttribute('data-adj'));
      var d = parseInt(el.getAttribute('data-d'), 10);
      t.score += d;
      Snd.cue(d < 0 ? 'pointsDown' : 'pointsUp');
      sync(); return;
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
        /* greyed out at 3+ teams — leave the stored value alone there */
        if ($('#setRounds') && !$('#setRounds').disabled) {
          /* Blank hands the decision back to the bracket. */
          var rv = ($('#setRounds').value || '').trim();
          S.settings.rounds = rv === '' ? null
            : Math.max(1, Math.min(MAX_ROUNDS, parseInt(rv, 10) || 1));
        }
        S.settings.deduct = $('#setDeduct').checked;
        S.settings.sound = $('#setSound').checked; Snd.on = S.settings.sound;
        if ($('#setMusic')) { S.settings.music = $('#setMusic').checked; Snd.music = S.settings.music; }
        if ($('#setVol')) {
          S.settings.volume = Math.max(0, Math.min(1, (parseInt($('#setVol').value, 10) || 0) / 100));
          Snd.setVolume(S.settings.volume);
        }
        /* A bed playing while the host saves "music off" would carry on
           to the end of the clue, which is exactly the sort of thing
           that makes a setting look broken. */
        if (!Snd.on || !Snd.music) Snd.bedStop();
        S.settings.classMode = $('#setClass').checked;
        /* Which pool we are dealing from. Falls back to the question bank
           rather than to whatever was checked, so a build shipped without an
           acronym file cannot be left pointing at an empty pool. */
        var gs = document.querySelector('input[name="gstyle"]:checked');
        var want = gs ? gs.value : 'normal';
        if ((want === 'acronyms' || want === 'mixed') && !ACRO_POOL.length) want = 'normal';
        S.settings.gameStyle = want;
        if ($('#setClsA')) S.settings.classA = ($('#setClsA').value || 'CLASS A').slice(0, 18);
        if ($('#setClsB')) S.settings.classB = ($('#setClsB').value || 'CLASS B').slice(0, 18);
        makeTeams(S.settings.teamCount); persist(); S.settingsOpen = false; sync(); break;
      case 'clippick':
        var fi = $('#setClip'); if (fi) { fi.value = ''; fi.click(); } break;
      case 'clipclear':
        Snd.clipClear(); MusicStore.clear(); flash('Answer music removed: the built-in countdown plays'); paintClipRow(); break;
      case 'testsnd':
        /* Tests what is ON SCREEN, not what was last saved, so dragging
           the slider and pressing Test does what the host expects. */
        Snd.on = $('#setSound') ? $('#setSound').checked : Snd.on;
        Snd.music = $('#setMusic') ? $('#setMusic').checked : Snd.music;
        if ($('#setVol')) Snd.setVolume((parseInt($('#setVol').value, 10) || 0) / 100);
        Snd.test();
        break;
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
      case 'ok':      judge(true); break;
      case 'no':      judge(false); break;
      case 'show':    revealNow(); break;
      case 'peek':    peekAnswer(); break;
      case 'shuffle': shuffleMembers(); break;
      case 'resetacro':
        if (!confirm('Put all ' + fmt(acroTotal()) + ' acronyms back in the pool?\n\n' +
                     'Games will start drawing acronyms your classes have already had.')) break;
        S.adeck = newAcroDeck();
        persist();
        flash('Acronym pool reset — all ' + fmt(acroTotal()) + ' back in play');
        render();
        break;

      case 'resetpool':
        if (!confirm('Put all ' + fmt(deckTotal()) + ' questions back in the pool?\n\n' +
                     'Games will start drawing questions your classes have already had.')) break;
        S.deck = newDeck(); persist(); render();
        flash('Question pool reset — all ' + fmt(deckTotal()) + ' clues available', 'good');
        break;
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
    if ((e.key === 'a' || e.key === 'A') && S.active) { peekAnswer(); e.preventDefault(); return; }
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
  /* The rest of the settings modal only catches up on Save, but the round
     count exists purely to change the sentence underneath it — a summary
     still reading "1 board" while the box says 3 looks broken. */
  /* The chosen card has to light up the moment it is clicked. The class is
     rendered from the SAVED setting, so until Save was pressed the old
     choice and the new one both looked selected — on a projector, in front
     of a class, with no way to tell which one the game would actually use. */
  app.addEventListener('change', function (e) {
    if (e.target.id === 'setClip') {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      Snd.clipSet(f, f.name).then(function (secs) {
        MusicStore.save(f, f.name).catch(function () { flash('Loaded, but this browser would not keep it for next time', 'bad'); });
        flash('Answer music loaded: ' + f.name + ' (' + Math.round(secs) + ' s)'); paintClipRow();
      }, function () { flash('That file could not be played. Try an MP3 or WAV.', 'bad'); });
      return;
    }
    if (e.target.name !== 'gstyle') return;
    var picks = document.querySelectorAll('.stylepick');
    for (var i = 0; i < picks.length; i++) {
      var input = picks[i].querySelector('input[name="gstyle"]');
      picks[i].classList.toggle('on', !!(input && input.checked));
    }
  });
  app.addEventListener('input', function (e) {
    if (e.target.id === 'setVol') {
      /* Live, so the host hears the change while the slider moves
         instead of having to save and reopen to find out. */
      var pc = parseInt(e.target.value, 10) || 0;
      Snd.setVolume(pc / 100);
      var out = $('#setVolNum'); if (out) out.textContent = pc + '%';
      return;
    }
    if (e.target.id !== 'setRounds') return;
    /* Blank means auto, so the preview has to fall back to what the
       bracket would take rather than showing 1. The field is never
       disabled now, so the old disabled guard would never have fired
       anyway. */
    var raw = (e.target.value || '').trim();
    var half2 = Math.ceil(S.settings.teamCount / 2);
    var n = raw === ''
      ? bracketBoards(S.settings.teamCount, S.settings.classMode, half2, S.settings.teamCount - half2)
      : Math.max(1, Math.min(MAX_ROUNDS, parseInt(raw, 10) || 1));
    var el = $('#brBoards');
    if (el) el.textContent = n + ' board' + (n === 1 ? '' : 's') + (raw === '' ? ' (auto)' : '');
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', fitClue);

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
  var KEY = 'fo:me:' + GAME_ID + ':' + code + (seat ? ':' + seat : '');
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

  /* Firebase deletes empty arrays and objects on the way in, so a team with
     nobody on it comes back with no `members` key, an all-empty board comes
     back with no `alive`, and so on. Put back what the database dropped
     before any view tries to read it. */
  function normalizePub(p) {
    if (!p) return p;
    if (!p.teams) p.teams = [];
    for (var i = 0; i < p.teams.length; i++) {
      if (!p.teams[i]) p.teams[i] = {};
      if (!p.teams[i].members) p.teams[i].members = [];
    }
    if (!p.alive) p.alive = [];
    if (!p.buzzOrder) p.buzzOrder = [];
    if (!p.lockedOut) p.lockedOut = [];
    return p;
  }
  /* Whatever is half-typed in the answer box belongs to the clue that was on
     screen when it was typed. When the host moves on, drop it — otherwise a
     team that ran out of time on one question opens the next one with the old
     answer sitting in the box, and submits it by reflex. */
  var lastClueSig = '';
  function clueSig(p) {
    return p && p.q ? [p.q.cat, p.q.value, p.q.text].join('') : '';
  }
  function onPub(p) {
    P = normalizePub(p);
    var sig = clueSig(P);
    if (sig !== lastClueSig) { lastClueSig = sig; draft.answer = ''; }
    render();
  }
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
        var mem = t.members || [];
        var full = mem.length >= cap && !mem.some(function (m) { return m.id === me.memberId; });
        return '<button class="slot' + (me.teamId === t.id ? ' sel' : '') + '" data-team="' + t.id + '"' + (full ? ' disabled' : '') + '>' +
          '<div class="bar" style="background:' + t.color + '"></div>' +
          '<div class="n">' + esc(t.name) + '</div>' +
          '<div class="c">' + mem.length + '/' + cap + (full ? ' · FULL' : '') + '</div></button>';
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
    /* Class vs class runs as duels: a clue belongs to one A-vs-B matchup and
       the rest of the room sits it out. Say so on the button rather than
       leaving students mashing a buzzer the host is ignoring. */
    var duel = (P.q && P.q.duel) || null;
    var myDuel = !duel || duel.indexOf(t.id) >= 0;
    var rival = duel && duel.length === 2
      ? P.teams.filter(function (x) { return duel.indexOf(x.id) >= 0 && x.id !== t.id; })[0] : null;

    var canBuzz = ph === 'clue' && !iAmLocked && !iBuzzed && myDuel;
    var label, cls = 'buzz';
    if (iAmCurrent && (ph === 'answering' || ph === 'judge')) { label = 'YOU\'RE UP'; cls += ' mine'; }
    else if (!myDuel) label = 'NOT YOUR MATCHUP — SIT THIS ONE OUT';
    else if (iAmLocked) label = 'LOCKED OUT — this one\'s gone';
    else if (iBuzzed && ph === 'clue') label = 'BUZZED IN · #' + (pos + 1) + ' in line';
    else if (ph === 'clue') label = rival ? 'BUZZ · vs ' + rival.name.toUpperCase() : 'BUZZ';
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
    } else if (ph === 'clue' && !myDuel) {
      status = 'This clue belongs to another matchup. Yours comes back around next rotation.';
    } else if (ph === 'clue') {
      status = iAmLocked ? 'You already had your shot on this one.'
             : rival ? 'Head-to-head with ' + rival.name + ' — buzz when you know it.'
             : 'Buzz when your team knows it.';
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
        (PLAYER_STALLED && liveMode()
          ? '<div class="fbwarn" style="text-align:left;margin:14px 0"><div class="ic">⚠</div><div>' +
            '<b>This phone can\'t reach the game server.</b><br>' +
            'The room is almost certainly fine — it\'s this device\'s connection. ' +
            'Turn Wi-Fi <b>off</b> and use cellular data, then reload. School Wi-Fi ' +
            'often blocks <span class="mono">gstatic.com</span>, which the game needs.' +
            '</div></div>'
          : '<div class="hint">Make sure your instructor has the host screen open.' +
            (liveMode() ? '' : '<br><br><b>Local mode:</b> this join link only works in another tab on the host computer.') + '</div>') +
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
        /* The student's own handset confirms their tap registered. The
           music and everything else stays on the board — thirty phones
           running countdown music out of sync would be unusable. */
        send({ type: 'buzz', teamId: t.id }); Snd.cue('buzz');
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
  /* Enter submits; Shift+Enter still makes a new line. On a phone keyboard the
     Submit button is often under the keyboard, and students were losing seconds
     dismissing it to find the button. Also covers the name and wager boxes. */
  app.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    var id = e.target.id, btn = null;
    if (id === 'ans')         btn = $('[data-act="answer"]') || $('[data-act="finalanswer"]');
    else if (id === 'myname') btn = $('[data-act="join"]');
    else if (id === 'tname')  btn = $('[data-act="setname"]');
    else if (id === 'wager')  btn = $('[data-act="wager"]') || $('[data-act="finalwager"]');
    if (!btn || btn.disabled || e.target.disabled) return;
    e.preventDefault();
    btn.click();
  });

  render();
  /* If the transport can't connect, say so on the player's screen. Without
     this the promise rejected silently and the student stared at
     "Looking for room …" with no idea why. */
  var gotPub = false;
  T.playerInit(function (p) { gotPub = true; onPub(p); }, onTimer)
    .catch(function (err) {
      console.error(err);
      PLAYER_STALLED = true;
      render();
    });
  /* Nothing errored but nothing arrived either — still worth explaining. */
  setTimeout(function () {
    if (!gotPub) { PLAYER_STALLED = true; render(); }
  }, 9000);
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
