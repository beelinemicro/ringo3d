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
VOICE = os.environ.get("RINGO_VOICE_ID", "FuqUZgB1nmXK4S9GhENW")

def ssm(name):
    return subprocess.check_output(
        ["aws", "ssm", "get-parameter", "--name", name,
         "--with-decryption", "--query", "Parameter.Value", "--output", "text"]
    ).decode().strip()

KEY = os.environ.get("ELEVENLABS_API_KEY") or ssm("/storymaker/elevenlabs-api-key")

# The caller is a calm, matter-of-fact British voice — the tone of a ship's
# computer announcing a result, not a game-show host. High stability and
# almost no style keep the delivery even; periods, not exclamation marks,
# keep it from shouting. (An earlier excited voice growled after all-caps
# "!!!" lines; trim_tail() below still drops any breath left after the last
# real sound.)
CALM = {"stability": 0.72, "similarity_boost": 0.8, "style": 0.12, "use_speaker_boost": True}

# filename -> (settings, text). Names must match public/js/voice.js.
CLIPS = {
    "ringo":        (CALM, "Ringo."),
    "double-ringo": (CALM, "Double Ringo."),
    "triple-ringo": (CALM, "Triple Ringo."),
    "stolen":       (CALM, "Stolen."),
    "double-wild":  (CALM, "Double wild."),
    "triple-wild":  (CALM, "Triple wild."),
    "twist":        (CALM, "Twist."),
}


def trim_tail(path):
    """Cut the clip just after its last real sound (12% of peak) with a short
    fade. Silently skipped if ffmpeg isn't installed."""
    import audioop, warnings
    warnings.filterwarnings("ignore")
    try:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "22050", "-"],
                             capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return
    step = int(22050 * 0.02) * 2
    rms = [audioop.rms(raw[i:i + step], 2) for i in range(0, len(raw) - step, step)]
    if not rms:
        return
    peak = max(rms)
    last = max(i for i, r in enumerate(rms) if r > peak * 0.12)
    end = (last + 1) * 0.02 + 0.09
    if end >= len(rms) * 0.02 - 0.05:
        return  # nothing to trim
    tmp = path + ".trim.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-t", f"{end:.3f}",
                    "-af", f"afade=t=out:st={end - 0.07:.3f}:d=0.07", "-c:a", "libmp3lame", "-b:a", "96k", tmp], check=True)
    os.replace(tmp, path)
    print(f"  trimmed {os.path.basename(path)} to {end:.2f}s")

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
            trim_tail(path)
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
