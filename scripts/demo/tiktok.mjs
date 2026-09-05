// Renders the vertical (9:16) how-to cut, frame by frame under virtual time
// (see capture.mjs), plus the frame furniture that goes around it: the felt
// background, the burned-in captions, and the end card.
//
//   PORT=8081 node server.js &
//   node scripts/demo/tiktok.mjs OUT_DIR [--cards-only]
//
// The game is captured at 640x934 — the widest the phone layout goes — and
// tiktok.py drops it into a 1080x1920 frame with a caption band on top and
// the bottom left clear of TikTok's own interface.
import { chromium } from '/home/steve/blmicrosystems/node_modules/playwright-core/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { capture } from './capture.mjs';

const OUT = resolve(process.argv[2] || 'build/tiktok');
const CARDS_ONLY = process.argv.includes('--cards-only');
mkdirSync(OUT, { recursive: true });
const URL = process.env.RINGO_URL || 'http://127.0.0.1:8081/';
const VW = 640, VH = 934;
const FW = 1080, FH = 1920;
const BADGE = 'data:image/png;base64,' + readFileSync('/home/steve/blmicrosystems/public/google-play-badge.png').toString('base64');

// Forced dice: You build Sky row 3, Chip takes a triple wild you then steal
// from, and a twist lands on Rose so the line is never disturbed.
// col R0 I1 N2 G3 O4 · row 1→0…5→4 · layer Sky0…Rose4 · 5 = ★
const face = (f) => (f + 0.5) / 6;
const roll = (c, r, l) => [face(c), face(r), face(l)];
const DICE = [
  ...roll(0, 2, 0), ...roll(1, 0, 1), ...roll(1, 2, 0), ...roll(5, 5, 5),
  ...roll(1, 0, 1), ...roll(3, 4, 4), /* twist */ ...roll(4, 0, 3),
  ...roll(2, 2, 0), ...roll(0, 4, 2), ...roll(3, 2, 0), ...roll(1, 4, 2), ...roll(4, 2, 0),
];

if (!CARDS_ONLY) {
  const cap = await capture({
    dir: OUT, width: VW, height: VH, url: URL, initArg: DICE,
    init: (dice) => {
      // Dice come from this queue whenever rollDice() is on the stack; all
      // other randomness stays a seeded stream so the take is repeatable.
      let s = 11; const q = dice.slice(); window.__dice = q;
      Math.random = function () {
        if (q.length && new Error().stack.includes('rollDice')) return q.shift();
        s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 0.83;
      };
      try {
        localStorage.clear();
        localStorage.setItem('ringoName', 'You');
        localStorage.setItem('ringoDiff', 'easy');
        localStorage.setItem('ringo3d.music', 'off');
        localStorage.setItem('ringo3dTour', 'done');
        localStorage.setItem('ringo3dNudges', '["wild","steal","twist"]');
      } catch {}
    },
  });
  const { click, hold, until, beat } = cap;
  const visible = (sel) => until((s) => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && el.offsetParent !== null; }, sel);
  const message = (re) => until((src) => new RegExp(src, 'i').test(document.getElementById('message')?.textContent || ''), re.source);
  const myTurn = () => until(() => { const b = document.getElementById('btn-roll'); return b && !b.classList.contains('hidden') && !b.disabled && /You:/.test(document.getElementById('message')?.textContent || ''); });

  await click('#btn-mode-ai'); await hold(400);
  await cap.evaluate(() => [...document.querySelectorAll('#setup-body .seg button')].find((b) => b.textContent.trim() === 'Easy')?.click());
  await hold(250);
  await click('#btn-setup-go');
  await visible('#screen-game'); await hold(1200);

  // Hook: fan the layers apart in the first second while the intro is spoken.
  beat('hook');
  await click('#btn-explode'); await hold(3400);
  await click('#btn-explode'); await hold(800);
  await click('#btn-view'); await hold(700);

  await click('#btn-roll'); beat('roll');
  await visible('#btn-place'); await hold(3600);
  await click('#btn-place'); beat('place'); await hold(1500);

  // Chip answers, then takes the triple wild…
  await myTurn();
  await click('#btn-roll'); await visible('#btn-place'); await hold(600);
  await click('#btn-place');
  await message(/WILD/); beat('wild'); await hold(2600);

  // …which you steal back
  await myTurn();
  await click('#btn-roll'); await message(/taken/); beat('steal'); await hold(1800);
  await click('#btn-place'); await hold(1600);

  await myTurn();
  await click('#btn-twist'); beat('twist'); await hold(600);
  await cap.evaluate(() => { const b = document.querySelectorAll('#twist-slices button'); b[b.length - 1].click(); });
  await hold(1700);
  await click('#btn-twist-go'); await hold(2200);

  for (let i = 0; i < 2; i++) {
    await myTurn();
    await click('#btn-roll'); await visible('#btn-place'); await hold(500);
    await click('#btn-place'); await hold(300);
  }

  await myTurn();
  await click('#btn-roll'); beat('win');
  await visible('#btn-place'); await hold(1200);
  await click('#btn-place');
  await visible('#banner'); beat('ringo');
  await hold(5600); // the close is spoken over the confetti
  beat('end');

  console.log('  result:', JSON.stringify(await cap.evaluate(() => ({
    banner: document.getElementById('banner-text')?.textContent,
    sub: document.getElementById('banner-sub')?.textContent,
    diceLeft: window.__dice.length,
  }))));
  await cap.finish();
}

