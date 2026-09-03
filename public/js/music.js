// The music bed — a hypnotic, mind-sharpening loop (see scripts/make-music.py)
// played through Web Audio so the loop is sample-accurate. The file holds
// [1 s silence] + loop + [the loop's first seconds again]; looping between
// 1.5 s and 1.5 s + LOOP_SECONDS lands on identical audio at both ends, so
// any MP3 decoder delay cancels out and the seam is inaudible.
//
// Plays from the first tap on the landing page and carries on into the
// game. Off switches: the ♫ buttons on the menu and in the game header
// (remembered), and the sound mute silences it too.

import { context, isMuted } from './sound.js';

const FILE = 'audio/mind.mp3';
const LOOP_SECONDS = 95;
const LOOP_START = 1.5;
const LEVEL = 0.3;
const KEY = 'ringo3dMusic';

let buffer = null;
let loading = null;
let source = null;
let gain = null;
let wanted = localStorage.getItem(KEY) !== 'off';

export function musicEnabled() {
  return wanted;
}

export function setMusicEnabled(on) {
  wanted = on;
  localStorage.setItem(KEY, on ? 'on' : 'off');
  if (on) start();
  else stop();
}

async function load(ctx) {
  if (buffer) return buffer;
  if (!loading) {
    loading = fetch(FILE)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((b) => { buffer = b; return b; })
      .catch(() => { loading = null; return null; });
  }
  return loading;
}

// Start (or resume) the bed if music is wanted and sound isn't muted. Call
// it from a user gesture the first time (browsers insist). Fades in;
// repeated calls are harmless.
let starting = false;
export async function start() {
  if (!wanted || isMuted() || source || starting) return;
  const ctx = context();
  if (!ctx) return;
  // Resume synchronously, inside the gesture, before any awaiting.
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* needs a gesture */ } }
  starting = true;
  const buf = await load(ctx);
  starting = false;
  if (!buf || source || !wanted || isMuted() || ctx.state !== 'running') return;
  gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(LEVEL, ctx.currentTime + 2.5);
  gain.connect(ctx.destination);
  source = ctx.createBufferSource();
  source.buffer = buf;
  source.loop = true;
  source.loopStart = LOOP_START;
  source.loopEnd = LOOP_START + LOOP_SECONDS;
  source.connect(gain);
  source.start(0, LOOP_START - 0.5); // the very first pass begins half a second early — same audio, longer fade room
}

export function stop() {
  if (!source) return;
  const ctx = context();
  const s = source;
  const g = gain;
  source = null;
  gain = null;
  try {
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    s.stop(t + 1.25);
  } catch { try { s.stop(); } catch { /* already stopped */ } }
}

export function isPlaying() {
  return !!source;
}

// Any tap or key on the page is a chance to start (the first one is what
// unlocks audio); once playing these are no-ops.
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { start(); }, { passive: true }));

// Warm the download early so the bed is ready when audio unlocks.
export function preloadMusic() {
  const ctx = context();
  if (ctx && wanted) load(ctx);
}
