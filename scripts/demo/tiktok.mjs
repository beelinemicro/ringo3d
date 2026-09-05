// Records the vertical (9:16) how-to cut, plus the frame furniture that goes
// around it: the felt background, the burned-in captions, and the end card.
//
//   PORT=8081 node server.js &
//   node scripts/demo/tiktok.mjs OUT_DIR [--cards-only]
//
// The game is recorded at a 520x760 viewport — wide enough that the cube,
// the dice and the button read at arm's length, narrow enough to keep the
// phone layout — and dropped into a 1080x1920 frame with a caption band on
// top and the bottom left clear of TikTok's own interface.
import { chromium } from '/home/steve/blmicrosystems/node_modules/playwright-core/index.mjs';
import { writeFileSync, mkdirSync, renameSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'build/tiktok');
const CARDS_ONLY = process.argv.includes('--cards-only');
mkdirSync(OUT, { recursive: true });
const URL = process.env.RINGO_URL || 'http://127.0.0.1:8081/';
// Playwright only ever scales a recording DOWN to recordVideo.size, so we
// record 1:1 at the viewport and let ffmpeg do the upscale. 640 is the widest
// the phone layout goes (max-width: 640px), which keeps the source as large
// as possible before that 1.4x enlargement into the frame.
const VW = 640, VH = 935;
const FW = 1080, FH = 1920;
const BADGE = 'data:image/png;base64,' + readFileSync('/home/steve/blmicrosystems/public/google-play-badge.png').toString('base64');

// Same forced dice as the landscape cut: You build Sky row 3, Chip takes a
// triple wild you then steal from, and a twist lands on Rose so the line is
// never disturbed. col R0 I1 N2 G3 O4 · row 1→0…5→4 · layer Sky0…Rose4 · 5 = ★
const face = (f) => (f + 0.5) / 6;
const roll = (c, r, l) => [face(c), face(r), face(l)];
const DICE = [
  ...roll(0, 2, 0), ...roll(1, 0, 1), ...roll(1, 2, 0), ...roll(5, 5, 5),
  ...roll(1, 0, 1), ...roll(3, 4, 4), /* twist */ ...roll(4, 0, 3),
  ...roll(2, 2, 0), ...roll(0, 4, 2), ...roll(3, 2, 0), ...roll(1, 4, 2), ...roll(4, 2, 0),
];

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const beats = {};
const t0 = Date.now();

