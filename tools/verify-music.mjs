/* The answer music: the Face Off think cue, checked by driving the real page.

     node tools/verify-music.mjs           every check must pass
     node tools/verify-music.mjs --plant   every planted defect must be CAUGHT

   Needs Playwright and Chromium (PW and CHROME override where they are).

   What it checks:
     GONE     the load-your-own-music button is gone (owner, 9 October
              2026): Game settings has no Load answer music…, the sound
              engine takes no file, and a copy a host loaded before it was
              taken out is cleared from the browser
     CUE      the think cue lands its DUM exactly on zero for every window
              from 5 s to 120 s, keeps the clock ticking, plays nothing
              outside the window; 30 s is the whole cue as previewed;
              nothing plays while the clue is read, and a buzz plays it
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
async function run(rewrites) {
  const fails = []; const F = (m) => fails.push(m);
  const s = serve(rewrites), B = await launch(); let pg = null;
  try {
    const ctx = await B.newContext({ viewport: { width: 1400, height: 950 } }); const p = await ctx.newPage(); pg = p;
    p.on('pageerror', (e) => F('PAGE: ' + e.message));
    await p.goto(s.url + '/index.html#/host'); await p.waitForTimeout(600);

    /* GONE: a copy of a loaded file, left from before, is cleared */
    await p.evaluate(() => new Promise((ok) => { const r = indexedDB.open('fo-answer-music', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('music');
      r.onsuccess = () => { const db = r.result, t = db.transaction('music', 'readwrite'); t.objectStore('music').put({ name: 'old.wav' }, 'answer'); t.oncomplete = () => { db.close(); ok(); }; }; }));
    await p.reload(); await p.waitForTimeout(800);
    const dbs = await p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    if (dbs.indexOf('fo-answer-music') >= 0) F('GONE: a music file loaded before is still kept in the browser');
    /* GONE: no Load answer music… in Game settings, and no way in for a file */
    await p.locator('[data-act="settings"]').first().click(); await p.waitForTimeout(200);
    const modal = await p.locator('.modal').innerText();
    if (/Load answer music|Answer music:/i.test(modal) || await p.locator('#setClip, #clipRow, [data-act="clippick"], [data-act="clipclear"], .modal input[type="file"]').count()) F('GONE: Game settings still offers to load answer music');
    if (await p.evaluate(() => ['clipSet', 'clipReady', '_clipStart', 'clipPlan'].some((k) => k in window.FACEOFF_SOUND))) F('GONE: the sound engine still takes a loaded file');
    if (!/Countdown music/.test(modal) || !(await p.locator('[data-act="testsnd"]').count())) F('GONE: the countdown music switch or Test sounds went with it');
    await p.getByRole('button', { name: /^Save/ }).first().click(); await p.waitForTimeout(300);

    /* back to the board from a clue, wherever it ended */
    async function toBoard() { const m = p.getByRole('button', { name: /Show answer & move on/ }); if (await m.count()) { await m.first().click(); await p.waitForTimeout(300); }
      const b = p.getByRole('button', { name: /Back to board/ }); if (await b.count()) { await b.first().click(); await p.waitForTimeout(300); } }
    /* open an unused clue and buzz; says whether music was already playing */
    async function openAndBuzz() {
      await p.locator('[data-clue]').filter({ hasText: /\d/ }).first().click(); await p.waitForTimeout(300);
      const before = await p.evaluate(() => !!window.FACEOFF_SOUND._bed);
      for (const k of ['1', '2', '3', '4', '5', '6', '7', '8']) { await p.keyboard.press(k); await p.waitForTimeout(80); if (await p.evaluate(() => !!window.FACEOFF_SOUND._bed)) break; }
      await p.waitForTimeout(400);
      return before;
    }

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
    if (await openAndBuzz()) F('CUE: music was playing before anybody buzzed');
    const cueOn = await p.evaluate(() => { const b = window.FACEOFF_SOUND._bed; return !!b && b.ev.length > 0; });
    if (!cueOn) F('CUE: a buzz does not play the think cue');
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
  ['GONE', 'the cleanup of an old loaded file is left out', { 'app.js': [["try { if (window.indexedDB) indexedDB.deleteDatabase('fo-answer-music'); } catch (e) {}", '']] }],
  ['GONE', 'Game settings still shows a Load answer music… button', { 'app.js': [['\'<button class="btn" data-act="testsnd" type="button">Test sounds</button>\' +', '\'<button class="btn" data-act="testsnd" type="button">Test sounds</button><button class="btn" data-act="clippick" type="button">Load answer music…</button>\' +']] }],
  ['CUE', 'the cue always starts from its top, so short windows end early', { 'app.js': [['var total = order.length * BAR, skip = total - secs, ev = [];', 'var total = order.length * BAR, skip = 0, ev = [];']] }],
  ['CUE', 'the middle is never repeated, so long windows go quiet', { 'app.js': [['var reps = Math.max(1, Math.ceil((secs - 15) / 15));', 'var reps = 1;']] }],
  ['RING', "the time's-up sound still plays over the DUM", { 'app.js': [["if (!landed) Snd.cue('timeUp');", "Snd.cue('timeUp');"]] }],
  ['RING', 'every stop rings out, even when judged early', { 'app.js': [['var ring = !!(c && bed.dumAt && c.currentTime >= bed.dumAt - 0.15);', 'var ring = !!(c && bed.dumAt);']] }]
];

if (!process.argv.includes('--plant')) {
  const f = await run(null); f.forEach((x) => console.log('FAIL ' + x));
  console.log(f.length ? f.length + ' failure(s)' : 'PASS — answer music: gone (no loading); think cue: cue, ring');
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
