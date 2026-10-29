// Jeremy's marks, alive: the MADRiD TV cyclone (vortex) and scratchy marks, and Marlin's Memories.
// Built the way the Brain's graph moves: no keyframes. Every quantity (a charge, a heat, a piece's
// place) is a damped spring that cools toward rest on a 33 ms tick, with drift at rest.
// Nothing is redrawn: the energy lives on Jeremy's traced strokes, exactly where he drew them.
//   cyclone   his lines are static strands: TV snow inside every stroke, an electric glow, crackles
//             that light up stretches of his own lines, arcs that jump only between them; his
//             lettering and asterisks are a pulsing orange plasma
//   scratchy  his letters and asterisk are the plasma; the picture tears, rolls and switches off
//   marlin    his drawing in Marlin's colours; and a dense colour ASCII render of the same motion
//
//   mountMark(host, {mark: "vortex" | "scratchy" | "marlin", src, state}) -> controller
//   mountAscii(host, {mark: "marlin", src, cols, state, text}) -> controller (text: a <pre>, no colour)
//   controller.play("in" | "idle" | "loading" | "out") -> Promise (in/out resolve when done)
//   controller.step(n) (with manual: true), controller.dispose()
// Reduced motion: no movement; in/out a short fade; loading a slow pulse.

const FRAME = 33;                                    // ms, as the Brain's sim
const SVG = "http://www.w3.org/2000/svg";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const cache = new Map();
function load(mark, src) {
  const url = new URL(`${mark}.mark.json`, src || import.meta.url).href;
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); }));
  return cache.get(url);
}
function random(seed) {                              // mulberry32: the same motion every time for a seed
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/* ---- springs ----------------------------------------------------------------------------------- */
const KEYS = ["x", "y", "r", "s", "o"];
function piece(px, py) {
  const p = {px, py, wait: 0, k: 0.08, c: 0.22, free: {}};
  for (const key of KEYS) { p[key] = key === "s" || key === "o" ? 1 : 0; p["v" + key] = 0; p["t" + key] = p[key]; }
  return p;
}
function rest(p) { p.tx = 0; p.ty = 0; p.tr = 0; p.ts = 1; p.to = 1; }
function set(p, values) { for (const key in values) { p[key] = values[key]; p["v" + key] = 0; } }
function stepPiece(p) {
  if (p.wait > 0) { p.wait -= 1; return; }
  for (const key of KEYS) {
    if (p.free[key]) { p[key] += p["v" + key]; continue; }
    p["v" + key] += (p["t" + key] - p[key]) * p.k - p["v" + key] * p.c;
    p[key] += p["v" + key];
  }
}
const settled = p => p.wait <= 0 && KEYS.every(k => p.free[k] || (Math.abs(p["t" + k] - p[k]) < (k === "r" ? 0.05 : k === "x" || k === "y" ? 0.3 : 0.004) && Math.abs(p["v" + k]) < 0.05));
const transform = p => `translate(${p.px + p.x} ${p.py + p.y}) rotate(${p.r}) scale(${Math.max(p.s, 0.0001)}) translate(${-p.px} ${-p.py})`;

/* ---- behaviours -------------------------------------------------------------------------------- */
// The cyclone: three charges, as springs on .o: the strands' energy, the plasma's heat, the sweep.
function cyclone(data) {
  const [cx, cy] = data.center;
  const energy = piece(cx, cy), heat = piece(cx, cy), sweep = piece(cx, cy);
  const pieces = [energy, heat, sweep];
  return {pieces, energy, heat, sweep, whole: piece(cx, cy), enter(state) {
    for (const p of pieces) { p.free = {}; p.k = 0.08; p.c = 0.22; rest(p); p.wait = 0; }
    energy.to = 0.8; sweep.o = 1; sweep.vo = 0;
    if (state === "in") {
      // The charge runs round his swirl and lights each line as it reaches it; then the name ignites.
      set(energy, {o: 0.2}); energy.to = 1; set(heat, {o: 0}); heat.wait = 26; heat.k = 0.09; heat.c = 0.1;
      set(sweep, {o: 0}); sweep.free = {o: true}; sweep.vo = 1 / 34;
    } else if (state === "loading") {
      energy.to = 1; sweep.free = {o: true}; sweep.vo = 1 / 40;   // the charge goes round and round
    } else if (state === "out") {
      energy.vo = 0.32; energy.to = 0; energy.k = 0.05; energy.c = 0.16;   // a discharge, then dark
      heat.to = 0; heat.wait = 16; heat.k = 0.05; heat.c = 0.2;
    }
  }, tick(t, state) {
    if (state === "in" && sweep.o >= 1) { sweep.free = {}; sweep.o = 1; sweep.vo = 0; energy.to = 0.8; }
  }};
}

function scratchy(data, rnd) {
  const BANDS = 18, [top, bottom] = data.band, h = (bottom - top) / BANDS, [vx, , vw] = data.viewBox;
  const pieces = [];
  for (let i = 0; i < BANDS; i += 1) pieces.push(piece(vx + vw / 2, top + h * (i + 0.5)));
  const star = piece(data.asteriskCenter[0], data.asteriskCenter[1]); pieces.push(star);
  const heat = piece(0, 0); pieces.push(heat);
  const bands = pieces.slice(0, BANDS), whole = piece(data.asteriskCenter[0], data.asteriskCenter[1]);
  let blipAt = 150, tickAt = 0;
  return {pieces, whole, bands, star, heat, enter(state) {
    for (const p of pieces) { p.free = {}; p.k = 0.12; p.c = 0.26; rest(p); p.wait = 0; }
    whole.free = {}; whole.k = 0.1; whole.c = 0.3; rest(whole); whole.sy = 1;
    if (state === "in") {
      // The picture tears sideways and catches hold, band by band; the asterisk lands last, white-hot.
      bands.forEach((p, i) => { set(p, {x: (i % 2 ? 1 : -1) * vw * (0.12 + rnd() * 0.32), o: 0.2}); p.wait = Math.floor(rnd() * 6); });
      set(star, {s: 0, r: -160, o: 0}); star.wait = 16; star.k = 0.1; star.c = 0.18;
      set(heat, {o: 1.8}); heat.k = 0.04; heat.c = 0.14;
    } else if (state === "idle") { blipAt = 90 + Math.floor(rnd() * 120); }
    else if (state === "out") {
      bands.forEach((p, i) => { p.tx = (i % 2 ? 1 : -1) * vw * (0.05 + rnd() * 0.12); p.k = 0.2; });
      whole.collapse = 0; whole.free = {s: true, o: true}; whole.vs = 0; whole.vo = 0;
    }
  }, tick(t, state) {
    if (state === "idle" && t >= blipAt) {           // now and then the signal slips, and catches again
      const at = Math.floor(rnd() * (BANDS - 3)), n = 2 + Math.floor(rnd() * 3), kick = (rnd() < 0.5 ? -1 : 1) * vw * (0.006 + rnd() * 0.01);
      for (let i = at; i < at + n; i += 1) bands[i].vx += kick;
      heat.vo += 0.08;
      blipAt = t + 150 + Math.floor(rnd() * 120);
    }
    if (state === "loading") {                       // the picture rolls; the asterisk ticks round like a hand
      bands.forEach((p, i) => { p.tx = Math.sin(Math.PI * 2 * (t / 36 - i / BANDS)) * vw * 0.012; });
      if (t >= tickAt) { star.tr += 30; tickAt = t + 5; }
    }
    if (state === "out") {
      whole.collapse += 1;
      const c = whole.collapse;
      whole.sy = c < 8 ? 1 : Math.max(0.015, 1 - (c - 8) / 6);
      whole.s = c < 14 ? 1 : Math.max(0, 1 - (c - 14) / 6);
      if (c > 14) { star.to = 0; star.k = 0.05; }
      if (c > 22) whole.o = 0;
    }
  }};
}

function marlin(data, rnd) {
  const [hx, hy] = data.hatTip;
  const pieces = data.pieces.map((d, i) => i === 0 ? piece(hx, hy) : piece(d.cx, d.cy));
  const head = pieces[0], memories = pieces.slice(1), info = data.pieces.slice(1);
  const phase = pieces.map(() => rnd() * Math.PI * 2);
  const fx = data.pieces[0].cx, fy = data.pieces[0].cy;
  return {pieces, whole: piece(hx, hy), enter(state) {
    for (const p of pieces) { p.free = {}; p.k = 0.08; p.c = 0.2; rest(p); p.wait = 0; }
    if (state === "in") {
      // He drops in on his string and bounces; then the memories burst out of the hat's tip.
      set(head, {y: -620, r: 7}); head.k = 0.07; head.c = 0.11;
      memories.forEach((p, i) => {
        const d = Math.hypot(info[i].cx - hx, info[i].cy - hy);
        set(p, {x: hx - info[i].cx, y: hy - info[i].cy, s: 0.1, o: 0}); p.wait = 18 + Math.floor(d / 40); p.k = 0.1; p.c = 0.17;
      });
    } else if (state === "out") {
      // The memories go back in at the tip, the far ones last; then the string lifts him away.
      memories.forEach((p, i) => {
        const d = Math.hypot(info[i].cx - hx, info[i].cy - hy);
        p.tx = hx - info[i].cx; p.ty = hy - info[i].cy; p.ts = 0.1; p.to = 0; p.wait = Math.floor((600 - Math.min(d, 600)) / 60); p.k = 0.1;
      });
      head.ty = -760; head.to = 0; head.wait = 10; head.k = 0.07; head.c = 0.14;
    }
  }, tick(t, state) {
    if (state === "idle" || state === "loading") head.tr = Math.sin(t * 0.02 + phase[0]) * 1.6;
    if (state === "idle") memories.forEach((p, i) => {
      p.tx = Math.sin(t * 0.02 + phase[i + 1]) * 6; p.ty = Math.cos(t * 0.017 + phase[i + 1]) * 6; p.tr = Math.sin(t * 0.013 + phase[i + 1]) * 4;
    });
    if (state === "loading") memories.forEach((p, i) => {
      const ox = info[i].cx - fx, oy = info[i].cy - fy, d = Math.hypot(ox, oy), a = t * 0.9 * (220 / Math.max(d, 120)) * Math.PI / 180;
      p.tx = ox * Math.cos(a) - oy * Math.sin(a) - ox; p.ty = ox * Math.sin(a) + oy * Math.cos(a) - oy;
    });
  }};
}
const MARKS = {vortex: cyclone, scratchy, marlin};

/* ---- the clock -------------------------------------------------------------------------------- */
function driver(data, options, draw) {
  const rnd = random(options.seed || 7);
  const behaviour = (options.behaviour || MARKS[data.mark])(data, rnd);
  const all = [...behaviour.pieces, behaviour.whole];
  let state = "idle", t = 0, timer = null, done = null, fade = 1;
  const quiet = options.reduced ?? reduced();
  function tick() {
    t += 1;
    if (!quiet) { behaviour.tick(t, state); for (const p of all) stepPiece(p); }
    else fade = clamp(fade + (state === "out" ? -0.12 : state === "loading" ? 0 : 0.12));
    draw(behaviour, quiet && state === "loading" ? 0.55 + 0.45 * Math.cos(t * 0.08) : fade, state, quiet ? 0 : t, rnd);
    if (done && (quiet ? (state === "out" ? fade <= 0 : fade >= 1) : all.every(settled) && (state !== "out" || t > 26))) {
      const finish = done; done = null;
      if (state === "in") { state = "idle"; behaviour.enter("idle"); }
      finish();
    }
  }
  const controller = {
    play(next) {
      state = next; t = 0;
      if (quiet) fade = next === "in" ? 0 : next === "out" ? 1 : fade; else behaviour.enter(next);
      if (next === "in" || next === "out") return new Promise(resolve => { done = resolve; });
      return Promise.resolve();
    },
    step(n = 1) { for (let i = 0; i < n; i += 1) tick(); },
    get state() { return state; },
    dispose() { clearInterval(timer); timer = null; }
  };
  if (!options.manual) timer = setInterval(tick, FRAME);
  controller.play(options.state || "in");
  draw(behaviour, fade, state, 0, rnd);
  return controller;
}

/* ---- canvas helpers ---------------------------------------------------------------------------- */
const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
function tinted(mask, colour) {
  const c = canvasOf(mask.width, mask.height), g = c.getContext("2d");
  g.drawImage(mask, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = colour; g.fillRect(0, 0, c.width, c.height);
  return c;
}
function glow(mask, colour, blur) {                  // only the glow: the shape drawn off-canvas, its shadow brought back
  const c = canvasOf(mask.width, mask.height), g = c.getContext("2d"), tint = tinted(mask, colour);
  g.shadowColor = colour; g.shadowBlur = blur; g.shadowOffsetX = c.width; g.drawImage(tint, -c.width, 0);
  g.shadowBlur = blur * 2.4; g.globalAlpha = 0.6; g.drawImage(tint, -c.width, 0);
  return c;
}
// The orange is a gas-plasma panel's: square cells of one neon orange at a few fixed brightness
// steps, never white, never scan lines (MADRiD: "fix the orange plasma representation"). What moves
// is which step each cell is at: a flowing noise, warped by itself and folded into thin ridges, so
// brighter threads run through his letters.
const PANEL = [255, 92, 18], PANEL_HOT = [255, 176, 96];            // the same orange as madrid-text.js
const PANEL_STEPS = [0, 0.4, 0.62, 0.82, 1];
const PERM = (() => { const r = random(1234), a = [...Array(256).keys()]; for (let i = 255; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } const p = new Uint8Array(512); for (let i = 0; i < 512; i += 1) p[i] = a[i & 255]; return p; })();
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), X = xi & 255, Y = yi & 255;
  const a = PERM[PERM[X] + Y], b = PERM[PERM[X + 1] + Y], c = PERM[PERM[X] + Y + 1], d = PERM[PERM[X + 1] + Y + 1];
  return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) / 255;
}
function fbm(x, y) { let s = 0, amp = 0.5, f = 1; for (let o = 0; o < 4; o += 1) { s += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; } return s / 0.9375; }
function filament(u, v, t) {                          // 0..1: how near a bright thread this point is
  const qx = fbm(u + t * 0.013, v - t * 0.011), qy = fbm(u - 5.2 + t * 0.009, v + 1.3 - t * 0.007);
  const n = fbm(u + 2.6 * qx + t * 0.021, v + 2.6 * qy - t * 0.017);
  return (1 - Math.abs(2 * n - 1)) ** 6;
}

