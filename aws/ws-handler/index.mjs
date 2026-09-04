// RINGO 3D WebSocket handler — the AWS Lambda twin of server.js.
//
// API Gateway WebSocket routes ($connect / $disconnect / $default) all land
// here. Room state lives in DynamoDB (single table, on-demand):
//   ROOM#<code>     — players, host, started flag, game state, rematch rotation
//   CONN#<id>       — reverse lookup so $disconnect can find its room
//   PRESENCE#<id>   — one per open page (the client says 'hello' on load);
//                     short TTL, refreshed by keepalive pings, so the live
//                     "people here now" count self-heals from missed disconnects
//   LOG#<utc>#<id>  — permanent visit log: UTC + Central time and source IP
//
// Writes use optimistic locking: every room carries a `rev` counter and saves
// are conditional on the rev they read. Simultaneous joins (five family
// members tapping the same code at once) retry instead of clobbering each
// other.
//
// The deploy script copies public/js/game.js next to this file so the exact
// same rules run in the cloud, in the browser, and in local server.js.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { createHash } from 'node:crypto';
import { GAME_VERSION, newGame, rollDice, applyRoll, applyPlace, applyTwist, canTwist, isLegal, nextPlayer } from './game.js';
import { chooseCell, chooseSteal, chooseTwist } from './ai.js';

const TABLE = process.env.RINGO_TABLE || 'ringo3d';
const TTL_HOURS = 24;
const LOBBY_TTL_HOURS = 1; // a room that never started is reclaimed sooner
const IDLE_GAME_HOURS = 1; // a started game everyone walked away from
const MAX_ROOM_PLAYERS = 5;

// Abuse limits. The game is open to anyone, so a bot could otherwise hold
// thousands of sockets open and make a room on each: that fills the 4-letter
// code space, bloats the open-table broadcast, and costs real money here.
// Rate-limiting per address matters more than a global cap, since a global
// cap alone lets one attacker lock everybody else out by filling it.
// A whole household shares one public address, so the per-address limit is
// set well above anything a family could hit while still stopping a bot.
const MAX_ROOMS_PER_IP = Number(process.env.RINGO_MAX_ROOMS_PER_IP || 20);
const MAX_ROOMS_PER_WINDOW = 400; // everyone together, a backstop
const ROOM_WINDOW_MS = 10 * 60_000;
const MAX_ROOMS_LISTED = 25; // open rooms sent to each menu
const REACT_GAP_MS = 900; // one reaction per connection per second

// A room is private by default: invisible, reachable only by its 4-letter
// code. A host can instead open it, which lists it live on the menu of
// everyone on the site so anybody can drop in and play.

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
let mgmt = null;

export const handler = async (event) => {
  const rc = event.requestContext;
  mgmt = new ApiGatewayManagementApiClient({ endpoint: `https://${rc.domainName}/${rc.stage}` });
  const connId = rc.connectionId;

  if (rc.routeKey === '$connect') return { statusCode: 200 };
  if (rc.routeKey === '$disconnect') {
    await onDisconnect(connId).catch((e) => console.error('disconnect:', e));
    return { statusCode: 200 };
  }

  let msg;
  try {
    msg = JSON.parse(event.body);
  } catch {
    return { statusCode: 200 };
  }
  try {
    await onMessage(connId, msg, rc.identity?.sourceIp);
  } catch (e) {
    console.error('message handler:', e);
    await sendTo(connId, { type: 'error', message: 'Something went wrong on the server.' });
  }
  return { statusCode: 200 };
};

// ---------- storage ----------

const ttl = () => Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;

// How long a room is kept alive. A junk room that never started goes quickly,
// a real game is held a full day so phones can drop and come back — but once
// every seat is empty it falls back to the idle hour, which is what server.js
// does with EMPTY_GAME_MS.
function roomTtl(room) {
  const now = Math.floor(Date.now() / 1000);
  if (!room.started) return now + LOBBY_TTL_HOURS * 3600;
  const anyoneHere = (room.players || []).some((p) => !p.isBot && !p.disconnected);
  return now + (anyoneHere ? TTL_HOURS : IDLE_GAME_HOURS) * 3600;
}

async function getItem(pk) {
  const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk } }));
  return r.Item || null;
}

const getRoom = (code) => getItem(`ROOM#${code}`);

// Conditional save: succeeds only if the stored rev still matches the one we
// read. Returns false on a lost race so the caller can reload and retry.
async function trySaveRoom(room) {
  const prev = room.rev || 0;
  room.rev = prev + 1;
  // Any activity in the room pushes this out again.
  room.ttl = roomTtl(room);
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: room,
      ConditionExpression: 'attribute_not_exists(pk) OR rev = :prev',
      ExpressionAttributeValues: { ':prev': prev },
    }));
    return true;
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      room.rev = prev;
      return false;
    }
    throw e;
  }
}

