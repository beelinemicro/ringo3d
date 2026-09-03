// RINGO 3D — client application: screens, the cube, dice, turn flow, twists,
// and online play (rooms, spectators, family stats).

import {
  GAME_VERSION, WILD, COL_LABELS, LAYERS, COLORS, SIZE,
  newGame, rollDice, applyRoll, applyPlace, applyTwist, canTwist, isLegal, selectableCells,
  diceLabel, cellLabel, sliceLabel, wildCount,
} from './game.js';
import { chooseCell, chooseSteal, chooseTwist } from './ai.js';
import { sfx, unlock, setMuted, isMuted } from './sound.js';
import { burst as confettiBurst, stop as confettiStop } from './confetti.js';
import { createCube } from './cube.js';
import { voice, preloadVoices } from './voice.js';
import { musicEnabled, setMusicEnabled, start as musicStart, stop as musicStop, preloadMusic } from './music.js';

const $ = (id) => document.getElementById(id);

// ---------- app state ----------

let mode = null; // 'local' | 'ai' | 'online' | 'watch'
let state = null; // game state (authoritative locally; server copy when online)
let busy = false; // dice or a twist animating
let startingPlayer = 0;
let cube = null; // the three.js view, created on first game
let twistOpen = false;
const twistSel = { axis: 'z', k: 0, dir: 1 };
let net = null; // { ws, code, myIndex, isHost, keepalive }

// Family tables: rooms whose host opened them to the family. Seeing the list
// — or opening a table of your own — needs the shared passphrase, kept on
// this device once entered. Rooms without it stay private and code-only.
const FAMILY_KEY = 'ringo3dFamilyPass';
let familyOk = false; // this device has entered the right passphrase
let familyEnabled = true; // the server has a passphrase configured at all
let familyTables = [];
let familyError = ''; // shown under the passphrase field after a bad try

// ---------- screens ----------

const SCREENS = ['screen-menu', 'screen-setup', 'screen-lobby', 'screen-game'];

function show(id) {
  SCREENS.forEach((s) => $(s).classList.toggle('hidden', s !== id));
  if (id === 'screen-menu') fitMenu();
}

// The menu keeps its roomy spacing unless it would overflow the viewport —
// then it compacts one notch at a time until it fits (see style.css).
function fitMenu() {
  const menu = $('screen-menu');
  if (menu.classList.contains('hidden')) return;
  const doc = document.documentElement;
  menu.classList.remove('tight', 'tighter');
  if (doc.scrollHeight <= innerHeight) return;
  menu.classList.add('tight');
  if (doc.scrollHeight <= innerHeight) return;
  menu.classList.add('tighter');
}

window.addEventListener('resize', fitMenu);
if (document.fonts?.ready) document.fonts.ready.then(fitMenu);

// ---------- menu ----------

$('btn-mode-local').addEventListener('click', () => { unlock(); preloadVoices(); preloadMusic(); sfx.click(); openSetup('local'); });
$('btn-mode-ai').addEventListener('click', () => { unlock(); preloadVoices(); preloadMusic(); sfx.click(); openSetup('ai'); });
$('btn-mode-online').addEventListener('click', () => { unlock(); preloadVoices(); preloadMusic(); sfx.click(); openSetup('online'); });
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
  $('btn-setup-go').classList.toggle('hidden', m === 'online');

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

  if (m === 'online') {
    $('setup-title').textContent = 'Play Online';
    body.innerHTML = `
      <div class="field">
        <label>Your name</label>
        <input type="text" id="online-name" maxlength="14" placeholder="Your name" value="${savedName()}">
      </div>
      <label class="open-opt" id="open-opt">
        <input type="checkbox" id="chk-open"> <span>Open table &mdash; family can drop in</span>
      </label>
      <div class="setup-actions">
        <button class="btn btn-primary" id="btn-create-room">Create a Room</button>
      </div>
      <div class="field">
        <label>&hellip;or join a room with a code</label>
        <input type="text" id="online-code" maxlength="4" placeholder="CODE" style="text-transform:uppercase; letter-spacing:0.3em; text-align:center;">
      </div>
      <div class="setup-actions">
        <button class="btn" id="btn-join-room">Join Room</button>
        <button class="btn btn-ghost" id="btn-watch-room">👀 Watch</button>
      </div>
      <p class="hint" id="online-status"></p>
      <div class="family hidden" id="family-block"></div>`;
    renderFamily();
    $('btn-create-room').addEventListener('click', () => connectOnline(null));
    $('btn-join-room').addEventListener('click', () =>
      connectOnline($('online-code').value.trim().toUpperCase()));
    $('btn-watch-room').addEventListener('click', () =>
      watchOnline($('online-code').value.trim().toUpperCase()));
  }

  show('screen-setup');
}

$('btn-setup-back').addEventListener('click', () => { sfx.click(); show('screen-menu'); });

function savedFamilyPass() {
  return localStorage.getItem(FAMILY_KEY) || '';
}

// Ask the server to unlock this connection. The reply arrives as a 'family'
// message on the presence socket.
function sendFamilyPass(pass) {
  if (presenceWs?.readyState === WebSocket.OPEN) {
    presenceWs.send(JSON.stringify({ type: 'family', pass }));
  }
}