/* ---- the cyclone and scratchy, on a canvas -------------------------------------------------------- */
function energyCanvas(host, data, options) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%";
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", options.label || "MADRiD TV");
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const [vx, vy, vw, vh] = data.viewBox;
  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0, L = null;
  const toCanvas = (x, y) => [x * scale + ox, y * scale + oy];
  function build() {
    dpr = Math.min(options.dpr || 1.5, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const cap = Math.sqrt(2.2e6 / Math.max(1, (rect.width || 320) * (rect.height || 320) * dpr * dpr));   // every frame composites whole layers: keep a big TV affordable
    if (cap < 1) dpr *= cap;
    W = Math.max(8, Math.round((rect.width || 320) * dpr)); H = Math.max(8, Math.round((rect.height || 320) * dpr));
    canvas.width = W; canvas.height = H;
    scale = Math.min(W / vw, H / vh) * 0.9; ox = (W - vw * scale) / 2 - vx * scale; oy = (H - vh * scale) / 2 - vy * scale;
    const layer = () => canvasOf(W, H);
    const paint = (c, d, mode = "source-over") => { const g = c.getContext("2d"); g.setTransform(scale, 0, 0, scale, ox, oy); g.globalCompositeOperation = mode; g.fillStyle = "#fff"; g.fill(new Path2D(d), "evenodd"); g.setTransform(1, 0, 0, 1, 0, 0); return c; };
    const boxes = (c, mode) => { const g = c.getContext("2d"); g.setTransform(scale, 0, 0, scale, ox, oy); g.globalCompositeOperation = mode; g.beginPath(); for (const poly of data.text) { poly.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); } g.fillStyle = "#fff"; g.fill(); g.setTransform(1, 0, 0, 1, 0, 0); return c; };
    L = {a: layer(), b: layer(), c: layer(), noise: canvasOf(Math.ceil(W / 2), Math.ceil(H / 2))};
    if (data.mark === "vortex") {
      L.strands = boxes(paint(layer(), data.ink), "destination-out");         // his lines: everything but the lettering
      L.text = boxes(paint(layer(), data.ink), "destination-in");             // his lettering and its asterisks
      L.strandsTint = tinted(L.strands, "#bfe3ff");
      L.strandsGlow = glow(L.strands, "#3f9dff", 9 * dpr);
      const px = L.strands.getContext("2d").getImageData(0, 0, W, H).data, step = Math.max(2, Math.round(3 * dpr));
      L.points = [];
      for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (px[(y * W + x) * 4 + 3] > 140) L.points.push([x, y]);
      const xs = data.text.flat().map(q => q[0]), ys = data.text.flat().map(q => q[1]);
      const [tx0, ty0] = toCanvas(Math.min(...xs), Math.min(...ys)), [tx1, ty1] = toCanvas(Math.max(...xs), Math.max(...ys));
      L.textBox = [tx0, ty0, tx1 - tx0, ty1 - ty0];
      [L.cx, L.cy] = toCanvas(data.center[0], data.center[1]);
      L.strandAlpha = new Uint8Array(W * H); for (let i = 0; i < W * H; i += 1) L.strandAlpha[i] = px[i * 4 + 3];
      const tp = L.text.getContext("2d").getImageData(0, 0, W, H).data;
      L.textPoints = [];
      for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (tp[(y * W + x) * 4 + 3] > 140) L.textPoints.push([x, y]);
      L.arcs = []; L.sparks = []; L.trail = layer();
      L.current = [];                                  // charge running along his lines
      L.eye = 150 * scale;
    } else {
      L.text = paint(layer(), data.letters);
      L.star = paint(layer(), data.asterisk);
      L.textBox = [0, 0, W, H];
      [L.sx, L.sy] = toCanvas(data.asteriskCenter[0], data.asteriskCenter[1]);
    }
    // the panel: about 110 cells across his lettering, each cell a whole number of pixels
    const tw = data.mark === "vortex" ? L.textBox[2] : W * 0.8;
    L.cell = Math.max(1, Math.round(tw / 110)); L.gw = Math.ceil(W / L.cell); L.gh = Math.ceil(H / L.cell);
    L.grid = canvasOf(L.gw, L.gh); L.gridImg = L.grid.getContext("2d").createImageData(L.gw, L.gh); L.lv = new Float32Array(L.gw * L.gh);
    L.cover = mask => {                               // the cells his strokes cover, and how much
      const d = mask.getContext("2d").getImageData(0, 0, W, H).data, sum = new Float32Array(L.gw * L.gh), out = [];
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) sum[Math.floor(y / L.cell) * L.gw + Math.floor(x / L.cell)] += d[(y * W + x) * 4 + 3];
      const full = 255 * L.cell * L.cell;
      for (let i = 0; i < sum.length; i += 1) if (sum[i] / full > 0.2) out.push(i, sum[i] / full);
      return out;
    };
    L.textCells = L.cover(L.text);
    if (L.star) L.starCells = L.cover(L.star);
    L.textGlow = glow(L.text, "#ff4f00", 14 * dpr);
    L.frames = [];                                   // TV snow, a few frames at half resolution
    const nw = L.noise.width, nh = L.noise.height, ng = L.noise.getContext("2d");
    for (let f = 0; f < 6; f += 1) {
      const img = ng.createImageData(nw, nh), d = img.data, r = random(91 + f);
      for (let i = 0; i < d.length; i += 4) { const v = Math.pow(r(), 1.6) * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      L.frames.push(img);
    }
  }
  function clear(c) { const g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.shadowBlur = 0; g.clearRect(0, 0, c.width, c.height); return g; }
  // Light cells on the panel at the step the flowing field gives them. heat steps every cell down
  // together, the way a panel dims; extra is a list of [cell, step] the caller lights on top.
  function panel(cells, heat, pulse, t, into, {seed = 0, hot = true, extra = null} = {}) {
    const lv = L.lv; lv.fill(0);
    const h = clamp(heat, 0, 1.2), u0 = seed * 7.1, k = 3.4 / 110;
    for (let j = 0; j < cells.length; j += 2) {
      const i = cells[j], cov = cells[j + 1], gx = i % L.gw, gy = (i - gx) / L.gw;
      const f = filament(gx * k + u0, gy * k * 1.6, t) * (0.8 + 0.4 * pulse);
      let step = f > 0.6 ? 5 : f > 0.3 ? 4 : f > 0.1 ? 3 : 2.6;     // 5 = the hot, lighter orange
      if (cov < 0.5) step = Math.min(step, 2);                         // a cell his line only grazes
      lv[i] = Math.max(lv[i], step * h);
    }
    if (extra) for (let j = 0; j < extra.length; j += 2) lv[extra[j]] = Math.max(lv[extra[j]], extra[j + 1] * Math.min(1, h + 0.3));
    const d = L.gridImg.data;
    for (let i = 0; i < lv.length; i += 1) {
      const step = Math.round(lv[i]), o = i * 4;
      if (step < 1) { d[o + 3] = 0; continue; }
      const c = step >= 5 && hot ? PANEL_HOT : PANEL, m = step >= 5 ? 1 : PANEL_STEPS[step];
      d[o] = c[0] * m; d[o + 1] = c[1] * m; d[o + 2] = c[2] * m; d[o + 3] = 255;
    }
    L.grid.getContext("2d").putImageData(L.gridImg, 0, 0);
    // the panel's own soft bloom round lit cells, then the cells, square and whole
    into.save(); into.imageSmoothingEnabled = false;
    into.shadowColor = "rgba(255,64,0,0.42)"; into.shadowBlur = 10 * dpr; into.drawImage(L.grid, 0, 0, L.gw * L.cell, L.gh * L.cell);
    into.shadowColor = "rgba(255,92,18,0.8)"; into.shadowBlur = 2 * dpr; into.drawImage(L.grid, 0, 0, L.gw * L.cell, L.gh * L.cell);
    into.restore();
  }
  function drawCyclone(b, fade, state, t, rnd) {
    const E = Math.max(0, b.energy.o), heat = Math.max(0, b.heat.o), S = b.sweep.o;
    const g = clear(canvas);
    // 0. the eye: a slow breathing glow at the swirl's centre, under everything
    const breath = 0.5 + 0.5 * Math.sin(t * 0.045);
    const eye = g.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.eye * (1.15 + 0.12 * breath));
    eye.addColorStop(0, `rgba(120,150,255,${(0.1 + 0.1 * breath) * clamp(E + heat * 0.5)})`); eye.addColorStop(0.55, `rgba(255,90,20,${0.05 * clamp(heat)})`); eye.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = fade * clamp(b.whole.o); g.fillStyle = eye; g.fillRect(0, 0, W, H);
    // 1. his lines: a dim body (so they always read), snow inside them, the glow, crackles
    const s = clear(L.a);
    s.globalAlpha = 0.22 + 0.1 * clamp(E); s.drawImage(L.strandsTint, 0, 0);
    L.noise.getContext("2d").putImageData(L.frames[(t + Math.floor(rnd() * 6)) % L.frames.length], 0, 0);
    const n = clear(L.c);
    n.imageSmoothingEnabled = false; n.drawImage(L.noise, 0, 0, W, H);
    n.globalCompositeOperation = "destination-in"; n.drawImage(L.strands, 0, 0);
    n.globalCompositeOperation = "source-atop"; n.fillStyle = "rgba(110,185,255,0.42)"; n.fillRect(0, 0, W, H);
    s.globalCompositeOperation = "lighter"; s.globalAlpha = clamp(E * 0.75); s.drawImage(L.c, 0, 0);
    s.globalAlpha = clamp(E * (0.45 + 0.35 * rnd())); s.drawImage(L.strandsGlow, 0, 0);
    // crackles: stretches of his lines flare white
    const k = Math.round(E * (state === "loading" ? 9 : 4) * (0.5 + rnd()));
    const sp = clear(L.b);
    for (let i = 0; i < k && L.points.length; i += 1) {
      const [x, y] = L.points[Math.floor(rnd() * L.points.length)], r = (10 + rnd() * 30) * dpr;
      const grad = sp.createRadialGradient(x, y, 0, x, y, r); grad.addColorStop(0, "rgba(240,250,255,1)"); grad.addColorStop(0.4, "rgba(150,210,255,0.7)"); grad.addColorStop(1, "rgba(60,150,255,0)");
      sp.fillStyle = grad; sp.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    sp.globalCompositeOperation = "destination-in"; sp.drawImage(L.strands, 0, 0);
    s.globalAlpha = clamp(E); s.drawImage(L.b, 0, 0);
    // the current: points of charge riding along his strokes round the eye, turning inward, with trails;
    // a point that leaves his line is born again on it, so the current only ever draws his lines
    const want = Math.round((state === "loading" ? 340 : 220) * clamp(E));
    while (L.current.length < want && L.points.length) { const [x, y] = L.points[Math.floor(rnd() * L.points.length)]; L.current.push({x, y, px: x, py: y, v: (1.6 + rnd() * 2.4) * dpr, life: 30 + rnd() * 70}); }
    if (L.current.length > want) L.current.length = want;
    const tr = L.trail.getContext("2d");               // the trails fade, so the current reads as light running round
    tr.globalCompositeOperation = "destination-out"; tr.globalAlpha = state === "loading" ? 0.14 : 0.2; tr.fillRect(0, 0, W, H);
    tr.globalCompositeOperation = "lighter"; tr.lineCap = "round";
    for (const q of L.current) {
      const dx = q.x - L.cx, dy = q.y - L.cy, r = Math.max(1, Math.hypot(dx, dy)), speed = q.v * (state === "loading" ? 1.8 : 1);
      q.px = q.x; q.py = q.y; q.x += (-dy / r) * speed - (dx / r) * speed * 0.12; q.y += (dx / r) * speed - (dy / r) * speed * 0.12; q.life -= 1;
      const ix = Math.round(q.x), iy = Math.round(q.y);
      if (q.life <= 0 || ix < 0 || iy < 0 || ix >= W || iy >= H || L.strandAlpha[iy * W + ix] < 100) {
        const [x, y] = L.points[Math.floor(rnd() * L.points.length)]; Object.assign(q, {x, y, px: x, py: y, life: 30 + rnd() * 70}); continue;
      }
      tr.globalAlpha = 0.6 + 0.4 * rnd(); tr.strokeStyle = "rgba(235,246,255,1)"; tr.lineWidth = 1.5 * dpr;
      tr.beginPath(); tr.moveTo(q.px, q.py); tr.lineTo(q.x, q.y); tr.stroke();
    }
    const cur = clear(L.b); cur.drawImage(L.trail, 0, 0); cur.globalCompositeOperation = "destination-in"; cur.drawImage(L.strands, 0, 0);
    s.globalCompositeOperation = "lighter"; s.globalAlpha = clamp(E); s.shadowColor = "#7cc4ff"; s.shadowBlur = 6 * dpr; s.drawImage(L.b, 0, 0); s.shadowBlur = 0;
    // the charge's sweep: in reveals his lines in the swirl's turning; loading sends a bright wave round
    const conic = typeof s.createConicGradient === "function";
    if (conic && (state === "in" && S < 0.985 || state === "loading")) {
      const turn = state === "loading" ? (S % 1) : S, start = -Math.PI / 2;
      if (state === "in") {
        const m = s.createConicGradient(start, L.cx, L.cy);
        m.addColorStop(0, "rgba(0,0,0,1)"); m.addColorStop(Math.max(0.0001, turn - 0.06), "rgba(0,0,0,1)"); m.addColorStop(Math.max(0.0002, turn), "rgba(0,0,0,1)"); m.addColorStop(Math.min(0.9999, turn + 0.0001), "rgba(0,0,0,0)"); m.addColorStop(1, "rgba(0,0,0,0)");
        s.globalCompositeOperation = "destination-in"; s.globalAlpha = 1; s.fillStyle = m; s.fillRect(0, 0, W, H);
      }
      const wave = clear(L.b), m2 = wave.createConicGradient(start, L.cx, L.cy), at = turn, wd = 0.14;
      m2.addColorStop(0, "rgba(255,255,255,0)"); m2.addColorStop(clamp(at - wd, 0.0001, 0.9997), "rgba(255,255,255,0)"); m2.addColorStop(clamp(at, 0.0002, 0.9998), "rgba(255,255,255,1)"); m2.addColorStop(clamp(at + 0.01, 0.0003, 0.9999), "rgba(255,255,255,0)"); m2.addColorStop(1, "rgba(255,255,255,0)");
      wave.drawImage(L.c, 0, 0); wave.drawImage(L.strandsGlow, 0, 0); wave.drawImage(L.strandsTint, 0, 0);
      wave.globalCompositeOperation = "destination-in"; wave.fillStyle = m2; wave.fillRect(0, 0, W, H);
      s.globalCompositeOperation = "lighter"; s.globalAlpha = 1; s.drawImage(L.b, 0, 0);
    }
    g.globalAlpha = fade * clamp(b.whole.o); g.drawImage(L.a, 0, 0);
    // arcs: now and then a spark jumps from one of his lines to another nearby
    const chance = state === "out" ? 0.7 * clamp(E) : state === "loading" ? 0.22 : state === "in" ? 0.3 : 0.07;
    if (rnd() < chance && L.points.length) {
      const a = L.points[Math.floor(rnd() * L.points.length)];
      let best = null;
      for (let i = 0; i < 16; i += 1) { const c = L.points[Math.floor(rnd() * L.points.length)], d = Math.hypot(c[0] - a[0], c[1] - a[1]); if (d > 18 * dpr && d < 70 * dpr && (!best || Math.abs(d - 40 * dpr) < Math.abs(best.d - 40 * dpr))) best = {c, d}; }
      if (best) {
        g.globalCompositeOperation = "lighter"; g.globalAlpha = fade; g.strokeStyle = "rgba(225,242,255,0.95)"; g.lineWidth = 1.3 * dpr; g.shadowColor = "#5ab0ff"; g.shadowBlur = 10 * dpr;
        g.beginPath(); g.moveTo(a[0], a[1]);
        const [bx, by] = best.c, segs = 7, nx = -(by - a[1]) / best.d, ny = (bx - a[0]) / best.d;
        for (let i = 1; i < segs; i += 1) { const f = i / segs, j = (rnd() - 0.5) * best.d * 0.35; g.lineTo(a[0] + (bx - a[0]) * f + nx * j, a[1] + (by - a[1]) * f + ny * j); }
        g.lineTo(bx, by); g.stroke(); g.shadowBlur = 0;
      }
    }
    // 2. arcs: the lettering's charge jumps to the nearest of his lines, a jagged run of panel cells
    const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / (state === "loading" ? 22 : 48));
    const reach = (state === "loading" ? 0.22 : state === "out" ? 0.06 : 0.1) * clamp(heat);
    if (rnd() < reach && L.textPoints.length && L.points.length) {
      const a = L.textPoints[Math.floor(rnd() * L.textPoints.length)];
      let best = null;
      for (let i = 0; i < 40; i += 1) { const c = L.points[Math.floor(rnd() * L.points.length)], d = Math.hypot(c[0] - a[0], c[1] - a[1]); if (d > 14 * dpr && (!best || d < best.d)) best = {c, d}; }
      if (best && best.d < 120 * dpr) L.arcs.push({a, b: best.c, d: best.d, life: 6});
    }
    const extra = [];
    const light = (x, y, step) => { const gx = Math.floor(x / L.cell), gy = Math.floor(y / L.cell); if (gx >= 0 && gy >= 0 && gx < L.gw && gy < L.gh) extra.push(gy * L.gw + gx, step); };
    L.arcs = L.arcs.filter(arc => {
      const [ax, ay] = arc.a, [bx, by] = arc.b, nx = -(by - ay) / arc.d, ny = (bx - ax) / arc.d, segs = 8, step = arc.life > 4 ? 5 : arc.life > 2 ? 4 : 2;
      let px = ax, py = ay;
      for (let i = 1; i <= segs; i += 1) {                // re-jagged every frame: it crackles
        const f = i / segs, j = i === segs ? 0 : Math.sin(f * Math.PI) * (rnd() - 0.5) * arc.d * 0.5;
        const qx = ax + (bx - ax) * f + nx * j, qy = ay + (by - ay) * f + ny * j, n = Math.ceil(Math.hypot(qx - px, qy - py) / (L.cell * 0.5));
        for (let m = 0; m <= n; m += 1) light(px + (qx - px) * m / n, py + (qy - py) * m / n, step);
        px = qx; py = qy;
      }
      return (arc.life -= 1) > 0;
    });
    // sparks: single cells shed by the lettering, pulled round the eye by the cyclone, cooling as they go
    const shed = (state === "loading" ? 1.2 : state === "out" ? 2.5 : 0.4) * clamp(heat);
    for (let i = 0; i < Math.floor(shed + rnd()); i += 1) if (L.textPoints.length) { const [x, y] = L.textPoints[Math.floor(rnd() * L.textPoints.length)]; L.sparks.push({x, y, life: 40 + rnd() * 50, v: (1.2 + rnd() * 1.6) * dpr}); }
    L.sparks = L.sparks.filter(q => {
      const dx = q.x - L.cx, dy = q.y - L.cy, r = Math.max(1, Math.hypot(dx, dy));
      q.x += (-dy / r) * q.v + (dx / r) * q.v * 0.18; q.y += (dx / r) * q.v + (dy / r) * q.v * 0.18;
      light(q.x, q.y, q.life > 60 ? 4 : q.life > 25 ? 3 : 1);
      return (q.life -= 1) > 0;
    });
    // 3. his lettering and asterisks: the panel, threads of brighter orange flowing through them
    g.globalCompositeOperation = "source-over"; g.globalAlpha = fade * clamp(b.whole.o);
    panel(L.textCells, heat, pulse, t, g, {extra});
  }
  function drawScratchy(b, fade, state, t, rnd) {
    const heat = Math.max(0, b.heat.o), pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / (state === "loading" ? 22 : 48)), w = b.whole;
    // the letters as plasma, into a layer the bands are cut from
    const m = clear(L.a);
    panel(L.textCells, heat, pulse, t, m);
    const g = clear(canvas), sy = w.sy ?? 1, [sx0, sy0] = [L.sx, L.sy];
    g.translate(sx0, sy0); g.scale(Math.max(w.s, 0.0001), Math.max(w.s, 0.0001) * sy); g.translate(-sx0, -sy0);
    const [, top] = toCanvas(0, data.band[0]), [, bottom] = toCanvas(0, data.band[1]), h = (bottom - top) / b.bands.length;
    b.bands.forEach((p, i) => {
      const y0 = i === 0 ? 0 : Math.floor(top + h * i), y1 = i === b.bands.length - 1 ? H : Math.ceil(top + h * (i + 1));
      g.globalAlpha = fade * clamp(w.o) * clamp(p.o); g.drawImage(L.a, 0, y0, W, y1 - y0, p.x * scale, y0, W, y1 - y0);
    });
    // the asterisk: hotter plasma, its own glow, turned and scaled about its middle
    const st = b.star, a = clear(L.c);
    panel(L.starCells, heat + 0.4, 1 - pulse, t + 40, a, {seed: 1.7});
    g.save(); g.translate(sx0 + st.x * scale, sy0 + st.y * scale); g.rotate(st.r * Math.PI / 180); g.scale(Math.max(st.s, 0.0001), Math.max(st.s, 0.0001)); g.translate(-sx0, -sy0);
    g.globalAlpha = fade * clamp(w.o) * clamp(st.o); g.drawImage(L.c, 0, 0); g.restore();
  }
  build();
  let resized = false;
  const watch = typeof ResizeObserver === "function" ? new ResizeObserver(() => { resized = true; }) : null;
  if (watch) watch.observe(canvas);
  const c = driver(data, options, (b, fade, state, t, rnd) => {
    if (resized) { resized = false; build(); }
    (data.mark === "vortex" ? drawCyclone : drawScratchy)(b, fade, state, t, rnd);
  });
  const dispose = c.dispose;
  c.dispose = () => { dispose(); if (watch) watch.disconnect(); canvas.remove(); };
  c.canvas = canvas;
  return c;
}

