// RINGO 3D — client application: screens, the cube, dice, turn flow, twists.
// Pass & Play and vs Computer run entirely here; online rooms come next.

import {
  WILD, COL_LABELS, LAYERS, COLORS, SIZE,
  newGame, rollDice, applyRoll, applyPlace, applyTwist, canTwist, isLegal, selectableCells,
  diceLabel, cellLabel, sliceLabel, wildCount,
} from './game.js';
import { chooseCell, chooseSteal, chooseTwist } from './ai.js';
import { sfx, unlock, setMuted, isMuted } from './sound.js';
import { burst as confettiBurst, stop as confettiStop } from './confetti.js';
import { createCube } from './cube.js';
import { voice, preloadVoices } from './voice.js';

const $ = (id) => document.getElementById(id);

// ---------- app state ----------

let mode = null; // 'local' | 'ai'
let state = null;
let busy = false; // dice or a twist animating
let startingPlayer = 0;
let cube = null; // the three.js view, created on first game
let twistOpen = false;
const twistSel = { axis: 'z', k: 0, dir: 1 };

// ---------- screens ----------

const SCREENS = ['screen-menu', 'screen-setup', 'screen-lobby', 'screen-game'];

function show(id) {
  SCREENS.forEach((s) => $(s).classList.toggle('hidden', s !== id));
}

// ---------- menu ----------

$('btn-mode-local').addEventListener('click', () => { unlock(); preloadVoices(); sfx.click(); openSetup('local'); });
$('btn-mode-ai').addEventListener('click', () => { unlock(); preloadVoices(); sfx.click(); openSetup('ai'); });
$('btn-rules').addEventListener('click', () => { sfx.click(); $('rules-modal').classList.remove('hidden'); });
$('btn-rules-close').addEventListener('click', () => { sfx.click(); $('rules-modal').classList.add('hidden'); });
$('btn-story').addEventListener('click', () => { sfx.click(); $('story-modal').classList.remove('hidden'); });
$('btn-story-close').addEventListener('click', () => { sfx.click(); $('story-modal').classList.add('hidden'); });
$('btn-stats-close').addEventListener('click', () => { sfx.click(); $('stats-modal').classList.add('hidden'); });

// ---------- setup ----------

function colorDot(i) {
  return `<span class="player-color-dot" style="border-color:${COLORS[i].hex}"></span>`;
}

function segButtons(values, initial, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  values.forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = v;
    if (v === initial) b.classList.add('on');
    b.addEventListener('click', () => {
      sfx.click();
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onPick(v);
    });
    wrap.appendChild(b);
  });
  return wrap;
}

function savedName() {
  return localStorage.getItem('ringoName') || '';
}