// Load-mutate-save with retry. The mutator returns:
//   true     — save the room
//   'delete' — remove the room instead
//   false    — validation failed; save nothing
// Returns { room, out } where room is null if the code doesn't exist.
async function mutateRoom(code, mutator) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const room = await getRoom(code);
    if (!room) return { room: null, out: null };
    const out = mutator(room);
    if (out === false) return { room, out };
    if (out === 'delete') {
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: room.pk } }));
      return { room, out };
    }
    if (await trySaveRoom(room)) return { room, out };
  }
  throw new Error(`room ${code}: too much write contention`);
}

async function mapConnection(connId, code, idx) {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: `CONN#${connId}`, code, idx, ttl: ttl() },
  }));
}

// ---------- presence & usage log ----------

const PRESENCE_TTL_MIN = 15; // clients ping every 4 min; survives a couple misses

const presenceTtl = () => Math.floor(Date.now() / 1000) + PRESENCE_TTL_MIN * 60;

// "2026-08-05 14:03:22 CDT" — Intl handles the CST/CDT switch for us.
function centralTime(d) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZoneName: 'short',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName}`;
}

// One log entry per page visit. No ttl attribute, so unlike rooms these
// items never expire — this is the permanent usage log.
// A visit is a timestamp and nothing else. No address, no identifier: the
// count is all we ever wanted, and storing nothing about the visitor keeps
// the app store's data declaration honest and simple.
async function logVisit(connId) {
  const now = new Date();
  const utc = now.toISOString();
  const central = centralTime(now);
  console.log(`visit: ${utc}  ${central}`);
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: `LOG#${utc}#${connId.slice(0, 8)}`, utc, central },
  }));
}

// Everyone currently on the site (unexpired PRESENCE items).
async function presenceConnIds() {
  const now = Math.floor(Date.now() / 1000);
  const ids = [];
  let key;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(pk, :p) AND #ttl > :now',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':p': 'PRESENCE#', ':now': now },
      ExclusiveStartKey: key,
    }));
    for (const it of r.Items || []) ids.push(it.pk.slice('PRESENCE#'.length));
    key = r.LastEvaluatedKey;
  } while (key);
  return ids;
}

async function broadcastPresence() {
  const ids = await presenceConnIds();
  const msg = { type: 'presence', v: GAME_VERSION, count: ids.length };
  await Promise.all(ids.map((id) => sendTo(id, msg)));
}

// ---------- messaging ----------

async function sendTo(connId, msg) {
  if (!connId) return false;
  try {
    await mgmt.send(new PostToConnectionCommand({
      ConnectionId: connId,
      Data: JSON.stringify(msg),
    }));
    return true;
  } catch {
    return false; // gone/stale connection
  }
}

async function broadcastLobby(room) {
  await Promise.all(room.players.map((p, i) => sendTo(p.connectionId, {
    type: 'lobby',
    v: GAME_VERSION,
    code: room.code,
    you: i,
    host: room.host,
    token: p.token, // secret; lets this player rejoin later
    players: room.players.map((q) => ({ name: q.name, away: !!q.disconnected, isBot: !!q.isBot, level: q.level })),
  })));
}

// Every state broadcast reaches the seats and the gallery alike.
function roomAudience(room) {
  return [
    ...room.players.map((p) => p.connectionId),
    ...(room.watchers || []).map((w) => w.connectionId),
  ];
}

async function broadcastState(room, event) {
  const msg = { type: 'state', v: GAME_VERSION, state: room.state, event };
  await Promise.all(roomAudience(room).map((id) => sendTo(id, msg)));
}

// Tell each person in line exactly where they stand, and how many seats a
// rematch would actually free. `missed` marks the moment a rematch started
// without them.
async function broadcastQueue(room, missed = false) {
  const queue = (room.watchers || []).filter((w) => w.wantsIn);
  if (!queue.length) return;
  const seats = Math.max(0, MAX_ROOM_PLAYERS - (room.players || []).length);
  await Promise.all(queue.map((w, i) => sendTo(w.connectionId, {
    type: 'inline', v: GAME_VERSION, on: true, pos: i + 1, seats, missed,
  })));
}

async function broadcastWatchers(room) {
  const msg = { type: 'watchers', v: GAME_VERSION, n: (room.watchers || []).length };
  await Promise.all(roomAudience(room).map((id) => sendTo(id, msg)));
}