// ---- frame furniture (a normal browser; these are plain screenshots) --------
const browser = await chromium.launch({ headless: true });
const cards = await browser.newContext({ viewport: { width: FW, height: FH }, deviceScaleFactor: 1 });
const cp = await cards.newPage();
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Lilita+One&family=Fredoka:wght@400;600&display=swap" rel="stylesheet">`;
const FELT = `radial-gradient(120% 80% at 50% 38%, #1b6b43 0%, #0d3d27 62%, #071f14 100%)`;
const RINGS = `
  <div class="ring" style="width:520px;height:520px;left:-160px;top:-120px;border-color:#4fc3ff"></div>
  <div class="ring" style="width:380px;height:380px;right:-120px;top:520px;border-color:#ff6fae"></div>
  <div class="ring" style="width:460px;height:460px;left:-140px;bottom:180px;border-color:#ffd34d"></div>
  <div class="ring" style="width:300px;height:300px;right:-90px;bottom:-70px;border-color:#30a46c"></div>`;
const RING_CSS = `.ring{position:absolute;border-radius:50%;border:30px solid;opacity:.13;filter:blur(1px)}`;
const shell = (css, body, transparent = false) => `<!doctype html><html><head><meta charset="utf-8">${FONTS}
<style>html,body{margin:0;width:${FW}px;height:100%;overflow:hidden}
body{font-family:Fredoka,system-ui,sans-serif;color:#fbf3df;${transparent ? '' : `background:${FELT};`}}
${RING_CSS}${css}</style></head><body>${body}</body></html>`;

await cp.setContent(shell('', RINGS));
await cp.waitForTimeout(900);
await cp.screenshot({ path: `${OUT}/bg.png` });

// Each line is [text, size]: xl / l / m / s. Gold marks the key word.
const CAPS = {
  hook:  [['INTRODUCING', 's'], ['RINGO <b>3D</b>', 'xl'], ['FIVE IN A ROW THROUGH A CUBE', 's']],
  roll:  [['ROLL THREE DICE', 'l']],
  place: [['PLACE YOUR RING', 'l']],
  wild:  [['★ IS <b>WILD</b>', 'm'], ['GO ANYWHERE', 'm']],
  steal: [['LAND ON A RIVAL?', 'm'], ['<b>STEAL IT</b>', 'm']],
  twist: [['OR <b>TWIST</b> THE CUBE', 'l']],
  win:   [['FIVE IN A ROW WINS', 'l']],
};
const CAP_H = 290;
for (const [name, lines] of Object.entries(CAPS)) {
  await cp.setViewportSize({ width: FW, height: CAP_H });
  await cp.setContent(shell(
    `body{display:flex;align-items:center;justify-content:center;text-align:center}
     .cap{font-family:'Lilita One',Fredoka,sans-serif;line-height:1.04;letter-spacing:.01em;
          text-shadow:0 6px 0 rgba(7,31,20,.85), 0 12px 30px rgba(0,0,0,.6)}
     .xl{font-size:118px} .l{font-size:96px} .m{font-size:78px} .s{font-size:50px;letter-spacing:.06em;opacity:.95}
     b{color:#ffd34d}`,
    `<div class="cap">${lines.map(([t, k]) => `<div class="${k}">${t}</div>`).join('')}</div>`, true));
  await cp.waitForTimeout(600);
  await cp.screenshot({ path: `${OUT}/cap-${name}.png`, omitBackground: true });
}

await cp.setViewportSize({ width: FW, height: FH });
await cp.setContent(shell(
  `body{display:flex;align-items:center;justify-content:center;text-align:center}
   .logo{width:230px;height:230px;border-radius:52px;box-shadow:0 24px 60px rgba(0,0,0,.55);margin-bottom:34px}
   h1{font-family:'Lilita One',Fredoka,sans-serif;font-size:132px;margin:0;letter-spacing:.02em;text-shadow:0 10px 0 #0d3d27,0 22px 46px rgba(0,0,0,.5)}
   h1 b{color:#ffd34d}
   .url{font-size:40px;font-weight:600;margin-top:34px}
   .badge{height:112px;margin-top:34px}
   .note{font-size:30px;opacity:.72;margin-top:30px}`,
  `${RINGS}<div><img class="logo" src="${URL}icons/icon-512.png"><h1>RINGO <b>3D</b></h1>
   <div class="url">ringo3d.beelinemicrosystems.com</div>
   <img class="badge" src="${BADGE}">
   <div class="note">Free. No ads, no accounts.</div></div>`));
await cp.waitForTimeout(1200);
await cp.screenshot({ path: `${OUT}/card-end.png` });
await browser.close();
console.log('  wrote bg.png, captions, card-end.png');
