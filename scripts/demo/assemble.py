#!/usr/bin/env python3
"""Cut the demo: title card, the recorded game, end card; narration on the
beats the recorder logged, the announcer's RINGO on the win, the game's own
score underneath.

    python3 scripts/demo/assemble.py WORK_DIR OUT.mp4

WORK_DIR holds game.webm, beats.json, card-title.png, card-end.png and
voice/*.mp3 from record.mjs + narration.py.
"""
import json, os, subprocess, sys

WORK = sys.argv[1]; OUT = sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
beats = json.load(open(os.path.join(WORK, "beats.json")))
game_len = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
    "-of", "csv=p=0", os.path.join(WORK, "game.webm")]).decode())

TITLE, END, XF = 3.0, 5.5, 0.5
lead = beats["intro"] / 1000               # recorder lead-in, cut off (see record.mjs)
game_len -= lead
game_at = TITLE - XF                       # where the game segment starts in the final cut
end_at = game_at + game_len - XF
total = end_at + END
b = lambda name, off=0.0: game_at + (beats[name] - beats["intro"]) / 1000 + off

# (clip, start seconds)
cues = [
    ("intro",  0.3),
    ("cube",   b("cube", 0.3)),
    ("roll",   b("roll", 0.2)),
    ("place",  b("place", 0.2)),
    ("inside", b("inside", 0.3)),
    ("fan",    b("fan", 0.3)),
    ("wild",   b("wild", 0.3)),
    ("steal",  b("steal", 0.2)),
    ("twist",  b("twist", 0.4)),
    ("build",  b("twist", 9.5)),
    ("win",    b("win", -2.0)),
    ("outro",  end_at + 0.7),
]
# No line may start before the previous one has finished (plus a breath),
# whatever the recorder's timing did — later lines slide, never overlap.
def length(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", path]).decode())
GAP = 0.35
prev_end = 0.0
spaced = []
for n, t in sorted(cues, key=lambda c: c[1]):
    path = os.path.join(WORK, "voice", f"{n}.mp3")
    start = max(t, prev_end + GAP)
    if start > t + 0.01:
        print(f"  ({n} slid {start - t:.2f}s to clear the previous line)")
    spaced.append((n, start))
    prev_end = start + length(path)
cues = spaced
voice = [(os.path.join(WORK, "voice", f"{n}.mp3"), t) for n, t in cues]
# The announcer's RINGO follows "…and you shout." — right after that line
# ends, or on the banner if that comes later. Anchored on the win line
# itself, not on whichever line happens to be last.
win_start = dict(cues)["win"]
win_end = win_start + length(os.path.join(WORK, "voice", "win.mp3"))
shout = max(b("ringo", 0.05), win_end + 0.2)
voice.append((os.path.join(ROOT, "public", "audio", "ringo.mp3"), shout))
print(f"  RINGO shout at {shout:.2f}s (win line ends {win_end:.2f}s, banner at {b('ringo'):.2f}s)")
music = os.path.join(ROOT, "public", "audio", "mind.mp3")

inputs = ["-loop", "1", "-t", str(TITLE), "-i", os.path.join(WORK, "card-title.png"),
          "-i", os.path.join(WORK, "game.webm"),
          "-loop", "1", "-t", str(END), "-i", os.path.join(WORK, "card-end.png"),
          "-i", music]
for path, _ in voice:
    inputs += ["-i", path]

f = []
f.append("[0:v]fps=25,format=yuv420p,setsar=1[t]")
f.append(f"[1:v]trim=start={lead:.3f},setpts=PTS-STARTPTS,fps=25,format=yuv420p,setsar=1[g]")
f.append("[2:v]fps=25,format=yuv420p,setsar=1[e]")
f.append(f"[t][g]xfade=transition=fade:duration={XF}:offset={TITLE - XF}[tg]")
f.append(f"[tg][e]xfade=transition=fade:duration={XF}:offset={end_at}[v]")
f.append(f"[3:a]atrim=0:{total},volume=0.16,afade=t=in:d=1.5,afade=t=out:st={total - 2.5}:d=2.5[m]")
labels = ["[m]"]
for i, (_, t) in enumerate(voice):
    idx = 4 + i
    f.append(f"[{idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay={int(t * 1000)}|{int(t * 1000)}[a{i}]")
    labels.append(f"[a{i}]")
f.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0,atrim=0:{total}[a]")

cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(f),
       "-map", "[v]", "-map", "[a]", "-r", "25", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
       "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", f"{total:.2f}", OUT]
subprocess.run(cmd, check=True)
print(f"wrote {OUT}  ({total:.1f}s)")
for n, t in cues: print(f"  {t:6.2f}s  {n}")