function openSetup(m) {
  mode = m;
  const body = $('setup-body');
  body.innerHTML = '';

  if (m === 'local') {
    $('setup-title').textContent = 'Pass & Play';
    let count = 2;
    const nameFields = document.createElement('div');
    const renderNames = () => {
      nameFields.innerHTML = '';
      for (let i = 0; i < count; i++) {
        const f = document.createElement('div');
        f.className = 'field';
        f.innerHTML = `<label>${colorDot(i)}${COLORS[i].name} player</label>
          <input type="text" maxlength="14" placeholder="Player ${i + 1}" data-name-idx="${i}">`;
        nameFields.appendChild(f);
      }
    };
    const f = document.createElement('div');
    f.className = 'field';
    f.innerHTML = '<label>How many players?</label>';
    f.appendChild(segButtons([2, 3, 4, 5], 2, (v) => { count = v; renderNames(); }));
    body.appendChild(f);
    body.appendChild(nameFields);
    renderNames();
    $('btn-setup-go').onclick = () => {
      const players = [...nameFields.querySelectorAll('input')].map((inp, i) => ({
        name: inp.value.trim() || `Player ${i + 1}`,
      }));
      startLocalGame(players);
    };
  }

  if (m === 'ai') {
    $('setup-title').textContent = 'Play vs Computer';
    let bots = 1;
    let level = localStorage.getItem('ringoDiff') || 'normal';
    body.innerHTML = `<div class="field">
        <label>${colorDot(0)}Your name</label>
        <input type="text" id="ai-name" maxlength="14" placeholder="You" value="${savedName()}">
      </div>`;
    const f = document.createElement('div');
    f.className = 'field';
    f.innerHTML = '<label>How many computer players?</label>';
    f.appendChild(segButtons([1, 2, 3, 4], 1, (v) => { bots = v; }));
    body.appendChild(f);
    const fd = document.createElement('div');
    fd.className = 'field';
    fd.innerHTML = '<label>How tough should they be?</label>';
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    fd.appendChild(segButtons(['Easy', 'Normal', 'Hard'], cap(level), (v) => { level = v.toLowerCase(); }));
    body.appendChild(fd);
    $('btn-setup-go').onclick = () => {
      const you = $('ai-name').value.trim() || 'You';
      localStorage.setItem('ringoName', you);
      localStorage.setItem('ringoDiff', level);
      const botNames = ['Chip', 'Sparky', 'Gizmo', 'Bolt'];
      const players = [{ name: you }];
      for (let i = 0; i < bots; i++) players.push({ name: botNames[i], isBot: true, level });
      startLocalGame(players);
    };
  }

  show('screen-setup');
}

$('btn-setup-back').addEventListener('click', () => { sfx.click(); show('screen-menu'); });

// ---------- the cube ----------

function ensureCube() {
  if (cube) return;
  cube = createCube($('cube'), { onTap: onCellClick });
  const chips = $('layer-chips');
  LAYERS.forEach((l, z) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layer-chip';
    b.style.setProperty('--lc', l.hex);
    b.textContent = l.name;
    b.addEventListener('click', () => {
      sfx.click();
      cube.setFocus(cube.focus === z ? null : z);
      syncLayerChips();
    });
    chips.appendChild(b);
  });
  $('btn-explode').addEventListener('click', () => {
    sfx.click();
    cube.setExplode(!cube.explode);
    $('btn-explode').classList.toggle('on', cube.explode);
  });
  $('btn-view').addEventListener('click', () => { sfx.click(); cube.setView('iso'); });
  new ResizeObserver(() => cube && cube.resize()).observe($('holo'));
}

function syncLayerChips() {
  [...$('layer-chips').children].forEach((b, z) => b.classList.toggle('on', cube.focus === z));
}

function setFocusLayer(z) {
  cube.setFocus(z);
  syncLayerChips();
}

// ---------- rendering ----------

function myTurn() {
  if (!state || state.phase === 'over') return false;
  return !state.players[state.current].isBot;
}

function renderChips() {
  const wrap = $('player-chips');
  wrap.innerHTML = '';
  state.players.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    if (i === state.current && state.phase !== 'over') chip.classList.add('active');
    const bot = p.isBot ? ' 🤖' : '';
    chip.innerHTML = `<span class="chip-ring" style="border-color:${COLORS[i].hex}"></span>${p.name}${bot}`;
    if (!p.isBot) {
      chip.classList.add('editable');
      chip.title = 'Tap to rename';
      chip.innerHTML += '<span class="pencil">✏️</span>';
      chip.addEventListener('click', () => renamePlayer(i));
    }
    wrap.appendChild(chip);
  });
}

function renamePlayer(i) {
  const current = state.players[i].name;
  const entered = prompt('New name:', current);
  if (entered === null) return;
  const name = entered.trim().slice(0, 14);
  if (!name || name === current) return;
  sfx.click();
  if (mode === 'ai' && i === 0) localStorage.setItem('ringoName', name);
  state.players[i].name = name;
  renderAll();
}

