/* Answer music the host loads: checked by driving the real page.

     node tools/verify-music.mjs           every check must pass
     node tools/verify-music.mjs --plant   every planted defect must be CAUGHT

   Uses a generated 32-second test tone, never a real recording, so the
   check needs nothing the repo doesn't hold. Needs Playwright and
   Chromium (PW and CHROME override where they are).

   What it checks:
     PLAN     the stretch fits every window from 5 s to 120 s: it ends as
              the clock hits zero, at 0.67x to 1.34x
     LOAD     Load answer music… names the file and its length, and leaves
              the rest of the unsaved settings form alone
     KEPT     after a reload the music is still there (this browser only)
     BUZZ     nothing plays while the clue is read; a buzz starts the clip
              at the planned place and speed
     STOP     judging the answer stops it; so does the clock running out
     REMOVE   Remove puts back the built-in think cue
     CUE      the think cue lands its DUM exactly on zero for every window
              from 5 s to 120 s, keeps the clock ticking, plays nothing
              outside the window; 30 s is the whole cue as previewed; a
              buzz with nothing loaded plays it
     RING     when the clock runs out on the DUM it rings and the falling
              time's-up sound is not laid over it; judged before zero, it
              stops at once */
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
/* Local Mode always: the check never touches the real Firebase rooms */
const BASE = { 'firebase-config.js': [['enabled: true', 'enabled: false']] };
function serve(plant) {
  const rewrites = Object.assign({}, BASE); Object.keys(plant || {}).forEach((k) => { rewrites[k] = (rewrites[k] || []).concat(plant[k]); });
  const srv = http.createServer((q, r) => {
    const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html').replace(/^\//, '');
    fs.readFile(path.join(ROOT, rel), (e, b) => {
      if (!e && rewrites && rewrites[rel]) { let t = b.toString(); rewrites[rel].forEach(([a, c]) => { if (t.indexOf(a) < 0) { console.log('PLANT TEXT NOT FOUND: ' + a); process.exit(2); } t = t.split(a).join(c); }); b = Buffer.from(t); }
      r.writeHead(e ? 404 : 200, { 'content-type': TYPES[path.extname(rel)] || 'application/octet-stream' }); r.end(e ? '' : b);
    });
  }).listen(0);
  return { url: 'http://127.0.0.1:' + srv.address().port, close: () => srv.close() };
}
async function launch() {
  const pw = await import(process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs'); const { chromium } = pw.default || pw;
  return chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--headless=new', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
}
/* a 32-second 440 Hz tone, 8 kHz mono 16-bit */
function toneWav(secs) {
  const rate = 8000, n = rate * secs, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000), 44 + i * 2);
  return b;
}

