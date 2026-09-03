// The caller's voice — a handful of ElevenLabs clips shipped as static MP3s
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

// Warm the cache from a user gesture so the first shout isn't late.
export function preloadVoices() {
  NAMES.forEach(clip);
}

// The crowd cheer under a win — a sound effect, so it runs alongside the
// shout rather than replacing it. Not preloaded: the clip is optional.
let party = null;

export const voice = {
  // The crowd goes wild. Fails silently when audio/party.mp3 isn't there.
  party() {
    if (isMuted()) return;
    try {
      if (!party) { party = new Audio('audio/party.mp3'); party.volume = 0.55; }
      party.currentTime = 0;
      party.play().catch(() => {});
    } catch { /* no audio here */ }
  },
  stopAll() {
    try {
      if (current) { current.pause(); current.currentTime = 0; }
      if (party) { party.pause(); party.currentTime = 0; }
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
