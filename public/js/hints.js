// First-play help: a spotlight tour of the game screen the first time a
// game appears on this device, plus one-time nudges at the three moments
// that confuse new players — the first wild roll, the first landing on a
// rival's ring, and the first time the twist picker opens.
//
// Everything is skippable, remembered in localStorage, and replayable from
// the ? button in the game header. The tour never starts for spectators.

const TOUR_KEY = 'ringo3dTour';
const NUDGE_KEY = 'ringo3dNudges';

const STEPS = [
  {
    target: '#cube',
    title: 'The cube',
    text: 'Five glass layers, 125 spaces. Drag it to spin it round.',
  },
  {
    target: '.dice-area',
    title: 'Three dice',
    text: 'A letter, a number and a layer colour. Together they point at one space. A ★ is wild — you choose that part yourself.',
  },
  {
    target: '#btn-roll',
    title: 'Roll',
    text: 'Start your turn here. Land on an open space to place a ring. Land on a rival’s ring and you can steal it.',
  },
  {
    target: '#layer-chips',
    title: 'Look inside',
    text: 'Tap a colour to see into just that layer.',
  },
  {
    target: '#btn-explode',
    title: 'Fan it out',
    text: 'Spread the layers apart to see every ring at once.',
  },
  {
    target: '#btn-twist',
    title: 'Or twist',
    text: 'Skip the roll and turn a slice a quarter turn, Rubik’s-style. Five in a row through the cube, or four corners of a face, wins.',
  },
];

const $ = (sel) => document.querySelector(sel);
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

let root = null;   // #tour overlay
let step = -1;     // current tour step, -1 when idle
let onDone = null;
let nudgeTimer = 0;

function build() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'tour';
  root.className = 'tour hidden';
  root.innerHTML = `
    <div class="tour-spot"></div>
    <div class="tour-card" role="dialog" aria-live="polite">
      <div class="tour-dots"></div>
      <h3 class="tour-title"></h3>
      <p class="tour-text"></p>
      <div class="tour-actions">
        <button type="button" class="btn btn-ghost btn-small tour-skip">Skip</button>
        <button type="button" class="btn btn-primary btn-small tour-next">Next</button>
      </div>
    </div>
    <div class="tour-nudge hidden" role="status"><span></span><button type="button" class="tour-nudge-ok" aria-label="Got it">✕</button></div>`;
  document.body.appendChild(root);
  root.querySelector('.tour-skip').addEventListener('click', () => endTour());
  root.querySelector('.tour-next').addEventListener('click', () => advance());
  root.querySelector('.tour-nudge-ok').addEventListener('click', () => hideNudge());
  document.addEventListener('keydown', (e) => {
    if (step < 0) return;
    if (e.key === 'Escape') endTour();
    else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); advance(); }
  });
  window.addEventListener('resize', () => { if (step >= 0) place(); });
  return root;
}

// Steps whose target is hidden (Roll for a spectator, say) are skipped.
function visible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function liveSteps() {
  return STEPS.filter((s) => visible($(s.target)));
}

export function startTour({ force = false, done } = {}) {
  if (!force && read(TOUR_KEY)) return false;
  const steps = liveSteps();
  if (!steps.length) return false;
  build();
  hideNudge();
  onDone = done || null;
  root.dataset.steps = JSON.stringify(steps.map((s) => STEPS.indexOf(s)));
  step = 0;
  root.classList.remove('hidden');
  place();
  return true;
}

function current() {
  const order = JSON.parse(root.dataset.steps || '[]');
  return { steps: order.map((i) => STEPS[i]), i: step };
}

function advance() {
  const { steps } = current();
  if (step + 1 >= steps.length) return endTour(true);
  step++;
  place();
}

export function endTour(completed = false) {
  if (step < 0) return;
  step = -1;
  root.classList.add('hidden');
  write(TOUR_KEY, completed ? 'done' : 'skipped');
  if (onDone) { const f = onDone; onDone = null; f(); }
}

export const tourActive = () => step >= 0;

// Move the spotlight and the card to the current step. The card goes above
// the target when the target sits in the lower half of the screen, below it
// otherwise, and hugs the edges on phones so it never runs off the side.
function place() {
  const { steps, i } = current();
  const s = steps[i];
  const el = $(s.target);
  if (!visible(el)) return advance();
  const r = el.getBoundingClientRect();
  const pad = 8;
  const spot = root.querySelector('.tour-spot');
  spot.style.left = `${r.left - pad}px`;
  spot.style.top = `${r.top - pad}px`;
  spot.style.width = `${r.width + pad * 2}px`;
  spot.style.height = `${r.height + pad * 2}px`;

  root.querySelector('.tour-title').textContent = s.title;
  root.querySelector('.tour-text').textContent = s.text;
  root.querySelector('.tour-next').textContent = i + 1 === steps.length ? 'Play!' : 'Next';
  root.querySelector('.tour-dots').innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');

  const card = root.querySelector('.tour-card');
  card.classList.toggle('above', r.top + r.height / 2 > window.innerHeight * 0.5);
  card.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const narrow = vw < 560;
    const w = narrow ? vw - 24 : Math.min(400, vw - 24);
    card.style.width = `${w}px`;
    const cx = narrow ? 12 : Math.min(Math.max(12, r.left + r.width / 2 - w / 2), vw - w - 12);
    card.style.left = `${cx}px`;
    const below = r.bottom + 14;
    const above = r.top - 14 - ch;
    let top = card.classList.contains('above') ? above : below;
    if (top < 8) top = below;
    if (top + ch > window.innerHeight - 8) top = Math.max(8, above);
    card.style.top = `${top}px`;
    card.style.visibility = '';
  });
}

// ---- one-time nudges ------------------------------------------------------

function seenNudges() {
  try { return new Set(JSON.parse(read(NUDGE_KEY) || '[]')); } catch { return new Set(); }
}

export function nudge(key, target, text) {
  if (tourActive()) return false;
  const seen = seenNudges();
  if (seen.has(key)) return false;
  const el = $(target);
  if (!visible(el)) return false;
  build();
  seen.add(key);
  write(NUDGE_KEY, JSON.stringify([...seen]));
  const n = root.querySelector('.tour-nudge');
  n.querySelector('span').textContent = text;
  n.classList.remove('hidden');
  root.classList.remove('hidden');
  root.classList.add('nudging');
  const r = el.getBoundingClientRect();
  n.classList.toggle('above', r.top + r.height / 2 > window.innerHeight * 0.5);
  requestAnimationFrame(() => {
    const nh = n.offsetHeight;
    let top = n.classList.contains('above') ? r.top - 12 - nh : r.bottom + 12;
    if (top < 8) top = r.bottom + 12;
    if (top + nh > window.innerHeight - 8) top = Math.max(8, r.top - 12 - nh);
    n.style.top = `${top}px`;
  });
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(hideNudge, 9000);
  return true;
}

export function hideNudge() {
  if (!root) return;
  clearTimeout(nudgeTimer);
  root.querySelector('.tour-nudge').classList.add('hidden');
  root.classList.remove('nudging');
  if (step < 0) root.classList.add('hidden');
}

/** Forget everything, so the tour and nudges show again. */
export function resetHints() {
  try { localStorage.removeItem(TOUR_KEY); localStorage.removeItem(NUDGE_KEY); } catch { /* ignore */ }
}
