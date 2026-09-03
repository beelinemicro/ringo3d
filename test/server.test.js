// End-to-end tests for the RINGO 3D room server (server.js).  Run: npm test
//
// Spawns the real server on a test port — sandboxed to a temp dir so
// usage.log / stats.json in the repo are untouched, with bot pacing turned
// way down — and drives it with real WebSocket clients through the whole
// online protocol: presence, stats, lobby life-cycle, invite-era seat
// tokens, silent-drop survival, rejoin, ghost pruning, bots and their
// difficulty levels, reactions, twists, open rooms, and a full game.
//
// The Lambda (aws/ws-handler) speaks the identical protocol; this suite is
// the regression net for both halves' shared behavior.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { selectableCells, twistedBoard } from '../public/js/game.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3210;
const URL = `ws://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ringo3d-test-'));
const USAGE_LOG = path.join(TMP, 'usage.log');

// Whole-suite watchdog: a hung WebSocket must not hang CI forever.
const watchdog = setTimeout(() => {
  console.error('server tests timed out');
  process.exit(1);
}, 90_000);

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT,
    RINGO_BOT_DELAY: '25',
    RINGO_USAGE_LOG: USAGE_LOG,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});

function cleanup() {
  clearTimeout(watchdog);
  server.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A test client: records every message, with polling helpers to await one.
function client() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.msgs = [];
    ws.on('message', (d) => ws.msgs.push(JSON.parse(d)));
    ws.sendJ = (o) => ws.send(JSON.stringify(o));
    ws.last = (type) => [...ws.msgs].reverse().find((m) => m.type === type);
    ws.waitFor = async (type, pred = () => true, ms = 5000) => {
      const t0 = Date.now();
      for (;;) {
        const m = [...ws.msgs].reverse().find((x) => x.type === type && pred(x));
        if (m) return m;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for '${type}'`);
        await sleep(20);
      }
    };
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (String(d).includes('RINGO 3D is ready')) resolve(); });
  server.on('exit', () => reject(new Error('server died on startup')));
  setTimeout(() => reject(new Error('server never became ready')), 5000);
});

