// Renders the app icon and share images from the real cube renderer.
//
//   cp scripts/showcase.html public/ && PORT=8081 npm start &   # serve the showcase page
//   node scripts/make-assets.mjs build/assets                    # then copy into public/icons, og.png
//   rm public/showcase.html
//
// Drives a headless Chromium (Playwright's cached build) over CDP; edit CHROME
// and the port below for another machine.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import WebSocket from 'ws';
import { mkdirSync } from 'node:fs';
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9370, OUT = process.argv[2] || 'build/assets';
mkdirSync(OUT, { recursive: true });
const chrome = spawn(CHROME, ['--headless', '--no-sandbox', `--remote-debugging-port=${PORT}`, '--hide-scrollbars'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver; for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(100); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl); await new Promise((r) => ws.on('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, (m) => res(m.result ?? m)); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
async function capture(kind, w, h, file, format = 'png') {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url: `http://127.0.0.1:8081/showcase.html?kind=${kind}` }, sessionId);
  for (let i = 0; i < 60; i++) { const r = await send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true }, sessionId); if (r.result?.value) break; await sleep(200); }
  await sleep(300);
  const s = await send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? 88 : undefined }, sessionId);
  writeFileSync(`${OUT}/${file}`, Buffer.from(s.data, 'base64'));
  await send('Target.closeTarget', { targetId });
}
await capture('icon', 512, 512, 'icon-512.png');
await capture('icon', 192, 192, 'icon-192.png');
await capture('icon', 180, 180, 'apple-touch-icon.png');
await capture('icon', 64, 64, 'favicon.png');
await capture('og', 1200, 630, 'og.png');
await capture('og-square', 1200, 1200, 'og-square.png');
console.log('assets captured; errors:', errors.length ? errors : 'none');
ws.close(); chrome.kill();
