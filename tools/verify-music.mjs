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
     REMOVE   Remove puts back the generated countdown */
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
  const s = serve(rewrites), B = await launch();
  try {
    const ctx = await B.newContext({ viewport: { width: 1400, height: 950 } }); const p = await ctx.newPage();
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
    async function openAndBuzz() {
      await p.locator('[data-clue]').first().click(); await p.waitForTimeout(300);
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
    await p.keyboard.press('Space').catch(() => {}); await p.waitForTimeout(200);
    await p.locator('[data-act="settings"]').first().click();
    await p.locator('[data-act="clipclear"]').click(); await p.waitForTimeout(300);
    if (await p.evaluate(() => window.FACEOFF_SOUND.clipReady())) F('REMOVE: the music is still loaded');
    if (!/none loaded/.test(await p.locator('#clipRow').innerText())) F('REMOVE: the row still names a file');
    await p.evaluate(() => window.FACEOFF_SOUND.bedStart(5));
    if (await p.evaluate(() => { const b = window.FACEOFF_SOUND._bed; return !b || !!b.el; })) F('REMOVE: the generated countdown does not come back');
    await p.evaluate(() => window.FACEOFF_SOUND.bedStop());
    await p.reload(); await p.waitForTimeout(500);
    if (await p.evaluate(() => window.FACEOFF_SOUND.clipReady())) F('REMOVE: the music came back after a reload');
  } catch (e) { F('DRIVE: ' + String(e.message).split('\n')[0]); }
  finally { await B.close(); s.close(); }
  return fails;
}

const PLANTS = [
  ['PLAN', 'every long window plays the clip once, slowed right down', { 'app.js': [['if (rate < 0.67) { n++; rate = n * L / W; }', 'n = 1; rate = L / W;']] }],
  ['BUZZ', 'the loaded music is ignored', { 'app.js': [['if (this.clipReady()) return this._clipStart(secs);', '']] }],
  ['STOP', 'stopping the clock leaves the music playing', { 'app.js': [['setTimeout(function () { if (Snd._bed && Snd._bed.el === el) return; el.pause(); }, 90);', '']] }],
  ['KEPT', 'the file is never saved in the browser', { 'app.js': [['MusicStore.save(f, f.name).catch(', 'Promise.resolve().catch(']] }],
  ['LOAD', 'loading the music redraws the whole form', { 'app.js': [["flash('Answer music loaded: ' + f.name + ' (' + Math.round(secs) + ' s)'); paintClipRow();", "flash('Answer music loaded'); render();"]] }],
  ['REMOVE', 'Remove forgets to clear the browser copy', { 'app.js': [["Snd.clipClear(); MusicStore.clear();", 'Snd.clipClear();']] }]
];

if (!process.argv.includes('--plant')) {
  const f = await run(null); f.forEach((x) => console.log('FAIL ' + x));
  console.log(f.length ? f.length + ' failure(s)' : 'PASS — answer music: plan, load, kept, buzz, stop, remove');
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