function renderCube() {
  const over = state.phase === 'over';
  const legal = myTurn() && !busy && !twistOpen ? selectableCells(state) : [];
  const steal = legal.filter((i) => state.board[i] !== null);
  const diceShown = state.dice && (state.phase === 'place' || state.phase === 'blocked');
  cube.sync({
    board: state.board,
    legal,
    steal,
    current: over ? state.winner : state.current,
    winLines: over ? (state.winLines || []) : [],
    lastPlaced: over ? null : state.lastPlaced,
    dice: diceShown ? state.dice : null,
  });
  // Hold the cube still while somebody is aiming at a space.
  cube.setIdle(!(legal.length > 0) && !twistOpen);
  $('holo').style.setProperty('--turn', COLORS[over ? state.winner : state.current].hex);
}

function renderActions() {
  const roll = $('btn-roll');
  const twist = $('btn-twist');
  const place = $('btn-place');
  const mine = myTurn() && !busy;
  const legal = mine ? selectableCells(state) : [];
  const single = legal.length === 1 ? legal[0] : null;
  const placing = state.phase === 'place' || state.phase === 'blocked';
  roll.classList.toggle('hidden', state.phase === 'place');
  roll.disabled = !mine || (state.phase !== 'roll' && state.phase !== 'blocked');
  roll.textContent = state.phase === 'blocked' ? 'Roll Again!' : 'Roll!';
  twist.classList.toggle('hidden', placing);
  twist.disabled = !mine || state.phase !== 'roll';
  place.classList.toggle('hidden', !placing);
  place.disabled = !mine || single === null;
  if (placing) {
    if (single !== null) place.textContent = state.board[single] !== null ? 'Steal it!' : 'Place it!';
    else place.textContent = 'Tap a space';
  }
}

function renderAll() {
  renderChips();
  renderDice();
  renderActions();
  renderCube();
  setMessage(defaultMessage());
  fitHolo();
}

function setMessage(text) {
  $('message').textContent = text;
}

function defaultMessage() {
  const cur = state.players[state.current];
  if (state.phase === 'roll') {
    if (cur.isBot) return `${cur.name} is thinking…`;
    return `${cur.name}: roll the dice — or twist the cube!`;
  }
  if (state.phase === 'place') {
    const d = state.dice;
    const wilds = wildCount(d);
    const who = myTurn() ? 'Tap a glowing space' : `${cur.name} is placing a ring`;
    if (wilds === 3) return `TRIPLE WILD! ${who} — anywhere in the cube, even an opponent's ring!`;
    if (wilds === 2) return `Double wild! ${who} — open spots or an opponent's ring.`;
    if (wilds === 1) return `Wild! ${who} — open spots or an opponent's ring.`;
    const legal = selectableCells(state);
    return myTurn() ? `Rolled ${diceLabel(d)}. Tap it, or hit Place it!` : `${cur.name} rolled ${diceLabel(d)}.`;
  }
  if (state.phase === 'blocked') {
    return myTurn()
      ? `${diceLabel(state.dice)} is taken! Steal the ring, or roll again.`
      : `${cur.name} rolled ${diceLabel(state.dice)} — it's taken! Steal, or roll again?`;
  }
  return '';
}

// On phones the cube fills whatever height is left once the header, dice
// and message are laid out. Measure everything that is not the cube and
// hand it to CSS as --rest (see the .holo rule in the small-screen query).
let restFit = null;
function fitHolo(force = false) {
  if ($('screen-game').classList.contains('hidden')) return;
  const rest = $('app').offsetHeight - $('holo').offsetHeight;
  if (!force && restFit !== null && Math.abs(rest - restFit) < 24) return;
  restFit = rest;
  $('app').style.setProperty('--rest', `${rest}px`);
}

window.addEventListener('resize', () => fitHolo(true));

// ---------- showmanship ----------

let calloutTimer = null;

function showCallout(text, kind = '') {
  const el = $('callout');
  el.firstElementChild.textContent = text;
  el.className = 'callout';
  void el.offsetWidth;
  el.className = `callout show ${kind}`;
  clearTimeout(calloutTimer);
  calloutTimer = setTimeout(() => { el.className = 'callout'; }, 1300);
}