async function run(rewrites) {
  const fails = []; const F = (m) => fails.push(m);
  const s = serve(rewrites), B = await launch(); let pg = null;
  try {
    const ctx = await B.newContext({ viewport: { width: 1400, height: 950 } }); const p = await ctx.newPage(); pg = p;
    p.on('pageerror', (e) => F('PAGE: ' + e.message));
    await p.goto(s.url + '/index.html#/host'); await p.waitForTimeout(600);

    /* PLAN */
    const plans = await p.evaluate(() => { const out = []; for (let W = 5; W <= 120; W++) { const P = window.FACEOFF_SOUND.clipPlan(32, W); out.push([W, P, (32 - P.offset) / P.rate + (P.passes - 1) * 32 / P.rate]); } return out; });
    plans.forEach(([W, P, T]) => {
      if (Math.abs(T - W) > 0.01) F('PLAN: a ' + W + ' s window plays ' + T.toFixed(2) + ' s of music');
      if (P.rate < 0.67 || P.rate > 1.34) F('PLAN: a ' + W + ' s window plays at ' + P.rate.toFixed(2) + 'x');
    });

    /* LOAD, from Game settings, without losing the unsaved form */
    await p.locator('[data-act="settings"]').first().click();
    await p.locator('#setSecs').fill('45');
    if (!/none loaded/.test(await p.locator('#clipRow').innerText())) F('LOAD: the row does not say no music is loaded');
    await p.locator('#setClip').setInputFiles({ name: 'test-tone.wav', mimeType: 'audio/wav', buffer: toneWav(32) });
    await p.waitForFunction(() => window.FACEOFF_SOUND.clipReady(), null, { timeout: 5000 }).catch(() => F('LOAD: the file never became the answer music'));
    await p.waitForTimeout(300);
    const row = await p.locator('#clipRow').innerText().catch(() => '');
    if (!/test-tone\.wav/.test(row) || !/\(32 s\)/.test(row)) F('LOAD: the row does not name the file and its length: ' + row);
    if ((await p.locator('#setSecs').inputValue()) !== '45') F('LOAD: loading the music threw away the unsaved seconds to answer');
    await p.getByRole('button', { name: /^Save/ }).first().click();

    /* KEPT, in this browser */
    await p.reload(); await p.waitForTimeout(600);
    await p.waitForFunction(() => window.FACEOFF_SOUND.clipReady(), null, { timeout: 5000 }).catch(() => F('KEPT: the music was gone after a reload'));

    /* BUZZ: start a game, open a clue, buzz */
    await p.locator('[data-act="start"]').first().click().catch(() => {});
    await p.waitForTimeout(400);
    /* back to the board from a revealed clue, if that's where we are */
    async function toBoard() { const m = p.getByRole('button', { name: /Show answer & move on/ }); if (await m.count()) { await m.first().click(); await p.waitForTimeout(300); }
      const b = p.getByRole('button', { name: /Back to board/ }); if (await b.count()) { await b.first().click(); await p.waitForTimeout(300); } }
    async function openAndBuzz() {
      await p.locator('[data-clue]').filter({ hasText: /\d/ }).first().click(); await p.waitForTimeout(300);
      const before = await p.evaluate(() => { const b = window.FACEOFF_SOUND._bed; return !!b; });
      for (const k of ['1', '2', '3', '4', '5', '6', '7', '8']) { await p.keyboard.press(k); await p.waitForTimeout(80); if (await p.evaluate(() => !!window.FACEOFF_SOUND._bed)) break; }
      await p.waitForTimeout(400);
      return before;
    }
    const playingBefore = await openAndBuzz();
    if (playingBefore) F('BUZZ: music was playing before anybody buzzed');
    const b = await p.evaluate(() => { const S = window.FACEOFF_SOUND, bed = S._bed; return bed && { clip: !!bed.el, paused: bed.el ? bed.el.paused : null, rate: bed.el ? bed.el.playbackRate : 0, t: bed.el ? bed.el.currentTime : 0, plan: bed.plan, pitch: bed.el ? bed.el.preservesPitch : null }; });
    if (!b || !b.clip) F('BUZZ: a buzz did not start the loaded music');
    else {
      if (b.paused) F('BUZZ: the loaded music is not playing after the buzz');
      if (Math.abs(b.rate - b.plan.rate) > 0.001 || Math.abs(b.plan.rate - 32 / 45) > 0.001) F('BUZZ: 45 s to answer should play the 32 s clip at ' + (32 / 45).toFixed(3) + 'x, it plays at ' + b.rate);
      if (b.pitch === false) F('BUZZ: slowed down, the pitch drops');
      if (b.t < 0.1) F('BUZZ: the music is not moving');
    }

    /* STOP: judging stops it */
    await p.keyboard.press('y'); await p.waitForTimeout(400);
    const after = await p.evaluate(() => ({ bed: !!window.FACEOFF_SOUND._bed, paused: window.FACEOFF_SOUND._clipEl ? window.FACEOFF_SOUND._clipEl.paused : true }));
    if (after.bed || !after.paused) F('STOP: the music kept playing after the answer was judged');

    /* STOP: the clock running out stops it (5 s plays the clip's last 5 s) */
    await p.evaluate(() => { const S = window.FACEOFF_SOUND; S.bedStart(1.2); });
    const t1 = await p.evaluate(() => window.FACEOFF_SOUND._bed && window.FACEOFF_SOUND._bed.el ? window.FACEOFF_SOUND._bed.el.currentTime : -1);
    if (t1 < 30) F('STOP: a short window does not start near the end of the clip (' + t1 + ')');
    await p.waitForTimeout(1800);
    if (!(await p.evaluate(() => window.FACEOFF_SOUND._clipEl.paused || window.FACEOFF_SOUND._clipEl.ended))) F('STOP: the clip ran past the end of a short window');
    await p.evaluate(() => window.FACEOFF_SOUND.bedStop());

    /* REMOVE */
    await toBoard(); await p.locator('[data-act="settings"]').first().click();
    await p.locator('[data-act="clipclear"]').click(); await p.waitForTimeout(300);
    if (await p.evaluate(() => window.FACEOFF_SOUND.clipReady())) F('REMOVE: the music is still loaded');
    if (!/none loaded/.test(await p.locator('#clipRow').innerText())) F('REMOVE: the row still names a file');
    await p.evaluate(() => window.FACEOFF_SOUND.bedStart(5));
    if (await p.evaluate(() => { const b = window.FACEOFF_SOUND._bed; return !b || !!b.el; })) F('REMOVE: the generated countdown does not come back');
    await p.evaluate(() => window.FACEOFF_SOUND.bedStop());
    await p.reload(); await p.waitForTimeout(500);
    if (await p.evaluate(() => window.FACEOFF_SOUND.clipReady())) F('REMOVE: the music came back after a reload');

    /* CUE: the built-in think cue, for every window from 5 s to 120 s */
    const sc = await p.evaluate(() => { const S = window.FACEOFF_SOUND, BEAT = 60 / S.CUE_BPM, out = [];
      for (let W = 5; W <= 120; W++) { const r = S.cueScore(W), dums = r.events.filter((e) => e.dum), ticks = r.events.filter((e) => e.k === 'tick');
        let gap = 0; for (let i = 1; i < ticks.length; i++) gap = Math.max(gap, ticks[i].t - ticks[i - 1].t);
        out.push({ W, dum: dums.map((e) => e.t), first: r.events[0].t, last: r.events[r.events.length - 1].t, gap, firstTick: ticks[0].t, BEAT }); }
      const r30 = S.cueScore(30); out.push({ W: 'base', skip: r30.skip, reps: r30.reps, first: r30.events.find((e) => e.k === 'mar').f });
      return out; });
    sc.forEach((x) => {
      if (x.W === 'base') { if (x.skip !== 0 || x.reps !== 1 || Math.abs(x.first - 523.25) > 0.1) F('CUE: 30 s is not the whole cue as previewed (skip ' + x.skip + ', reps ' + x.reps + ')'); return; }
      if (x.dum.length !== 1 || Math.abs(x.dum[0] - x.W) > 1e-6) F('CUE: a ' + x.W + ' s window does not land its DUM on zero (' + x.dum.join(',') + ')');
      if (x.first < -1e-9 || x.last > x.W + 1e-6) F('CUE: a ' + x.W + ' s window plays notes outside the window');
      if (x.gap > x.BEAT + 1e-6 || x.firstTick > x.BEAT + 1e-6) F('CUE: a ' + x.W + ' s window drops the clock tick somewhere');
    });

    /* CUE in the game: 5 seconds to answer, a buzz, and the clock runs out */
    await toBoard(); await p.locator('[data-act="settings"]').first().click();
    await p.locator('#setSecs').fill('5'); await p.getByRole('button', { name: /^Save/ }).first().click(); await p.waitForTimeout(300);
    await p.evaluate(() => { const S = window.FACEOFF_SOUND; window.__cues = []; window.__dum = []; const c = S.cue.bind(S), n = S._cueNote.bind(S);
      S.cue = (x) => { window.__cues.push(x); return c(x); }; S._cueNote = (bed, e, at) => { if (e.dum) window.__dum.push(at - bed.t0); return n(bed, e, at); }; });
    await p.locator('[data-act="start"]').first().click().catch(() => {}); await p.waitForTimeout(300);
    await openAndBuzz();
    const cueOn = await p.evaluate(() => { const b = window.FACEOFF_SOUND._bed; return !!b && !b.el && b.ev.length > 0; });
    if (!cueOn) F('CUE: a buzz with no music loaded does not play the think cue');
    await p.waitForTimeout(5600);
    const end = await p.evaluate(() => ({ cues: window.__cues.slice(), dum: window.__dum.slice(), bed: !!window.FACEOFF_SOUND._bed }));
    if (end.dum.length !== 1 || Math.abs(end.dum[0] - 5) > 0.05) F('CUE: the DUM did not sound at zero in the game (' + end.dum.join(',') + ')');
    if (end.cues.indexOf('timeUp') >= 0) F('RING: the falling time\'s-up sound played over the DUM');
    if (end.bed) F('RING: the cue is still running after the clock ran out');
    /* judged before zero: it stops at once, it does not ring */
    await toBoard(); await p.locator('[data-act="settings"]').first().click();
    await p.locator('#setSecs').fill('20'); await p.getByRole('button', { name: /^Save/ }).first().click(); await p.waitForTimeout(300);
    await openAndBuzz(); await p.waitForTimeout(800);
    const gate = await p.evaluate(() => { window.__gate = window.FACEOFF_SOUND._bed && window.FACEOFF_SOUND._bed.gate; return !!window.__gate; });
    await p.keyboard.press('y'); await p.waitForTimeout(250);
    const g = await p.evaluate(() => window.__gate ? window.__gate.gain.value : 1);
    if (!gate) F('RING: no cue was playing to judge (the buzz did not start it)'); else if (g > 0.01) F('RING: judging the answer did not stop the cue at once (gate ' + g + ')');
  } catch (e) { F('DRIVE: ' + String(e.message).split('\n')[0]); if (process.env.SHOT && pg) await pg.screenshot({ path: process.env.SHOT }).catch(() => {}); }
  finally { await B.close(); s.close(); }
  return fails;
}

