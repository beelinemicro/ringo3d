// Shared RINGO 3D game logic — used by the browser client and (later) the
// room server.
//
// Rules (Dad's RINGO, taken into the third dimension):
//  - A 5x5x5 cube of spaces. Columns are lettered R-I-N-G-O (left to right),
//    rows are numbered 1-5 (top to bottom), and the five layers from front to
//    back each have a translucent color of their own.
//  - Three dice: letters R,I,N,G,O + wild; numbers 1-5 + wild; and a color
//    die with the five layer colors + wild. On your turn you either ROLL and
//    place a ring in the rolled space, or TWIST one slice of the cube a
//    quarter turn (Rubik's style) — one or the other, then the next player.
//  - A wild lets you pick that coordinate yourself: any column, any row, or
//    any layer. A wild also lets you steal any opponent ring the dice reach.
//  - If the rolled space holds an opponent's ring, choose: STEAL the spot
//    (replace their ring with yours) or roll again. Your own ring? Roll again.
//  - Five rings of your color in any straight line through the cube — along
//    a row, column or depth, diagonally across any flat layer, or corner to
//    corner through the middle — wins. So do all four corners of any outer
//    face of the cube. Shout "RINGO!"
//  - A twist can finish a line too. Whoever's rings end up in line wins, even
//    if the other player did the twisting; if a twist completes lines for
//    both, the twister wins. You may not simply undo the twist just made.

// Bump this whenever the rules change (see the 2D game's refresh banner).
export const GAME_VERSION = 1;

export const SIZE = 5;
export const N_CELLS = SIZE * SIZE * SIZE;
export const WILD = 'W';
export const COL_LABELS = ['R', 'I', 'N', 'G', 'O'];

// The five layers, front to back. Distinct from the ring colors on purpose:
// "R-1-Sky" must never sound like the blue player's ring.
export const LAYERS = [
  { name: 'Sky', hex: '#4fc3ff' },
  { name: 'Violet', hex: '#b388ff' },
  { name: 'Mint', hex: '#4fe0a8' },
  { name: 'Peach', hex: '#ffab5e' },
  { name: 'Rose', hex: '#ff6fae' },
];

export const COLORS = [
  { name: 'Red', hex: '#e5484d' },
  { name: 'Yellow', hex: '#f0b000' },
  { name: 'Blue', hex: '#3a7bd5' },
  { name: 'Green', hex: '#30a46c' },
  { name: 'Black', hex: '#262626' },
];

export const MAX_PLAYERS = COLORS.length;

// ---------- coordinates ----------
// A cell is an index 0..124. x = column (letter), y = row (number),
// z = layer (color, 0 = front).

export const idx = (x, y, z) => z * SIZE * SIZE + y * SIZE + x;
export const xyz = (i) => [i % SIZE, Math.floor(i / SIZE) % SIZE, Math.floor(i / (SIZE * SIZE))];

// ---------- every way to win ----------

// All 109 straight lines of five: 75 along the axes, 30 diagonals across
// flat layers (in all three orientations), 4 corner-to-corner through the
// middle. Each line is listed once.
export const ALL_LINES = (() => {
  const dirs = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        // Keep one of each direction pair: first non-zero component positive.
        const first = dx !== 0 ? dx : dy !== 0 ? dy : dz;
        if (first > 0) dirs.push([dx, dy, dz]);
      }
    }
  }
  const inside = (v) => v >= 0 && v < SIZE;
  const lines = [];
  for (const [dx, dy, dz] of dirs) {
    for (let i = 0; i < N_CELLS; i++) {
      const [x, y, z] = xyz(i);
      // Start only where stepping backwards leaves the cube.
      if (inside(x - dx) && inside(y - dy) && inside(z - dz)) continue;
      const end = [x + 4 * dx, y + 4 * dy, z + 4 * dz];
      if (!end.every(inside)) continue;
      lines.push([0, 1, 2, 3, 4].map((k) => idx(x + k * dx, y + k * dy, z + k * dz)));
    }
  }
  return lines;
})();

// The four corners of each of the six outer faces.
export const FACE_CORNERS = (() => {
  const L = SIZE - 1;
  const faces = [];
  const corners2 = [[0, 0], [0, L], [L, 0], [L, L]];
  for (const fixed of [0, L]) {
    faces.push(corners2.map(([a, b]) => idx(fixed, a, b))); // x = fixed
    faces.push(corners2.map(([a, b]) => idx(a, fixed, b))); // y = fixed
    faces.push(corners2.map(([a, b]) => idx(a, b, fixed))); // z = fixed
  }
  return faces;
})();

