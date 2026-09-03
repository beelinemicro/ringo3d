// The RINGO 3D cube — a holographic 5x5x5 of tinted glass cells with enamel
// rings inside, rendered with three.js. Owns the camera, orbit gestures,
// tap-to-place picking, the slice-twist animation, the exploded and
// layer-focus views, and the glowing win lines. main.js drives it through
// the small API returned by createCube(); game state stays in game.js.

import * as THREE from './vendor/three.module.js';
import { SIZE, N_CELLS, idx, xyz, LAYERS, COLORS, COL_LABELS, twistMap, sliceCells } from './game.js';

const S = 1.0; // cell pitch
const HALF = (SIZE - 1) / 2;
const BOX = 0.84;
const EXPLODE_GAP = 1.05; // extra spacing between layers when exploded
const AXIS_VEC = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

const VIEWS = {
  iso: { yaw: -0.62, pitch: 0.40 },
  floors: { yaw: -0.45, pitch: 1.15 }, // exploded: the layers stack like floors of a base
  front: { yaw: 0, pitch: 0.10 },
  side: { yaw: -1.25, pitch: 0.18 },
  top: { yaw: -0.5, pitch: 1.15 },
};

const ease = {
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2, // overshoot
};

// Cell (x, y, z) → world. y flips (rows count downwards), z flips (front
// layer nearest the camera at +z).
function cellPos(x, y, z, explode = 0) {
  return new THREE.Vector3((x - HALF) * S, (HALF - y) * S, (HALF - z) * (S + explode * EXPLODE_GAP));
}