// The block under the online setup: a passphrase prompt, or the live list.
function renderFamily() {
  const box = $('family-block');
  if (!box) return;
  const openOpt = $('open-opt');
  if (!familyEnabled) { // no passphrase configured — the feature is off
    box.classList.add('hidden');
    if (openOpt) openOpt.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  if (openOpt) {
    openOpt.classList.toggle('locked', !familyOk);
    const chk = $('chk-open');
    if (chk) chk.disabled = !familyOk;
    openOpt.title = familyOk ? '' : 'Unlock family tables below to open a table';
  }
  if (!familyOk) {
    box.innerHTML = `<h3>🏠 Family tables</h3>
      <p class="hint">Enter the family passphrase to see open tables and to leave your own open.</p>
      <div class="pass-row">
        <input type="password" id="family-pass" maxlength="40" placeholder="Family passphrase" autocomplete="current-password">
        <button class="btn btn-small" id="btn-family-go">Unlock</button>
      </div>
      <p class="hint" id="family-status">${familyError}</p>`;
    const go = () => {
      const pass = $('family-pass').value.trim();
      if (!pass) return;
      sfx.click();
      familyError = '';
      $('family-status').textContent = 'Checking…';
      sendFamilyPass(pass);
    };
    $('btn-family-go').addEventListener('click', go);
    $('family-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return;
  }
  box.innerHTML = '<h3>🏠 Family tables</h3><div id="table-list" class="table-list"></div>';
  renderTables();
}

function renderTables() {
  const list = $('table-list');
  if (!list) return;
  list.innerHTML = '';
  if (!familyTables.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No open tables right now. Create one with “Open table” ticked and the family will see it here.';
    list.appendChild(p);
    return;
  }
  familyTables.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'table-row';
    const who = t.players.map((p) => p.name + (p.isBot ? ' 🤖' : '') + (p.away ? ' 💤' : '')).join(', ');
    const full = t.seats === 0;
    const label = t.started ? 'in play' : (full ? 'full' : `${t.seats} seat${t.seats === 1 ? '' : 's'} free`);
    row.innerHTML = `<span class="table-who">${who || t.host}</span><span class="table-meta">${label}</span>`;
    const b = document.createElement('button');
    b.className = 'btn btn-small';
    b.type = 'button';
    if (t.started) {
      b.textContent = '👀 Watch';
      b.addEventListener('click', () => watchOnline(t.code));
    } else {
      b.textContent = 'Join';
      b.disabled = full;
      b.addEventListener('click', () => connectOnline(t.code));
    }
    row.appendChild(b);
    list.appendChild(row);
  });
}

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
      if (twistOpen) {
        // While choosing a twist, the chips pick the layer to twist.
        twistSel.axis = 'z';
        twistSel.k = z;
        selectTwist();
        return;
      }
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

// Reactions only make sense with people on other screens; watchers can't play.
function setupGameControls() {
  const online = mode === 'online' || mode === 'watch';
  $('react-bar').classList.toggle('hidden', !online);
  $('btn-joinnext').classList.toggle('hidden', mode !== 'watch');
  $('watch-count').classList.add('hidden'); // re-shown by the next watchers broadcast
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
  if (mode === 'watch') return false;
  if (mode === 'online') return state.current === net?.myIndex;
  return !state.players[state.current].isBot;
}

function renderChips() {
  const wrap = $('player-chips');
  wrap.innerHTML = '';
  wrap.classList.toggle('many', state.players.length >= 4);
  state.players.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    if (i === state.current && state.phase !== 'over') chip.classList.add('active');
    if (p.disconnected) chip.classList.add('disconnected');
    const you = mode === 'online' && i === net?.myIndex ? ' (you)' : '';
    const bot = p.isBot ? ' 🤖' : '';
    chip.innerHTML = `<span class="chip-ring" style="border-color:${COLORS[i].hex}"></span>${p.name}${you}${bot}`;
    const canRename = !p.disconnected && (mode === 'online' ? i === net?.myIndex : mode !== 'watch' && !p.isBot);
    if (canRename) {
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
  if (mode === 'online') {
    localStorage.setItem('ringoName', name);
    send({ type: 'rename', name });
    return; // the server broadcasts the updated roster
  }
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
  const watching = mode === 'watch';
  roll.classList.toggle('hidden', watching || state.phase === 'place');
  roll.disabled = !mine || (state.phase !== 'roll' && state.phase !== 'blocked');
  roll.textContent = state.phase === 'blocked' ? 'Roll Again!' : 'Roll!';
  twist.classList.toggle('hidden', watching || placing);
  twist.disabled = !mine || state.phase !== 'roll';
  place.classList.toggle('hidden', watching || !placing);
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
    if (mode === 'online' || mode === 'watch') {
      return myTurn() ? 'Your turn — roll the dice, or twist the cube!' : `Waiting for ${cur.name}…`;
    }
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
const CALLOUT_POP = 1.12; // the peak scale of the callout animation (style.css)

function showCallout(text, kind = '') {
  const el = $('callout');
  const span = el.firstElementChild;
  span.textContent = text;
  el.className = 'callout'; // no animation while we measure
  // Long shouts ("R-1-VIOLET!", "DOUBLE WILD!") are wider than the cube's
  // panel on a big screen, and the panel clips them. Measure at the CSS
  // size and shrink the font until it fits, leaving room for the pop
  // animation's 1.12 overshoot.
  span.style.fontSize = '';
  const avail = el.clientWidth * (0.96 / CALLOUT_POP);
  const natural = span.scrollWidth;
  if (natural > avail && avail > 0) {
    const size = parseFloat(getComputedStyle(span).fontSize) || 48;
    span.style.fontSize = `${Math.max(14, size * (avail / natural)).toFixed(1)}px`;
  }
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
  enterGame();
  maybeBotAct();
}

// A fresh board on screen: local start, online start, rematch, watching.
function enterGame() {
  ensureCube();
  cube.reset();
  $('btn-explode').classList.remove('on');
  syncLayerChips();
  closeTwist(false);
  setupGameControls();
  $('banner').classList.add('hidden');
  confettiStop($('confetti'));
  show('screen-game');
  renderAll();
  fitHolo(true);
  cube.resize();
}

$('btn-roll').addEventListener('click', () => {
  const canRoll = (state?.phase === 'roll' || state?.phase === 'blocked') && myTurn() && !busy;
  if (!canRoll) return;
  if (mode === 'online') { send({ type: 'roll' }); return; }
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
  if (mode === 'online') { send({ type: 'place', cell: i }); return; }
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
    endGame(placedBy, null);
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
      endGame(r.winner, twister);
    } else {
      setMessage(`${state.players[twister].name} twisted ${sliceLabel(t)}. ${defaultMessage()}`);
      maybeBotAct();
    }
  });
}

