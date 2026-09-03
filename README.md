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

**Stage one** (this repo, playable locally): the cube, twists, Pass & Play,
vs Computer (easy / normal / hard bots that place, steal and twist), the
caller's voice, install-to-phone.

Live at **https://ringo3d.beelinemicrosystems.com** (static site; Pass &
Play and vs Computer run entirely in the browser).

**Stage two** (next): online family rooms, spectators, family stats — the
WebSocket Lambda and DynamoDB table. `server.js`, `aws/ws-handler/` and
`scripts/deploy-lambda.sh` are still the 2D game's copies and need porting
to the cube's rules (cell indexes instead of `[row, col]`, the `twist` move).

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
- **Multiplayer**: not yet — stage two adds the API Gateway WebSocket API,
  Lambda and DynamoDB table, and `scripts/deploy-web.sh` then gets the
  `wss://` endpoint in `WS_URL`.

```bash
./scripts/deploy-web.sh      # web client → S3 + CloudFront invalidation
```

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
  banner, voice, install.
- `public/js/voice.js` + `public/audio/*.mp3` — the caller (ElevenLabs
  clips generated once by `scripts/make-voices.py`; key from SSM, never in
  the browser).
- `public/js/vendor/three.module.js` — three.js r170, vendored so the
  installed app works offline.

Element IDs in `index.html` are the contract with `main.js`.

## Credits

RINGO is an original game invented by **Wendelin Leinweber**.
© 2026 Bee Line Microsystems LLC.
