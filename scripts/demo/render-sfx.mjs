// Renders each of the game's synthesised sound effects to a WAV, using the
// game's own sound.js against an OfflineAudioContext, so the demo videos
// carry exactly the sounds a player hears.
//
//   PORT=8081 node server.js &
//   node scripts/demo/render-sfx.mjs OUT_DIR
import { chromium } from '/home/steve/blmicrosystems/node_modules/playwright-core/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'build/sfx');
mkdirSync(OUT, { recursive: true });
const URL = process.env.RINGO_URL || 'http://127.0.0.1:8081/';
const SECONDS = 2.5; // longest effect (the win fanfare) is ~1.4 s

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript((secs) => {
  // sound.js does `new AudioContext()` once and caches it; hand it an offline
  // context instead. Its resume() would reject before rendering starts.
  window.AudioContext = class {
    constructor() {
      const c = new OfflineAudioContext(2, Math.round(44100 * secs), 44100);
      c.resume = () => Promise.resolve();
      return c;
    }
  };
  window.webkitAudioContext = window.AudioContext;
}, SECONDS);

const page = await ctx.newPage();
await page.goto(URL + 'js/sound.js'); // any same-origin page; we only need the module
const names = await page.evaluate(async () => Object.keys((await import('/js/sound.js')).sfx));
for (const name of names) {
  const p = await ctx.newPage();
  await p.goto(URL + 'js/sound.js');
  const b64 = await p.evaluate(async (n) => {
    const m = await import('/js/sound.js');
    m.sfx[n]();
    const buf = await m.context().startRendering();
    // PCM16 stereo WAV
    const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
    const bytes = 44 + len * ch * 2;
    const dv = new DataView(new ArrayBuffer(bytes));
    const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    w(36, 'data'); dv.setUint32(40, len * ch * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]));
      dv.setInt16(o, v < 0 ? v * 32768 : v * 32767, true); o += 2;
    }
    let s = ''; const u8 = new Uint8Array(dv.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, name);
  writeFileSync(`${OUT}/${name}.wav`, Buffer.from(b64, 'base64'));
  await p.close();
}
await browser.close();
console.log(`  rendered ${names.length} effects: ${names.join(', ')}`);