function maybeBotAct() {
  if (mode === 'online' || mode === 'watch' || !state || state.phase === 'over') return;
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
  if (cube.focus !== null) {
    twistSel.axis = 'z';
    twistSel.k = cube.focus;
  }
  renderCube();
  selectTwist();
  fitHolo();
}

// The panel, the layer chips and the cube all show the same chosen slice:
// a layer twist focuses that layer; a column or row twist clears the focus.
function selectTwist() {
  setFocusLayer(twistSel.axis === 'z' ? twistSel.k : null);
  buildSliceButtons();
  refreshTwistUI();
  cube.highlightSlice(twistSel);
  cube.previewTwist(twistSel);
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
    b.addEventListener('click', () => { sfx.click(); twistSel.k = k; selectTwist(); });
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
  // The button says what it will do — on phones it stands in for the message.
  const short = twistSel.axis === 'z' ? LAYERS[twistSel.k].name
    : twistSel.axis === 'x' ? `col ${COL_LABELS[twistSel.k]}` : `row ${twistSel.k + 1}`;
  $('btn-twist-go').textContent = ok ? `Twist ${short} ${twistSel.dir === 1 ? '↻' : '↺'}` : "Can't undo that";
  if (state && !ok && state.phase === 'roll') setMessage("That would just undo the last twist — pick another.");
  else if (state && state.phase === 'roll') setMessage(`Twist ${sliceLabel(twistSel)} ${twistSel.dir === 1 ? 'right' : 'left'}?`);
}

$('btn-twist').addEventListener('click', () => { sfx.click(); openTwist(); });
$('btn-twist-cancel').addEventListener('click', () => { sfx.click(); closeTwist(); });
$('btn-twist-go').addEventListener('click', () => {
  if (!state || !canTwist(state, twistSel) || !myTurn() || busy) return;
  const t = { ...twistSel };
  closeTwist();
  if (mode === 'online') { send({ type: 'twist', ...t }); return; }
  doLocalTwist(t);
});
$('twist-axis').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  sfx.click();
  twistSel.axis = b.dataset.axis;
  selectTwist();
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

function endGame(winnerIdx, twister) {
  setFocusLayer(null);
  setTimeout(() => {
    shakeScreen(true);
    showBanner(winTitle(state), winSub(state, twister), winnerIdx);
    const n = state.winLines?.length || 1;
    // Watchers celebrate every winner — they have no dog in the fight.
    const lost = (mode === 'ai' && state.players[winnerIdx].isBot)
      || (mode === 'online' && winnerIdx !== net?.myIndex);
    voice.win(n);
    if (lost) {
      sfx.lose();
    } else {
      sfx.win();
      const colors = [COLORS[winnerIdx].hex, '#ffd34d', '#ffffff'];
      confettiBurst($('confetti'), colors);
      for (let i = 1; i < n; i++) setTimeout(() => confettiBurst($('confetti'), colors), i * 450);
    }
  }, 900);
}

// Tuck the win card away to see the cube (tap outside it), or bring it back.
function peekBanner(on) {
  $('banner').classList.toggle('peek', on);
}

$('banner').addEventListener('click', (e) => {
  if (e.target === e.currentTarget || e.target.classList.contains('banner-rays')) { sfx.click(); peekBanner(true); }
});
$('btn-banner-peek').addEventListener('click', () => { sfx.click(); peekBanner(true); });
$('btn-banner-peekback').addEventListener('click', () => { sfx.click(); peekBanner(false); });