function textTexture(text, { font = "700 84px 'Lilita One', 'Fredoka', sans-serif", color = '#ffffff', shadow = 'rgba(0,0,0,0.6)' } = {}) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = shadow;
  g.shadowBlur = 10;
  g.fillStyle = color;
  g.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function backgroundTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 96, 10, 128, 128, 190);
  grad.addColorStop(0, '#182a4a');
  grad.addColorStop(0.55, '#0c1630');
  grad.addColorStop(1, '#05080f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCube(canvas, { onTap = () => {}, onInteract = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = backgroundTexture();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 16);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2a44, 1.6));
  const key = new THREE.DirectionalLight(0xfff4e0, 2.6);
  key.position.set(5, 9, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88b8ff, 1.2);
  rim.position.set(-7, -4, -6);
  scene.add(rim);

  // The projector table the hologram floats over.
  const grid = new THREE.GridHelper(16, 16, 0x2a4a7a, 0x1a2f52);
  grid.position.y = -3.9;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);
  const discTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(90,160,255,0.55)');
    grad.addColorStop(0.5, 'rgba(60,120,220,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -3.85;
  scene.add(disc);

  // Everything that orbits.
  const root = new THREE.Group();
  root.rotation.order = 'XYZ';
  scene.add(root);

  // ---- cells ----
  const boxGeo = new THREE.BoxGeometry(BOX, BOX, BOX);
  const edgeGeo = new THREE.EdgesGeometry(boxGeo);
  const ringGeo = new THREE.TorusGeometry(0.27, 0.105, 18, 40);
  const layerColor = LAYERS.map((l) => new THREE.Color(l.hex));
  const playerColor = COLORS.map((c) => new THREE.Color(c.hex));
  const ringMat = COLORS.map((c, i) => new THREE.MeshStandardMaterial({
    color: i === 4 ? 0x3c3c40 : c.hex,
    emissive: i === 4 ? 0x0a0a0c : c.hex,
    emissiveIntensity: i === 4 ? 0.6 : 0.22,
    metalness: i === 4 ? 0.55 : 0.25,
    roughness: 0.32,
  }));
  const ringMatDim = ringMat.map((m) => { const d = m.clone(); d.transparent = true; d.opacity = 0.22; d.depthWrite = false; return d; });

  const cells = []; // { group, box, edges, ring, x, y, z }
  for (let i = 0; i < N_CELLS; i++) {
    const [x, y, z] = xyz(i);
    const group = new THREE.Group();
    group.position.copy(cellPos(x, y, z));
    const box = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({
      color: layerColor[z], transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide,
    }));
    box.renderOrder = 1;
    box.userData.cell = i;
    const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: layerColor[z], transparent: true, opacity: 0.5 }));
    edges.renderOrder = 2;
    group.add(box, edges);
    root.add(group);
    cells.push({ group, box, edges, ring: null, x, y, z, i });
  }

  // ---- labels ----
  const labels = { col: [], row: [], layer: [] };
  function makeLabels() {
    for (const k of Object.keys(labels)) { labels[k].forEach((s) => { root.remove(s); s.material.map.dispose(); s.material.dispose(); }); labels[k] = []; }
    const mk = (text, pos, color, scale = 0.62) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text, { color }), transparent: true, depthWrite: false }));
      sp.position.copy(pos);
      sp.scale.setScalar(scale);
      sp.userData.base = scale;
      root.add(sp);
      return sp;
    };
    COL_LABELS.forEach((l, x) => labels.col.push(mk(l, new THREE.Vector3((x - HALF) * S, HALF + 0.9, HALF + 0.62), '#ffe9a8', 0.56)));
    for (let y = 0; y < SIZE; y++) labels.row.push(mk(String(y + 1), new THREE.Vector3(-HALF - 0.9, (HALF - y) * S, HALF + 0.62), '#ffe9a8', 0.56));
    LAYERS.forEach((l, z) => labels.layer.push(mk('●', new THREE.Vector3(-HALF - 0.66, -HALF - 0.66, (HALF - z) * S), l.hex, 0.34)));
  }
  makeLabels();
  if (document.fonts?.ready) document.fonts.ready.then(() => { makeLabels(); applyLabelHot(); });

  // ---- crosshair through a single target cell ----
  const hairMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  const hairGeo = new THREE.BoxGeometry(SIZE * S + 1.2, 0.035, 0.035);
  const hairs = [0, 1, 2].map((a) => {
    const m = new THREE.Mesh(hairGeo, hairMat);
    if (a === 1) m.rotation.z = Math.PI / 2;
    if (a === 2) m.rotation.y = Math.PI / 2;
    m.visible = false;
    m.renderOrder = 3;
    root.add(m);
    return m;
  });

  // ---- the scanner: a faint plane sweeping through the cube ----
  const scan = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE * S + 0.4, SIZE * S + 0.4),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  scan.renderOrder = 3;
  root.add(scan);
  const scanEdge = new THREE.LineSegments(new THREE.EdgesGeometry(scan.geometry), new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35 }));
  scan.add(scanEdge);

  // ---- win lines ----
  const winGroup = new THREE.Group();
  root.add(winGroup);

  // ---- state ----
  const view = { yaw: VIEWS.iso.yaw, pitch: VIEWS.iso.pitch, explode: 0, focus: null, zoom: 1 };
  const hl = { legal: new Set(), steal: new Set(), current: null, winCells: new Set(), last: null, dice: null };
  let board = Array(N_CELLS).fill(null);
  let idle = true;
  let lastInteract = performance.now();
  let twisting = false;
  const tweens = [];

  function tween(dur, onUpdate, { easing = ease.out, onDone } = {}) {
    const t = { start: performance.now(), dur, onUpdate, easing, onDone };
    tweens.push(t);
    return t;
  }

  function layout() {
    for (const c of cells) {
      if (c.group.parent !== root) continue;
      c.group.position.copy(cellPos(c.x, c.y, c.z, view.explode));
    }
    labels.layer.forEach((s, z) => { s.position.z = (HALF - z) * (S + view.explode * EXPLODE_GAP); });
    const off = view.explode * EXPLODE_GAP * HALF;
    labels.col.forEach((s) => { s.position.z = HALF + 0.62 + off; });
    labels.row.forEach((s) => { s.position.z = HALF + 0.62 + off; });
    fitCamera();
  }

  function fitCamera() {
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 300;
    const aspect = w / h;
    const radius = 4.3 + view.explode * 2.4;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fov = Math.min(vfov, hfov);
    camera.position.z = (radius / Math.sin(fov / 2)) / view.zoom;
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fitCamera();
  }

  // ---- rings ----
  function addRing(c, owner, { late = false, spin = null } = {}) {
    const ring = new THREE.Mesh(ringGeo, ringMat[owner]);
    ring.userData.owner = owner;
    ring.renderOrder = 4;
    c.group.add(ring);
    c.ring = ring;
    if (spin) {
      ring.quaternion.copy(spin);
      tween(380, (t) => { ring.quaternion.slerpQuaternions(spin, new THREE.Quaternion(), t); }, { easing: ease.inOut });
    } else {
      ring.scale.setScalar(0.001);
      const delay = late ? 220 : 0;
      setTimeout(() => tween(420, (t) => { ring.scale.setScalar(Math.max(0.001, ease.back(t))); }, { easing: (t) => t }), delay);
    }
  }

  function removeRing(c, { yoink = false } = {}) {
    const ring = c.ring;
    if (!ring) return;
    c.ring = null;
    if (!yoink) { c.group.remove(ring); return; }
    // The stolen ring is flung out of the cube.
    tween(480, (t) => {
      ring.scale.setScalar(1 + t * 0.6);
      ring.position.y = t * 1.6;
      ring.rotation.z = t * 2.4;
      ring.material = ringMatDim[ring.userData.owner];
    }, { easing: ease.out, onDone: () => c.group.remove(ring) });
  }

  // Re-create rings only where the owner changed, so nothing re-drops.
  function syncRings(next, { instant = false } = {}) {
    for (const c of cells) {
      const owner = next[c.i];
      const prev = c.ring ? c.ring.userData.owner : null;
      if (owner === prev) continue;
      if (c.ring) removeRing(c, { yoink: !instant && owner !== null });
      if (owner !== null) {
        if (instant) { addRing(c, owner); c.ring.scale.setScalar(1); }
        else addRing(c, owner, { late: prev !== null });
      }
    }
    board = next.slice();
  }

  // ---- looks ----
  function applyLabelHot() {
    const d = hl.dice;
    const set = (arr, hot) => arr.forEach((s, i) => {
      const on = !!d && (hot === 'W' || hot === i);
      s.scale.setScalar(s.userData.base * (on ? 1.45 : 1));
      s.material.opacity = on ? 1 : 0.85;
    });
    set(labels.col, d?.col);
    set(labels.row, d?.row);
    set(labels.layer, d?.layer);
  }

  function applyLooks() {
    const focus = view.focus;
    const cur = hl.current !== null ? playerColor[hl.current] : null;
    for (const c of cells) {
      const inFocus = focus === null || c.z === focus;
      const legal = hl.legal.has(c.i);
      const steal = hl.steal.has(c.i);
      const win = hl.winCells.has(c.i);
      const bm = c.box.material;
      const em = c.edges.material;
      if (legal && cur) {
        bm.color.copy(steal ? new THREE.Color(0xff5a5a) : cur);
        em.color.set(0xffffff);
        em.opacity = 1;
      } else if (win) {
        bm.color.set(0xffd34d);
        bm.opacity = 0.35;
        em.color.set(0xffe9a8);
        em.opacity = 1;
      } else {
        bm.color.copy(layerColor[c.z]);
        em.color.copy(layerColor[c.z]);
        bm.opacity = inFocus ? (focus === null ? 0.09 : 0.16) : 0.02;
        em.opacity = inFocus ? (focus === null ? 0.5 : 0.85) : 0.07;
      }
      if (c.ring) c.ring.material = inFocus || legal ? ringMat[c.ring.userData.owner] : ringMatDim[c.ring.userData.owner];
      if (c.i === hl.last && !legal && !win) { em.color.set(0xffffff); em.opacity = Math.max(em.opacity, inFocus ? 0.9 : 0.2); }
    }
    // A single target gets the crosshair; a wild spread just glows.
    const single = hl.legal.size === 1 ? [...hl.legal][0] : null;
    hairs.forEach((m) => { m.visible = single !== null; });
    if (single !== null) {
      const c = cells[single];
      const p = cellPos(c.x, c.y, c.z, view.explode);
      hairs[0].position.set(0, p.y, p.z);
      hairs[1].position.set(p.x, 0, p.z);
      hairs[2].position.set(p.x, p.y, 0);
      hairs[0].scale.x = hairs[1].scale.x = 1;
      hairs[2].scale.x = 1 + view.explode * EXPLODE_GAP * 0.8;
      hairMat.color.copy(hl.steal.has(single) ? new THREE.Color(0xff8080) : (cur || new THREE.Color(0xffffff)));
    }
    applyLabelHot();
  }

  function sync({ board: next, legal = [], steal = [], current = null, winLines = [], lastPlaced = null, dice = null, instant = false }) {
    hl.legal = new Set(legal);
    hl.steal = new Set(steal);
    hl.current = current;
    hl.last = lastPlaced;
    hl.dice = dice;
    hl.winCells = new Set(winLines.flat());
    syncRings(next, { instant });
    applyLooks();
    drawWinLines(winLines);
  }

  // ---- win lines: glowing rods through the winning rings ----
  function drawWinLines(lines) {
    while (winGroup.children.length) {
      const m = winGroup.children.pop();
      m.geometry.dispose();
    }
    if (!lines.length) return;
    const glow = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const halo = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const pos = (i) => { const [x, y, z] = xyz(i); return cellPos(x, y, z, view.explode); };
    let delay = 150;
    const rod = (a, b, when) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      for (const [mat, r] of [[glow, 0.085], [halo, 0.2]]) {
        const geo = new THREE.CylinderGeometry(r, r, len, 12, 1, true);
        geo.translate(0, len / 2, 0);
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(a);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        m.scale.y = 0.001;
        m.renderOrder = 5;
        winGroup.add(m);
        setTimeout(() => tween(650, (t) => { m.scale.y = Math.max(0.001, t); }), when);
      }
    };
    lines.forEach((line) => {
      if (line.length === 4) {
        // Four corners: trace the square around the face.
        const [a, b, c, d] = line.map(pos);
        const order = [a, b, d, c, a];
        for (let k = 0; k < 4; k++) rod(order[k], order[k + 1], delay + k * 180);
        delay += 800;
      } else {
        rod(pos(line[0]), pos(line[4]), delay);
        delay += 400;
      }
    });
  }

  // ---- twist animation ----
  // Which way to spin on screen is derived from the game's own twist map, so
  // the picture always lands exactly where the rules say the rings went.
  function twist(t, done) {
    if (twisting) { done?.(); return; }
    twisting = true;
    const go = () => {
      const map = twistMap(t.axis, t.k, t.dir);
      const axis = AXIS_VEC[t.axis];
      const probe = sliceCells(t.axis, t.k).find((i) => { const [x, y, z] = xyz(i); return !(x === 2 && y === 2) && !(x === 2 && z === 2) && !(y === 2 && z === 2); });
      const from = cellPos(...xyz(probe));
      const to = cellPos(...xyz(map.get(probe)));
      let angle = Math.PI / 2;
      if (from.clone().applyAxisAngle(axis, angle).distanceTo(to) > 0.01) angle = -Math.PI / 2;
      const pivot = new THREE.Group();
      root.add(pivot);
      const moving = sliceCells(t.axis, t.k).map((i) => cells[i]);
      moving.forEach((c) => pivot.attach(c.group));
      const spin = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      tween(720, (k) => { pivot.quaternion.slerpQuaternions(new THREE.Quaternion(), spin, k); }, {
        easing: ease.inOut,
        onDone: () => {
          moving.forEach((c) => { root.attach(c.group); c.group.position.copy(cellPos(c.x, c.y, c.z, 0)); c.group.quaternion.identity(); });
          root.remove(pivot);
          // Rings now sit in their new cells; their glass tint resets to the
          // layer they landed in. Rings that tumbled settle back upright.
          const next = board.slice();
          for (const [f, to2] of map) next[to2] = board[f];
          for (const c of cells) { if (c.ring) { c.group.remove(c.ring); c.ring = null; } }
          board = Array(N_CELLS).fill(null);
          for (const c of cells) {
            if (next[c.i] === null) continue;
            addRing(c, next[c.i], { spin: map.has(c.i) && t.axis !== 'z' ? spin : null });
            if (!map.has(c.i) || t.axis === 'z') c.ring.scale.setScalar(1);
          }
          board = next;
          twisting = false;
          applyLooks();
          done?.();
        },
      });
    };
    if (view.explode > 0.01 && t.axis !== 'z') {
      const from = view.explode;
      tween(260, (k) => { view.explode = from * (1 - k); layout(); }, { onDone: go });
    } else go();
  }

  // A little nudge in the chosen direction, to preview a twist.
  function previewTwist(t) {
    if (twisting) return;
    const axis = AXIS_VEC[t.axis];
    const map = twistMap(t.axis, t.k, t.dir);
    const probe = sliceCells(t.axis, t.k).find((i) => { const [x, y, z] = xyz(i); return !(x === 2 && y === 2) && !(x === 2 && z === 2) && !(y === 2 && z === 2); });
    const from = cellPos(...xyz(probe));
    const to = cellPos(...xyz(map.get(probe)));
    let sign = 1;
    if (from.clone().applyAxisAngle(axis, Math.PI / 2).distanceTo(to) > 0.01) sign = -1;
    const moving = sliceCells(t.axis, t.k).map((i) => cells[i]);
    const centre = new THREE.Vector3();
    const q = new THREE.Quaternion();
    tween(520, (k) => {
      const a = Math.sin(k * Math.PI) * 0.22 * sign;
      q.setFromAxisAngle(axis, a);
      moving.forEach((c) => {
        const p = cellPos(c.x, c.y, c.z, view.explode).sub(centre).applyQuaternion(q);
        c.group.position.copy(p);
        c.group.quaternion.copy(q);
      });
    }, { easing: (x) => x, onDone: () => moving.forEach((c) => { c.group.position.copy(cellPos(c.x, c.y, c.z, view.explode)); c.group.quaternion.identity(); }) });
  }

  // Dim everything except one slice while the player is choosing a twist.
  let sliceHint = null;
  function highlightSlice(t) {
    sliceHint = t ? new Set(sliceCells(t.axis, t.k)) : null;
    applyLooks();
    if (!sliceHint) return;
    for (const c of cells) {
      const on = sliceHint.has(c.i);
      c.box.material.opacity = on ? 0.22 : 0.02;
      c.edges.material.opacity = on ? 1 : 0.06;
      if (on) c.edges.material.color.set(0xffffff);
      if (c.ring) c.ring.material = on ? ringMat[c.ring.userData.owner] : ringMatDim[c.ring.userData.owner];
    }
  }

  // ---- views ----
  function setView(name) {
    const v = VIEWS[name] || VIEWS.iso;
    const y0 = view.yaw;
    const p0 = view.pitch;
    // Take the short way round.
    let dy = v.yaw - y0;
    dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    tween(600, (k) => { view.yaw = y0 + dy * k; view.pitch = p0 + (v.pitch - p0) * k; }, { easing: ease.inOut });
    lastInteract = performance.now();
  }

  function setExplode(on) {
    const from = view.explode;
    const to = on ? 1 : 0;
    tween(560, (k) => { view.explode = from + (to - from) * k; layout(); applyLooks(); }, { easing: ease.inOut });
    setView(on ? 'floors' : 'iso');
  }

  function setFocus(z) {
    view.focus = z;
    applyLooks();
  }

  // ---- gestures: drag to orbit, tap to pick, wheel to zoom ----
  let pointer = null;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const targets = [...hl.legal].map((i) => cells[i].box);
    const hit = ray.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.cell : null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, vx: 0, vy: 0, t: performance.now() };
    canvas.setPointerCapture?.(e.pointerId);
    lastInteract = performance.now();
    onInteract();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    if (!pointer.moved && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 7) pointer.moved = true;
    if (pointer.moved) {
      view.yaw += dx * 0.0085;
      view.pitch = THREE.MathUtils.clamp(view.pitch + dy * 0.0085, -1.35, 1.35);
      pointer.vx = dx;
      pointer.vy = dy;
    }
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    lastInteract = performance.now();
  });
  const up = (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = pointer;
    pointer = null;
    if (!p.moved) {
      const cell = pick(e.clientX, e.clientY);
      if (cell !== null) onTap(cell);
    } else {
      // Inertia.
      let vx = p.vx * 0.0085;
      let vy = p.vy * 0.0085;
      tween(600, (k) => {
        const damp = (1 - k) ** 2;
        view.yaw += vx * damp * 0.5;
        view.pitch = THREE.MathUtils.clamp(view.pitch + vy * damp * 0.5, -1.35, 1.35);
      }, { easing: (x) => x });
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoom = THREE.MathUtils.clamp(view.zoom * (e.deltaY < 0 ? 1.08 : 0.93), 0.7, 2.2);
    fitCamera();
  }, { passive: false });

  // ---- frame loop ----
  let running = true;
  let lastT = performance.now();
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const t = tweens[i];
      const k = Math.min(1, (now - t.start) / t.dur);
      t.onUpdate(t.easing(k));
      if (k >= 1) { tweens.splice(i, 1); t.onDone?.(); }
    }
    // A slow turntable while nobody needs to aim, and the scanner sweeps.
    if (idle && !pointer && now - lastInteract > 2500) view.yaw += dt * 0.16;
    const sweep = (Math.sin(now / 1900) * 0.5 + 0.5);
    scan.position.z = (HALF + 0.2 - sweep * (SIZE * S + 0.4)) * (1 + view.explode * EXPLODE_GAP / S);
    scan.visible = view.explode < 0.05 && hl.winCells.size === 0;
    root.rotation.set(view.pitch, view.yaw, 0);
    // Pulse the targets.
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    for (const i of hl.legal) {
      const c = cells[i];
      c.box.material.opacity = 0.22 + 0.3 * pulse;
      c.group.scale.setScalar(1 + 0.05 * pulse);
    }
    hairMat.opacity = 0.3 + 0.35 * pulse;
    for (const i of hl.winCells) {
      const c = cells[i];
      if (c.ring) c.ring.scale.setScalar(1 + 0.14 * (0.5 + 0.5 * Math.sin(now / 180 + c.x + c.y + c.z)));
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  function reset() {
    for (const c of cells) { c.group.scale.setScalar(1); if (c.ring) { c.group.remove(c.ring); c.ring = null; } }
    board = Array(N_CELLS).fill(null);
    hl.legal.clear(); hl.steal.clear(); hl.winCells.clear(); hl.last = null; hl.dice = null;
    view.explode = 0; view.focus = null; view.zoom = 1;
    sliceHint = null;
    drawWinLines([]);
    layout();
    applyLooks();
    setView('iso');
  }

  resize();
  layout();
  applyLooks();

  return {
    sync, twist, previewTwist, highlightSlice, setView, setExplode, setFocus, resize, reset,
    get explode() { return view.explode > 0.5; },
    get focus() { return view.focus; },
    setIdle(v) { idle = v; },
    dispose() { running = false; renderer.dispose(); },
  };
}
