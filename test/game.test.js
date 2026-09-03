// Sanity tests for the shared RINGO 3D game logic.  Run: npm test

import assert from 'node:assert';
import {
  WILD, SIZE, N_CELLS, idx, xyz, ALL_LINES, FACE_CORNERS, WIN_LINES, LINES_AT,
  newGame, rollDice, legalCells, stealableCells, selectableCells,
  applyRoll, applyPlace, applyTwist, twistMap, twistedBoard, canTwist, sliceCells,
  isLegal, winLinesFor, diceLabel, cellLabel,
} from '../public/js/game.js';

function fresh(n = 2) {
  return newGame(Array.from({ length: n }, (_, i) => ({ name: 'P' + i })));
}

// --- geometry ---
assert.equal(N_CELLS, 125);
assert.equal(ALL_LINES.length, 109, '75 axis + 30 flat diagonals + 4 space diagonals');
assert.equal(FACE_CORNERS.length, 6, 'one corner set per outer face');
assert.equal(WIN_LINES.length, 115);
assert.ok(ALL_LINES.every((l) => l.length === 5 && new Set(l).size === 5), 'lines are five distinct cells');
assert.equal(new Set(ALL_LINES.map((l) => [...l].sort((a, b) => a - b).join(','))).size, 109, 'no line listed twice');
assert.equal(LINES_AT[idx(2, 2, 2)].length, 13, 'the centre sits on 13 lines');
assert.equal(LINES_AT[idx(0, 0, 0)].length, 7 + 3, 'a corner: 7 lines + 3 faces');
for (let i = 0; i < N_CELLS; i++) {
  const [x, y, z] = xyz(i);
  assert.equal(idx(x, y, z), i);
}

// --- dice ---
for (let i = 0; i < 500; i++) {
  const d = rollDice();
  for (const f of [d.col, d.row, d.layer]) assert.ok(f === WILD || (f >= 0 && f <= 4), 'die face valid');
}
assert.equal(diceLabel({ col: 0, row: 0, layer: 0 }), 'R-1-Sky');
assert.equal(diceLabel({ col: WILD, row: 4, layer: WILD }), '★-5-★');
assert.equal(cellLabel(idx(2, 3, 4)), 'N-4-Rose');

// --- legal cells ---
{
  const s = fresh();
  assert.deepEqual(legalCells(s.board, { col: 2, row: 3, layer: 1 }), [idx(2, 3, 1)], 'concrete roll → single cell');
  assert.equal(legalCells(s.board, { col: WILD, row: 3, layer: 1 }).length, 5, 'one wild → a line of five');
  assert.equal(legalCells(s.board, { col: WILD, row: WILD, layer: 1 }).length, 25, 'two wilds → a whole layer');
  assert.equal(legalCells(s.board, { col: WILD, row: WILD, layer: WILD }).length, 125, 'triple wild → anywhere');
  s.board[idx(2, 3, 1)] = 0;
  assert.equal(legalCells(s.board, { col: 2, row: 3, layer: 1 }).length, 0, 'occupied cell not open');
  assert.equal(legalCells(s.board, { col: WILD, row: 3, layer: 1 }).length, 4, 'wild skips occupied');
  assert.deepEqual(stealableCells(s.board, { col: 2, row: 3, layer: 1 }, 1), [idx(2, 3, 1)], 'opponent cell stealable');
  assert.deepEqual(stealableCells(s.board, { col: 2, row: 3, layer: 1 }, 0), [], 'own cell not stealable');
}

// --- blocked roll on an opponent ring → steal-or-reroll choice ---
{
  const s = fresh();
  const c = idx(2, 3, 1);
  s.board[c] = 1;
  assert.equal(applyRoll(s, { col: 2, row: 3, layer: 1 }), 'blocked');
  assert.equal(s.current, 0, 'turn is NOT lost');
  assert.ok(isLegal(s, c), 'the occupied spot is stealable');
  assert.ok(!isLegal(s, 0), 'cannot place elsewhere while blocked');
  const { result, stolen } = applyPlace(s, c);
  assert.equal(result, 'next');
  assert.equal(stolen, 1);
  assert.equal(s.board[c], 0, 'ring replaced with stealer\'s color');
  assert.equal(s.current, 1, 'turn advances after steal');
}

// --- own ring → roll again; wild reaches opponent rings ---
{
  const s = fresh();
  s.board[idx(2, 3, 1)] = 0;
  assert.equal(applyRoll(s, { col: 2, row: 3, layer: 1 }), 'reroll');
  assert.equal(s.phase, 'roll');
  s.board[idx(4, 3, 1)] = 1;
  applyRoll(s, { col: WILD, row: 3, layer: 1 });
  const sel = selectableCells(s);
  assert.equal(sel.length, 3 + 1, 'three open + one steal on a wild');
  assert.ok(sel.includes(idx(4, 3, 1)));
  assert.ok(!sel.includes(idx(2, 3, 1)), 'never your own ring');
}

// --- wins: axis line, flat diagonal, space diagonal, face corners ---
function playLine(cells) {
  const s = fresh();
  cells.slice(0, -1).forEach((c) => { s.board[c] = 0; });
  applyRoll(s, { col: WILD, row: WILD, layer: WILD });
  const { result } = applyPlace(s, cells[cells.length - 1]);
  return { s, result };
}
{
  const depth = [0, 1, 2, 3, 4].map((z) => idx(1, 2, z));
  assert.equal(playLine(depth).result, 'win', 'five deep (front to back) wins');
  const diag = [0, 1, 2, 3, 4].map((k) => idx(k, 4 - k, 3));
  assert.equal(playLine(diag).result, 'win', 'diagonal across a layer wins');
  const space = [0, 1, 2, 3, 4].map((k) => idx(k, k, k));
  const sw = playLine(space);
  assert.equal(sw.result, 'win', 'corner-to-corner through the middle wins');
  assert.equal(sw.s.winLines.length, 1);
  const face = FACE_CORNERS[5]; // z = 4 (back face)
  assert.equal(playLine(face).result, 'win', 'four corners of an outer face wins');
  const notFace = [idx(0, 0, 2), idx(0, 4, 2), idx(4, 0, 2), idx(4, 4, 2)];
  assert.equal(playLine(notFace).result, 'next', 'corners of an interior layer do not win');
  const bent = [idx(0, 0, 0), idx(1, 1, 0), idx(2, 2, 0), idx(3, 3, 0), idx(4, 4, 1)];
  assert.equal(playLine(bent).result, 'next', 'a bent line is not a line');
}