function showBanner(text, sub, winnerIdx) {
  peekBanner(false);
  $('banner-text').classList.toggle('legendary', /DOUBLE|TRIPLE|QUADRUPLE|MEGA/.test(text));
  setBannerText(text);
  $('banner-sub').innerHTML = winnerIdx !== null
    ? `<span class="player-color-dot" style="border-color:${COLORS[winnerIdx].hex}"></span>${sub}`
    : sub;
  $('btn-banner-again').classList.toggle('hidden', mode === 'watch' || (mode === 'online' && !net?.isHost));
  $('banner').classList.remove('hidden');
}

$('btn-banner-again').addEventListener('click', () => {
  sfx.click();
  voice.stopAll();
  $('banner').classList.add('hidden');
  confettiStop($('confetti'));
  if (mode === 'online') {
    send({ type: 'again' });
    return;
  }
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
  voice.stopAll();
  send({ type: 'leave' }); // frees a lobby seat for real (vs. a phone blip)
  if (net) { clearInterval(net.keepalive); net.ws.onclose = null; net.ws.close(); net = null; }
  clearSeat(); // leaving on purpose — don't auto-rejoin this game later
  watchInfo = null;
  rejoinAttempts = 0;
  stateQueue.length = 0;
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
  if (isMuted()) musicStop();
  else musicStart();
});

// The music switch lives on the landing page and in the game header.
function renderMusicButton() {
  const on = musicEnabled();
  document.querySelectorAll('.btn-music').forEach((b) => {
    b.classList.toggle('off', !on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Music: on (tap to turn off)' : 'Music: off (tap to turn on)';
  });
}

document.querySelectorAll('.btn-music').forEach((b) => b.addEventListener('click', () => {
  unlock();
  sfx.click();
  setMusicEnabled(!musicEnabled());
  renderMusicButton();
}));

renderMusicButton();

// ---------- online play ----------

function onlineStatus(text) {
  const el = $('online-status');
  if (el) el.textContent = text;
}

// The seat token lets us reclaim our spot in a game after a dropped
// connection (phone locked, app switched, wifi blip). Rooms expire after
// 24h, so older saved seats are useless.
function saveSeat(code, token) {
  localStorage.setItem('ringo3dSeat', JSON.stringify({ code, token, ts: Date.now() }));
}

function savedSeat() {
  try {
    const s = JSON.parse(localStorage.getItem('ringo3dSeat'));
    if (s && s.code && s.token && Date.now() - s.ts < 24 * 3600 * 1000) return s;
  } catch { /* corrupt entry */ }
  return null;
}

function clearSeat() {
  localStorage.removeItem('ringo3dSeat');
}

let rejoinAttempts = 0;
let watchInfo = null; // spectating: remembered so a dropped watch quietly resumes

function scheduleRejoin() {
  const seat = savedSeat();
  if (!seat || rejoinAttempts >= 5) return false;
  rejoinAttempts++;
  setTimeout(() => {
    if (!net) connectGame({ type: 'rejoin', code: seat.code, token: seat.token });
  }, rejoinAttempts === 1 ? 300 : 2500);
  return true;
}

// Phones kill the socket the instant the browser is backgrounded. The
// moment we're foregrounded again, sit straight back down — and after any
// real time away, don't trust an existing socket: drop it and rejoin.
let hiddenSince = null;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenSince = Date.now();
    return;
  }
  stopTitleFlash();
  const away = hiddenSince ? Date.now() - hiddenSince : 0;
  hiddenSince = null;
  if (mode === 'watch' && watchInfo) {
    if (net && away > 20_000) {
      const ws = net.ws;
      ws.onclose = null;
      clearInterval(net.keepalive);
      net = null;
      ws.close();
    }
    if (!net) {
      rejoinAttempts = 1;
      connectGame({ type: 'watch', ...watchInfo });
    }
    return;
  }
  const seat = savedSeat();
  if (!seat) return;
  const inGame = mode === 'online' && state && state.phase !== 'over';
  const inLobby = !$('screen-lobby').classList.contains('hidden');
  if (!inGame && !inLobby) return;
  if (net && away > 20_000) {
    const ws = net.ws;
    ws.onclose = null;
    clearInterval(net.keepalive);
    net = null;
    ws.close();
  }
  if (!net) {
    rejoinAttempts = 1;
    connectGame({ type: 'rejoin', code: seat.code, token: seat.token });
  }
});

function wsUrl() {
  // A deployed copy sets window.RINGO_WS_URL in config.js; local dev uses
  // the same host that served the page (server.js).
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return window.RINGO_WS_URL || `${proto}://${location.host}`;
}