// An open room may be given a name at creation, shown on everyone's menu.
// Same character rules as a player name, just a little longer.
function cleanTitle(raw) {
  return String(raw || '').replace(/[^\w !?'.,&-]/g, '').trim().slice(0, 24);
}

function cleanName(raw) {
  return String(raw || 'Player').replace(/[^\w !?'.-]/g, '').trim().slice(0, 14) || 'Player';
}

// ---------- bots ----------

const BOT_NAMES = ['Chip', 'Sparky', 'Gizmo', 'Bolt'];
const BOT_LEVELS = ['easy', 'normal', 'hard'];

const cleanLevel = (l) => (BOT_LEVELS.includes(l) ? l : 'normal');

const REACTIONS = ['🎉', '😂', '😱', '😈', '💪', '❤️'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Plays out consecutive bot turns, broadcasting each roll and placement so
// clients animate them exactly like human moves. Runs inside whatever
// invocation triggered the bot's turn; the step cap keeps a long chain of
// bot turns safely inside the Lambda timeout — if it's ever hit, the next
// message from any player (including keepalive pings) picks the chain up.
async function runBots(code) {
  for (let step = 0; step < 18; step++) {
    const peek = await getRoom(code);
    if (!peek || !peek.started || peek.state.phase === 'over') return;
    if (!peek.players[peek.state.current]?.isBot) return;
    if (!peek.players.some((p) => !p.isBot && !p.disconnected)) return; // nobody watching
    await sleep(850);

    let event = null;
    const { room, out } = await mutateRoom(code, (r) => {
      event = null;
      if (!r.started || r.state.phase === 'over') return false;
      const bot = r.players[r.state.current];
      if (!bot?.isBot) return false;
      const st = r.state;
      if (st.phase === 'place' || st.phase === 'blocked') {
        const cell = st.phase === 'place' ? chooseCell(st, bot.level) : chooseSteal(st, bot.level);
        if (cell !== null) {
          const { result, stolen } = applyPlace(st, cell);
          event = { kind: result === 'next' ? 'place' : result, cell, stolen, by: bot.name };
          return true;
        }
        // Blocked and not worth stealing — fall through to a fresh roll.
      } else if (st.phase === 'roll') {
        // Twist instead of rolling when the bot thinks it pays.
        const twist = chooseTwist(st, bot.level);
        if (twist) {
          const { result, winner } = applyTwist(st, twist);
          event = { kind: result === 'win' ? 'win' : 'twist', twist, winner, by: bot.name };
          return true;
        }
      }
      const dice = rollDice();
      const result = applyRoll(st, dice);
      event = { kind: result === 'place' ? 'roll' : result, dice, by: bot.name };
      return true;
    });
    if (!room || out !== true) return;
    await broadcastState(room, event);
    if (event.kind === 'win') return;
  }
}

async function scanPrefix(prefix) {
  const items = [];
  let key;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(pk, :p)',
      ExpressionAttributeValues: { ':p': prefix },
      ExclusiveStartKey: key,
    }));
    items.push(...(r.Items || []));
    key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

// Which connections are still real. A socket that dies without a $disconnect
// ever firing — an app killed rather than closed — leaves its player marked
// present forever, so the CONN# items are the only honest answer to "is
// anyone actually in here". Keyed on connectionId rather than on the seat
// number, which shifts when someone leaves a lobby. One extra scan, and this
// runs only when the room list can change, never per move.
async function liveConns() {
  const now = Math.floor(Date.now() / 1000);
  const set = new Set();
  for (const c of await scanPrefix('CONN#')) {
    if (c.ttl && c.ttl <= now) continue; // expired but not yet swept
    set.add(String(c.pk).slice('CONN#'.length));
  }
  return set;
}

const playerLive = (live, p) => !!p.connectionId && live.has(p.connectionId);

// Flip ghosts to disconnected so a dead room stops being advertised and its
// expiry drops to the idle hour. Liveness is re-read inside the mutator, not
// taken from the caller's snapshot, so somebody joining while we work is
// never mistaken for a ghost.
async function reapGhosts(code) {
  try {
    const room = await getRoom(code);
    if (!room) return;
    const suspects = (room.players || []).filter((p) => !p.isBot && !p.disconnected);
    const dead = new Set();
    await Promise.all(suspects.map(async (p) => {
      if (!p.connectionId) { dead.add(p.name); return; }
      if (!(await getItem(`CONN#${p.connectionId}`))) dead.add(p.connectionId || p.name);
    }));
    if (!dead.size) return;
    await mutateRoom(code, (r) => {
      let changed = false;
      (r.players || []).forEach((p, i) => {
        if (p.isBot || p.disconnected) return;
        if (!dead.has(p.connectionId || p.name)) return;
        p.disconnected = true;
        p.connectionId = null;
        if (r.state?.players?.[i]) r.state.players[i].disconnected = true;
        changed = true;
      });
      if (!changed) return false;
      if (r.players[r.host]?.disconnected && r.players.some((p) => !p.disconnected)) {
        r.host = r.players.findIndex((p) => !p.disconnected);
      }
      return true;
    });
  } catch { /* best effort — the next refresh tries again */ }
}

// What the menu shows: each open room's name, who's there, and whether
// there's a seat free.
async function openRooms() {
  const now = Math.floor(Date.now() / 1000);
  const [rooms, live] = await Promise.all([scanPrefix('ROOM#'), liveConns()]);
  // TTL deletion is best-effort and can lag well past the timestamp, so never
  // advertise a room that has already expired just because it is still there.
  const alive = rooms.filter((r) => !(r.ttl && r.ttl <= now));
  // Don't advertise a room nobody is sitting in: rooms outlive a dropped
  // connection so people can come back, but a ghost room is a dead end.
  const sitting = (r) => (r.players || []).some((p) => !p.isBot && !p.disconnected && playerLive(live, p));
  // Clean up any room still holding a seat no socket backs. Awaited rather
  // than left floating, since Lambda freezes work that outlives the response.
  const ghosts = alive.filter((r) => !sitting(r) && (r.players || []).some((p) => !p.isBot && !p.disconnected));
  if (ghosts.length) await Promise.all(ghosts.map((r) => reapGhosts(r.code)));
  return alive
    .filter((r) => r.open && sitting(r))
    .map((r) => ({
      code: r.code,
      title: r.title || '',
      host: r.players?.[r.host]?.name || 'Someone',
      players: (r.players || []).map((p) => ({
        name: p.name,
        isBot: !!p.isBot,
        away: !p.isBot && (!!p.disconnected || !playerLive(live, p)),
      })),
      seats: Math.max(0, MAX_ROOM_PLAYERS - (r.players || []).length),
      started: !!r.started,
    }))
    // Rooms you can join first, then games to watch — and never more than
    // fit on a menu, so the broadcast stays small however many rooms exist.
    .sort((a, b) => (a.started - b.started) || (b.seats - a.seats))
    .slice(0, MAX_ROOMS_LISTED);
}

// Only called where the list can actually change (a seat taken or freed, a
// game starting or ending) — never per move, since each refresh is a scan.
async function refreshRooms(room) {
  if (!room?.open) return;
  const [rooms, ids] = await Promise.all([openRooms(), presenceConnIds()]);
  const msg = { type: 'rooms', v: GAME_VERSION, rooms };
  await Promise.all(ids.map((id) => sendTo(id, msg)));
}

// ---------- abuse limits ----------

// Rate counters are keyed on a hash of the caller's address, so the address
// itself is never written to the table.
const IP_SALT = 'ringo3d-rate';
const ipKey = (ip) => createHash('sha256').update(String(ip || '') + IP_SALT).digest('hex').slice(0, 16);

// Counters in the same table, one per address plus one for everyone, each
// covering a rolling window. Checked before a room is made, bumped after.
async function roomCreateBlocked(ip) {
  const now = Date.now();
  const [mine, all] = await Promise.all([getItem(`RATE#ip#${ipKey(ip)}`), getItem('RATE#all')]);
  const live = (r) => r && now - (r.windowStart || 0) < ROOM_WINDOW_MS;
  if (live(all) && (all.n || 0) >= MAX_ROOMS_PER_WINDOW) {
    return 'The game is busy right now — try again in a minute.';
  }
  if (live(mine) && (mine.n || 0) >= MAX_ROOMS_PER_IP) {
    return "That's a lot of rooms at once — give it a minute and try again.";
  }
  return null;
}

async function noteRoomCreated(ip) {
  const now = Date.now();
  await Promise.all([`RATE#ip#${ipKey(ip)}`, 'RATE#all'].map(async (pk) => {
    const cur = await getItem(pk);
    if (cur && now - (cur.windowStart || 0) < ROOM_WINDOW_MS) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk },
        UpdateExpression: 'ADD n :one SET #ttl = :t',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':t': ttl() },
      }));
    } else {
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: { pk, windowStart: now, n: 1, ttl: ttl() },
      }));
    }
  })).catch((e) => console.error('rate counter:', e));
}