const PLANTS = [
  ['PLAN', 'every long window plays the clip once, slowed right down', { 'app.js': [['if (rate < 0.67) { n++; rate = n * L / W; }', 'n = 1; rate = L / W;']] }],
  ['BUZZ', 'the loaded music is ignored', { 'app.js': [['if (this.clipReady()) return this._clipStart(secs);', '']] }],
  ['STOP', 'stopping the clock leaves the music playing', { 'app.js': [['setTimeout(function () { if (Snd._bed && Snd._bed.el === el) return; el.pause(); }, 90);', '']] }],
  ['KEPT', 'the file is never saved in the browser', { 'app.js': [['MusicStore.save(f, f.name).catch(', 'Promise.resolve().catch(']] }],
  ['LOAD', 'loading the music redraws the whole form', { 'app.js': [["flash('Answer music loaded: ' + f.name + ' (' + Math.round(secs) + ' s)'); paintClipRow();", "flash('Answer music loaded'); render();"]] }],
  ['REMOVE', 'Remove forgets to clear the browser copy', { 'app.js': [["Snd.clipClear(); MusicStore.clear();", 'Snd.clipClear();']] }],
  ['CUE', 'the cue always starts from its top, so short windows end early', { 'app.js': [['var total = order.length * BAR, skip = total - secs, ev = [];', 'var total = order.length * BAR, skip = 0, ev = [];']] }],
  ['CUE', 'the middle is never repeated, so long windows go quiet', { 'app.js': [['var reps = Math.max(1, Math.ceil((secs - 15) / 15));', 'var reps = 1;']] }],
  ['RING', "the time's-up sound still plays over the DUM", { 'app.js': [["if (!landed) Snd.cue('timeUp');", "Snd.cue('timeUp');"]] }],
  ['RING', 'every stop rings out, even when judged early', { 'app.js': [['var ring = !!(c && bed.dumAt && c.currentTime >= bed.dumAt - 0.15);', 'var ring = !!(c && bed.dumAt);']] }]
];

if (!process.argv.includes('--plant')) {
  const f = await run(null); f.forEach((x) => console.log('FAIL ' + x));
  console.log(f.length ? f.length + ' failure(s)' : 'PASS — answer music: plan, load, kept, buzz, stop, remove; think cue: cue, ring');
  process.exit(f.length ? 1 : 0);
} else {
  let bad = 0;
  for (const [by, what, rw] of PLANTS) {
    const f = await run(rw), hit = f.filter((x) => x.startsWith(by));
    if (hit.length) console.log('caught  [' + by + '] ' + what + '  ← ' + hit[0]);
    else { bad++; console.log('MISSED  [' + by + '] ' + what + (f.length ? '  (only tripped: ' + f[0] + ')' : '')); }
  }
  console.log(bad ? bad + ' plant(s) missed' : 'PASS — all ' + PLANTS.length + ' plants caught');
  process.exit(bad ? 1 : 0);
}
