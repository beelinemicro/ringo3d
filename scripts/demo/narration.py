#!/usr/bin/env python3
"""Narration for the how-to-play video, in the announcer's voice.

    python3 scripts/demo/narration.py OUT_DIR

Same voice, model and calm settings as scripts/make-voices.py, so the
narrator and the in-game announcer are audibly the same person.
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error

OUT = sys.argv[1] if len(sys.argv) > 1 else "build/demo/voice"
os.makedirs(OUT, exist_ok=True)
URL = "https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_96"
MODEL = "eleven_flash_v2_5"
VOICE = os.environ.get("RINGO_VOICE_ID", "FuqUZgB1nmXK4S9GhENW")
CALM = {"stability": 0.72, "similarity_boost": 0.8, "style": 0.12, "use_speaker_boost": True}

def ssm(name):
    return subprocess.check_output(["aws", "ssm", "get-parameter", "--name", name,
        "--with-decryption", "--query", "Parameter.Value", "--output", "text"]).decode().strip()
KEY = os.environ.get("ELEVENLABS_API_KEY") or ssm("/storymaker/elevenlabs-api-key")

# Punchier lines for the vertical cut: TikTok rewards speed, and most of the
# frame's talking is done by the burned-in captions.
TIKTOK = [
    ("hook",   "Five in a row. Through a cube."),
    ("roll",   "Three dice: a letter, a number, a colour. They point at one space."),
    ("place",  "Place your ring."),
    ("wild",   "A star is wild. Anywhere you like."),
    ("steal",  "Land on a rival's ring? Take it."),
    ("twist",  "Or twist the cube, and swing a whole line into place."),
    ("win",    "Five in a row, and you shout."),
    ("outro",  "RINGO 3D. Free, on Android and the web."),
]

# Order matters only for reading; timing is decided by the recorder's beat log.
LINES = [
    ("intro",  "This is RINGO 3D. A family board game, lifted into a cube."),
    ("cube",   "Five glass layers. One hundred and twenty-five spaces."),
    ("roll",   "Roll three dice: a letter, a number, and a layer colour. Together, they point at one space."),
    ("place",  "Place your ring there."),
    ("inside", "Tap a colour to look into a single layer."),
    ("fan",    "Or fan the layers apart, and see every ring at once."),
    ("wild",   "A star is wild. You choose that part yourself."),
    ("steal",  "Land on a rival's ring, and you can take it."),
    ("twist",  "Or skip the roll, and twist a slice. Rubik's style."),
    ("win",    "Five in a row through the cube, or all four corners of a face, and you shout."),
    ("outro",  "Play free in your browser, or get it on Google Play."),
]

if "--tiktok" in sys.argv:
    LINES = TIKTOK

for name, text in LINES:
    path = os.path.join(OUT, name + ".mp3")
    if os.path.exists(path) and os.path.getsize(path) > 0 and "--force" not in sys.argv:
        print(f"  skip  {name}"); continue
    body = json.dumps({"text": text, "model_id": MODEL, "voice_settings": CALM}).encode()
    req = urllib.request.Request(URL.format(vid=VOICE), data=body, method="POST", headers={
        "xi-api-key": KEY, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            open(path, "wb").write(data)
            print(f"  wrote {name} ({len(data)} bytes)")
            break
        except urllib.error.HTTPError as e:
            print(f"  {name}: HTTP {e.code} {e.read()[:160]!r}")
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(2 + attempt * 3); continue
            raise
print("done")