// One reaction per connection per second. The conditional write *is* the
// brake: if it fails, this connection reacted too recently.
async function reactAllowed(pk) {
  const now = Date.now();
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk },
      UpdateExpression: 'SET lastReact = :now',
      ConditionExpression: 'attribute_exists(pk) AND (attribute_not_exists(lastReact) OR lastReact < :cut)',
      ExpressionAttributeValues: { ':now': now, ':cut': now - REACT_GAP_MS },
    }));
    return true;
  } catch {
    return false;
  }
}

// No ambiguous letters (I/L/O look like 1/0).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

const randomCode = () => Array.from({ length: 4 }, () =>
  CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

// ---------- message handling ----------

async function onMessage(connId, msg, ip) {
  switch (msg.type) {
    // Sent once when a page loads: registers this connection as "on the
    // site", records the visit, and pushes the fresh count to everyone.
    case 'hello': {
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: { pk: `PRESENCE#${connId}`, ttl: presenceTtl() },
      }));
      await logVisit(connId);
      await broadcastPresence();
      await sendTo(connId, { type: 'rooms', v: GAME_VERSION, rooms: await openRooms() });
      return;
    }

    // Keepalive from a presence connection — just refresh its TTL.
    case 'presence-ping': {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `PRESENCE#${connId}` },
        UpdateExpression: 'SET #ttl = :t',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':t': presenceTtl() },
      })).catch(() => {}); // expired-and-swept item; next hello re-registers
      return;
    }

    case 'create': {
      const blocked = await roomCreateBlocked(ip);
      if (blocked) return sendTo(connId, { type: 'error', message: blocked });
      for (let tries = 0; tries < 10; tries++) {
        const code = randomCode();
        const room = {
          pk: `ROOM#${code}`,
          code,
          open: !!msg.open,
          title: msg.open ? cleanTitle(msg.title) : '', // named at creation only
          rev: 0,
          players: [{ name: cleanName(msg.name), connectionId: connId, disconnected: false, token: crypto.randomUUID() }],
          host: 0,
          started: false,
          state: null,
          firstPlayer: 0,
        };
        if (await getRoom(code)) continue;
        if (await trySaveRoom(room)) {
          await noteRoomCreated(ip);
          await mapConnection(connId, code, 0);
          await broadcastLobby(room);
          await refreshRooms(room);
          return;
        }
      }
      throw new Error('could not allocate a room code');
    }

    case 'join': {
      const code = String(msg.code || '').toUpperCase();
      let err = null;
      let seat = -1;
      const { room, out } = await mutateRoom(code, (r) => {
        err = null;
        if (r.started) { err = 'That game already started.'; return false; }
        if (r.players.length >= MAX_ROOM_PLAYERS) {
          err = `That room is full (${MAX_ROOM_PLAYERS} players max).`;
          return false;
        }
        r.players.push({ name: cleanName(msg.name), connectionId: connId, disconnected: false, token: crypto.randomUUID() });
        seat = r.players.length - 1;
        return true;
      });
      if (!room) return sendTo(connId, { type: 'error', message: 'No room with that code.' });
      if (out === false) return sendTo(connId, { type: 'error', message: err });
      await mapConnection(connId, code, seat);
      await broadcastLobby(room);
      await refreshRooms(room);
      return;
    }

    // Spectator: watch a game in progress by room code — read-only view
    // of every broadcast, plus emoji reactions. No seat is taken.
    case 'watch': {
      const code = String(msg.code || '').toUpperCase();
      const name = cleanName(msg.name || 'Watcher');
      let err = null;
      const { room, out } = await mutateRoom(code, (r) => {
        err = null;
        if (!r.started) { err = "That game hasn't started yet."; return false; }
        r.watchers = (r.watchers || []).filter((w) => w.connectionId !== connId);
        if (r.watchers.length >= 10) { err = 'Too many watchers on that game.'; return false; }
        r.watchers.push({ connectionId: connId, name });
        return true;
      });
      if (!room) return sendTo(connId, { type: 'error', message: 'No room with that code.' });
      if (out === false) return sendTo(connId, { type: 'error', message: err });
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: { pk: `WATCH#${connId}`, code, name, ttl: ttl() },
      }));
      await sendTo(connId, { type: 'watching', v: GAME_VERSION, code, state: room.state });
      await broadcastWatchers(room);
      return;
    }

    // A watcher queues (or un-queues) for a seat in the next game.
    case 'joinnext': {
      const watch = await getItem(`WATCH#${connId}`);
      if (!watch) return;
      const on = !!msg.on;
      const { room, out } = await mutateRoom(watch.code, (r) => {
        const w = (r.watchers || []).find((x) => x.connectionId === connId);
        if (!w) return false;
        w.wantsIn = on;
        return true;
      });
      if (room && out === true) {
        if (!on) await sendTo(connId, { type: 'inline', v: GAME_VERSION, on: false });
        await broadcastQueue(room); // positions shift for everyone behind them
      }
      return;
    }

    // Emoji reaction — validated against the allowlist, stamped with the
    // sender's name, shown big on every screen in the room. Watchers can
    // react too; their name carries a 👀.
    case 'react': {
      if (!REACTIONS.includes(msg.e)) return;
      const conn = await getItem(`CONN#${connId}`);
      const watch = conn ? null : await getItem(`WATCH#${connId}`);
      const code = conn?.code || watch?.code;
      if (!code) return;
      const room = await getRoom(code);
      if (!room?.started) return;
      const by = conn ? room.players[conn.idx]?.name : `${watch.name} 👀`;
      if (!by) return;
      if (!(await reactAllowed(conn ? `CONN#${connId}` : `WATCH#${connId}`))) return;
      const msg2 = { type: 'react', v: GAME_VERSION, e: msg.e, by };
      await Promise.all(roomAudience(room).map((id) => sendTo(id, msg2)));
      return;
    }

    // A player whose connection dropped mid-game reclaims their seat by
    // presenting the seat token they got when they first joined.
    case 'rejoin': {
      const code = String(msg.code || '').toUpperCase();
      const token = String(msg.token || '');
      let seat = -1;
      let name = null;
      const { room, out } = await mutateRoom(code, (r) => {
        seat = token ? r.players.findIndex((p) => p.token === token) : -1;
        if (seat === -1) return false;
        r.players[seat].connectionId = connId;
        r.players[seat].disconnected = false;
        if (r.started) r.state.players[seat].disconnected = false;
        name = r.players[seat].name;
        return true;
      });
      if (!room || out !== true) return sendTo(connId, { type: 'rejoin-failed', v: GAME_VERSION });
      await mapConnection(connId, code, seat);
      if (!room.started) return broadcastLobby(room); // back in the lobby
      await sendTo(connId, {
        type: 'rejoined', v: GAME_VERSION,
        code, you: seat, host: room.host, token,
      });
      await broadcastState(room, { kind: 'rejoined', name });
      await refreshRooms(room);
      if (room.watchers?.length) await broadcastWatchers(room); // re-show the 👀 badge
      return;
    }
  }

  // Everything below needs an existing room membership.
  const conn = await getItem(`CONN#${connId}`);
  if (!conn) return;
  const idx = conn.idx;

  switch (msg.type) {
    // Game-socket keepalive — also nudges a stalled bot chain back to life
    // (e.g. if a previous invocation hit the step cap).
    case 'ping':
      return runBots(conn.code);

    // Host fills an empty seat with a computer player.
    case 'addbot': {
      const { room, out } = await mutateRoom(conn.code, (r) => {
        if (r.started || idx !== r.host) return false;
        if (r.players.length >= MAX_ROOM_PLAYERS) return false;
        const name = BOT_NAMES.find((n) => !r.players.some((p) => p.name === n));
        if (!name) return false;
        r.players.push({ name, isBot: true, connectionId: null, disconnected: false, level: cleanLevel(msg.level) });
        return true;
      });
      if (room && out === true) { await broadcastLobby(room); await refreshRooms(room); }
      return;
    }

    // Host cycles a bot's difficulty: easy → normal → hard → easy.
    case 'botlevel': {
      const bi = Number(msg.i);
      const { room, out } = await mutateRoom(conn.code, (r) => {
        if (r.started || idx !== r.host) return false;
        const p = r.players[bi];
        if (!p?.isBot) return false;
        p.level = BOT_LEVELS[(BOT_LEVELS.indexOf(cleanLevel(p.level)) + 1) % BOT_LEVELS.length];
        return true;
      });
      if (room && out === true) await broadcastLobby(room);
      return;
    }

    case 'removebot': {
      const bi = Number(msg.i);
      const { room, out } = await mutateRoom(conn.code, (r) => {
        if (r.started || idx !== r.host) return false;
        if (!r.players[bi]?.isBot) return false;
        r.players.splice(bi, 1);
        if (bi < r.host) r.host -= 1;
        return true;
      });
      if (room && out === true) {
        // Seats shifted — refresh every remaining connection's mapping.
        await Promise.all(room.players.map((p, i) =>
          p.connectionId ? mapConnection(p.connectionId, room.code, i) : null));
        await broadcastLobby(room);
        await refreshRooms(room);
      }
      return;
    }

    case 'start': {
      const { room, out } = await mutateRoom(conn.code, (r) => {
        if (r.started || idx !== r.host) return false;
        // Prune ghosts — lobby seats whose players dropped and never returned.
        const host = r.players[idx];
        r.players = r.players.filter((p) => !p.disconnected);
        r.host = r.players.indexOf(host);
        if (r.players.length < 2) return false;
        r.firstPlayer %= r.players.length;
        r.started = true;
        r.state = newGame(r.players.map((p) => ({ name: p.name, isBot: p.isBot })), r.firstPlayer);
        return true;
      });
      if (room && out === true) {
        // Pruning may have re-numbered seats — refresh every mapping.
        await Promise.all(room.players.map((p, i) =>
          p.connectionId ? mapConnection(p.connectionId, room.code, i) : null));
        await broadcastState(room, { kind: 'start' });
        await refreshRooms(room);
        await runBots(conn.code);
      }
      return;
    }

    // Deliberately giving up a lobby seat (the Leave button). A silent
    // disconnect keeps the seat instead — phones drop the socket the moment
    // the browser is backgrounded (e.g. to text the invite link).
    case 'leave': {
      const { room, out } = await mutateRoom(conn.code, (r) => {
        if (r.started) return false; // mid-game leave = plain disconnect
        if (!r.players[idx] || r.players[idx].connectionId !== connId) return false;
        r.players.splice(idx, 1);
        if (r.players.length === 0) return 'delete';
        if (idx < r.host) r.host -= 1;
        else if (idx === r.host) r.host = 0;
        if (r.host >= r.players.length) r.host = 0;
        return true;
      });
      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `CONN#${connId}` } }));
      if (room && out === true) {
        // Seats shifted — refresh every remaining connection's mapping.
        await Promise.all(room.players.map((p, i) =>
          p.connectionId ? mapConnection(p.connectionId, room.code, i) : null));
        await broadcastLobby(room);
      }
      if (room) await refreshRooms(room);
      return;
    }

    case 'roll': {
      let event = null;
      const { room, out } = await mutateRoom(conn.code, (r) => {
        event = null;
        if (!r.started) return false;
        const phase = r.state.phase;
        if (phase !== 'roll' && phase !== 'blocked') return false;
        if (idx !== r.state.current) return false;
        const dice = rollDice();
        const result = applyRoll(r.state, dice); // 'place' | 'blocked' | 'reroll'
        event = { kind: result === 'place' ? 'roll' : result, dice, by: r.players[idx].name };
        return true;
      });
      if (room && out === true) await broadcastState(room, event);
      return;
    }

    case 'place': {
      let event = null;
      const { room, out } = await mutateRoom(conn.code, (r) => {
        event = null;
        if (!r.started) return false;
        const phase = r.state.phase;
        if (phase !== 'place' && phase !== 'blocked') return false;
        if (idx !== r.state.current) return false;
        const cell = Number(msg.cell);
        if (!Number.isInteger(cell) || !isLegal(r.state, cell)) return false;
        const { result, stolen } = applyPlace(r.state, cell);
        event = {
          kind: result === 'next' ? 'place' : result,
          cell,
          stolen,
          by: r.players[idx].name,
        };
        return true;
      });
      if (room && out === true) {
        await broadcastState(room, event);
        if (event.kind === 'win') await refreshRooms(room);
        else await runBots(conn.code);
      }
      return;
    }

    // Instead of rolling: turn one slice of the cube a quarter turn. The
    // rules decide whether it's allowed (start of the turn, not an undo)
    // and who — if anyone — it hands the win to.
    case 'twist': {
      let event = null;
      const { room, out } = await mutateRoom(conn.code, (r) => {
        event = null;
        if (!r.started) return false;
        if (idx !== r.state.current) return false;
        const twist = { axis: String(msg.axis), k: Number(msg.k), dir: Number(msg.dir) };
        if (!canTwist(r.state, twist)) return false;
        const { result, winner } = applyTwist(r.state, twist);
        event = { kind: result === 'win' ? 'win' : 'twist', twist, winner, by: r.players[idx].name };
        return true;
      });
      if (room && out === true) {
        await broadcastState(room, event);
        if (event.kind === 'win') await refreshRooms(room);
        else await runBots(conn.code);
      }
      return;
    }

    case 'rename': {
      let evt = null;
      const { room, out } = await mutateRoom(conn.code, (r) => {
        evt = null;
        const p = r.players[idx];
        if (!p || p.disconnected) return false;
        const to = cleanName(msg.name);
        if (to === p.name) return false;
        evt = { kind: 'rename', from: p.name, to };
        p.name = to;
        if (r.started && r.state.players[idx]) r.state.players[idx].name = to;
        return true;
      });
      if (room && out === true) {
        if (!room.started) await broadcastLobby(room);
        else await broadcastState(room, evt);
        await refreshRooms(room);
      }
      return;
    }

    case 'again': {
      let promoted = [];
      const { room, out } = await mutateRoom(conn.code, (r) => {
        promoted = [];
        if (!r.started || r.state.phase !== 'over' || idx !== r.host) return false;
        // Seat watchers who queued for the next game, oldest first, into
        // whatever chairs are free.
        const queued = (r.watchers || []).filter((w) => w.wantsIn)
          .slice(0, Math.max(0, MAX_ROOM_PLAYERS - r.players.length));
        for (const w of queued) {
          r.watchers = r.watchers.filter((x) => x !== w);
          const token = crypto.randomUUID();
          r.players.push({ name: w.name, connectionId: w.connectionId, disconnected: false, token });
          promoted.push({ connectionId: w.connectionId, idx: r.players.length - 1, token });
        }
        r.firstPlayer = (r.firstPlayer + 1) % r.players.length;
        r.state = newGame(
          r.players.map((p) => ({ name: p.name, isBot: p.isBot, disconnected: p.disconnected })),
          r.firstPlayer,
        );
        // Don't hand the first turn to someone who already left.
        if (r.state.players[r.state.current].disconnected) nextPlayer(r.state);
        return true;
      });
      if (room && out === true) {
        // Promoted watchers become full players: seat mapping, seat token,
        // and the same personalized hello a rejoiner gets.
        await Promise.all(promoted.map(async (p) => {
          await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `WATCH#${p.connectionId}` } }));
          await mapConnection(p.connectionId, room.code, p.idx);
          await sendTo(p.connectionId, {
            type: 'rejoined', v: GAME_VERSION,
            code: room.code, you: p.idx, host: room.host, token: p.token,
          });
        }));
        await broadcastQueue(room, true); // whoever is still waiting learns they missed this one
        await broadcastState(room, { kind: 'start' });
        await refreshRooms(room);
        await broadcastWatchers(room); // promotions may have emptied the gallery
        await runBots(conn.code);
      }
      return;
    }
  }
}

