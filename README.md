# RINGO 3D

Dad's family board game, cubed. The 5×5 R-I-N-G-O board becomes a **5×5×5
cube** of translucent glass, a third die picks the **layer** (Sky, Violet,
Mint, Peach, Rose), and instead of rolling you may **twist** any layer,
column or row a quarter turn, Rubik's-style — swinging whole slices of rings
into new lines.

Same objective: **five in a row** wins — along any row, column or depth,
diagonally across a layer, or corner to corner through the middle (109 lines
in all) — and so do **all four corners of any outer face**. Steals and wilds
work exactly as in RINGO; a wild on the color die means any layer.

A twist can finish a line for anyone: whoever's rings line up wins, even if
the other player did the twisting (the twister wins a double finish). You
can't simply undo the twist that was just made.

Sister site of [RINGO](https://ringo.beelinemicrosystems.com) — same rings,
same dice, same shout.

## Status

Live at **https://ringo3d.beelinemicrosystems.com**: the cube, twists, Pass
& Play, vs Computer (easy / normal / hard bots that place, steal and twist),
online rooms with invite links, **open tables** anyone can drop into,
spectators who can queue for the next game, emoji reactions, the
announcer's voice, and install-to-phone with offline local play.

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm test           # rules-engine tests
```

Pass & Play and vs Computer need no server at all — `server.js` only serves
the files.

## AWS deployment (ringo3d.beelinemicrosystems.com)

Same shape as RINGO's, with its own resources (tagged `project=ringo3d`):

- **Web**: private S3 bucket `ringo3d-web-352154386127-us-east-2` behind
  CloudFront `E1O9VORKDZL4G2` (`d11oqbipww0xi9.cloudfront.net`), origin
  access control shared with RINGO, alias `ringo3d.beelinemicrosystems.com`
  (Route 53 A/AAAA in zone `Z0157479MORFOGXW3GGR`, wildcard ACM cert
  `*.beelinemicrosystems.com`). Files are uploaded with
  `Cache-Control: no-cache`; the service worker is network-first with cache
  fallback, so the installed app is never stale online and still plays
  offline.
- **Multiplayer**: API Gateway WebSocket API `o2l49t9p86` (us-east-2, stage
  `prod`) → Lambda `ringo3d-ws` (Node 20, 256 MB, 30s timeout;
  `aws/ws-handler/index.mjs` + the shared `game.js` and `ai.js`) → DynamoDB
  table `ringo3d` (on-demand, TTL on `ttl`). The Lambda is authoritative: it
  rolls the dice, validates every placement and twist, and plays the bots.
  Role `ringo3d-ws-role` (inline policy `ringo3d-ws-access`). CloudWatch
  alarm `ringo3d-ws-errors` emails via the shared SNS topic `ringo-alerts`.

Same single-table layout as RINGO: `ROOM#<code>`, `CONN#<id>`, `WATCH#<id>`,
`PRESENCE#<id>` and `LOG#<utc>#<id>`.

```bash
./scripts/deploy-web.sh      # web client → S3 + CloudFront invalidation
./scripts/deploy-lambda.sh   # room server → Lambda (bundles game.js + ai.js)
```

## Open tables

A room is private by default: invisible, reachable only by its 4-letter code,
for when you want to play with people you invite. Ticking "Open table"
instead lists the room live on the menu of everyone on the site — who's
there, how many seats are free — so anybody can drop in, or watch once it
starts. The list rides the presence socket every open page already holds, so
it updates the moment a seat fills or a game begins. A table nobody is
sitting at is delisted rather than advertised as a dead end.

There is deliberately no leaderboard and no chat. Names are typed per game,
sanitized to 14 characters and never stored; reactions are a fixed list of
six emoji. Nothing a player types outlives the room.

## Abuse limits

The game is open to anyone, so a bot could otherwise hold thousands of
sockets open and make a room on each — filling the 4-letter code space,
bloating the open-table broadcast, and costing real money in the cloud.

- **Rooms per address**: 20 per 10 minutes (`RINGO_MAX_ROOMS_PER_IP`). Set
  well above anything a household behind one router could hit. Limiting per
  address matters more than a global cap, which on its own would let one
  attacker lock everybody else out by filling it.
- **Rooms overall**: a backstop of 400 creations per 10 minutes in the cloud,
  300 alive at once locally.
- **Open tables broadcast**: at most 25, however many rooms exist.
- **Room codes**: allocation gives up rather than spinning when the space is
  crowded, and answers with a friendly "try again in a minute".
- **Empty rooms**: one that never started is reclaimed in an hour in the
  cloud (10 minutes locally); a real game is held longer, since phones drop
  sockets constantly. Any activity pushes the expiry out again.
- **Reactions**: one per connection per second, on both halves. In the cloud
  the conditional write *is* the brake.
- **API Gateway**: the `prod` stage throttles at 100 requests/second, burst
  200. AWS Budget `ringo3d-monthly` emails if spend on resources tagged
  `project=ringo3d` passes $5.

**When changing the rules**, bump `GAME_VERSION` in `public/js/game.js` and
deploy both halves; open pages that hear a newer number show the "new rules
— tap to refresh" banner.

The app icon, share images and store screenshots are rendered from the real
cube: `scripts/make-assets.mjs` + `scripts/showcase.html` (see the header).

## How it's built

- `public/js/game.js` — the shared rules engine. Cells are indexes 0–124
  (`idx(x, y, z)` / `xyz(i)`): x = column letter, y = row number, z = layer
  colour, front to back. `WIN_LINES` holds the 109 lines + 6 face-corner
  sets; `twistMap()` is the quarter-turn permutation the renderer also uses,
  so the picture can never disagree with the rules.
- `public/js/ai.js` — the bots: line-progress scoring for placements and
  steals, plus `chooseTwist()` which twists to win, to build its own lines,
  or to break a four-in-a-line — never two rounds running.
- `public/js/cube.js` — the three.js view: tinted glass cells with glowing
  edges, enamel rings, drag-to-orbit, tap-to-place picking (only legal cells
  are pickable, so you can tap through glass), the slice-twist animation
  (spin direction derived from `twistMap`), the exploded "floors" view,
  layer focus, a scanner sweep, and the win rods.
- `public/js/main.js` — screens, dice, turn flow, the twist picker, bots,
  banner, voice, install, and online play (rooms, rejoin by seat token,
  spectators, reactions, stats, presence). A twist broadcast animates on
  every screen in the room before the new arrangement lands; state
  messages that arrive mid-twist queue up behind it.
- `server.js` — the local room server (`npm start`) and the reference for
  the protocol; `aws/ws-handler/index.mjs` is its Lambda twin.
- `public/js/voice.js` + `public/audio/*.mp3` — the announcer: a calm,
  matter-of-fact British voice stating each result (ElevenLabs clips
  generated once by `scripts/make-voices.py`; key from SSM, never in the
  browser). Lines are written with periods, not exclamation marks, and the
  generator trims any breath after the last sound.
- `public/js/music.js` + `public/audio/mind.mp3` — the music bed: a
  hypnotic instrumental composed by Eleven Music (`scripts/make-music.py`),
  built into an exact 110-second loop with a 10-second crossfade seam, a
  40 Hz gamma binaural bed and a faint 528 Hz tone (both phase-continuous
  across the seam). Played through Web Audio, looping between two points
  that hold identical audio so the seam is sample-accurate in every
  browser. Starts on the first tap and carries on into the game; the ♫
  buttons on the landing page and in the game header turn it off (remembered).
- `public/js/vendor/three.module.js` — three.js r170, vendored so the
  installed app works offline.

Element IDs in `index.html` are the contract with `main.js`.

## Credits

RINGO is an original game invented by **Wendelin Leinweber**.
© 2026 Bee Line Microsystems LLC.