// --- twists ---
{
  for (const axis of ['x', 'y', 'z']) {
    for (let k = 0; k < SIZE; k++) {
      const m = twistMap(axis, k, 1);
      assert.equal(m.size, 25);
      assert.equal(new Set(m.values()).size, 25, 'a twist is a bijection of the slice');
      assert.ok([...m.values()].every((i) => m.has(i)), 'a twist stays inside its slice');
      // Four quarter turns come home; a turn back undoes a turn forward.
      let b = Array.from({ length: N_CELLS }, (_, i) => i);
      for (let t = 0; t < 4; t++) b = twistedBoard(b, { axis, k, dir: 1 });
      assert.ok(b.every((v, i) => v === i), '4 x 90° = identity');
      b = twistedBoard(twistedBoard(b, { axis, k, dir: 1 }), { axis, k, dir: -1 });
      assert.ok(b.every((v, i) => v === i), '+90 then -90 = identity');
      assert.ok(sliceCells(axis, k).every((i) => xyz(i)[['x', 'y', 'z'].indexOf(axis)] === k));
    }
  }
  // Front layer, dir +1: seen from the front (y down) the right-middle cell
  // goes to bottom-middle — clockwise.
  const m = twistMap('z', 0, 1);
  assert.equal(m.get(idx(4, 2, 0)), idx(2, 4, 0));
  assert.equal(m.get(idx(2, 2, 0)), idx(2, 2, 0), 'the slice centre stays put');
  // Turning a column slice moves rings between layers.
  const mx = twistMap('x', 0, 1);
  assert.ok([...mx.entries()].some(([f, t]) => xyz(f)[2] !== xyz(t)[2]), 'a column twist moves rings between layers');
  assert.equal(xyz(mx.get(idx(0, 0, 1)))[2], 0, 'R-1-Violet swings round into the Sky layer');
}

// --- a twist can win, for anyone; the twister wins ties; no instant undo ---
{
  const s = fresh();
  // Red has four across row 1 of the front layer plus the fifth one row down
  // in column O: twisting the O column brings... simpler: place four in the
  // front layer's row 1 at R,I,N,G and the fifth at O in row 1 of layer Violet.
  // A twist of column O about x moves cells within that column slice.
  [0, 1, 2, 3].forEach((x) => { s.board[idx(x, 0, 0)] = 0; });
  const mO = twistMap('x', 4, 1);
  const source = [...mO.entries()].find(([, to]) => to === idx(4, 0, 0))[0];
  s.board[source] = 0;
  assert.equal(winLinesFor(s.board, 0).length, 0, 'not yet a line');
  s.current = 1; // the OPPONENT twists and hands red the win
  assert.ok(canTwist(s, { axis: 'x', k: 4, dir: 1 }));
  const r = applyTwist(s, { axis: 'x', k: 4, dir: 1 });
  assert.equal(r.result, 'win');
  assert.equal(r.winner, 0, 'whoever\'s rings line up wins');
  assert.equal(s.phase, 'over');
}
{
  const s = fresh();
  s.current = 0;
  assert.ok(canTwist(s, { axis: 'z', k: 2, dir: 1 }));
  applyTwist(s, { axis: 'z', k: 2, dir: 1 });
  assert.equal(s.current, 1, 'a twist ends the turn');
  assert.equal(s.phase, 'roll');
  assert.ok(!canTwist(s, { axis: 'z', k: 2, dir: -1 }), 'cannot undo the twist just made');
  assert.ok(canTwist(s, { axis: 'z', k: 2, dir: 1 }), 'but may turn it further');
  assert.ok(canTwist(s, { axis: 'x', k: 2, dir: -1 }));
  applyRoll(s, { col: 0, row: 0, layer: 0 });
  assert.ok(!canTwist(s, { axis: 'x', k: 0, dir: 1 }), 'no twisting once you have rolled');
}
{
  // Both players complete a line on the same twist → the twister wins.
  // Red has R-I-N-G across row 1 (front), yellow has R-I-N-G across row 5;
  // each one's fifth ring sits in column O where one twist of that column
  // swings both into place at once.
  const s = fresh();
  const mO = twistMap('x', 4, 1);
  const from = (to) => [...mO.entries()].find(([, t]) => t === to)[0];
  [0, 1, 2, 3].forEach((x) => { s.board[idx(x, 0, 0)] = 0; s.board[idx(x, 4, 0)] = 1; });
  s.board[from(idx(4, 0, 0))] = 0;
  s.board[from(idx(4, 4, 0))] = 1;
  assert.equal(winLinesFor(s.board, 0).length + winLinesFor(s.board, 1).length, 0, 'nothing finished yet');
  s.current = 1;
  const r = applyTwist(s, { axis: 'x', k: 4, dir: 1 });
  assert.equal(winLinesFor(s.board, 0).length, 1, 'red\'s row is complete too');
  assert.equal(r.winner, 1, 'twister wins a double finish');
}

console.log('All RINGO 3D game tests passed ✔');