function connectGame(firstMsg) {
  let ws;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    onlineStatus('Could not connect. Run the game with "npm start" to play online.');
    return;
  }
  // API Gateway drops idle sockets after 10 minutes — keep it warm.
  const keepalive = setInterval(() => send({ type: 'ping' }), 4 * 60 * 1000);
  net = { ws, code: null, myIndex: null, isHost: false, keepalive };

  ws.onopen = () => send(firstMsg);
  ws.onerror = () => onlineStatus('Could not connect. Run the game with "npm start" to play online.');
  ws.onclose = () => {
    clearInterval(keepalive);
    net = null;
    if (mode === 'watch' && watchInfo) {
      if (rejoinAttempts < 5) {
        rejoinAttempts++;
        setMessage('Connection lost — reconnecting…');
        setTimeout(() => {
          if (!net && watchInfo) connectGame({ type: 'watch', ...watchInfo });
        }, rejoinAttempts === 1 ? 300 : 2500);
      } else {
        quitToMenu();
      }
      return;
    }
    const inGame = mode === 'online' && state && state.phase !== 'over';
    const inLobby = !$('screen-lobby').classList.contains('hidden');
    if ((inGame || inLobby) && scheduleRejoin()) {
      if (inGame) setMessage('Connection lost — reconnecting…');
      else $('lobby-status').textContent = 'Connection lost — reconnecting…';
      return;
    }
    if (inGame) {
      showBanner('OOPS', 'Connection lost. Head back to the menu.', null);
      $('btn-banner-again').classList.add('hidden');
    } else if (inLobby) {
      show('screen-menu');
    }
  };
  ws.onmessage = (ev) => handleServer(JSON.parse(ev.data));
}

function connectOnline(joinCode) {
  const name = ($('online-name').value.trim() || 'Player').slice(0, 14);
  localStorage.setItem('ringoName', name);
  if (joinCode !== null && joinCode.length !== 4) {
    onlineStatus('Room codes are 4 letters.');
    return;
  }
  sfx.click();
  onlineStatus('Connecting…');
  if (joinCode !== null) {
    connectGame({ type: 'join', code: joinCode, name });
    return;
  }
  // An open table is listed for the family; the server checks the passphrase.
  const open = familyOk && !!$('chk-open')?.checked;
  connectGame({ type: 'create', name, open, pass: open ? savedFamilyPass() : undefined });
}

function watchOnline(code) {
  const name = ($('online-name').value.trim() || 'Watcher').slice(0, 14);
  localStorage.setItem('ringoName', name);
  if (code.length !== 4) {
    onlineStatus('Room codes are 4 letters.');
    return;
  }
  sfx.click();
  onlineStatus('Connecting…');
  watchInfo = { code, name };
  connectGame({ type: 'watch', code, name });
}

function send(msg) {
  if (net?.ws?.readyState === WebSocket.OPEN) {
    net.ws.send(JSON.stringify(msg));
    return;
  }
  // Tap landed on a dead socket — recover the seat instead of eating it.
  const seat = savedSeat();
  if (seat && mode === 'online' && !net) {
    rejoinAttempts = 1;
    connectGame({ type: 'rejoin', code: seat.code, token: seat.token });
  }
}

// ---------- stale-version banner ----------

let updateBannerShown = false;

function checkVersion(serverVersion) {
  if (updateBannerShown || !serverVersion || serverVersion <= GAME_VERSION) return;
  updateBannerShown = true;
  $('update-banner').classList.remove('hidden');
}

$('update-banner').addEventListener('click', () => {
  const inGame = mode === 'online' && state && state.phase !== 'over';
  if (!inGame || confirm('Refreshing now will drop you out of the current game. Refresh anyway?')) {
    location.reload();
  }
});

// The room code as four ticket letters that flip into place.
function setRoomCode(code) {
  const el = $('lobby-code');
  if (el.dataset.code === code) return;
  el.dataset.code = code;
  el.innerHTML = '';
  [...code].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'code-letter';
    s.textContent = ch;
    s.style.setProperty('--i', String(i));
    el.appendChild(s);
  });
}

// State broadcasts that arrive while a twist is still turning on screen
// wait their turn, so the cube never re-syncs mid-animation.
const stateQueue = [];
let twistAnimating = false;