export const WIN_LINES = [...ALL_LINES, ...FACE_CORNERS];

// Every win line through each cell — the hot path for win checks and the bot.
export const LINES_AT = (() => {
  const at = Array.from({ length: N_CELLS }, () => []);
  WIN_LINES.forEach((line) => line.forEach((i) => at[i].push(line)));
  return at;
})();

export function newGame(players, startingPlayer = 0) {
  return {
    board: Array(N_CELLS).fill(null),
    players, // [{ name, isBot?, level?, disconnected? }] — color = player index
    current: startingPlayer,
    phase: 'roll', // 'roll' (roll or twist) | 'place' | 'blocked' | 'over'
    dice: null, // { col, row, layer } each 0-4 | 'W'
    winner: null,
    winLines: null, // every line the winning move completed
    lastPlaced: null, // cell index
    lastTwist: null, // { axis, k, dir } — the move just made, for the no-undo rule + animation
    lastTwistAt: players.map(() => -1), // move number of each player's latest twist
    moves: 0,
  };
}

export function rollDice(rng = Math.random) {
  const face = () => {
    const i = Math.floor(rng() * 6);
    return i === 5 ? WILD : i;
  };
  return { col: face(), row: face(), layer: face() };
}

function matches(dice, i) {
  const [x, y, z] = xyz(i);
  return (dice.col === WILD || dice.col === x)
    && (dice.row === WILD || dice.row === y)
    && (dice.layer === WILD || dice.layer === z);
}

export function legalCells(board, dice) {
  const cells = [];
  for (let i = 0; i < N_CELLS; i++) if (board[i] === null && matches(dice, i)) cells.push(i);
  return cells;
}

// Opponent-occupied cells matching the dice — candidates for a steal.
export function stealableCells(board, dice, player) {
  const cells = [];
  for (let i = 0; i < N_CELLS; i++) {
    if (board[i] !== null && board[i] !== player && matches(dice, i)) cells.push(i);
  }
  return cells;
}

export function boardFull(board) {
  return board.every((c) => c !== null);
}

export function winLinesFor(board, player) {
  return WIN_LINES.filter((line) => line.every((i) => board[i] === player));
}

export function winLineFor(board, player) {
  return winLinesFor(board, player)[0] || null;
}

export function nextPlayer(state) {
  let n = state.current;
  do {
    n = (n + 1) % state.players.length;
  } while (state.players[n].disconnected && n !== state.current);
  state.current = n;
}

// Applies a roll for the current player. Returns:
//   'place'   — at least one open matching space; place a ring normally
//   'blocked' — only opponent rings match; choose to steal one or roll again
//   'reroll'  — only your own rings match; roll again
export function applyRoll(state, dice) {
  state.dice = dice;
  if (legalCells(state.board, dice).length > 0) {
    state.phase = 'place';
    return 'place';
  }
  if (stealableCells(state.board, dice, state.current).length > 0) {
    state.phase = 'blocked';
    return 'blocked';
  }
  state.phase = 'roll';
  return 'reroll';
}

export function wildCount(dice) {
  if (!dice) return 0;
  return (dice.col === WILD ? 1 : 0) + (dice.row === WILD ? 1 : 0) + (dice.layer === WILD ? 1 : 0);
}

export function hasWild(dice) {
  return wildCount(dice) > 0;
}

// Every cell the current player may claim right now. In the 'place' phase a
// wild also unlocks stealing any opponent ring the dice can reach; in the
// 'blocked' phase only the occupied spot(s) are up for grabs.
export function selectableCells(state) {
  if (state.phase === 'place') {
    const open = legalCells(state.board, state.dice);
    if (hasWild(state.dice)) {
      return open.concat(stealableCells(state.board, state.dice, state.current));
    }
    return open;
  }
  if (state.phase === 'blocked') {
    return stealableCells(state.board, state.dice, state.current);
  }
  return [];
}

export function isLegal(state, i) {
  return selectableCells(state).includes(i);
}

function finish(state, winner, lines) {
  state.phase = 'over';
  state.winner = winner;
  state.winLines = lines;
  state.winLine = lines[0];
}

