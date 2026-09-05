// Frame-stepped capture of the game under virtual time.
//
// Real-time screen recording of a WebGL page on a software renderer drops
// frames at random — a two-second freeze mid dice-roll shipped once. So the
// demos are rendered one frame at a time instead: Chromium's old headless
// shell with BeginFrame control, virtual time advanced 40 ms per frame, a
// screenshot per frame. Every frame exists, animations are exactly as smooth
// as the game's own, and every beat is an exact frame number — no drift, no
// markers.
//
//   const cap = await capture({ dir, width, height, url, init });
//   await cap.click('#btn-roll'); cap.beat('roll');
//   await cap.until(() => ...);   await cap.frames(25);
//   await cap.finish();           // encodes dir/game.mp4, writes dir/beats.json
import { chromium } from '/home/steve/blmicrosystems/node_modules/playwright-core/index.mjs';
import { writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

export const FPS = 25;
const DT = 1000 / FPS;

// Playwright launches the full Chromium by default, whose new headless mode
// ignores BeginFrame control; the old headless shell honours it.
const SHELL = readdirSync(process.env.HOME + '/.cache/ms-playwright')
  .filter((d) => d.startsWith('chromium_headless_shell-')).sort().at(-1);
const BIN = `${process.env.HOME}/.cache/ms-playwright/${SHELL}/chrome-headless-shell-linux64/chrome-headless-shell`;

export async function capture({ dir, width, height, url, init, initArg, warmupMs = 2500 }) {
  if (height % 2 || width % 2) throw new Error('width and height must be even for the encoder');
  const frames = `${dir}/frames`;
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: BIN,
    args: ['--deterministic-mode', '--enable-begin-frame-control', '--run-all-compositor-stages-before-draw',
      '--disable-new-content-rendering-timeout', '--disable-threaded-animation', '--disable-threaded-scrolling',
      '--disable-checker-imaging', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width, height } });
  if (init) await ctx.addInitScript(init, initArg);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(url);
  await page.waitForTimeout(warmupMs); // real time: fonts, three.js, first paint
  // virtualTimeTicksBase is the browser's monotonic clock at the moment
  // virtual time began — BeginFrame timestamps must share that base.
  const { virtualTimeTicksBase } = await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });

  let n = 0, ticks = virtualTimeTicksBase;
  const beats = {};
  const t0 = Date.now();

  async function frame() {
    const expired = new Promise((r) => cdp.once('Emulation.virtualTimeBudgetExpired', r));
    await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: DT });
    await expired;
    ticks += DT;
    const res = await cdp.send('HeadlessExperimental.beginFrame', {
      frameTimeTicks: ticks, interval: DT, noDisplayUpdates: false, screenshot: { format: 'jpeg', quality: 92 },
    });
    if (!res.screenshotData) throw new Error(`frame ${n}: no screenshot (hasDamage=${res.hasDamage})`);
    writeFileSync(`${frames}/${String(n).padStart(5, '0')}.jpg`, Buffer.from(res.screenshotData, 'base64'));
    n++;
  }

  return {
    page,
    /** Advance k frames (k/25 s of video). */
    frames: async (k) => { for (let i = 0; i < k; i++) await frame(); },
    /** Advance ~ms of video. */
    hold: async (ms) => { for (let i = 0; i < Math.round(ms / DT); i++) await frame(); },
    /** Plain DOM click — Playwright's own click waits on animation frames, which don't come unasked here. */
    click: (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('missing ' + s); el.click(); }, sel),
    /** Step frames until the page-side predicate holds. */
    until: async (pred, arg, maxFrames = 25 * 30) => {
      for (let i = 0; i < maxFrames; i++) { if (await page.evaluate(pred, arg)) return i; await frame(); }
      throw new Error('until(): predicate never became true');
    },
    /** Mark the current frame. */
    beat: (name) => { beats[name] = n / FPS; console.log(`  ${beats[name].toFixed(2).padStart(6)}s  ${name}`); },
    now: () => n / FPS,
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    /** Encode the frames and write the beat sheet. */
    finish: async ({ keepFrames = false } = {}) => {
      await browser.close();
      execSync(`ffmpeg -v error -y -framerate ${FPS} -i ${frames}/%05d.jpg -c:v libx264 -preset fast -crf 16 -pix_fmt yuv420p ${dir}/game.mp4`);
      writeFileSync(`${dir}/beats.json`, JSON.stringify({ fps: FPS, frames: n, beats }, null, 2));
      if (!keepFrames) rmSync(frames, { recursive: true, force: true });
      console.log(`  ${n} frames = ${(n / FPS).toFixed(1)}s of video, rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      return { beats, frames: n };
    },
  };
}
