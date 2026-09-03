// Canvas confetti for the "RINGO!" moment: paper, rings, and streamers
// from a center burst plus a cannon in each bottom corner. Bursts stack —
// a legendary DOUBLE/TRIPLE win calls burst() several times.

let raf = null;
let parts = [];
let ctx = null;
let W = 0;
let H = 0;

function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function spawn(n, x, y, dir, spread, speed, palette) {
  for (let i = 0; i < n; i++) {
    const a = dir + (Math.random() - 0.5) * spread;
    const v = speed * (0.5 + Math.random() * 0.8);
    const kind = Math.random();
    parts.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      w: 7 + Math.random() * 7,
      h: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.45,
      wob: Math.random() * Math.PI * 2,
      wobV: 0.12 + Math.random() * 0.18,
      color: palette[Math.floor(Math.random() * palette.length)],
      shape: kind < 0.58 ? 'rect' : kind < 0.86 ? 'ring' : 'streamer',
      age: 0,
      life: 190 + Math.random() * 90,
    });
  }
}

export function burst(canvas, colors) {
  prepare(canvas);
  const palette = [...colors, '#ffd34d', '#ffffff', '#ff7ab6', '#7ad3ff'];
  spawn(180, W / 2, H * 0.38, -Math.PI / 2, 2.4, 15, palette);
  spawn(80, 0, H * 0.9, -Math.PI / 3.1, 0.9, 20, palette);
  spawn(80, W, H * 0.9, -Math.PI + Math.PI / 3.1, 0.9, 20, palette);
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame() {
  ctx.clearRect(0, 0, W, H);
  const alive = [];
  for (const p of parts) {
    p.age++;
    p.vy += 0.34;
    p.vx *= 0.985;
    p.vy *= 0.99;
    p.wob += p.wobV;
    p.x += p.vx + Math.sin(p.wob) * 1.2;
    p.y += p.vy;
    p.rot += p.vr;
    if (p.y > H + 40 || p.age > p.life) continue;
    alive.push(p);
    const fade = p.age > p.life - 40 ? (p.life - p.age) / 40 : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    // Flutter: a paper piece seen edge-on gets thin.
    const squash = 0.35 + Math.abs(Math.cos(p.wob * 0.7)) * 0.65;
    if (p.shape === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.w * 0.32;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.w * 0.55, p.w * 0.55 * squash, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.shape === 'streamer') {
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w * 1.6, -p.h * 0.25 * squash, p.w * 3.2, p.h * 0.5 * squash + 1);
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, (-p.h / 2) * squash, p.w, p.h * squash + 0.5);
    }
    ctx.restore();
  }
  parts = alive;
  if (parts.length) {
    raf = requestAnimationFrame(frame);
  } else {
    raf = null;
    ctx.clearRect(0, 0, W, H);
  }
}

export function stop(canvas) {
  cancelAnimationFrame(raf);
  raf = null;
  parts = [];
  const c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
}
