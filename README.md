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

**Stage two** (next): online family rooms, spectators, family stats, the
`ringo3d.beelinemicrosystems.com` deployment (own S3 bucket, CloudFront,
WebSocket Lambda and DynamoDB table). `server.js`, `aws/ws-handler/` and
`scripts/deploy-*.sh` are still the 2D game's copies and need porting to
the cube's rules (cell indexes instead of `[row, col]`, the `twist` move).

## Run it

```bash
npm install
npm start          # http://localhost:3000
npm test           # rules-engine tests
```

Pass & Play and vs Computer need no server at all — `server.js` only serves
the files. To try it on a phone from WSL, forward the port on the Windows
side (see the notes in the session that built this) or `npx localtunnel --port 3000`.

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