function calloutForRoll(dice) {
  const wilds = wildCount(dice);
  if (wilds === 3) return ['TRIPLE WILD!', 'wild'];
  if (wilds === 2) return ['DOUBLE WILD!', 'wild'];
  return [`${diceLabel(dice).toUpperCase()}!`, wilds ? 'wild' : ''];
}

function shakeScreen(big = false) {
  const el = $('screen-game');
  el.classList.remove('shake', 'shake-big');
  void el.offsetWidth;
  el.classList.add(big ? 'shake-big' : 'shake');
  setTimeout(() => el.classList.remove('shake', 'shake-big'), 700);
}

function setBannerText(text) {
  const el = $('banner-text');
  el.innerHTML = '';
  [...text].forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.setProperty('--i', String(i));
    if (ch === ' ') s.className = 'sp';
    el.appendChild(s);
  });
}

// ---------- dice (3D cubes) ----------

// Each die is a cube with faces f0..f4 and f5 (★ wild). This is the cube
// rotation that brings face k to the front.
const FACE_ROT = [[0, 0], [0, -90], [0, 180], [0, 90], [-90, 0], [90, 0]];
const DIE_IDS = ['die-col', 'die-row', 'die-layer'];
const dieSpin = Object.fromEntries(DIE_IDS.map((id) => [id, { x: 0, y: 0 }]));

function orientDie(el, value, turns = 0) {
  const spin = dieSpin[el.id];
  const [tx, ty] = FACE_ROT[value === WILD ? 5 : value];
  const toward = (cur, target, extra) => {
    let d = (((target - cur) % 360) + 360) % 360;
    if (extra) return cur + 360 * extra + d;
    if (d > 180) d -= 360;
    return cur + d;
  };
  const k = DIE_IDS.indexOf(el.id);
  spin.x = toward(spin.x, tx, turns ? turns + (k === 0 ? 1 : 0) : 0);
  spin.y = toward(spin.y, ty, turns ? turns + (k === 1 ? 1 : 0) : 0);
  el.querySelector('.cube-die').style.transform =
    `rotateX(-16deg) rotateY(-20deg) rotateX(${spin.x}deg) rotateY(${spin.y}deg)`;
}

function setDieFace(el, value) {
  orientDie(el, value);
  el.classList.toggle('wild-face', value === WILD);
}

function renderDice() {
  if (!state.dice) return;
  setDieFace($('die-col'), state.dice.col);
  setDieFace($('die-row'), state.dice.row);
  setDieFace($('die-layer'), state.dice.layer);
}

function animateRoll(dice, done) {
  busy = true;
  renderActions();
  sfx.roll();
  const dice3 = [[$('die-col'), dice.col], [$('die-row'), dice.row], [$('die-layer'), dice.layer]];
  dice3.forEach(([d]) => {
    d.classList.remove('wild-face', 'rolling');
    void d.offsetWidth;
    d.classList.add('rolling');
  });
  dice3.forEach(([d, v]) => orientDie(d, v, 1 + Math.floor(Math.random() * 2)));
  setTimeout(() => {
    dice3.forEach(([d, v]) => { d.classList.remove('rolling'); setDieFace(d, v); });
    const wilds = wildCount(dice);
    if (wilds) sfx.wild();
    if (wilds === 2) voice.play('double-wild');
    if (wilds === 3) voice.play('triple-wild');
    const [text, kind] = calloutForRoll(dice);
    showCallout(text, kind);
    busy = false;
    done();
  }, 1000);
}

// ---------- local game flow ----------

function startLocalGame(players) {
  sfx.click();
  startingPlayer = 0;
  state = newGame(players, startingPlayer);
  ensureCube();
  cube.reset();
  $('btn-explode').classList.remove('on');
  syncLayerChips();
  closeTwist(false);
  $('banner').classList.add('hidden');
  confettiStop($('confetti'));
  show('screen-game');
  renderAll();
  fitHolo(true);
  cube.resize();
  maybeBotAct();
}

