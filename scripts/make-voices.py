#!/usr/bin/env python3
"""Generate the RINGO 3D caller's voice clips (ElevenLabs) into public/audio/.

The ElevenLabs API key is TTS-scoped and stored in SSM (the same key the
SantaVerse games use) — this script pulls it via the aws CLI, so no secret
lives in the repo or ships to browsers: the clips are static MP3s.
Idempotent: existing non-empty clips are skipped.

Run:  python3 scripts/make-voices.py            # fill in missing clips
      python3 scripts/make-voices.py --force    # regenerate everything
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "audio")
URL = "https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_96"
MODEL = "eleven_flash_v2_5"
VOICE = os.environ.get("RINGO_VOICE_ID", "dHd5gvgSOzSfduK4CvEg")

def ssm(name):
    return subprocess.check_output(
        ["aws", "ssm", "get-parameter", "--name", name,
         "--with-decryption", "--query", "Parameter.Value", "--output", "text"]
    ).decode().strip()

KEY = os.environ.get("ELEVENLABS_API_KEY") or ssm("/storymaker/elevenlabs-api-key")

# A big, excited game-show caller.
SHOUT = {"stability": 0.32, "similarity_boost": 0.8, "style": 0.7, "use_speaker_boost": True}
CALL = {"stability": 0.45, "similarity_boost": 0.8, "style": 0.5, "use_speaker_boost": True}

# filename -> (settings, text). Names must match public/js/voice.js.
CLIPS = {
    "ringo":        (SHOUT, "RINGO!!!"),
    "double-ringo": (SHOUT, "DOUBLE RINGO!!!"),
    "triple-ringo": (SHOUT, "TRIPLE RINGO!!!"),
    "stolen":       (CALL,  "Stolen!"),
    "double-wild":  (CALL,  "Double wild!"),
    "triple-wild":  (SHOUT, "TRIPLE WILD!!!"),
    "twist":        (CALL,  "Twist!"),
}

def gen(name, settings, text):
    path = os.path.join(OUT, name + ".mp3")
    if "--force" not in sys.argv and os.path.exists(path) and os.path.getsize(path) > 0:
        print(f"  skip  {name}")
        return
    body = json.dumps({"text": text, "model_id": MODEL, "voice_settings": settings}).encode()
    req = urllib.request.Request(URL.format(vid=VOICE), data=body, method="POST", headers={
        "xi-api-key": KEY, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            print(f"  wrote {name} ({len(data)} bytes)")
            return
        except urllib.error.HTTPError as e:
            print(f"  {name}: HTTP {e.code} {e.read()[:200]!r}")
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(2 + attempt * 3)
                continue
            raise

os.makedirs(OUT, exist_ok=True)
for name, (settings, text) in CLIPS.items():
    gen(name, settings, text)
print("done")