function handleServer(msg) {
  checkVersion(msg.v);
  switch (msg.type) {
    case 'react':
      spawnReaction(msg.e, msg.by);
      break;

    case 'watching': {
      mode = 'watch';
      net.code = msg.code;
      net.myIndex = null;
      net.isHost = false;
      rejoinAttempts = 0;
      state = msg.state;
      $('btn-joinnext').dataset.on = '';
      $('btn-joinnext').textContent = '🙋 Play in the next game';
      enterGame();
      setMessage(`Watching room ${msg.code} — ${defaultMessage()}`);
      if (state.phase === 'over') showBanner(winTitle(state), winSub(state, null), state.winner);
      break;
    }

    case 'watchers': {
      const el = $('watch-count');
      el.textContent = `👀 ${msg.n}`;
      el.classList.toggle('hidden', msg.n === 0);
      break;
    }

    case 'inline': {
      const b = $('btn-joinnext');
      b.dataset.on = msg.on ? '1' : '';
      b.textContent = msg.on
        ? '✔ In line for the next game — tap to step out'
        : '🙋 Play in the next game';
      break;
    }

    case 'error':
      onlineStatus(msg.message);
      $('lobby-status').textContent = msg.message;
      break;

    // We're back in our seat after a dropped connection — or a watcher
    // just got promoted into the next game. Restore identity and jump
    // straight to the board (the state broadcast follows).
    case 'rejoined': {
      mode = 'online';
      watchInfo = null;
      rejoinAttempts = 0;
      net.code = msg.code;
      net.myIndex = msg.you;
      net.isHost = msg.you === msg.host;
      saveSeat(msg.code, msg.token);
      state = null;
      ensureCube();
      cube.reset();
      setupGameControls();
      $('banner').classList.add('hidden');
      confettiStop($('confetti'));
      show('screen-game');
      break;
    }

    case 'rejoin-failed': {
      clearSeat();
      const wasInGame = mode === 'online' && state && state.phase !== 'over';
      const wasInLobby = !$('screen-lobby').classList.contains('hidden');
      if (net) { net.ws.onclose = null; net.ws.close(); clearInterval(net.keepalive); net = null; }
      if (wasInGame) {
        showBanner('OOPS', 'Connection lost. Head back to the menu.', null);
        $('btn-banner-again').classList.add('hidden');
      } else if (wasInLobby) {
        show('screen-menu');
      }
      break;
    }

    case 'lobby': {
      mode = 'online';
      net.code = msg.code;
      net.myIndex = msg.you;
      net.isHost = msg.you === msg.host;
      rejoinAttempts = 0;
      if (msg.token) saveSeat(msg.code, msg.token);
      setRoomCode(msg.code);
      const list = $('lobby-players');
      list.innerHTML = '';
      msg.players.forEach((p, i) => {
        const li = document.createElement('li');
        li.innerHTML = `${colorDot(i)}${p.name}${p.isBot ? ' 🤖' : ''}${p.away ? ' 💤' : ''}${i === msg.host ? ' 👑' : ''}${i === msg.you ? ' (you)' : ''}`;
        if (p.away) li.classList.add('away');
        if (p.isBot && net.isHost) {
          const x = document.createElement('span');
          x.className = 'kick';
          x.textContent = '✕';
          x.title = 'Remove computer player';
          x.addEventListener('click', () => { sfx.click(); send({ type: 'removebot', i }); });
          li.appendChild(x);
        }
        if (p.isBot) {
          const lvl = document.createElement('span');
          lvl.className = 'bot-level';
          lvl.textContent = p.level || 'normal';
          if (net.isHost) {
            lvl.classList.add('editable-level');
            lvl.title = 'Tap to change difficulty';
            lvl.addEventListener('click', () => { sfx.click(); send({ type: 'botlevel', i }); });
          }
          li.appendChild(lvl);
        }
        if (i === msg.you) {
          li.classList.add('editable');
          li.title = 'Tap to rename';
          li.innerHTML += '<span class="pencil">✏️</span>';
          li.addEventListener('click', () => {
            const entered = prompt('New name:', p.name);
            if (entered === null) return;
            const name = entered.trim().slice(0, 14);
            if (!name || name === p.name) return;
            sfx.click();
            localStorage.setItem('ringoName', name);
            send({ type: 'rename', name });
          });
        }
        list.appendChild(li);
      });
      const here = msg.players.filter((p) => !p.away).length;
      $('btn-lobby-start').classList.toggle('hidden', !net.isHost);
      $('btn-lobby-start').disabled = here < 2;
      $('btn-lobby-addbot').classList.toggle('hidden', !net.isHost || msg.players.length >= 5);
      $('lobby-status').textContent = net.isHost
        ? (here < 2 ? 'Waiting for at least one more player…' : 'Ready when you are!')
        : 'Waiting for the host to start the game…';
      show('screen-lobby');
      break;
    }

    case 'state':
      if (twistAnimating) stateQueue.push(msg);
      else applyServerState(msg);
      break;
  }
}

function drainStateQueue() {
  while (stateQueue.length && !twistAnimating) applyServerState(stateQueue.shift());
}