$('btn-roll').addEventListener('click', () => {
  const canRoll = (state?.phase === 'roll' || state?.phase === 'blocked') && myTurn() && !busy;
  if (!canRoll) return;
  doLocalRoll();
});

$('btn-place').addEventListener('click', () => {
  if (!state || !myTurn() || busy) return;
  const legal = selectableCells(state);
  if (legal.length === 1) onCellClick(legal[0]);
});

function doLocalRoll() {
  const dice = rollDice();
  animateRoll(dice, () => {
    const roller = state.players[state.current].name;
    const result = applyRoll(state, dice);
    // Look into the rolled layer so the space is easy to find.
    setFocusLayer(dice.layer === WILD ? null : dice.layer);
    renderAll();
    if (result === 'blocked') {
      sfx.pass();
    } else if (result === 'reroll') {
      sfx.pass();
      setMessage(`${roller} rolled ${diceLabel(dice)} — that's ${myTurn() ? 'your' : 'their'} own ring! Roll again.`);
    }
    maybeBotAct();
  });
}

function onCellClick(i) {
  if (busy || !state || !myTurn()) return;
  if (state.phase !== 'place' && state.phase !== 'blocked') return;
  if (!isLegal(state, i)) return;
  doLocalPlace(i);
}

function doLocalPlace(i) {
  const placedBy = state.current;
  const { result, stolen } = applyPlace(state, i);
  if (stolen !== null) {
    sfx.steal();
    shakeScreen();
    showCallout('STOLEN!', 'steal');
    voice.play('stolen', { delay: 120 });
  } else {
    sfx.place();
  }
  renderAll();
  if (stolen !== null && result !== 'win') {
    setMessage(`${state.players[placedBy].name} stole ${cellLabel(i)} from ${state.players[stolen].name}!`);
  }
  if (result === 'win') {
    endLocalGame(placedBy, null);
  } else {
    maybeBotAct();
  }
}

function doLocalTwist(t) {
  const twister = state.current;
  busy = true;
  renderActions();
  renderCube();
  sfx.twist();
  showCallout('TWIST!', 'twist');
  voice.play('twist');
  setMessage(`${state.players[twister].name} twists ${sliceLabel(t)}!`);
  cube.twist(t, () => {
    const r = applyTwist(state, t);
    busy = false;
    renderAll();
    if (r.result === 'win') {
      endLocalGame(r.winner, twister);
    } else {
      setMessage(`${state.players[twister].name} twisted ${sliceLabel(t)}. ${defaultMessage()}`);
      maybeBotAct();
    }
  });
}

function maybeBotAct() {
  if (!state || state.phase === 'over') return;
  const cur = state.players[state.current];
  if (!cur.isBot) return;
  const still = () => state && state.players[state.current].isBot;
  if (state.phase === 'roll') {
    setTimeout(() => {
      if (state.phase !== 'roll' || !still()) return;
      const t = chooseTwist(state, cur.level);
      if (t) doLocalTwist(t);
      else doLocalRoll();
    }, 900);
  } else if (state.phase === 'place') {
    setTimeout(() => {
      if (state.phase !== 'place' || !still()) return;
      const cell = chooseCell(state, cur.level);
      if (cell !== null) doLocalPlace(cell);
    }, 1000);
  } else if (state.phase === 'blocked') {
    setTimeout(() => {
      if (state.phase !== 'blocked' || !still()) return;
      const cell = chooseSteal(state, cur.level);
      if (cell !== null) doLocalPlace(cell);
      else doLocalRoll();
    }, 1100);
  }
}

// ---------- twisting ----------

function openTwist() {
  if (!state || state.phase !== 'roll' || !myTurn() || busy) return;
  twistOpen = true;
  $('side-panel').classList.add('twisting');
  $('twist-panel').classList.remove('hidden');
  buildSliceButtons();
  refreshTwistUI();
  renderCube();
  cube.highlightSlice(twistSel);
  cube.previewTwist(twistSel);
  setMessage('Pick a layer, column or row and a direction — then Twist it!');
  fitHolo();
}