/* ---- Marlin in SVG (his drawing in Marlin's colours, moving) ----------------------------------- */
const el = (name, attrs = {}, parent) => { const e = document.createElementNS(SVG, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
function marlinSvg(host, data, options) {
  const [vx, vy, vw, vh] = data.viewBox;
  const svg = el("svg", {viewBox: `${vx} ${vy} ${vw} ${vh}`, role: "img", "aria-label": options.label || "Marlin's Memories"});
  svg.style.cssText = "overflow:visible;width:100%;height:100%;display:block";
  const root = el("g", {}, svg), nodes = [];
  for (const p of data.pieces) {
    const g = el("g", {}, root);
    for (const f of p.fills) el("path", {d: f.d, fill: f.colour, "fill-rule": "evenodd"}, g);
    el("path", {d: p.ink, fill: options.ink || "#F0EDE8", "fill-rule": "evenodd"}, g);
    nodes.push(g);
  }
  host.appendChild(svg);
  const c = driver(data, options, (b, fade) => {
    b.pieces.forEach((p, i) => { nodes[i].setAttribute("transform", transform(p)); nodes[i].setAttribute("opacity", clamp(p.o).toFixed(3)); });
    root.setAttribute("opacity", (clamp(b.whole.o) * fade).toFixed(3));
  });
  const dispose = c.dispose;
  c.dispose = () => { dispose(); svg.remove(); };
  return c;
}

export async function mountMark(host, options = {}) {
  const data = await load(options.mark || "vortex", options.src);
  return data.mark === "marlin" ? marlinSvg(host, data, options) : energyCanvas(host, data, options);
}

/* ---- Marlin in ASCII ----------------------------------------------------------------------------- */
// His coloured drawing, moving, rendered every frame into a grid of characters: his lines by their
// direction (| / - \), the fills by a 70-step density ramp in their own colour; each character
// scrambles through the ramp before it lands, so he decodes into place. Use sparingly.
const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
export async function mountAscii(host, options = {}) {
  const data = await load(options.mark || "marlin", options.src);
  if (data.mark !== "marlin") throw new Error("ASCII is drawn for marlin");
  const [vx, vy, vw, vh] = data.viewBox;
  const cols = options.cols || 104, rows = Math.round(cols * (vh / vw) * 0.5), SX = 3, SY = 6;
  const SW = cols * SX, SH = rows * SY, scale = SW / vw;
  const colour = canvasOf(SW, SH), cg = colour.getContext("2d", {willReadFrequently: true});
  const ink = canvasOf(SW, SH), ig = ink.getContext("2d", {willReadFrequently: true});
  const paths = data.pieces.map(p => ({ink: new Path2D(p.ink), fills: p.fills.map(f => ({colour: f.colour, path: new Path2D(f.d)}))}));
  let out, og = null, cw = 0, chh = 0;
  if (options.text) { out = host; } else {
    out = document.createElement("canvas"); out.style.cssText = "display:block;width:100%;height:100%"; out.setAttribute("role", "img"); out.setAttribute("aria-label", options.label || "Marlin's Memories");
    host.appendChild(out); og = out.getContext("2d");
  }
  function sizeOut() {
    if (!og) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), r = out.getBoundingClientRect();
    out.width = Math.max(8, Math.round((r.width || 400) * dpr)); out.height = Math.max(8, Math.round((r.height || 400) * dpr));
    cw = Math.min(out.width / cols, out.height / rows / 2); chh = cw * 2;
  }
  sizeOut();
  const shown = new Array(cols * rows).fill(" "), hue = new Array(cols * rows).fill("#000"), scramble = new Int8Array(cols * rows);
  const draw = (b, fade, state, t, rnd) => {
    for (const g of [cg, ig]) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.clearRect(0, 0, SW, SH); }
    b.pieces.forEach((p, i) => {
      const o = clamp(p.o) * clamp(b.whole.o) * fade; if (o <= 0.02) return;
      for (const g of [cg, ig]) {
        g.setTransform(1, 0, 0, 1, 0, 0); g.scale(scale, scale); g.translate(-vx, -vy);
        g.translate(p.px + p.x, p.py + p.y); g.rotate(p.r * Math.PI / 180); g.scale(Math.max(p.s, 0.0001), Math.max(p.s, 0.0001)); g.translate(-p.px, -p.py);
        g.globalAlpha = o;
      }
      for (const f of paths[i].fills) { cg.fillStyle = f.colour; cg.fill(f.path, "evenodd"); }
      cg.fillStyle = options.ink || "#F0EDE8"; cg.fill(paths[i].ink, "evenodd");
      ig.fillStyle = "#fff"; ig.fill(paths[i].ink, "evenodd");
    });
    const C = cg.getImageData(0, 0, SW, SH).data, I = ig.getImageData(0, 0, SW, SH).data;
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
      let A = 0, R = 0, G = 0, B = 0, m0 = 0, mx = 0, my = 0, mxx = 0, myy = 0, mxy = 0;
      for (let y = 0; y < SY; y += 1) for (let x = 0; x < SX; x += 1) {
        const o = ((row * SY + y) * SW + col * SX + x) * 4, a = C[o + 3] / 255, w = I[o + 3] / 255;
        A += a; R += C[o] * a; G += C[o + 1] * a; B += C[o + 2] * a;
        if (w > 0) { const px = x * 2, py = y; m0 += w; mx += w * px; my += w * py; mxx += w * px * px; myy += w * py * py; mxy += w * px * py; }
      }
      const n = SX * SY, cov = A / n, inkCov = m0 / n, i = row * cols + col;
      let glyph = " ", rgb = "#000";
      if (cov > 0.1) {
        // lifted for a dark ground: the same hue, brighter (Marlin's hat red is too deep to read as text)
        const lift = v => Math.round(Math.min(255, (v / A) * 1.45 + 34));
        rgb = `rgb(${lift(R)},${lift(G)},${lift(B)})`;
        if (inkCov > 0.3) {
          const ex = mx / m0, ey = my / m0, cxx = mxx / m0 - ex * ex, cyy = myy / m0 - ey * ey, cxy = mxy / m0 - ex * ey;
          const aniso = Math.sqrt((cxx - cyy) ** 2 + 4 * cxy * cxy) / Math.max(1e-6, cxx + cyy);
          if (inkCov > 0.82) glyph = "#";
          else if (aniso > 0.35) { const deg = (Math.atan2(2 * cxy, cxx - cyy) / 2) * 180 / Math.PI; glyph = Math.abs(deg) < 22.5 ? "-" : Math.abs(deg) > 67.5 ? "|" : deg > 0 ? "\\" : "/"; }
          else glyph = inkCov > 0.55 ? "@" : "o";
        } else {
          const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / A / 255;
          glyph = RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(clamp(cov * (0.45 + 0.75 * lum)) * (RAMP.length - 1))))];
        }
      }
      if (glyph !== shown[i] && scramble[i] <= 0 && glyph !== " ") scramble[i] = state === "in" || shown[i] === " " ? 2 + Math.floor(rnd() * 5) : (rnd() < 0.35 ? 1 : 0);
      if (scramble[i] > 0) { scramble[i] -= 1; shown[i] = scramble[i] > 0 ? RAMP[10 + Math.floor(rnd() * (RAMP.length - 10))] : glyph; }
      else shown[i] = glyph;
      hue[i] = rgb;
    }
    if (options.text) {
      let s = ""; for (let row = 0; row < rows; row += 1) s += shown.slice(row * cols, row * cols + cols).join("").replace(/\s+$/, "") + "\n";
      out.textContent = s; return;
    }
    og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, out.width, out.height);
    const x0 = (out.width - cw * cols) / 2, y0 = (out.height - chh * rows) / 2;
    og.font = `${Math.round(chh * 0.92)}px Menlo, ui-monospace, monospace`; og.textBaseline = "top";
    for (let i = 0; i < shown.length; i += 1) {
      if (shown[i] === " ") continue;
      og.fillStyle = scramble[i] > 0 ? "#F0EDE8" : hue[i];
      og.fillText(shown[i], x0 + (i % cols) * cw, y0 + Math.floor(i / cols) * chh);
    }
  };
  const c = driver(data, options, draw);
  if (og && typeof ResizeObserver === "function") { const w = new ResizeObserver(sizeOut); w.observe(out); const d = c.dispose; c.dispose = () => { d(); w.disconnect(); out.remove(); }; }
  return c;
}

// For madrid-text.js (the DOS text-mode renderer): the same clock and springs.
export {driver, piece, rest, set, random, load, clamp, MARKS};