function applyServerState(msg) {
  const prev = state;
  const ev = msg.event || {};

  // A twist (winning or not) turns on every screen before the new
  // arrangement lands — the cube animates from the board it is showing.
  if (ev.twist && prev && cube && !$('screen-game').classList.contains('hidden')) {
    twistAnimating = true;
    busy = true;
    closeTwist(false);
    renderActions();
    renderCube();
    sfx.twist();
    showCallout('TWIST!', 'twist');
    voice.play('twist');
    setMessage(`${ev.by} twists ${sliceLabel(ev.twist)}!`);
    cube.twist(ev.twist, () => {
      twistAnimating = false;
      busy = false;
      state = msg.state;
      renderAll();
      if (ev.kind === 'win') {
        endGame(state.winner, state.lastTwist?.by ?? null);
      } else {
        setMessage(`${ev.by} twisted ${sliceLabel(ev.twist)}. ${defaultMessage()}`);
        if (myTurn() && state.phase === 'roll') { sfx.yourTurn(); notifyTurn(); }
      }
      drainStateQueue();
    });
    return;
  }

  state = msg.state;

  if (ev.kind === 'start') {
    enterGame();
    if (myTurn()) { sfx.yourTurn(); notifyTurn(); }
    return;
  }

  if (ev.kind === 'roll' || ev.kind === 'blocked' || ev.kind === 'reroll') {
    animateRoll(ev.dice, () => {
      setFocusLayer(ev.dice.layer === WILD ? null : ev.dice.layer);
      renderAll();
      if (ev.kind === 'blocked') {
        sfx.pass();
      } else if (ev.kind === 'reroll') {
        sfx.pass();
        setMessage(`${ev.by} rolled ${diceLabel(ev.dice)} — ${myTurn() ? 'your' : 'their'} own ring is there! Roll again.`);
      }
    });
    return;
  }

  if (ev.kind === 'place' || ev.kind === 'win') {
    const stolen = ev.stolen !== null && ev.stolen !== undefined;
    if (stolen) {
      sfx.steal();
      shakeScreen();
      showCallout('STOLEN!', 'steal');
      voice.play('stolen', { delay: 120 });
    } else {
      sfx.place();
    }
    renderAll();
    if (ev.kind === 'win') {
      endGame(state.winner, null);
    } else {
      if (stolen) {
        setMessage(`${ev.by} stole ${cellLabel(ev.cell)} from ${state.players[ev.stolen].name}!`);
        setTimeout(() => { if (state === msg.state) renderAll(); }, 2000);
      }
      if (myTurn() && state.phase === 'roll') { sfx.yourTurn(); notifyTurn(); }
    }
    return;
  }

  if (ev.kind === 'left') {
    renderAll();
    setMessage(`${ev.name} left the game.`);
    setTimeout(() => { if (state === msg.state) renderAll(); }, 2000);
    return;
  }

  if (ev.kind === 'rejoined') {
    if (!prev) { enterGame(); } else renderAll();
    if (state.phase === 'over') {
      showBanner(winTitle(state), winSub(state, null), state.winner);
    } else {
      setMessage(`${ev.name} is back!`);
      setTimeout(() => { if (state === msg.state) renderAll(); }, 2000);
      if (myTurn() && ev.name === state.players[net.myIndex]?.name) {
        sfx.yourTurn();
        notifyTurn();
      }
    }
    return;
  }

  if (ev.kind === 'rename') {
    renderAll();
    setMessage(`${ev.from} is now ${ev.to}.`);
    setTimeout(() => { if (state === msg.state) renderAll(); }, 2000);
    return;
  }

  // Fallback (e.g. a fresh board after rejoining mid-render).
  if (!prev) enterGame();
  else renderAll();
}

$('btn-lobby-start').addEventListener('click', () => { sfx.click(); send({ type: 'start' }); });
$('btn-lobby-leave').addEventListener('click', () => { sfx.click(); quitToMenu(); });
$('btn-lobby-addbot').addEventListener('click', () => {
  sfx.click();
  send({ type: 'addbot', level: localStorage.getItem('ringoDiff') || 'normal' });
});
$('btn-joinnext').addEventListener('click', () => {
  sfx.click();
  send({ type: 'joinnext', on: !$('btn-joinnext').dataset.on });
});

