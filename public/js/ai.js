// Computer player for RINGO 3D. Scores each legal cell by how much it
// extends the bot's own lines and how much it blocks an opponent's, with a
// small random tiebreak so games don't play out identically — and weighs
// up whether a twist beats a roll this turn.

import {
  selectableCells, LINES_AT, WIN_LINES, N_CELLS, AXES, SIZE,
  canTwist, twistedBoard, winLinesFor,
} from './game.js';

// Difficulty knobs:
//   blunder   — chance of ignoring strategy and playing any legal cell
//   stealAt   — how valuable a blocked spot must be before stealing it
//   threat    — bonus per four-in-a-line threat a placement creates
//   spite     — weight on the damage a steal does to the victim's lines
//   twistGain — how much a twist must improve the position to be chosen
//               over rolling (Infinity = never twists, except to win)
//   twistWin  — chance the bot spots a twist that wins outright
export const LEVELS = {
  easy: { blunder: 0.45, stealAt: 2900, threat: 0, spite: 0, twistGain: Infinity, twistWin: 0.35 },
  normal: { blunder: 0, stealAt: 3.5, threat: 0, spite: 0, twistGain: 14, twistWin: 1 },
  hard: { blunder: 0, stealAt: 1.8, threat: 400, spite: 3, twistGain: 7, twistWin: 1 },
};

const cfgFor = (level) => LEVELS[level] || LEVELS.normal;

// How many win lines would sit one-away after I take cell i? Two or more is
// hard to stop — though in three dimensions the dice, not the opponent,
// decide whether you get to finish them.
function threatsAfter(state, i) {
  const me = state.current;
  const b = state.board;
  const prev = b[i];
  b[i] = me;
  let n = 0;
  for (const line of LINES_AT[i]) {
    let mine = 0;
    let empty = 0;
    let other = 0;
    for (const c of line) {
      const v = b[c];
      if (v === me) mine++;
      else if (v === null) empty++;
      else other++;
    }
    if (other === 0 && empty === 1 && mine === line.length - 1) n++;
  }
  b[i] = prev;
  return n;
}

// How much the ring at i is worth to the player who owns it — the sum of
// their progress in every still-winnable line through it. What a steal destroys.
function ringValueToOwner(board, i) {
  const owner = board[i];
  let v = 0;
  for (const line of LINES_AT[i]) {
    const cells = line.map((c) => board[c]);
    if (cells.some((o) => o !== null && o !== owner)) continue; // dead line
    v += cells.filter((o) => o === owner).length ** 2;
  }
  return v;
}

// Value of the current player owning cell i, ignoring whatever ring is there
// now. Rewards extending winnable lines and blocking opponent lines.
function scoreCell(state, i, cfg) {
  const me = state.current;
  let score = Math.random() * 0.5;
  for (const line of LINES_AT[i]) {
    const rest = line.length - 1;
    const owners = line.filter((c) => c !== i).map((c) => state.board[c]).filter((v) => v !== null);
    const mine = owners.filter((o) => o === me).length;
    const others = owners.filter((o) => o !== me);
    if (others.length === 0) {
      score += mine === rest ? 10000 : (mine + 1) ** 2;
    } else if (mine === 0 && new Set(others).size === 1) {
      score += others.length === rest ? 3000 : others.length ** 2 * 0.8;
    }
  }
  if (cfg.threat) score += cfg.threat * threatsAfter(state, i);
  const victim = state.board[i];
  if (cfg.spite && victim !== null && victim !== me) {
    score += cfg.spite * ringValueToOwner(state.board, i);
  }
  return score;
}

function bestOf(state, cells, cfg) {
  let best = null;
  let bestScore = -Infinity;
  for (const i of cells) {
    const score = scoreCell(state, i, cfg);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return { best, bestScore };
}

// Place phase: open cells plus, on a wild, any reachable opponent ring.
export function chooseCell(state, level = 'normal') {
  const cfg = cfgFor(level);
  const cells = selectableCells(state);
  if (cfg.blunder && Math.random() < cfg.blunder) {
    return cells[Math.floor(Math.random() * cells.length)] ?? null;
  }
  return bestOf(state, cells, cfg).best;
}

// Blocked roll: returns a cell to steal, or null to roll again.
export function chooseSteal(state, level = 'normal') {
  const cfg = cfgFor(level);
  const { best, bestScore } = bestOf(state, selectableCells(state), cfg);
  if (best === null) return null;
  const emptyLeft = state.board.filter((v) => v === null).length;
  if (emptyLeft === 0) return best;
  return bestScore >= cfg.stealAt ? best : null;
}

// ---------- twist or roll? ----------

// Position value for one player: progress in every line no one else has
// touched. Four-in-a-line is worth a lot — the dice will get there.
const PROGRESS = [0, 1, 4, 12, 45, 100000];

function progress(board, players) {
  const val = Array(players).fill(0);
  for (const line of WIN_LINES) {
    let owner = null;
    let n = 0;
    let dead = false;
    for (const c of line) {
      const v = board[c];
      if (v === null) continue;
      if (owner === null) owner = v;
      else if (owner !== v) { dead = true; break; }
      n++;
    }
    if (!dead && owner !== null) val[owner] += PROGRESS[Math.min(n, 5)];
  }
  return val;
}

function best(val, skip) {
  let m = 0;
  val.forEach((v, p) => { if (p !== skip) m = Math.max(m, v); });
  return m;
}

export function allTwists() {
  const out = [];
  for (const axis of AXES) for (let k = 0; k < SIZE; k++) for (const dir of [1, -1]) out.push({ axis, k, dir });
  return out;
}

// Returns a twist to make instead of rolling, or null to roll. A twist that
// wins on the spot is taken (mostly — easy bots miss some). Otherwise a bot
// twists only when it clearly builds its OWN lines, or breaks up an
// opponent's four-in-a-line, never when it hands anyone a finished line —
// and never two rounds running, so a game can't dissolve into twist wars.
export function chooseTwist(state, level = 'normal') {
  const cfg = cfgFor(level);
  const me = state.current;
  const n = state.players.length;
  const before = progress(state.board, n);
  const oppNow = best(before, me);
  const recently = state.lastTwistAt && state.moves - state.lastTwistAt[me] <= 2 * n;
  let pick = null;
  let pickScore = -Infinity;
  for (const t of allTwists()) {
    if (!canTwist(state, t)) continue;
    const b = twistedBoard(state.board, t);
    if (winLinesFor(b, me).length) {
      if (Math.random() < cfg.twistWin) return t;
      continue;
    }
    if (recently || cfg.twistGain === Infinity) continue;
    let gift = false;
    for (let p = 0; p < n && !gift; p++) if (p !== me && winLinesFor(b, p).length) gift = true;
    if (gift) continue;
    const after = progress(b, n);
    const oppAfter = best(after, me);
    const defensive = oppNow >= PROGRESS[4] && oppAfter < PROGRESS[4] ? 20 : 0;
    const score = (after[me] - before[me]) + defensive - 0.3 * Math.max(0, oppAfter - oppNow) + Math.random() * 0.5;
    if (score > pickScore) { pickScore = score; pick = t; }
  }
  return pick && pickScore >= cfg.twistGain ? pick : null;
}

export const CELL_COUNT = N_CELLS;
