#!/usr/bin/env python3
"""Cut the vertical (9:16) how-to for TikTok.

Input is the frame-stepped render from tiktok.mjs / capture.mjs (game.mp4 +
beats.json with exact frame times).

    python3 scripts/demo/tiktok.py WORK_DIR OUT.mp4

WORK_DIR holds game.webm, beats.json, bg.png, cap-*.png, card-end.png and
voice/*.mp3 from tiktok.mjs + narration.py --tiktok.

The frame is 1080x1920: a caption band on top, the game in the middle, and
the bottom ~300px left clear because TikTok draws its own interface there.
Captions are burned in and timed to the narration, since most of TikTok
watches on mute.
"""
import json, os, subprocess, sys

WORK = sys.argv[1]; OUT = sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
meta = json.load(open(os.path.join(WORK, "beats.json")))
GAME = os.path.join(WORK, "game.mp4")   # rendered frame by frame under virtual time (capture.mjs)
FPS = meta["fps"]

def length(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", path]).decode())

FW, FH = 1080, 1920
GW, GH, GX, GY = 900, 1315, 90, 300      # the game inside the frame
CAP_Y = 8                                 # caption band (captions are 290 tall; game starts at 300)
END, XF = 4.6, 0.5                        # end card: a beat to read it, then the loop line
GAP = 0.3

beats = meta["beats"]                     # exact frame times — the capture is frame-stepped
lead = beats["hook"]                      # recorder settle + menu, trimmed off
game_len = length(GAME) - lead
end_at = game_len - XF
total = end_at + END
b = lambda n, off=0.0: beats[n] - beats["hook"] + off

cues = [
    ("hook",  b("hook", 0.2)),
    ("roll",  b("roll", 0.15)),
    ("place", b("place", 0.15)),
    ("wild",  b("wild", 0.25)),
    ("steal", b("steal", 0.15)),
    ("twist", b("twist", 0.35)),
    ("win",   b("ringo") - length(os.path.join(WORK, "voice", "win.mp3")) - 0.3),
    ("outro", b("ringo", 1.3)),           # over the confetti, after the shout
    # Trails off just before the cut so the loop completes the sentence.
    ("loop",  total - length(os.path.join(WORK, "voice", "loop.mp3")) - 0.25),
]

# No line may start before the previous one has finished.
prev_end, spaced = 0.0, []
for n, t in sorted(cues, key=lambda c: c[1]):
    start = max(t, prev_end + GAP)
    if start > t + 0.01:
        print(f"  ({n} slid {start - t:.2f}s)")
    spaced.append((n, start))
    prev_end = start + length(os.path.join(WORK, "voice", f"{n}.mp3"))
cues = spaced
at = dict(cues)

voice = [(os.path.join(WORK, "voice", f"{n}.mp3"), t) for n, t in cues]
win_end = at["win"] + length(os.path.join(WORK, "voice", "win.mp3"))
shout = max(b("ringo", 0.05), win_end + 0.15)
voice.append((os.path.join(ROOT, "public", "audio", "ringo.mp3"), shout))
print(f"  RINGO shout at {shout:.2f}s (banner {b('ringo'):.2f}s)")

# A caption lives as long as the line it belongs to — but never into the
# next caption, which would draw the two on top of each other.
caps = []
for n, t in cues:
    p = os.path.join(WORK, f"cap-{n}.png")
    if os.path.exists(p):
        caps.append([p, max(0.0, t - 0.2), t + length(os.path.join(WORK, "voice", f"{n}.mp3")) + 0.7])
for a, b_ in zip(caps, caps[1:]):
    a[2] = min(a[2], b_[1] - 0.12)

inputs = ["-loop", "1", "-t", f"{total}", "-i", os.path.join(WORK, "bg.png"),
          "-i", GAME,
          "-loop", "1", "-t", f"{END}", "-i", os.path.join(WORK, "card-end.png"),
          "-i", os.path.join(ROOT, "public", "audio", "mind.mp3")]
for p, _, _ in caps:
    inputs += ["-loop", "1", "-t", f"{total}", "-i", p]
for p, _ in voice:
    inputs += ["-i", p]

f = [
    f"[0:v]scale={FW}:{FH},fps=25,format=yuv420p,setsar=1[bg]",
    f"[1:v]trim=start={lead:.3f},setpts=PTS-STARTPTS,"
    f"scale={GW}:{GH}:flags=lanczos,fps={FPS},format=yuv420p,setsar=1[g]",
    f"[bg][g]overlay={GX}:{GY}:shortest=0[base0]",
]
label = "base0"
for i, (_, s0, s1) in enumerate(caps):
    src = 4 + i
    f.append(f"[{src}:v]format=rgba[c{i}]")
    f.append(f"[{label}][c{i}]overlay=0:{CAP_Y}:enable='between(t,{s0:.2f},{s1:.2f})'[base{i + 1}]")
    label = f"base{i + 1}"
f.append(f"[{label}]trim=0:{game_len:.3f},setpts=PTS-STARTPTS[main]")
f.append(f"[2:v]scale={FW}:{FH},fps=25,format=yuv420p,setsar=1[e]")
f.append(f"[main][e]xfade=transition=fade:duration={XF}:offset={end_at:.3f}[v]")

f.append(f"[3:a]atrim=0:{total},volume=0.16,afade=t=in:d=1.2,afade=t=out:st={total - 2.2:.2f}:d=2.2[m]")
labels = ["[m]"]
vstart = 4 + len(caps)
for i, (_, t) in enumerate(voice):
    f.append(f"[{vstart + i}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
             f"adelay={int(t * 1000)}|{int(t * 1000)}[a{i}]")
    labels.append(f"[a{i}]")
f.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0,atrim=0:{total}[a]")

subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(f),
                "-map", "[v]", "-map", "[a]", "-r", "25",
                "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
                "-t", f"{total:.2f}", OUT], check=True)
print(f"wrote {OUT}  ({total:.1f}s, {FW}x{FH})")
for n, t in cues:
    print(f"  {t:6.2f}s  {n}")
