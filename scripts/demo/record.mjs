// Records the how-to-play demo from the real game: a scripted You-vs-Chip
// game with exact dice each turn, so every beat lands where the narration
// expects it. Writes the webm, the two cards, and beats.json (name → ms).
//
//   PORT=8081 node server.js &        # serve the game
//   node scripts/demo/record.mjs OUT_DIR
//
// Dice are forced by wrapping Math.random and answering from a queue only
// when rollDice() is on the stack; everything else keeps a seeded stream.
import { chromium } from '/home/steve/blmicrosystems/node_modules/playwright-core/index.mjs';
import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'build/demo');
mkdirSync(OUT, { recursive: true });
const URL = process.env.RINGO_URL || 'http://127.0.0.1:8081/';
const W = 1280, H = 720;

// col: R0 I1 N2 G3 O4 · row: 1→0 … 5→4 · layer: Sky0 Violet1 Mint2 Peach3 Rose4 · 5 = ★
const face = (f) => (f + 0.5) / 6;
const roll = (c, r, l) => [face(c), face(r), face(l)];
// You build Sky row 3 (R3 I3 N3 G3 O3); Chip stays off it, and steals nothing.
const DICE = [
  ...roll(0, 2, 0), // H1  R3 Sky
  ...roll(1, 0, 1), // C1  I1 Violet
  ...roll(1, 2, 0), // H2  I3 Sky
  ...roll(5, 5, 5), // C2  ★★★  (Chip picks a space)
  ...roll(1, 0, 1), // H3  I1 Violet — Chip's ring: steal it
  ...roll(3, 4, 4), // C3  G5 Rose
  //               H4  twist the Rose layer (no roll)
  ...roll(4, 0, 3), // C4  O1 Peach
  ...roll(2, 2, 0), // H5  N3 Sky
  ...roll(0, 4, 2), // C5  R5 Mint
  ...roll(3, 2, 0), // H6  G3 Sky
  ...roll(1, 4, 2), // C6  I5 Mint
  ...roll(4, 2, 0), // H7  O3 Sky — RINGO
];

const CARDS_ONLY = process.argv.includes('--cards-only');
import { readFileSync } from 'node:fs';
const BADGE = 'data:image/png;base64,' + readFileSync('/home/steve/blmicrosystems/public/google-play-badge.png').toString('base64');

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
await ctx.addInitScript((dice) => {
  let s = 11; const q = dice.slice(); window.__dice = q;
  Math.random = function () {
    if (q.length && new Error().stack.includes('rollDice')) return q.shift();
    s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 0.83;
  };
  try {
    localStorage.clear();
    localStorage.setItem('ringoName', 'You');
    localStorage.setItem('ringoDiff', 'easy');
    localStorage.setItem('ringo3dTour', 'done');
    localStorage.setItem('ringo3dNudges', '["wild","steal","twist"]');
  } catch {}
}, DICE);

const beats = {};
const t0 = Date.now();
if (!CARDS_ONLY) {
const page = await ctx.newPage();
const beat = (name) => { beats[name] = Date.now() - t0; console.log(`  ${String(beats[name]).padStart(6)}ms  ${name}`); };
const hold = (ms) => page.waitForTimeout(ms);
const vis = (sel) => page.locator(sel).isVisible();
const waitVis = (sel, t = 15000) => page.locator(sel).waitFor({ state: 'visible', timeout: t });
const waitMsg = (re, t = 15000) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.getElementById('message')?.textContent || ''), re.source, { timeout: t });
const myTurn = () => page.waitForFunction(() => { const b = document.getElementById('btn-roll'); return b && !b.classList.contains('hidden') && !b.disabled && /You:/.test(document.getElementById('message')?.textContent || ''); }, null, { timeout: 20000 });

await page.goto(URL);
beat('intro');
await hold(3600);

// vs Computer, one easy bot
await page.click('#btn-mode-ai');
await hold(400);
await page.locator('#setup-body .seg button', { hasText: 'Easy' }).first().click().catch(() => {});
await hold(300);
await page.click('#btn-setup-go');
await waitVis('#screen-game');
beat('cube');
await hold(3600);

// H1: roll → place
await page.click('#btn-roll'); beat('roll');
await waitVis('#btn-place');
await hold(3400);
await page.click('#btn-place'); beat('place');
await hold(2400);

