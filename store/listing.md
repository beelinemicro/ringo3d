# Google Play listing — RINGO 3D

Everything to paste into Play Console, plus the answers to the declarations.
Character counts are checked against Play's limits.

## App name (limit 30)

    RINGO 3D

Alternative, if you'd rather the title carry search terms, since nobody is
looking for the name yet:

    RINGO 3D: Five in a Row

## Short description (limit 80)

    Five in a row through a 5x5x5 cube. Roll, place your rings, twist the cube.

## Full description (limit 4000)

Dad's board game, cubed.

RINGO started at a kitchen table: a 5x5 grid, two dice, and a pile of coloured
rings. Wendelin Leinweber drew it up, lettered the columns R-I-N-G-O, numbered
the rows 1 to 5, and put a wild star on each die. The family has been shouting
"RINGO!" at each other ever since.

RINGO 3D lifts that board into a cube. Five layers of glass stacked front to
back, 125 spaces, and a third die that picks the layer by colour.

HOW IT PLAYS

Roll three dice: a letter, a number and a layer colour. Place a ring of your
colour where they meet. Each die has a wild face, so you choose that part
yourself, and three wilds means anywhere in the cube.

Land on someone else's ring and you choose: steal the spot, or roll again.
Land on your own and you simply roll again. You never lose your turn.

Or don't roll at all. Twist the cube instead. Turn any layer, column or row a
quarter turn, Rubik's style, and every ring in that slice swings somewhere
new. A twist can finish your line. It can also finish someone else's, and they
win, which is exactly as funny as it sounds.

TWO WAYS TO WIN

Five of your rings in any straight line through the cube: across, down, front
to back, diagonally through a layer, or corner to corner through the middle.
Or claim all four corners of any outer face. Either way, shout it.

Finish more than one line at once for a DOUBLE or TRIPLE RINGO.

WAYS TO PLAY

Pass and Play: two to five players sharing one screen.
vs Computer: easy, normal and hard opponents that place, steal and twist.
Online: create a room and share the code, or open your room so anyone can drop
in. Watch a game in progress and take the next free seat.

SEEING INSIDE A CUBE

The whole cube is there in front of you. Drag to spin it. Tap a colour to look
into one layer. Fan the layers apart to see where every ring sits. A rolled
space is marked with a crosshair so you always know where you're aiming.

NO NONSENSE

No adverts. No accounts. No chat. No tracking. Nothing you type outlives the
game you typed it in. Pass and Play and games against the computer work with
no signal at all.

Free, and it will stay that way.

RINGO is an original game invented by Wendelin Leinweber.
(c) 2026 Bee Line Microsystems LLC

## Release notes (limit 500 per language)

Play asks for these each time you upload a build. For a first release there is
nothing "new" yet, so they simply say what the game is.

    First release.
    
    RINGO 3D is a family board game lifted into a cube: three dice, five layers of glass, and rings you can steal from each other. Twist any slice Rubik's-style to swing whole lines into place. Five in a row through the cube, or all four corners of a face, wins.
    
    Play on one screen, against the computer, or online with anyone. No ads, no accounts, no tracking.

Shorter, if you'd rather:

    First release. Dad's board game, cubed: three dice, a 5x5x5 cube, rings to steal, and a Rubik's-style twist. Five in a row, or four corners, wins.

## Other listing fields

- App or game: **Game**
- Category: **Board**
- Tags: board game, puzzle, family, multiplayer, dice
- Contact email: steve@beelinemicrosystems.com
- Website: https://ringo3d.beelinemicrosystems.com
- Privacy policy: https://ringo3d.beelinemicrosystems.com/privacy.html

## Graphics

- App icon 512x512: `public/icons/icon-512.png`
- Feature graphic 1024x500: `store/feature-graphic.png`
- Phone screenshots: `public/screenshots/phone-menu.jpg`, `phone-game.jpg`
  (780x1320). Play wants at least two; four is better. More can be rendered
  with `scripts/make-assets.mjs`.
- Tablet screenshots are optional, but a filled slot needs two images:
  `public/screenshots/desktop-game.jpg` (the cube in play) and
  `public/screenshots/desktop-layers.jpg` (the fanned-layers view), both
  1280x900. Use the same pair for the 7-inch and 10-inch slots.

## Data safety answers

Answer **yes, this app collects data**, then declare exactly one item. Saying
"no data collected" would be wrong, because the display name reaches the
server and lives in the room for up to a day, which is longer than Play's
definition of ephemeral.