// One tap to text the room to the family: native share sheet where the
// browser has one (phones), clipboard everywhere else.
$('btn-lobby-share').addEventListener('click', async () => {
  sfx.click();
  if (!net?.code) return;
  const url = `${location.origin}${location.pathname}?join=${net.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'RINGO 3D', text: 'Join my RINGO 3D game!', url }); } catch { /* sheet closed */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    $('lobby-status').textContent = 'Invite link copied — paste it to your family!';
  } catch {
    $('lobby-status').textContent = url;
  }
});

// ---------- emoji reactions ----------

const REACTIONS = ['🎉', '😂', '😱', '😈', '💪', '❤️'];
let lastReactAt = 0;

(function buildReactBar() {
  const bar = $('react-bar');
  REACTIONS.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = e;
    b.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastReactAt < 1000) return;
      lastReactAt = now;
      sfx.click();
      send({ type: 'react', e });
    });
    bar.appendChild(b);
  });
})();

function spawnReaction(emoji, by) {
  sfx.react();
  const el = document.createElement('div');
  el.className = 'react-fly';
  el.style.left = `${10 + Math.random() * 75}%`;
  el.style.setProperty('--rot', `${(Math.random() * 36 - 18).toFixed(0)}deg`);
  const big = document.createElement('span');
  big.className = 'react-emoji';
  big.textContent = emoji;
  const name = document.createElement('span');
  name.className = 'react-name';
  name.textContent = by;
  el.append(big, name);
  $('react-layer').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- hall of fame & family stats ----------

function renderHallOfFame(top) {
  if (!top || top.length === 0) {
    $('hof').classList.add('hidden');
    fitMenu();
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const list = $('hof-list');
  list.innerHTML = '';
  top.forEach((s, i) => {
    const li = document.createElement('li');
    const w = `${s.wins} win${s.wins === 1 ? '' : 's'}`;
    const l = s.losses ? ` · ${s.losses} loss${s.losses === 1 ? '' : 'es'}` : '';
    const fire = s.streak >= 2 ? ` 🔥${s.streak}` : '';
    li.textContent = `${medals[i] || '•'} ${s.name} — ${w}${l}${fire}`;
    list.appendChild(li);
  });
  $('hof').classList.remove('hidden');
  fitMenu();
}

function renderFullStats(msg) {
  const body = $('stats-players');
  body.innerHTML = '';
  msg.players.forEach((s) => {
    const tr = document.createElement('tr');
    const star = s.legendary ? ` ⭐${s.legendary > 1 ? `×${s.legendary}` : ''}` : '';
    [s.name + star, s.wins, s.losses, s.streak >= 2 ? `🔥${s.streak}` : s.streak || '–', s.bestStreak || '–']
      .forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i === 0) td.className = 'stats-name';
        tr.appendChild(td);
      });
    body.appendChild(tr);
  });
  const h2h = $('stats-h2h');
  h2h.innerHTML = '';
  if (msg.h2h.length === 0) {
    h2h.textContent = 'No head-to-head games yet — rivalries start with two humans in one room.';
  }
  msg.h2h.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'stats-h2h-row';
    const lead = r.aWins === r.bWins ? 'tied with' : (r.aWins > r.bWins ? 'leads' : 'trails');
    row.textContent = `${r.a} ${r.aWins} – ${r.bWins} ${r.b}`;
    row.title = `${r.a} ${lead} ${r.b}`;
    h2h.appendChild(row);
  });
  const hasLegends = msg.legends && msg.legends.length > 0;
  $('stats-legends-h').classList.toggle('hidden', !hasLegends);
  $('stats-legends').classList.toggle('hidden', !hasLegends);
  if (hasLegends) {
    const kind = { 2: 'DOUBLE', 3: 'TRIPLE', 4: 'QUADRUPLE' };
    const box = $('stats-legends');
    box.innerHTML = '';
    msg.legends.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'stats-h2h-row';
      const day = (l.central || '').split(' ')[0];
      row.textContent = `🌟 ${l.name}${l.isBot ? ' 🤖' : ''} — ${kind[l.lines] || l.lines + '-line'} RINGO · ${day}`;
      box.appendChild(row);
    });
  }
  $('stats-modal').classList.remove('hidden');
}

$('btn-fullstats').addEventListener('click', () => {
  sfx.click();
  if (presenceWs?.readyState === WebSocket.OPEN) {
    presenceWs.send(JSON.stringify({ type: 'fullstats' }));
  }
});

// ---------- turn nudges ----------

const BASE_TITLE = document.title;
let titleFlash = null;

function notifyTurn() {
  navigator.vibrate?.([100, 60, 100]);
  showCallout('YOUR TURN!', 'turn');
  if (document.hidden && !titleFlash) {
    let on = false;
    titleFlash = setInterval(() => {
      on = !on;
      document.title = on ? '🎲 YOUR TURN — RINGO 3D!' : BASE_TITLE;
    }, 1000);
  }
}

function stopTitleFlash() {
  if (!titleFlash) return;
  clearInterval(titleFlash);
  titleFlash = null;
  document.title = BASE_TITLE;
}

// ---------- presence (the "N people here now" badge) ----------

// A second, lightweight socket that lives for the whole visit — separate
// from the game socket so browsing the menu counts the same as playing.
let presenceRetry = 5000;
let presenceWs = null; // also carries stats requests from the menu

function startPresence() {
  let ws;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    return; // opened from disk with no server — no badge, no retries
  }
  presenceWs = ws;
  let keepalive = null;
  ws.onopen = () => {
    presenceRetry = 5000;
    ws.send(JSON.stringify({ type: 'hello' }));
    // Re-unlock the family list automatically on this device.
    const saved = savedFamilyPass();
    if (saved) ws.send(JSON.stringify({ type: 'family', pass: saved }));
    keepalive = setInterval(() => ws.send(JSON.stringify({ type: 'presence-ping' })), 4 * 60 * 1000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    checkVersion(msg.v);
    if (msg.type === 'presence') {
      $('presence-count').textContent = msg.count === 1
        ? 'Just you here right now'
        : `${msg.count} people here now`;
      $('presence').classList.remove('hidden');
      fitMenu();
    } else if (msg.type === 'stats') {
      renderHallOfFame(msg.top);
    } else if (msg.type === 'fullstats') {
      renderFullStats(msg);
    } else if (msg.type === 'family') {
      familyEnabled = msg.enabled !== false;
      familyOk = !!msg.ok;
      if (familyOk) {
        const typed = $('family-pass')?.value.trim();
        if (typed) localStorage.setItem(FAMILY_KEY, typed);
        familyError = '';
      } else {
        localStorage.removeItem(FAMILY_KEY);
        familyTables = [];
        familyError = familyEnabled
          ? "That's not the family passphrase."
          : 'Family tables are switched off on this server.';
      }
      renderFamily();
    } else if (msg.type === 'tables') {
      familyTables = msg.tables || [];
      renderTables();
    }
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    clearInterval(keepalive);
    presenceWs = null;
    setTimeout(startPresence, presenceRetry);
    presenceRetry = Math.min(presenceRetry * 2, 60000);
  };
}

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
  fitMenu();
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  showInstallButton();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install-label').textContent = 'Installed!';
  setTimeout(() => { $('btn-install').classList.add('hidden'); fitMenu(); }, 2500);
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

startPresence();

// Arriving by invite link (?join=CODE): straight to the join form.
{
  const code = new URLSearchParams(location.search).get('join');
  if (code && /^[A-Za-z]{4}$/.test(code)) {
    openSetup('online');
    $('online-code').value = code.toUpperCase();
    history.replaceState(null, '', location.pathname);
  }
}