function closeTwist(rerender = true) {
  twistOpen = false;
  $('side-panel').classList.remove('twisting');
  $('twist-panel').classList.add('hidden');
  if (cube) cube.highlightSlice(null);
  if (rerender && state) renderAll();
}

function buildSliceButtons() {
  const wrap = $('twist-slices');
  wrap.innerHTML = '';
  for (let k = 0; k < SIZE; k++) {
    const b = document.createElement('button');
    b.type = 'button';
    if (twistSel.axis === 'z') {
      b.textContent = LAYERS[k].name;
      b.className = 'layer';
      b.style.setProperty('--lc', LAYERS[k].hex);
    } else if (twistSel.axis === 'x') {
      b.textContent = COL_LABELS[k];
    } else {
      b.textContent = String(k + 1);
    }
    b.addEventListener('click', () => { sfx.click(); twistSel.k = k; refreshTwistUI(); cube.highlightSlice(twistSel); cube.previewTwist(twistSel); });
    wrap.appendChild(b);
  }
}

function refreshTwistUI() {
  $('twist-axis').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.axis === twistSel.axis));
  [...$('twist-slices').children].forEach((b, k) => b.classList.toggle('on', k === twistSel.k));
  $('twist-cw').classList.toggle('on', twistSel.dir === 1);
  $('twist-ccw').classList.toggle('on', twistSel.dir === -1);
  const ok = state && canTwist(state, twistSel);
  $('btn-twist-go').disabled = !ok;
  if (state && !ok && state.phase === 'roll') setMessage("That would just undo the last twist — pick another.");
  else if (state && state.phase === 'roll') setMessage(`Twist ${sliceLabel(twistSel)} ${twistSel.dir === 1 ? 'right' : 'left'}?`);
}

$('btn-twist').addEventListener('click', () => { sfx.click(); openTwist(); });
$('btn-twist-cancel').addEventListener('click', () => { sfx.click(); closeTwist(); });
$('btn-twist-go').addEventListener('click', () => {
  if (!state || !canTwist(state, twistSel) || !myTurn() || busy) return;
  const t = { ...twistSel };
  closeTwist();
  doLocalTwist(t);
});
$('twist-axis').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  sfx.click();
  twistSel.axis = b.dataset.axis;
  buildSliceButtons();
  refreshTwistUI();
  cube.highlightSlice(twistSel);
  cube.previewTwist(twistSel);
}));
$('twist-cw').addEventListener('click', () => { sfx.click(); twistSel.dir = 1; refreshTwistUI(); cube.previewTwist(twistSel); });
$('twist-ccw').addEventListener('click', () => { sfx.click(); twistSel.dir = -1; refreshTwistUI(); cube.previewTwist(twistSel); });

// ---------- the end ----------

function winTitle(st) {
  const n = st?.winLines?.length || 1;
  return ['RINGO!', 'DOUBLE RINGO!', 'TRIPLE RINGO!', 'QUADRUPLE RINGO!'][n - 1] || 'MEGA RINGO!';
}

function winSub(st, twister) {
  const n = st?.winLines?.length || 1;
  const name = st.players[st.winner].name;
  const how = n >= 2 ? `${name} wins with a legendary ${n}-line finish!` : `${name} wins!`;
  if (twister === null || twister === undefined) return how;
  if (twister === st.winner) return `${how} Finished with a twist!`;
  return `${how} Handed over by ${st.players[twister].name}'s twist!`;
}

function endLocalGame(winnerIdx, twister) {
  setFocusLayer(null);
  setTimeout(() => {
    shakeScreen(true);
    showBanner(winTitle(state), winSub(state, twister), winnerIdx);
    const n = state.winLines?.length || 1;
    voice.win(n);
    if (mode === 'ai' && state.players[winnerIdx].isBot) {
      sfx.lose();
    } else {
      sfx.win();
      const colors = [COLORS[winnerIdx].hex, '#ffd34d', '#ffffff'];
      confettiBurst($('confetti'), colors);
      for (let i = 1; i < n; i++) setTimeout(() => confettiBurst($('confetti'), colors), i * 450);
    }
  }, 900);
}