// look inside, then fan out (Chip takes C1 meanwhile)
await page.locator('#layer-chips button').first().click(); beat('inside');
await hold(3300);
await page.click('#btn-explode'); beat('fan');
await hold(4600);
await page.click('#btn-explode');
await hold(500);
await page.click('#btn-view');
await hold(600);

// H2, then Chip's triple wild
await myTurn();
await page.click('#btn-roll');
await waitVis('#btn-place'); await hold(900);
await page.click('#btn-place');
await waitMsg(/WILD/); beat('wild');
await hold(3800);

// H3: land on Chip's ring and steal it
await myTurn();
await page.click('#btn-roll');
await waitMsg(/taken/); beat('steal');
await hold(2200);
await page.click('#btn-place');
await hold(2600);

// H4: twist the Rose layer
await myTurn();
await page.click('#btn-twist'); beat('twist');
await hold(700);
await page.locator('#twist-slices button').last().click();
await hold(2600);
await page.click('#btn-twist-go');
await hold(2600);

// H5, H6 quickly
for (let i = 0; i < 2; i++) {
  await myTurn();
  await page.click('#btn-roll');
  await waitVis('#btn-place'); await hold(700);
  await page.click('#btn-place');
  await hold(400);
}

// H7: the winning roll
await myTurn();
await page.click('#btn-roll'); beat('win');
await waitVis('#btn-place'); await hold(1500);
await page.click('#btn-place');
await waitVis('#banner', 8000); beat('ringo');
await hold(5200);
beat('end');

const result = await page.evaluate(() => ({
  banner: document.getElementById('banner-text')?.textContent,
  sub: document.getElementById('banner-sub')?.textContent,
  diceLeft: window.__dice.length,
}));
console.log('result:', JSON.stringify(result));

const video = page.video();
await ctx.close();
const vp = await video.path();
renameSync(vp, `${OUT}/game.webm`);
writeFileSync(`${OUT}/beats.json`, JSON.stringify({ ...beats, result }, null, 2));
} else { await ctx.close(); }

// ---- title + end cards (own context, not recorded) --------------------------
const cards = await browser.newContext({ viewport: { width: W, height: H } });
const cp = await cards.newPage();
const shell = (body) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Fredoka:wght@400;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
  body{font-family:Fredoka,system-ui,sans-serif;color:#fbf3df;background:radial-gradient(120% 90% at 50% 40%,#1b6b43 0%,#0d3d27 60%,#071f14 100%);display:flex;align-items:center;justify-content:center;text-align:center}
  h1{font-family:'Lilita One',Fredoka,sans-serif;font-size:118px;margin:0;letter-spacing:.02em;text-shadow:0 8px 0 #0d3d27,0 18px 40px rgba(0,0,0,.5)}
  h1 b{color:#ffd34d}
  p{font-size:36px;margin:18px 0 0;opacity:.92}
  .logo{width:168px;height:168px;border-radius:38px;box-shadow:0 20px 50px rgba(0,0,0,.5);margin-bottom:26px}
  .url{font-size:40px;font-weight:600;margin-top:30px}
  .badge{height:96px;margin-top:26px}
  .ring{position:absolute;border-radius:50%;border:26px solid;opacity:.14;filter:blur(1px)}
</style></head><body>${body}</body></html>`;
const rings = `<div class="ring" style="width:420px;height:420px;left:-120px;top:-100px;border-color:#4fc3ff"></div>
<div class="ring" style="width:300px;height:300px;right:-80px;top:120px;border-color:#ff6fae"></div>
<div class="ring" style="width:360px;height:360px;right:140px;bottom:-160px;border-color:#ffd34d"></div>`;
await cp.setContent(shell(`${rings}<div><img class="logo" src="${URL}icons/icon-512.png"><h1>RINGO <b>3D</b></h1><p>How to play — in ninety seconds</p></div>`));
await cp.waitForTimeout(1500);
await cp.screenshot({ path: `${OUT}/card-title.png` });
await cp.setContent(shell(`${rings}<div><img class="logo" src="${URL}icons/icon-512.png"><h1>RINGO <b>3D</b></h1><div class="url">ringo3d.beelinemicrosystems.com</div><img class="badge" src="${BADGE}"><p style="font-size:26px;opacity:.7;margin-top:22px">Free. No ads, no accounts. Invented by Wendelin Leinweber.</p></div>`));
await cp.waitForTimeout(1500);
await cp.screenshot({ path: `${OUT}/card-end.png` });
await cards.close();
await browser.close();
console.log('wrote', `${OUT}/game.webm`, 'cards, beats.json');