if (!CARDS_ONLY) {
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    recordVideo: { dir: OUT, size: { width: VW, height: VH } },
  });
  await ctx.addInitScript((dice) => {
    // Playwright's screencast drops frames while WebGL warms up, so wall-clock
    // timings don't map onto video time. Each beat flashes a magenta strip
    // across the top of the page; tiktok.py finds those flashes in the file
    // and gets the real times. The strip is cropped off when compositing.
    window.__beat = (name) => {
      let el = document.getElementById('beatmark');
      if (!el) {
        el = document.createElement('div');
        el.id = 'beatmark';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;height:8px;z-index:99999;pointer-events:none;background:transparent';
        document.body.appendChild(el);
      }
      el.style.background = '#ff00ff';
      setTimeout(() => { el.style.background = 'transparent'; }, 240);
      return name;
    };
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

  const page = await ctx.newPage();
  const order = [];
  const beat = async (n) => {
    await page.evaluate((name) => window.__beat(name), n);
    order.push(n);
    beats[n] = Date.now() - t0;
    console.log(`  ${String(beats[n]).padStart(6)}ms  ${n}`);
  };
  const hold = (ms) => page.waitForTimeout(ms);
  const waitVis = (sel, t = 15000) => page.locator(sel).waitFor({ state: 'visible', timeout: t });
  const waitMsg = (re, t = 15000) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.getElementById('message')?.textContent || ''), re.source, { timeout: t });
  const myTurn = () => page.waitForFunction(() => {
    const b = document.getElementById('btn-roll');
    return b && !b.classList.contains('hidden') && !b.disabled && /You:/.test(document.getElementById('message')?.textContent || '');
  }, null, { timeout: 20000 });

  await page.goto(URL);
  await hold(4000); // let the screencast reach full size before anything counts
  await page.click('#btn-mode-ai');
  await hold(400);
  await page.locator('#setup-body .seg button', { hasText: 'Easy' }).first().click().catch(() => {});
  await hold(250);
  await page.click('#btn-setup-go');
  await waitVis('#screen-game');
  await hold(1200);

  // Hook: fan the layers apart in the first second — the most striking thing
  // the game does, and the reason to keep watching.
  await beat('hook');
  await page.click('#btn-explode');
  await hold(3400); // the introducing line runs ~4.5 s; fan for most of it
  await page.click('#btn-explode');
  await hold(800);
  await page.click('#btn-view');
  await hold(700);

  await page.click('#btn-roll'); await beat('roll');
  await waitVis('#btn-place');
  await hold(3600);
  await page.click('#btn-place'); await beat('place');
  await hold(1500);

  // Chip answers, then takes the triple wild
  await myTurn();
  await page.click('#btn-roll');
  await waitVis('#btn-place'); await hold(600);
  await page.click('#btn-place');
  await waitMsg(/WILD/); await beat('wild');
  await hold(2600);

  // …which you promptly steal back
  await myTurn();
  await page.click('#btn-roll');
  await waitMsg(/taken/); await beat('steal');
  await hold(1800);
  await page.click('#btn-place');
  await hold(1600);

  await myTurn();
  await page.click('#btn-twist'); await beat('twist');
  await hold(600);
  await page.locator('#twist-slices button').last().click();
  await hold(1700);
  await page.click('#btn-twist-go');
  await hold(2200);

  for (let i = 0; i < 2; i++) {
    await myTurn();
    await page.click('#btn-roll');
    await waitVis('#btn-place'); await hold(500);
    await page.click('#btn-place');
    await hold(300);
  }

  await myTurn();
  await page.click('#btn-roll'); await beat('win');
  await waitVis('#btn-place'); await hold(1200);
  await page.click('#btn-place');
  await waitVis('#banner', 8000); await beat('ringo');
  await hold(5600); // the close is spoken over the confetti, not a static card
  await beat('end');
  await hold(700); // let the last marker actually reach the file

  console.log('result:', JSON.stringify(await page.evaluate(() => ({
    banner: document.getElementById('banner-text')?.textContent,
    sub: document.getElementById('banner-sub')?.textContent,
    diceLeft: window.__dice.length,
  }))));

  const video = page.video();
  await ctx.close();
  renameSync(await video.path(), `${OUT}/game.webm`);
  writeFileSync(`${OUT}/beats.json`, JSON.stringify({ wall: beats, order }, null, 2));
}

// ---- frame furniture -------------------------------------------------------
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

// the felt the game sits on
await cp.setContent(shell('', RINGS));
await cp.waitForTimeout(900);
await cp.screenshot({ path: `${OUT}/bg.png` });

// captions — transparent PNGs so ffmpeg can drop them on any frame
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
    `<div class="cap">${lines.map(([t, k]) => `<div class="${k}">${t}</div>`).join('')}</div>`,
    true));
  await cp.waitForTimeout(600);
  await cp.screenshot({ path: `${OUT}/cap-${name}.png`, omitBackground: true });
}

// end card
await cp.setViewportSize({ width: FW, height: FH });
await cp.setContent(shell(
  `body{display:flex;align-items:center;justify-content:center;text-align:center}
   .logo{width:230px;height:230px;border-radius:52px;box-shadow:0 24px 60px rgba(0,0,0,.55);margin-bottom:34px}
   h1{font-family:'Lilita One',Fredoka,sans-serif;font-size:132px;margin:0;letter-spacing:.02em;
      text-shadow:0 10px 0 #0d3d27,0 22px 46px rgba(0,0,0,.5)}
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
await cards.close();
await browser.close();
console.log('wrote game.webm, bg.png, captions, card-end.png');