// Places (or steals) the current player's ring at cell i.
// Returns { result: 'win' | 'next', stolen: previousOwner | null }.
export function applyPlace(state, i) {
  const p = state.current;
  const stolen = state.board[i];
  state.board[i] = p;
  state.lastPlaced = i;
  state.lastTwist = null;
  state.moves++;
  const lines = LINES_AT[i].filter((line) => line.every((c) => state.board[c] === p));
  if (lines.length) {
    finish(state, p, lines);
    return { result: 'win', stolen };
  }
  nextPlayer(state);
  state.phase = 'roll';
  state.dice = null;
  return { result: 'next', stolen };
}

// ---------- twists ----------

export const AXES = ['x', 'y', 'z'];

// Where each cell of the slice goes under a quarter turn. Right-handed
// rotations about +x, +y, +z in cell space for dir = +1; dir = -1 is the
// inverse. (The renderer derives the matching on-screen spin from this map,
// so logic and picture can never disagree.)
export function twistMap(axis, k, dir) {
  const L = SIZE - 1;
  const map = new Map();
  for (let a = 0; a < SIZE; a++) {
    for (let b = 0; b < SIZE; b++) {
      // (a, b) are the in-plane coordinates in cyclic order: x→(y,z), y→(z,x), z→(x,y).
      const [na, nb] = dir > 0 ? [L - b, a] : [b, L - a];
      let from;
      let to;
      if (axis === 'x') { from = idx(k, a, b); to = idx(k, na, nb); }
      else if (axis === 'y') { from = idx(b, k, a); to = idx(nb, k, na); }
      else { from = idx(a, b, k); to = idx(na, nb, k); }
      map.set(from, to);
    }
  }
  return map;
}

export function sliceCells(axis, k) {
  return [...twistMap(axis, k, 1).keys()];
}

export function isUndo(twist, last) {
  return !!last && twist.axis === last.axis && twist.k === last.k && twist.dir === -last.dir;
}

// A twist is legal at the start of your turn — instead of rolling — as long
// as it doesn't simply reverse the twist the previous player just made.
export function canTwist(state, twist) {
  if (state.phase !== 'roll') return false;
  if (!AXES.includes(twist.axis) || twist.k < 0 || twist.k >= SIZE || Math.abs(twist.dir) !== 1) return false;
  return !isUndo(twist, state.lastTwist);
}

export function twistedBoard(board, twist) {
  const next = board.slice();
  for (const [from, to] of twistMap(twist.axis, twist.k, twist.dir)) next[to] = board[from];
  return next;
}

// Turns one slice a quarter turn. Returns { result: 'win' | 'next', winner }.
// A twist can finish lines for anyone; the twister wins ties.
export function applyTwist(state, twist) {
  const p = state.current;
  const map = twistMap(twist.axis, twist.k, twist.dir);
  state.board = twistedBoard(state.board, twist);
  if (state.lastPlaced !== null && map.has(state.lastPlaced)) state.lastPlaced = map.get(state.lastPlaced);
  state.lastTwist = { ...twist, by: p };
  state.lastTwistAt[p] = state.moves;
  state.moves++;
  const order = [p];
  for (let n = 1; n < state.players.length; n++) order.push((p + n) % state.players.length);
  for (const q of order) {
    const lines = winLinesFor(state.board, q);
    if (lines.length) {
      finish(state, q, lines);
      return { result: 'win', winner: q };
    }
  }
  nextPlayer(state);
  state.phase = 'roll';
  state.dice = null;
  return { result: 'next', winner: null };
}

// ---------- labels ----------

export function diceLabel(dice) {
  const col = dice.col === WILD ? '★' : COL_LABELS[dice.col];
  const row = dice.row === WILD ? '★' : String(dice.row + 1);
  const layer = dice.layer === WILD ? '★' : LAYERS[dice.layer].name;
  return `${col}-${row}-${layer}`;
}

export function cellLabel(i) {
  const [x, y, z] = xyz(i);
  return `${COL_LABELS[x]}-${y + 1}-${LAYERS[z].name}`;
}

export function sliceLabel(twist) {
  if (twist.axis === 'z') return `the ${LAYERS[twist.k].name} layer`;
  if (twist.axis === 'x') return `column ${COL_LABELS[twist.k]}`;
  return `row ${twist.k + 1}`;
}