// ---------- disconnect ----------

async function onDisconnect(connId) {
  // Presence connection closing (tab closed / navigated away)?
  const pres = await getItem(`PRESENCE#${connId}`);
  if (pres) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `PRESENCE#${connId}` } }));
    await broadcastPresence();
  }

  // A spectator leaving the gallery?
  const watch = await getItem(`WATCH#${connId}`);
  if (watch) {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `WATCH#${connId}` } }));
    const { room: wr, out: wout } = await mutateRoom(watch.code, (r) => {
      const before = (r.watchers || []).length;
      r.watchers = (r.watchers || []).filter((w) => w.connectionId !== connId);
      return r.watchers.length !== before;
    });
    if (wr && wout === true) {
      await broadcastWatchers(wr);
      await broadcastQueue(wr); // the rest move up a place
    }
  }

  const conn = await getItem(`CONN#${connId}`);
  if (conn) await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { pk: `CONN#${connId}` } }));
  if (!conn) return;

  let mode = null; // 'lobby' | 'game' | null
  let name = null;
  const { room, out } = await mutateRoom(conn.code, (r) => {
    mode = null;
    const idx = conn.idx;
    // Stale mapping (e.g. this seat was re-numbered after a lobby leave).
    if (!r.players[idx] || r.players[idx].connectionId !== connId) return false;

    if (!r.started) {
      // Keep the seat — this is usually a phone backgrounding the browser
      // for a moment. The player rejoins by token; 'start' prunes any
      // lingering ghosts and the room itself expires via TTL.
      r.players[idx].disconnected = true;
      r.players[idx].connectionId = null;
      mode = 'lobby';
      return true;
    }

    // Mid-game: mark the player as gone and skip their turns. Even with
    // everyone disconnected the room survives (phones may all be
    // backgrounded at once) — TTL reclaims it if nobody returns.
    name = r.players[idx].name;
    r.players[idx].disconnected = true;
    r.players[idx].connectionId = null;
    r.state.players[idx].disconnected = true;
    if (r.host === idx && r.players.some((p) => !p.disconnected)) {
      r.host = r.players.findIndex((p) => !p.disconnected);
    }
    if (r.state.phase !== 'over' && r.state.current === idx && r.players.some((p) => !p.disconnected)) {
      nextPlayer(r.state);
      r.state.phase = 'roll';
      r.state.dice = null;
    }
    mode = 'game';
    return true;
  });

  if (!room || out !== true) return;
  if (mode === 'lobby') await broadcastLobby(room);
  else if (mode === 'game') {
    await broadcastState(room, { kind: 'left', name });
    await runBots(room.code); // the departed player's turn may pass to a bot
  }
  await refreshRooms(room);
}