| Question | Answer |
| --- | --- |
| Data type | Personal info → Name |
| Collected or shared | Collected. Not shared. |
| Processed ephemerally | No |
| Required or optional | Optional |
| Purpose | App functionality |
| Linked to a user identity | No. There are no accounts. |
| Can users request deletion | Deleted automatically when the room expires |
| Data encrypted in transit | Yes |

Everything else is genuinely nothing: no location, no contacts, no photos, no
identifiers, no advertising ID, no analytics library, no crash reporting SDK.

## The rest of App content

- **Ads**: no ads.
- **App access**: all functionality is available without any special access.
- **Content rating**: no violence, no language, no sexual content, no
  gambling, no purchases, no user-to-user free text. It should come back
  Everyone / PEGI 3.
- **Target audience**: 13 and up. The content suits everyone, but ticking the
  under-13 boxes pulls the app into the Families programme, and the app does
  take a display name. 13+ keeps the first release simple.
- **News app**: no. **Government app**: no. **Financial features**: none.
- **Health**: none.

## YouTube (the how-to-play video)

Title (limit 100):

    RINGO 3D – How to Play in 90 Seconds

Description. The first two lines show before "Show more", so they carry the
links. Chapter timestamps come from scripts/demo/assemble.py's cue table;
YouTube needs at least three, starting at 0:00, each 10 seconds or longer.

    RINGO 3D is a family board game lifted into a 5×5×5 cube. Here's how to play, in ninety seconds.

    ▶ Play free in your browser: https://ringo3d.beelinemicrosystems.com
    📱 Get it on Google Play: https://play.google.com/store/apps/details?id=com.beelinemicrosystems.ringo3d

    HOW IT WORKS
    Roll three dice – a letter, a number and a layer colour – and they point at one space in the cube. Place a ring there. A star is wild: you choose that part yourself. Land on a rival's ring and you can steal it. Or skip the roll and twist a slice of the cube, Rubik's-style, and every ring in it swings somewhere new.

    Five of your rings in any straight line through the cube – or all four corners of a face – wins. Then you shout RINGO!

    Play on one screen with up to five people, against the computer, or online with anyone.

    CHAPTERS
    0:00 Meet RINGO 3D
    0:12 The cube and the three dice
    0:25 Seeing inside the cube
    0:42 Wilds and stealing
    0:53 The twist
    1:10 RINGO! And where to play

    ABOUT
    RINGO is an original board game invented by Wendelin Leinweber and played around his family's table for years. RINGO 3D lifts it into three dimensions. Free, with no ads, no accounts and no tracking.

    Built by Bee Line Microsystems – https://beelinemicrosystems.com/solutions/ringo-3d/

    #boardgame #familygame #puzzlegame

Tags (comma-separated, in the Tags box): RINGO 3D, board game, family board game, puzzle game, dice game, five in a row, 3D board game, Android game, free game, Rubik's cube, how to play

Upload settings Play requires: Public or Unlisted, embedding allowed, not
age-restricted, ads off, "not made for kids".

## TikTok / Reels / Shorts (the vertical cut)

`ringo3d-tiktok-vertical.mp4` — 1080x1920, 60s, captions burned in because
most of TikTok watches on mute. One sentence straddles the loop point: it
closes on "So, it is our great honor to be..." and the auto-loop completes
it with the opening "Introducing you to RINGO 3D, where the object is five
in a row, through a cube." Rebuild with:

    PORT=8081 node server.js &
    python3 scripts/demo/narration.py build/tiktok/voice --tiktok
    node scripts/demo/tiktok.mjs build/tiktok
    python3 scripts/demo/tiktok.py build/tiktok build/tiktok/vertical.mp4

Caption (TikTok allows 2200 characters; the first line is what shows):

    Dad invented this board game at the kitchen table. I turned it into a cube 🎲

    Five in a row through a 5x5x5 cube — or all four corners of a face. Roll three dice, place your ring, steal a rival's, or twist the whole cube Rubik's-style and swing a line into place.

    Free, no ads, no accounts. Link in bio 👆

    #boardgame #familygame #indiegame #puzzlegame #madewithcode #rubikscube #tabletop #gamedev #dadsinvention #fyp

Hashtags to rotate: #boardgame #familygame #indiegame #puzzlegame #tabletop
#gamedev #dadsinvention #braingames #strategygame #fyp

Notes
- TikTok covers the bottom ~300px and the right ~110px with its own UI; the
  cut leaves that clear, which is why the game sits high in the frame.
- Same file works for Instagram Reels and YouTube Shorts (both 9:16, <=90s).
- Sound: keep the original audio. TikTok's "add sound" would bury the
  narration, and the captions already carry it for muted viewers.
