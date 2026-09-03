#!/usr/bin/env python3
"""Generate the game's music bed (Eleven Music) and build a seamless loop.

    python3 scripts/make-music.py            # generate + build public/audio/mind.mp3
    python3 scripts/make-music.py --build    # rebuild the loop from build/music-raw.wav

The track is composed by ElevenLabs from PROMPT (instrumental, ~2 min), then:
  1. trimmed to exactly RAW_SECONDS and crossfaded end-into-start over
     CROSSFADE seconds, giving a loop L of exactly LOOP_SECONDS;
  2. a gamma binaural bed (200 Hz left / 240 Hz right = 40 Hz beat) and a
     barely-there 528 Hz Solfeggio tone are mixed in — LOOP_SECONDS is a
     whole number of cycles of each, so they are phase-continuous at the seam;
  3. written as [1 s silence] + L + [first HEAD seconds of L again].
music.js loops the Web Audio buffer between 1.5 s and 1.5 + LOOP_SECONDS:
both points sit in identical audio, so any decoder delay cancels out and the
seam is sample-accurate in every browser. The API key is the ElevenLabs key
in SSM (it has the music permission).
"""
import json, os, subprocess, sys, urllib.request, urllib.error

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
BUILD = os.path.join(ROOT, "build")
RAW_MP3 = os.path.join(BUILD, "music-raw.mp3")
RAW_WAV = os.path.join(BUILD, "music-raw.wav")
OUT = os.path.join(ROOT, "public", "audio", "mind.mp3")

RAW_SECONDS = 120
CROSSFADE = 8
HEAD = 3
RATE = 44100
MUSIC_JS = os.path.join(ROOT, "public", "js", "music.js")

# Composed takes tend to start soft and end in silence; the loop is cut from
# the solid part between them (found by loudness), so the seam blends music
# with music. The loop length is a whole number of seconds — a whole number
# of cycles of the 200/240/528 Hz beds — and is written into music.js.
LEAD_DB = -28.0   # the loop starts at the first second at least this loud
TAIL_DB = -35.0   # ...and ends at the last second at least this loud

PROMPT = (
    "Cinematic, hypnotic electronic score with heart: a precise, pulsing synth arpeggio "
    "around 100 BPM over a deep sub-bass drone and warm analog pads; underneath, a soft, "
    "slow heartbeat-like drum pulse with gentle brushed percussion; and Tibetan singing "
    "bowls struck now and then, ringing out with long shimmering decays. Subtle glitch "
    "textures. Layers build slowly and never fully resolve — focused, clever, quietly "
    "euphoric, the feeling of a mind clicking into genius mode. Steady tempo throughout, "
    "no vocals, no big drops, no intro or outro: an evolving texture that could loop "
    "forever, tuned around a sustained 528 Hz drone."
)

def ssm(name):
    return subprocess.check_output(["aws", "ssm", "get-parameter", "--name", name, "--with-decryption",
                                    "--query", "Parameter.Value", "--output", "text"]).decode().strip()

def compose():
    key = os.environ.get("ELEVENLABS_API_KEY") or ssm("/storymaker/elevenlabs-api-key")
    body = json.dumps({"prompt": PROMPT, "music_length_ms": RAW_SECONDS * 1000, "force_instrumental": True,
                       "model_id": "music_v1"}).encode()
    req = urllib.request.Request("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", data=body,
                                 method="POST", headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        print("music API:", e.code, e.read()[:600].decode(errors="replace"))
        sys.exit(1)
    os.makedirs(BUILD, exist_ok=True)
    with open(RAW_MP3, "wb") as f:
        f.write(data)
    print(f"composed {len(data)} bytes")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", RAW_MP3, "-ar", str(RATE), "-ac", "2", RAW_WAV], check=True)

def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)

