// The music bed — a hypnotic, mind-sharpening loop (see scripts/make-music.py)
// played through Web Audio so the loop is sample-accurate. The file holds
// [1 s silence] + loop + [the loop's first seconds again]; looping between
// 1.5 s and 1.5 s + LOOP_SECONDS lands on identical audio at both ends, so
// any MP3 decoder delay cancels out and the seam is inaudible.
//
// Off switch: the ♪ button in the game header (remembered), and the sound
// mute silences it too.

import { context, isMuted } from './sound.js';

const FILE = 'audio/mind.mp3';
const LOOP_SECONDS = 110;
const LOOP_START = 1.5;
const LEVEL = 0.3;
const KEY = 'ringo3dMusic';

let buffer = null;
let loading = null;
let source = null;
let gain = null;
let wanted = localStorage.getItem(KEY) !== 'off';
let inGame = false; // music plays during a game, not on the menu

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

// Start (or resume) the bed if music is wanted, we're in a game, and sound
// isn't muted. Fades in; repeated calls are harmless.
export async function start() {
  if (!wanted || !inGame || isMuted() || source) return;
  const ctx = context();
  if (!ctx) return;
  const buf = await load(ctx);
  if (!buf || source || !wanted || !inGame || isMuted()) return;
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* needs a gesture */ } }
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

// Called when a game screen appears / the menu returns.
export function enterGame() {
  inGame = true;
  start();
}

export function leaveGame() {
  inGame = false;
  stop();
}

// Warm the download from the first gesture so the bed is ready at kickoff.
export function preloadMusic() {
  const ctx = context();
  if (ctx && wanted) load(ctx);
}
