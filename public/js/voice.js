// The announcer — a calm, matter-of-fact British voice, like a ship's
// computer stating the result. A handful of ElevenLabs clips as static MP3s
// (see scripts/make-voices.py). Honours the same mute toggle as the SFX;
// a missing clip fails silently, the game never depends on it.

import { isMuted } from './sound.js';

const NAMES = ['ringo', 'double-ringo', 'triple-ringo', 'stolen', 'double-wild', 'triple-wild', 'twist'];
const cache = new Map();
let current = null;

function clip(name) {
  let a = cache.get(name);
  if (!a) {
    a = new Audio(`audio/${name}.mp3`);
    a.preload = 'auto';
    a.volume = 0.95;
    cache.set(name, a);
  }
  return a;
}

// Warm the cache from a user gesture so the first line isn't late.
export function preloadVoices() {
  NAMES.forEach(clip);
}

export const voice = {
  stopAll() {
    try {
      if (current) { current.pause(); current.currentTime = 0; }
    } catch { /* nothing playing */ }
  },
  play(name, { delay = 0 } = {}) {
    if (isMuted()) return;
    setTimeout(() => {
      if (isMuted()) return;
      try {
        if (current) { current.pause(); current.currentTime = 0; }
        const a = clip(name);
        a.currentTime = 0;
        current = a;
        a.play().catch(() => {});
      } catch { /* no audio here */ }
    }, delay);
  },
  win(lines) {
    this.play(lines >= 3 ? 'triple-ringo' : lines === 2 ? 'double-ringo' : 'ringo');
  },
};