try {
  // --- presence count, visit log, stats push on hello ---
  {
    const p1 = await client();
    p1.sendJ({ type: 'hello' });
    await p1.waitFor('presence', (m) => m.count === 1);
    await p1.waitFor('rooms'); // the open-table list arrives with the hello
    const p2 = await client();
    p2.sendJ({ type: 'hello' });
    await p1.waitFor('presence', (m) => m.count === 2);
    p2.close();
    await p1.waitFor('presence', (m) => m.count === 1);
    assert.equal(fs.readFileSync(USAGE_LOG, 'utf8').trim().split('\n').length, 2, 'one log line per visit');
    assert.match(fs.readFileSync(USAGE_LOG, 'utf8'), /C[SD]T/, 'log has Central time');
    p1.close();
    console.log('presence + usage log ✔');
  }

  // --- lobby: seat tokens, bots, difficulty levels, permissions ---
  {
    const host = await client();
    host.sendJ({ type: 'create', name: 'Steve' });
    const lobby = await host.waitFor('lobby');
    assert.match(lobby.code, /^[A-Z]{4}$/, 'room code shape');
    assert.ok(lobby.token, 'seat token issued');
    const guest = await client();
    guest.sendJ({ type: 'join', code: lobby.code, name: 'Dad' });
    await host.waitFor('lobby', (m) => m.players.length === 2);

    host.sendJ({ type: 'addbot', level: 'hard' });
    let m = await guest.waitFor('lobby', (x) => x.players.length === 3);
    assert.deepEqual(
      [m.players[2].isBot, m.players[2].level], [true, 'hard'],
      'bot arrives with isBot flag and level');
    host.sendJ({ type: 'botlevel', i: 2 });
    await host.waitFor('lobby', (x) => x.players[2]?.level === 'easy');
    guest.sendJ({ type: 'botlevel', i: 2 }); // not the host
    await sleep(150);
    assert.equal(host.last('lobby').players[2].level, 'easy', 'non-host cannot change difficulty');
    host.sendJ({ type: 'addbot', level: 'bogus' });
    m = await host.waitFor('lobby', (x) => x.players.length === 4);
    assert.equal(m.players[3].level, 'normal', 'unknown level sanitized');
    host.sendJ({ type: 'removebot', i: 3 });
    await host.waitFor('lobby', (x) => x.players.length === 3);
    host.close();
    guest.close();
    console.log('lobby: tokens, bots, levels ✔');
  }

  // --- silent drop keeps the lobby seat; rejoin reclaims it; leave frees it ---
  {
    const host = await client();
    host.sendJ({ type: 'create', name: 'Steve' });
    const seat = await host.waitFor('lobby');
    host.terminate(); // phone backgrounded mid-invite
    await sleep(150);

    const guest = await client();
    guest.sendJ({ type: 'join', code: seat.code, name: 'Dad' });
    const m = await guest.waitFor('lobby');
    assert.equal(m.players[0].away, true, 'room survived; host shown away');

    const back = await client();
    back.sendJ({ type: 'rejoin', code: seat.code, token: seat.token });
    const l2 = await back.waitFor('lobby');
    assert.deepEqual([l2.you, l2.host, l2.players[0].away], [0, 0, false], 'host reclaimed seat 0');

    guest.sendJ({ type: 'leave' });
    await back.waitFor('lobby', (x) => x.players.length === 1);
    back.close();
    console.log('lobby survival + rejoin + leave ✔');
  }

  // --- ghost pruning at start; bots play; mid-game rejoin; reactions ---
  {
    const host = await client();
    host.sendJ({ type: 'create', name: 'Steve' });
    const seat = await host.waitFor('lobby');
    const guest = await client();
    guest.sendJ({ type: 'join', code: seat.code, name: 'Dad' });
    const guestSeat = await guest.waitFor('lobby');
    const ghost = await client();
    ghost.sendJ({ type: 'join', code: seat.code, name: 'Ghost' });
    await host.waitFor('lobby', (m) => m.players.length === 3);
    host.sendJ({ type: 'addbot', level: 'normal' });
    await host.waitFor('lobby', (m) => m.players.length === 4);
    ghost.terminate(); // never comes back
    await host.waitFor('lobby', (m) => m.players[2]?.away === true);

    host.sendJ({ type: 'react', e: '🎉' }); // game not started yet
    host.sendJ({ type: 'start' });
    const started = await host.waitFor('state', (m) => m.event?.kind === 'start');
    assert.deepEqual(
      started.state.players.map((p) => p.name), ['Steve', 'Dad', 'Chip'],
      'ghost pruned at start; bot kept');
    assert.equal(host.msgs.filter((m) => m.type === 'react').length, 0, 'pre-start reaction ignored');

    host.sendJ({ type: 'react', e: '😈' });
    const r = await guest.waitFor('react');
    assert.deepEqual([r.e, r.by], ['😈', 'Steve'], 'reaction broadcast with sender name');
    host.sendJ({ type: 'react', e: '💪' }); // within the spam brake
    host.sendJ({ type: 'react', e: '🖕' }); // not on the allowlist
    await sleep(150);
    assert.equal(guest.msgs.filter((m) => m.type === 'react').length, 1, 'spam brake + allowlist hold');

    guest.terminate(); // drop mid-game
    await host.waitFor('state', (m) => m.event?.kind === 'left');
    const back = await client();
    back.sendJ({ type: 'rejoin', code: seat.code, token: guestSeat.token });
    const rj = await back.waitFor('rejoined');
    assert.equal(rj.you, 1, 'rejoiner back in seat 1');
    const st = await back.waitFor('state', (m) => m.event?.kind === 'rejoined');
    assert.equal(st.state.players[1].disconnected, false, 'seat live again');
    await host.waitFor('state', (m) => m.event?.kind === 'rejoined');

    const bad = await client();
    bad.sendJ({ type: 'rejoin', code: seat.code, token: 'wrong' });
    await bad.waitFor('rejoin-failed');
    bad.close();

    host.close();
    back.close();
    console.log('ghost pruning + reactions + mid-game rejoin ✔');
  }

  // --- a full game vs a bot, played to a winner ---
  {
    const host = await client();
    host.sendJ({ type: 'create', name: 'Steve' });
    await host.waitFor('lobby');
    host.sendJ({ type: 'addbot', level: 'hard' });
    await host.waitFor('lobby', (m) => m.players.length === 2);
    host.sendJ({ type: 'start' });
    await host.waitFor('state', (m) => m.event?.kind === 'start');

    // Play any legal move on our turn until somebody wins.
    let finished = null;
    for (let tick = 0; tick < 3000 && !finished; tick++) {
      const m = host.last('state');
      const st = m.state;
      if (st.phase === 'over') { finished = m; break; }
      if (st.current === 0) {
        if (st.phase === 'roll') host.sendJ({ type: 'roll' });
        else {
          const cells = selectableCells(st);
          if (cells.length) host.sendJ({ type: 'place', cell: cells[0] });
          else host.sendJ({ type: 'roll' });
        }
      }
      await sleep(25);
    }
    assert.ok(finished, 'game reached a winner');
    const chipMoves = host.msgs.filter((m) => m.type === 'state' && m.event?.by === 'Chip').length;
    assert.ok(chipMoves > 0, 'bot actually played');
    assert.ok(finished.state.winLines?.length >= 1, 'the win names its line');

    host.close();
    console.log(`full game vs bot (${finished.state.players[finished.state.winner].name} won) ✔`);
  }

  // --- two humans, a watching relative, and a rematch that seats them ---
  {
    const a = await client();
    a.sendJ({ type: 'create', name: 'Steve' });
    const seat = await a.waitFor('lobby');
    const b = await client();
    b.sendJ({ type: 'join', code: seat.code, name: 'Dad' });
    await a.waitFor('lobby', (m) => m.players.length === 2);
    a.sendJ({ type: 'start' });
    await a.waitFor('state', (m) => m.event?.kind === 'start');

    const act = (ws, meIdx) => {
      const m = ws.last('state');
      if (!m || m.state.phase === 'over' || m.state.current !== meIdx) return;
      if (m.state.phase === 'roll') return ws.sendJ({ type: 'roll' });
      const cells = selectableCells(m.state);
      if (cells.length) ws.sendJ({ type: 'place', cell: cells[0] });
      else ws.sendJ({ type: 'roll' });
    };
    // Grandma settles in to watch and gets in line for the next game.
    const gw = await client();
    gw.sendJ({ type: 'watch', code: seat.code, name: 'Grandma' });
    await gw.waitFor('watching');
    gw.sendJ({ type: 'joinnext', on: true });
    await gw.waitFor('inline', (m) => m.on === true);

    let over = null;
    for (let tick = 0; tick < 3000 && !over; tick++) {
      act(a, 0);
      act(b, 1);
      await sleep(15);
      if (a.last('state')?.state.phase === 'over') over = a.last('state');
    }
    assert.ok(over, 'human-vs-human game reached a winner');

    // Host starts the rematch — the queued watcher gets a real seat.
    a.sendJ({ type: 'again' });
    const promo = await gw.waitFor('rejoined');
    assert.deepEqual([promo.you, !!promo.token], [2, true], 'watcher promoted into seat 2 with a token');
    const st2 = await gw.waitFor('state', (m) => m.event?.kind === 'start' && m.state.players.length === 3);
    assert.deepEqual(st2.state.players.map((p) => p.name), ['Steve', 'Dad', 'Grandma'], 'rematch seats the gallery');
    await a.waitFor('watchers', (m) => m.n === 0);
    gw.close();

    a.close();
    b.close();
    console.log('two humans + watcher promoted into the rematch ✔');
  }

  // --- twists over the wire: legal at the start of a turn, no instant undo ---
  {
    const a = await client();
    a.sendJ({ type: 'create', name: 'Steve' });
    const seat = await a.waitFor('lobby');
    const b = await client();
    b.sendJ({ type: 'join', code: seat.code, name: 'Dad' });
    await a.waitFor('lobby', (m) => m.players.length === 2);
    a.sendJ({ type: 'start' });
    const started = await a.waitFor('state', (m) => m.event?.kind === 'start');
    const first = started.state.current;
    const [me, other] = first === 0 ? [a, b] : [b, a];

    other.sendJ({ type: 'twist', axis: 'z', k: 0, dir: 1 }); // not their turn
    me.sendJ({ type: 'twist', axis: 'q', k: 9, dir: 1 }); // nonsense slice
    await sleep(150);
    assert.equal(me.msgs.filter((m) => m.type === 'state').length, 1, 'bad twists ignored');

    me.sendJ({ type: 'twist', axis: 'x', k: 4, dir: 1 });
    const tw = await other.waitFor('state', (m) => m.event?.kind === 'twist');
    assert.deepEqual(tw.event.twist, { axis: 'x', k: 4, dir: 1 }, 'twist echoed for animation');
    assert.equal(tw.state.current, 1 - first, 'a twist ends the turn');
    assert.deepEqual(tw.state.lastTwist, { axis: 'x', k: 4, dir: 1, by: first }, 'state remembers the twist');

    other.sendJ({ type: 'twist', axis: 'x', k: 4, dir: -1 }); // the forbidden undo
    await sleep(150);
    assert.equal(other.msgs.filter((m) => m.type === 'state').length, 2, 'instant undo refused');
    other.sendJ({ type: 'roll' });
    const rolled = await me.waitFor('state', (m) => ['roll', 'blocked', 'reroll'].includes(m.event?.kind));
    if (rolled.event.kind === 'roll') {
      other.sendJ({ type: 'twist', axis: 'z', k: 2, dir: 1 }); // mid-placement
      await sleep(150);
      assert.equal(me.last('state').event.kind, 'roll', 'no twisting once you have rolled');
      const cells = selectableCells(rolled.state);
      other.sendJ({ type: 'place', cell: cells[0] });
      const placed = await me.waitFor('state', (m) => ['place', 'win'].includes(m.event?.kind));
      assert.equal(placed.event.cell, cells[0], 'placement reported by cell index');
      assert.equal(placed.state.board[cells[0]], 1 - first, 'ring landed');
    }
    a.close();
    b.close();
    console.log('twists over the wire ✔');
  }

  // --- open rooms: the live list everyone on the site can see ---
  {
    const menu = await client(); // someone idling on the menu
    menu.sendJ({ type: 'hello' });
    const first = await menu.waitFor('rooms');
    assert.deepEqual(first.rooms, [], 'the list arrives with the hello, empty at first');

    // A room created without "open" stays invisible.
    const priv = await client();
    priv.sendJ({ type: 'create', name: 'Quiet', title: 'should not show' });
    await priv.waitFor('lobby');
    await sleep(150);
    assert.deepEqual(menu.last('rooms').rooms, [], 'a private room is never listed');

    // An open room appears, named, with who's there and seats left.
    const host = await client();
    host.sendJ({ type: 'create', name: 'Steve', open: true, title: 'Sunday night RINGO' });
    const seat = await host.waitFor('lobby');
    const listed = await menu.waitFor('rooms', (m) => m.rooms.length === 1);
    assert.deepEqual(
      [listed.rooms[0].code, listed.rooms[0].title, listed.rooms[0].host, listed.rooms[0].seats, listed.rooms[0].started],
      [seat.code, 'Sunday night RINGO', 'Steve', 4, false], 'the open room is listed by its name, with seats free');

    // A stranger drops in from the list; the seat count follows.
    const guest = await client();
    guest.sendJ({ type: 'join', code: seat.code, name: 'Passerby' });
    await host.waitFor('lobby', (m) => m.players.length === 2);
    const filled = await menu.waitFor('rooms', (m) => m.rooms[0]?.seats === 3);
    assert.deepEqual(filled.rooms[0].players.map((p) => p.name), ['Steve', 'Passerby'], 'the list names who is in the room');

    // Once it starts it becomes a game to watch, not a seat to take.
    host.sendJ({ type: 'start' });
    await host.waitFor('state', (m) => m.event?.kind === 'start');
    const playing = await menu.waitFor('rooms', (m) => m.rooms[0]?.started === true);
    assert.equal(playing.rooms[0].started, true, 'a room in play is flagged as such');

    // A room everyone has walked away from stops being advertised.
    host.terminate();
    guest.terminate();
    // Poll the newest list: an early empty one is still in this client's log,
    // so waitFor would match history rather than the state we're after.
    for (let i = 0; i < 200 && menu.last('rooms').rooms.length; i++) await sleep(25);
    assert.deepEqual(menu.last('rooms').rooms, [], 'a room with nobody in it is delisted');

    priv.close();
    menu.close();
    console.log('open rooms: live list for everyone ✔');
  }

  // --- the queue for the next game: position, re-numbering, missing out ---
  {
    const host = await client();
    host.sendJ({ type: 'create', name: 'Host' });
    const seat = await host.waitFor('lobby');
    const mate = await client();
    mate.sendJ({ type: 'join', code: seat.code, name: 'Mate' });
    await host.waitFor('lobby', (m) => m.players.length === 2);
    host.sendJ({ type: 'start' });
    await host.waitFor('state', (m) => m.event?.kind === 'start');

    // Five spectators line up behind two seated players: three seats free.
    const q = [];
    for (let i = 0; i < 5; i++) {
      const w = await client();
      w.sendJ({ type: 'watch', code: seat.code, name: 'Fan' + i });
      await w.waitFor('watching');
      w.sendJ({ type: 'joinnext', on: true });
      q.push(w);
    }
    for (let i = 0; i < 5; i++) {
      const m = await q[i].waitFor('inline', (x) => x.on === true && x.pos === i + 1);
      assert.equal(m.seats, 3, 'everyone is told how many seats a rematch frees');
    }

    // The one at the front changes their mind; the rest move up.
    q[0].sendJ({ type: 'joinnext', on: false });
    await q[0].waitFor('inline', (m) => m.on === false);
    await q[1].waitFor('inline', (m) => m.pos === 1);
    await q[4].waitFor('inline', (m) => m.pos === 4);

    // Play it out; the rematch seats three of the four still waiting.
    let over = null;
    for (let tick = 0; tick < 4000 && !over; tick++) {
      const m = host.last('state');
      if (m?.state.phase === 'over') { over = m; break; }
      const who = m.state.current === 0 ? host : mate;
      if (m.state.phase === 'roll') who.sendJ({ type: 'roll' });
      else {
        const cells = selectableCells(m.state);
        if (cells.length) who.sendJ({ type: 'place', cell: cells[0] });
        else who.sendJ({ type: 'roll' });
      }
      await sleep(12);
    }
    assert.ok(over, 'the game reached a winner');
    host.sendJ({ type: 'again' });

    const seated = [q[1], q[2], q[3]];
    for (const w of seated) await w.waitFor('rejoined');
    // The fifth misses out, and is told so along with their new place.
    const missed = await q[4].waitFor('inline', (m) => m.missed === true);
    assert.deepEqual([missed.on, missed.pos, missed.seats], [true, 1, 0],
      'the one left behind stays in line, moves to the front, and sees no seats free');
    assert.equal(q[4].last('rejoined'), undefined, 'and was not seated');

    [host, mate, ...q].forEach((w) => w.close());
    console.log('next-game queue: position, re-numbering, missing out ✔');
  }

  // --- spectator mode: watch, receive broadcasts, react, leave ---
  {
    const host = await client();
    host.sendJ({ type: 'create', name: 'Steve' });
    const seat = await host.waitFor('lobby');
    const w0 = await client();
    w0.sendJ({ type: 'watch', code: seat.code, name: 'Early' });
    await w0.waitFor('error', (m) => /hasn't started/.test(m.message));
    w0.close();

    const guest = await client();
    guest.sendJ({ type: 'join', code: seat.code, name: 'Dad' });
    await host.waitFor('lobby', (m) => m.players.length === 2);
    host.sendJ({ type: 'start' });
    await host.waitFor('state', (m) => m.event?.kind === 'start');

    const w = await client();
    w.sendJ({ type: 'watch', code: seat.code, name: 'Grandma' });
    const watching = await w.waitFor('watching');
    assert.equal(watching.code, seat.code, 'watcher admitted with full state');
    assert.equal(watching.state.players.length, 2, 'watcher sees the board');
    await host.waitFor('watchers', (m) => m.n === 1);

    host.sendJ({ type: 'roll' });
    await w.waitFor('state', (m) => ['roll', 'blocked', 'reroll'].includes(m.event?.kind));

    w.sendJ({ type: 'react', e: '😱' });
    const r = await host.waitFor('react');
    assert.deepEqual([r.e, r.by], ['😱', 'Grandma 👀'], 'watcher reaction reaches players, tagged');

    const before = host.msgs.filter((m) => m.type === 'state').length;
    w.sendJ({ type: 'roll' }); // spectators cannot play
    w.sendJ({ type: 'place', cell: 0 });
    await sleep(200);
    assert.equal(host.msgs.filter((m) => m.type === 'state').length, before, 'watcher moves are ignored');

    const bad = await client();
    bad.sendJ({ type: 'watch', code: 'XXXX', name: 'Lost' });
    await bad.waitFor('error', (m) => /No room/.test(m.message));
    bad.close();

    w.close();
    await host.waitFor('watchers', (m) => m.n === 0);
    host.close();
    guest.close();
    console.log('spectator mode ✔');
  }

  // --- abuse limits: one address can't open rooms without end ---
  // Last, because it deliberately spends this address's room allowance.
  {
    const made = [];
    let refusal = null;
    for (let i = 0; i < 30 && !refusal; i++) {
      const c = await client();
      c.sendJ({ type: 'create', name: 'Flood' + i });
      const got = await Promise.race([
        c.waitFor('lobby').then((m) => ({ lobby: m })),
        c.waitFor('error').then((m) => ({ error: m })),
      ]);
      if (got.error) refusal = got.error;
      else made.push(c);
    }
    assert.ok(refusal, 'a flood of rooms from one address is eventually refused');
    assert.match(refusal.message, /minute/, 'and told to wait, not just ignored');
    assert.ok(made.length >= 5, 'but an ordinary run of rooms goes through first');

    // Being refused a room must not break anything else: joining still works.
    const host = made[0];
    const code = host.last('lobby').code;
    const guest = await client();
    guest.sendJ({ type: 'join', code, name: 'Guest' });
    const joined = await guest.waitFor('lobby');
    assert.equal(joined.players.length, 2, 'joining an existing room is unaffected by the limit');

    guest.close();
    made.forEach((c) => c.close());
    console.log(`abuse limits: room flood refused after ${made.length} ✔`);
  }

  console.log('All RINGO 3D server tests passed ✔');
  cleanup();
  process.exit(0);
} catch (err) {
  console.error(err);
  cleanup();
  process.exit(1);
}