function showBanner(text, sub, winnerIdx) {
  $('banner-text').classList.toggle('legendary', /DOUBLE|TRIPLE|QUADRUPLE|MEGA/.test(text));
  setBannerText(text);
  $('banner-sub').innerHTML = winnerIdx !== null
    ? `<span class="player-color-dot" style="border-color:${COLORS[winnerIdx].hex}"></span>${sub}`
    : sub;
  $('btn-banner-again').classList.remove('hidden');
  $('banner').classList.remove('hidden');
}

$('btn-banner-again').addEventListener('click', () => {
  sfx.click();
  $('banner').classList.add('hidden');
  confettiStop($('confetti'));
  startingPlayer = (startingPlayer + 1) % state.players.length;
  state = newGame(state.players, startingPlayer);
  cube.reset();
  $('btn-explode').classList.remove('on');
  syncLayerChips();
  renderAll();
  maybeBotAct();
});

$('btn-banner-menu').addEventListener('click', () => { sfx.click(); quitToMenu(); });
$('btn-quit').addEventListener('click', () => { sfx.click(); quitToMenu(); });

function quitToMenu() {
  closeTwist(false);
  mode = null;
  state = null;
  busy = false;
  $('banner').classList.add('hidden');
  confettiStop($('confetti'));
  show('screen-menu');
}

// ---------- sound toggle ----------

$('btn-mute').addEventListener('click', () => {
  setMuted(!isMuted());
  $('btn-mute').textContent = isMuted() ? '🔇' : '🔊';
});

// ---------- install (add to home screen) ----------

let installPrompt = null;

function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMobile() {
  return isIOS() || /Android/i.test(navigator.userAgent);
}

function showInstallButton() {
  if (isStandalone()) return;
  $('install-label').textContent = isMobile() ? 'Add to Home Screen' : 'Install RINGO 3D';
  $('btn-install').classList.remove('hidden');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  showInstallButton();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install-label').textContent = 'Installed!';
  setTimeout(() => $('btn-install').classList.add('hidden'), 2500);
});

const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
const ICON_ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
const ICON_MENU = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
const ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/></svg>';

function installSteps() {
  if (isIOS()) {
    const safari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    return [
      [ICON_SHARE, safari
        ? 'Tap the <strong>Share</strong> button at the bottom of Safari.'
        : 'Tap the <strong>Share</strong> button in your browser\'s toolbar.'],
      [ICON_ADD, 'Scroll down and tap <strong>Add to Home Screen</strong>.'],
      [ICON_HOME, 'Tap <strong>Add</strong>. RINGO 3D lands on your home screen like any other app.'],
    ];
  }
  return [
    [ICON_MENU, 'Open your browser\'s menu (the <strong>&#8942;</strong> or <strong>&#8801;</strong> button).'],
    [ICON_ADD, 'Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.'],
    [ICON_HOME, 'Confirm, and RINGO 3D lands on your home screen like any other app.'],
  ];
}

$('btn-install').addEventListener('click', async () => {
  sfx.click();
  if (installPrompt) {
    const p = installPrompt;
    installPrompt = null;
    p.prompt();
    const { outcome } = await p.userChoice;
    if (outcome !== 'accepted' && !isMobile()) $('btn-install').classList.add('hidden');
    return;
  }
  const list = $('install-steps');
  list.innerHTML = '';
  installSteps().forEach(([icon, html]) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="install-icon">${icon}</span><span>${html}</span>`;
    list.appendChild(li);
  });
  $('install-modal').classList.remove('hidden');
});

$('btn-install-close').addEventListener('click', () => { sfx.click(); $('install-modal').classList.add('hidden'); });

if (isMobile() && !isStandalone()) showInstallButton();

// ---------- boot ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