def loudness_per_second():
    import array, math
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", RAW_WAV, "-f", "s16le", "-ac", "1", "-ar", str(RATE), "-"],
                         capture_output=True, check=True).stdout
    pcm = array.array("h")
    pcm.frombytes(raw)
    out = []
    for i in range(len(pcm) // RATE):
        seg = pcm[i * RATE:(i + 1) * RATE]
        out.append(20 * math.log10(max(1e-9, math.sqrt(sum(v * v for v in seg) / RATE) / 32768)))
    return out

def solid_span():
    """(start, end) in whole seconds of the take's solid music."""
    db = loudness_per_second()
    start = next((i for i, v in enumerate(db) if v >= LEAD_DB), 0)
    end = next((i + 1 for i in range(len(db) - 1, -1, -1) if db[i] >= TAIL_DB), len(db))
    return start, end

def build():
    """Three simple passes (one crossfade with both inputs read separately —
    ffmpeg deadlocks when they come from one split of the same stream)."""
    C, H = CROSSFADE, HEAD
    a, b = solid_span()
    L = b - a - C
    if L < 60:
        sys.exit(f"the take only has {b - a}s of solid music — compose again")
    print(f"solid music from {a}s to {b}s → loop {L}s (crossfade {C}s)")
    loop_wav = os.path.join(BUILD, "music-loop.wav")
    mix_wav = os.path.join(BUILD, "music-mix.wav")
    # 1. the loop: the solid span minus its first C seconds, with its tail
    #    crossfaded (equal-power) into those first C seconds — exactly L
    #    seconds, seamless end-to-start
    run(["-i", RAW_WAV, "-i", RAW_WAV, "-filter_complex",
         f"[0:a]atrim={a + C}:{b},asetpts=PTS-STARTPTS[body];"
         f"[1:a]atrim={a}:{a + C},asetpts=PTS-STARTPTS[head];"
         f"[body][head]acrossfade=d={C}:c1=qsin:c2=qsin,atrim=0:{L},asetpts=PTS-STARTPTS[o]",
         "-map", "[o]", loop_wav])
    # 2. the mind bed: gamma binaural (200 Hz left / 240 Hz right) and a faint
    #    528 Hz Solfeggio tone — L seconds is a whole number of cycles of each
    run(["-i", loop_wav, "-filter_complex",
         f"sine=frequency=200:sample_rate={RATE}:duration={L}[bl];"
         f"sine=frequency=240:sample_rate={RATE}:duration={L}[br];"
         f"[bl][br]join=inputs=2:channel_layout=stereo,volume=0.04[bin];"
         f"sine=frequency=528:sample_rate={RATE}:duration={L},aformat=channel_layouts=stereo,volume=0.012[sol];"
         f"[0:a][bin][sol]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.95,atrim=0:{L}[o]",
         "-map", "[o]", mix_wav])
    # 3. the file: 1 s of silence, the loop, then the loop's first H seconds again
    run(["-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=stereo:d=1", "-i", mix_wav, "-i", mix_wav, "-filter_complex",
         f"[2:a]atrim=0:{H},asetpts=PTS-STARTPTS[again];"
         f"[0:a][1:a][again]concat=n=3:v=0:a=1[o]",
         "-map", "[o]", "-c:a", "libmp3lame", "-b:a", "128k", OUT])
    for f in (loop_wav, mix_wav):
        d = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).decode().strip()
        print(f"  {os.path.basename(f)}: {float(d):.3f}s")
    dur = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).decode().strip()
    print(f"wrote {OUT}: {os.path.getsize(OUT)} bytes, {float(dur):.2f}s (loop {L}s between 1.5s and {1.5 + L}s)")
    # Keep the player's loop length in step with the file.
    import re
    js = open(MUSIC_JS).read()
    js2 = re.sub(r"const LOOP_SECONDS = \d+;", f"const LOOP_SECONDS = {L};", js)
    if js2 != js:
        open(MUSIC_JS, "w").write(js2)
        print(f"music.js: LOOP_SECONDS = {L}")

if "--build" not in sys.argv:
    compose()
build()
