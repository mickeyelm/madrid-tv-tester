// Jeremy's marks in DOS text mode: plasma-orange characters on black, the way an orange gas-plasma
// screen showed 80x25 text. Every character is the IBM VGA 8x16 font's own bitmap (cp437.json), and
// every cell's character is the one whose bitmap best matches Jeremy's drawing in that cell (shape
// matched over 2x4 zones, including the block, shade and line characters), so the picture stays
// his. No scan lines, no CRT effects: only characters, their brightness and a soft plasma glow.
//
//   mountText(host, {mark: "vortex" | "scratchy" | "marlin", cols, state, src, seed, manual})
//   -> controller: play("in" | "idle" | "loading" | "out") -> Promise, step(n), dispose()
//
//   cyclone (vortex)  his lines are static: they flicker in brightness, now and then a cell turns to
//                     snow (shade characters), crackles flare stretches of them, arcs of line
//                     characters jump between them; his lettering burns as plasma (brightness waves)
//   scratchy          his letters are the plasma; they type in, glitch now and then, the asterisk
//                     turns while loading, and they clear away like CLS
//   marlin            his coloured drawing as shaded text: lines bright, fills as shade by colour,
//                     the motion (string, burst, sway, orbit) re-matched every frame; characters
//                     scramble before they land
import {driver, piece, rest, set, load, clamp, MARKS} from "./madrid-mark.js";

const ORANGE = [255, 92, 18];                        // the orange of a neon gas-plasma panel
const LEVELS = [0, 0.4, 0.62, 0.82, 1];              // a few steps of brightness, as those panels had

let fontLoad = null;
function loadFont(src) {
  if (!fontLoad) fontLoad = fetch(new URL("cp437.json", src || import.meta.url)).then(r => r.json()).then(f => {
    const bits = new Uint8Array(f.codes.length * 128);
    f.bitmaps.forEach((b64, g) => { const raw = atob(b64); for (let y = 0; y < 16; y += 1) { const byte = raw.charCodeAt(y); for (let x = 0; x < 8; x += 1) bits[g * 128 + y * 8 + x] = (byte >> (7 - x)) & 1; } });
    const table = b64 => { const raw = atob(b64), out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i); return out; };
    return {bits, lut: table(f.lut), lutBlock: table(f.lutBlock), codes: f.codes, of: c => f.codes.indexOf(c)};
  });
  return fontLoad;
}
const canvasOf = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// scratchy as a fuse: one spring-free front that burns through his scribble, and the asterisk
function scratchyText(data) {
  const fuse = piece(0, 0), star = piece(data.asteriskCenter[0], data.asteriskCenter[1]);
  const pieces = [fuse, star];
  let tickAt = 0;
  return {pieces, fuse, star, whole: piece(0, 0), enter(state) {
    for (const p of pieces) { p.free = {}; p.k = 0.08; p.c = 0.22; rest(p); p.wait = 0; }
    if (state === "in") {                            // the fuse runs through his strokes; the asterisk goes off at the end
      set(fuse, {o: 0}); fuse.free = {o: true}; fuse.vo = 1 / 42;
      set(star, {s: 0, o: 0}); star.wait = 44; star.k = 0.16; star.c = 0.14;
    } else if (state === "out") {                    // and burns them away to ash
      set(fuse, {o: 0}); fuse.free = {o: true}; fuse.vo = 1 / 34;
      star.to = 0; star.ts = 0; star.wait = 36; star.k = 0.12;
    }
  }, tick(t, state) {
    const end = state === "out" ? 1.6 : 1;           // out: the last ash has to fall as well
    if ((state === "in" || state === "out") && fuse.o >= end) { fuse.free = {}; fuse.o = end; fuse.vo = 0; fuse.to = end; }
    if (state === "loading" && t >= tickAt) { star.tr += 30; tickAt = t + 5; }       // the asterisk turns like a hand
  }};
}

export async function mountText(host, options = {}) {
  const [data, F] = await Promise.all([load(options.mark || "vortex", options.src), loadFont(options.src)]);
  const mark = data.mark, [vx, vy, vw, vh] = data.viewBox;
  const cols = options.cols || (mark === "marlin" ? 104 : mark === "scratchy" ? 128 : 96), rows = Math.max(4, Math.round(cols * 8 * (vh / vw) / 16));
  const RW = cols * 8, RH = rows * 16, N = cols * rows;
  const scale = Math.min(RW / vw, RH / vh) * (options.fit || 0.94), ox = (RW - vw * scale) / 2 - vx * scale, oy = (RH - vh * scale) / 2 - vy * scale;
  const canvas = canvasOf(RW, RH);
  canvas.style.cssText = "display:block;margin:auto;image-rendering:pixelated;" +
    "filter:drop-shadow(0 0 1.5px rgba(255,92,18,.75)) drop-shadow(0 0 6px rgba(255,64,0,.32))";
  // Whole pixels where it fits (every character crisp, as on the panel); scaled down only where it must.
  // Measured in screen pixels; a scaled parent (the TV's overlay) is divided back out.
  const fitCanvas = () => {
    const r = host.getBoundingClientRect(), local = host.clientWidth || r.width, zoom = local && r.width ? r.width / local : 1;
    let k = Math.min((r.width || RW) / RW, (r.height || RH) / RH);
    if (k >= 1) k = Math.floor(k);
    canvas.style.width = `${RW * k / zoom}px`; canvas.style.height = `${RH * k / zoom}px`;
  };
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", options.label || (mark === "marlin" ? "Marlin's Memories" : "MADRiD TV"));
  host.appendChild(canvas); fitCanvas();
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(fitCanvas) : null;
  if (resize) resize.observe(host);
  const ctx = canvas.getContext("2d"), img = ctx.createImageData(RW, RH), screen = new Uint32Array(img.data.buffer);
  const palette = LEVELS.map(l => (255 << 24) | (Math.round(ORANGE[2] * l) << 16) | (Math.round(ORANGE[1] * l) << 8) | Math.round(ORANGE[0] * l));
  const HOT = (255 << 24) | (96 << 16) | (176 << 8) | 255;           // what is burning right now: the panel at full, a lighter orange
  const SPACE = F.of(0x20), SCRAMBLE = (mark === "scratchy" ? [0xB0, 0xB1, 0xB2, 0xDB, 0xDC, 0xDF] : [0xB0, 0xB1, 0x2A, 0x23, 0x25, 0x40, 0x26, 0x3F, 0x2F, 0x5C, 0x7C, 0x7E, 0x3D, 0x2B, 0xF9, 0xFA]).map(F.of);
  const SNOW = [0xB0, 0xB1, 0xB2, 0xFA, 0xF9, 0x2E, 0x3A, 0x27].map(F.of);
  const LINE = {h: F.of(0xC4), v: F.of(0xB3), d: F.of(0x5C), u: F.of(0x2F)};

  // A drawing's cells: paint it into a raster of the screen's pixels, read each 8x16 cell as 2x4 zones.
  const LUT = mark === "scratchy" ? F.lutBlock : F.lut;           // scratchy is drawn as an ANSI logo: blocks and shades
  const raster = canvasOf(RW, RH), rg = raster.getContext("2d", {willReadFrequently: true});
  function paint(fn) { rg.setTransform(1, 0, 0, 1, 0, 0); rg.globalAlpha = 1; rg.globalCompositeOperation = "source-over"; rg.clearRect(0, 0, RW, RH); rg.setTransform(scale, 0, 0, scale, ox, oy); fn(rg); return rg.getImageData(0, 0, RW, RH).data; }
  function cell(d, cx, cy) {                         // -> [glyph, coverage]
    let key = 0, total = 0;
    for (let zr = 0; zr < 4; zr += 1) for (let zc = 0; zc < 2; zc += 1) {
      let s = 0; const x0 = cx * 8 + zc * 4, y0 = cy * 16 + zr * 4;
      for (let y = y0; y < y0 + 4; y += 1) { const o = (y * RW + x0) * 4 + 3; s += d[o] + d[o + 4] + d[o + 8] + d[o + 12]; }
      total += s; key = key * 4 + Math.round(s / 4080 * 3);
    }
    return [LUT[key], total / (128 * 255)];
  }
  function cells(d, glyph, cover) { for (let i = 0; i < N; i += 1) { const [g, c] = cell(d, i % cols, Math.floor(i / cols)); glyph[i] = g; cover[i] = c; } }

  const shown = new Int16Array(N).fill(SPACE), lit = new Float32Array(N), scramble = new Uint8Array(N);
  const want = new Int16Array(N), level = new Float32Array(N);
  function present(rnd, settleFrames = 4) {
    screen.fill(0);
    for (let i = 0; i < N; i += 1) {
      let g = want[i], l = level[i];
      if (g !== shown[i] && g !== SPACE && scramble[i] === 0) scramble[i] = shown[i] === SPACE ? 1 + Math.floor(rnd() * settleFrames) : 0;
      if (scramble[i] > 0) { scramble[i] -= 1; if (scramble[i] > 0) { g = SCRAMBLE[Math.floor(rnd() * SCRAMBLE.length)]; l = Math.max(l, 0.82); } }
      shown[i] = g; lit[i] = l;
      if (g === SPACE || l <= 0) continue;
      const colour = l > 1.001 ? HOT : palette[Math.min(4, Math.ceil(clamp(l) * 4))], base = g * 128, x0 = (i % cols) * 8, y0 = Math.floor(i / cols) * 16;
      for (let y = 0; y < 16; y += 1) { const row = (y0 + y) * RW + x0, b = base + y * 8; for (let x = 0; x < 8; x += 1) if (F.bits[b + x]) screen[row + x] = colour; }
    }
    ctx.putImageData(img, 0, 0);
  }
  const plasma = (u, v, t) => (Math.sin(u * 11 + t * 0.09) + Math.sin(v * 9 - t * 0.12) + Math.sin((u + v) * 8 + t * 0.07) + Math.sin(Math.hypot(u - 0.5, v - 0.5) * 22 - t * 0.21) + 4) / 8;

  let draw;
  if (mark === "vortex") {
    // His lines and his lettering never move: their characters are matched once.
    const fill = (d, mode, polys) => g => { g.fillStyle = "#fff"; g.fill(new Path2D(d), "evenodd"); g.globalCompositeOperation = mode; g.beginPath(); for (const poly of polys) { poly.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); } g.fill(); };
    const gS = new Int16Array(N), cS = new Float32Array(N), gT = new Int16Array(N), cT = new Float32Array(N);
    cells(paint(fill(data.ink, "destination-out", data.text)), gS, cS);
    cells(paint(fill(data.ink, "destination-in", data.text)), gT, cT);
    const [ccx, ccy] = [data.center[0] * scale + ox, data.center[1] * scale + oy];
    const turn = new Float32Array(N), strand = [], text = [];
    let tx0 = cols, ty0 = rows, tx1 = 0, ty1 = 0;
    for (let i = 0; i < N; i += 1) {
      const cx = i % cols, cy = Math.floor(i / cols);
      turn[i] = ((Math.atan2(cy * 16 + 8 - ccy, cx * 8 + 4 - ccx) + Math.PI / 2) / (2 * Math.PI) + 1) % 1;
      if (cT[i] > 0.03 && gT[i] !== SPACE) { text.push(i); tx0 = Math.min(tx0, cx); ty0 = Math.min(ty0, cy); tx1 = Math.max(tx1, cx); ty1 = Math.max(ty1, cy); }
      else if (cS[i] > 0.03 && gS[i] !== SPACE) strand.push(i);
    }
    let crackles = [], arcs = [];
    draw = (b, fade, state, t, rnd) => {
      const E = Math.max(0, b.energy.o), heat = Math.max(0, b.heat.o), S = b.sweep.o;
      want.fill(SPACE); level.fill(0);
      // crackles: a few cells of his lines flare, and the flare spreads to their neighbours for a moment
      const spawn = E * (state === "loading" ? 2.6 : state === "out" ? 4 : 1.1);
      for (let n = spawn; n > 0; n -= 1) if (rnd() < n && strand.length) crackles.push({at: strand[Math.floor(rnd() * strand.length)], life: 2 + Math.floor(rnd() * 4), r: 1 + Math.floor(rnd() * 3)});
      if (rnd() < (state === "out" ? 0.6 * clamp(E) : state === "loading" ? 0.2 : state === "in" ? 0.25 : 0.06) && strand.length) {
        // an arc: line characters from one of his lines to another nearby
        const a = strand[Math.floor(rnd() * strand.length)], ax = a % cols, ay = Math.floor(a / cols);
        for (let k = 0; k < 14; k += 1) {
          const c = strand[Math.floor(rnd() * strand.length)], bx = c % cols, by = Math.floor(c / cols), dist = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
          if (dist < 3 || dist > 9) continue;
          const path = [];
          let px = ax, py = ay;
          for (let s = 1; s <= dist; s += 1) {
            const nx = Math.round(ax + (bx - ax) * s / dist + (s < dist ? (rnd() - 0.5) * 1.6 : 0)), ny = Math.round(ay + (by - ay) * s / dist + (s < dist ? (rnd() - 0.5) * 1.2 : 0));
            const dx = nx - px, dy = ny - py;
            path.push([nx, ny, dy === 0 ? LINE.h : dx === 0 ? LINE.v : dx * dy > 0 ? LINE.d : LINE.u]);
            px = nx; py = ny;
          }
          arcs.push({path, life: 2}); break;
        }
      }
      const boost = new Float32Array(N);
      crackles = crackles.filter(c => { const cx = c.at % cols, cy = Math.floor(c.at / cols);
        for (let y = -c.r; y <= c.r; y += 1) for (let x = -c.r; x <= c.r; x += 1) { const X = cx + x, Y = cy + y; if (X >= 0 && X < cols && Y >= 0 && Y < rows) boost[Y * cols + X] = Math.max(boost[Y * cols + X], 1 - Math.hypot(x, y * 2) / (c.r * 2 + 1)); }
        return (c.life -= 1) > 0; });
      for (const i of strand) {
        const visible = state === "in" ? turn[i] <= S : state === "out" ? rnd() < clamp(E * 1.5) : true;
        if (!visible) continue;
        let g = gS[i], l = (0.2 + 0.2 * rnd()) * (0.6 + 0.4 * clamp(E));
        if (rnd() < 0.05 * clamp(E)) { g = SNOW[Math.floor(rnd() * SNOW.length)]; l = 0.3 + 0.6 * rnd(); }   // static
        if (state === "in" && S - turn[i] < 0.025) l = 1;                                                // the charge's front
        if (state === "loading") { const d = ((turn[i] - (S % 1)) % 1 + 1) % 1; if (d > 0.84) l = Math.max(l, 0.45 + (d - 0.84) / 0.16 * 0.55); }
        want[i] = g; level[i] = Math.max(l, boost[i] * clamp(E));
      }
      arcs = arcs.filter(a => { for (const [x, y, g] of a.path) if (x >= 0 && x < cols && y >= 0 && y < rows) { const i = y * cols + x; want[i] = g; level[i] = clamp(E) * fade; } return (a.life -= 1) > 0; });
      // his lettering: plasma, as waves of brightness through the characters, pulsing
      const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / (state === "loading" ? 22 : 48));
      for (const i of text) {
        if (heat < 0.04) continue;
        const u = (i % cols - tx0) / Math.max(1, tx1 - tx0), v = (Math.floor(i / cols) - ty0) / Math.max(1, ty1 - ty0);
        want[i] = gT[i]; level[i] = clamp((0.58 + 0.42 * (plasma(u, v, t) * 0.6 + pulse * 0.4)) * clamp(heat * 1.25));
      }
      if (fade < 1) for (let i = 0; i < N; i += 1) level[i] *= fade;
      present(rnd);
    };
  } else if (mark === "scratchy") {
    // His tag as an ANSI logo, lit from the top left: the side of a stroke facing the light at full,
    // the far side in dark shade, a shade shadow cast down and right. The fuse follows his scribble
    // cell to touching cell from the first mark of his M, so it runs the way his pen did.
    const gT = new Int16Array(N), cT = new Float32Array(N);
    cells(paint(g => { g.fillStyle = "#fff"; g.fill(new Path2D(data.letters), "evenodd"); }), gT, cT);
    const isLetter = new Uint8Array(N), letters = [];
    for (let i = 0; i < N; i += 1) if (cT[i] > 0.03 && gT[i] !== SPACE) { isLetter[i] = 1; letters.push(i); }
    const dist = new Float32Array(N).fill(-1);
    const start = letters.reduce((a, i) => (i % cols) + Math.floor(i / cols) * 0.5 < (a % cols) + Math.floor(a / cols) * 0.5 ? i : a, letters[0]);
    let queue = [start]; dist[start] = 0;
    while (queue.length) {
      const next = [];
      for (const i of queue) { const x = i % cols, y = Math.floor(i / cols);
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) { const X = x + dx, Y = y + dy, j = Y * cols + X;
          if ((dx || dy) && X >= 0 && X < cols && Y >= 0 && Y < rows && isLetter[j] && dist[j] < 0) { dist[j] = dist[i] + (dx && dy ? 1.41 : 1); next.push(j); } } }
      queue = next;
    }
    let far = 0; for (const i of letters) far = Math.max(far, dist[i]);
    for (const i of letters) if (dist[i] < 0) dist[i] = (i % cols) / cols * far;      // a stray bit: by its place, left to right
    const dn = new Float32Array(N); for (const i of letters) dn[i] = dist[i] / Math.max(1, far);
    // the light: which way each cell of a stroke faces, from the slope of his coverage, smoothed
    const at = (x, y) => x < 0 || y < 0 || x >= cols || y >= rows ? 0 : cT[y * cols + x];
    const sm = (x, y) => { let v = 0; for (let j = -1; j <= 1; j += 1) for (let k = -1; k <= 1; k += 1) v += at(x + k, y + j); return v / 9; };
    const DARK = F.of(0xB2), FULL = F.of(0xDB), SHADE = F.of(0xB0);
    const baseG = new Int16Array(N), baseL = new Float32Array(N), shadowOf = new Int32Array(N).fill(-1), shadows = [];
    for (const i of letters) {
      const x = i % cols, y = Math.floor(i / cols);
      const gx = (sm(x + 1, y) - sm(x - 1, y)) / 16, gy = (sm(x, y + 1) - sm(x, y - 1)) / 32, n = Math.hypot(gx, gy);
      const face = n < 1e-4 ? 0 : (gx + gy) / (n * Math.SQRT2);          // > 0: the stroke's edge here faces up and left
      baseG[i] = cT[i] > 0.9 && face < -0.35 ? DARK : gT[i];
      baseL[i] = clamp(0.82 + 0.18 * clamp(face * 2) - 0.2 * clamp(-face * 1.5), 0.62, 1);
      const j = i + cols + 1;                                              // the shadow: one down, one right
      if (x + 1 < cols && y + 1 < rows && !isLetter[j] && shadowOf[j] < 0) { shadowOf[j] = i; shadows.push(j); }
    }
    let lx0 = Infinity, lx1 = -Infinity;                                   // the glint runs along the light's diagonal
    const diag = new Float32Array(N);
    for (const i of letters) { diag[i] = (i % cols) * 8 + Math.floor(i / cols) * 16; lx0 = Math.min(lx0, diag[i]); lx1 = Math.max(lx1, diag[i]); }
    for (const i of letters) diag[i] = (diag[i] - lx0) / Math.max(1, lx1 - lx0);
    const bottoms = letters.filter(i => i + cols < N && !isLetter[i + cols] && cT[i] > 0.5 && Math.floor(i / cols) > rows * 0.35);
    const star = new Path2D(data.asterisk), [scx, scy] = data.asteriskCenter;
    const scol = (scx * scale + ox) / 8, srow = (scy * scale + oy) / 16;
    const SPARK = [0x2A, 0x2B, 0x27, 0x60, 0x2E, 0xF9, 0xFA, 0x2C].map(F.of), ASH = [0x2E, 0xF9, 0xFA, 0x2C, 0x27].map(F.of);
    const MID = F.of(0xB1), LOW = F.of(0xB0), DOT = F.of(0xF9), DROP = F.of(0xFE), RUN = F.of(0xB3), RING = [F.of(0x2A), F.of(0xF9), F.of(0xFA)];
    let sparks = [], drips = [], lit0 = new Float32Array(N).fill(-1), surge = 0, glintAt = 0, flash = 0, ring = -1, burst = false, lastState = "";
    const spark = (x, y, vx, vy, life, ash = false) => sparks.push({x, y, vx, vy, life, max: life, ash});
    draw = (b, fade, state, t, rnd) => {
      if (state !== lastState) { lit0.fill(-1); burst = false; lastState = state; drips = []; glintAt = t + 45; surge = t + 220 + Math.floor(rnd() * 120); }
      want.fill(SPACE); level.fill(0);
      if (flash > 0) flash -= 1;                                           // counted in frames: the clock restarts with each state
      if (ring >= 0) ring += 1;
      const st = b.star, front = b.fuse.o, glint = state === "idle" && t >= glintAt ? (t - glintAt) / 34 * 1.3 - 0.15 : -9;
      if (glint > 1.2) glintAt = t + 110 + Math.floor(rnd() * 80);
      const show = (i, age) => {                                           // a letter cell; age: ticks since the fuse lit it
        want[i] = baseG[i]; level[i] = baseL[i];
        if (age < 1) { want[i] = FULL; level[i] = 1.2; }                   // the pen's hot nib
        else if (age < 4) level[i] = 1.2;
        else if (age < 18) level[i] = Math.max(baseL[i], 1 - (age - 4) / 14 * (1 - baseL[i]));
      };
      for (const i of letters) {
        const x = i % cols, y = Math.floor(i / cols);
        if (state === "in") {
          if (dn[i] > front) continue;
          if (lit0[i] < 0) { lit0[i] = t; if (rnd() < 0.2) spark(x, y, (rnd() - 0.3) * 1.1, -0.5 - rnd() * 0.9, 10 + rnd() * 16); }
          show(i, t - lit0[i]);
        } else if (state === "out") {
          want[i] = baseG[i]; level[i] = baseL[i];
          if (dn[i] > front) continue;
          if (lit0[i] < 0) { lit0[i] = t; if (rnd() < 0.3) spark(x, y, (rnd() - 0.5) * 0.25, 0.05 + rnd() * 0.15, 20 + rnd() * 24, true); }
          const age = t - lit0[i];
          if (age < 3) { want[i] = FULL; level[i] = 1.2; } else if (age < 8) { want[i] = MID; level[i] = 0.82; } else if (age < 13) { want[i] = LOW; level[i] = 0.62; } else if (age < 18) { want[i] = DOT; level[i] = 0.4; } else { want[i] = SPACE; }
        } else if (state === "loading") {
          const head = (t / 50) % 1.25, d = head - dn[i];
          want[i] = baseG[i]; level[i] = d >= 0 && d < 0.05 ? 1.2 : d >= 0 && d < 0.14 ? 1 : baseL[i] * 0.85;
          if (d >= 0 && d < 0.05) want[i] = FULL;
          if (d >= 0 && d < 0.02 && rnd() < 0.25) spark(x, y, (rnd() - 0.5) * 0.8, -0.3 - rnd() * 0.7, 8 + rnd() * 12);
        } else {                                       // idle: current runs through his strokes; a glint crosses now and then
          want[i] = baseG[i];
          level[i] = baseL[i] + 0.3 * Math.max(0, Math.cos(Math.PI * 2 * (dn[i] * 1.5 - t / 70))) ** 8;
          const gd = Math.abs(diag[i] - glint);
          if (gd < 0.025) { level[i] = 1.2; want[i] = FULL; } else if (gd < 0.07) level[i] = Math.max(level[i], 1);
        }
        if (flash > 0) level[i] = 1.2;
      }
      // the shadow follows the cell that casts it
      for (const j of shadows) { const i = shadowOf[j]; if (want[i] !== SPACE && want[j] === SPACE) { want[j] = SHADE; level[j] = 0.4; } }
      if (state === "idle" && t >= surge) {
        flash = 3;
        for (let k = 0; k < 14; k += 1) { const i = letters[Math.floor(rnd() * letters.length)]; spark(i % cols, Math.floor(i / cols), (rnd() - 0.5) * 1.2, -0.3 - rnd() * 0.8, 10 + rnd() * 14); }
        surge = t + 260 + Math.floor(rnd() * 160);
      }
      // drips: wet paint runs from the underside of a stroke, a drop falls, the run dries
      if (state === "idle" && drips.length < 3 && bottoms.length && rnd() < 0.02) drips.push({i: bottoms[Math.floor(rnd() * bottoms.length)], t0: t, max: 2 + Math.floor(rnd() * 4)});
      drips = drips.filter(d => {
        const age = t - d.t0, len = Math.min(d.max, 1 + Math.floor(age / 6)), dropAt = d.max * 6 + 14, x = d.i % cols;
        if (age === dropAt) spark(x, Math.floor(d.i / cols) + len, 0, 0.15, 30);
        for (let k = 1; k <= len; k += 1) {
          const j = d.i + k * cols; if (j >= N || isLetter[j]) break;
          const head = k === len && age < dropAt;
          want[j] = head ? DROP : RUN; level[j] = age < dropAt ? (head ? 1 : 0.82) : Math.max(0.4, 0.82 - (age - dropAt) / 40);
        }
        return age < dropAt + 60;
      });
      // the asterisk: matched again as it turns or scales; when the fuse reaches it, it goes off
      const shownStar = st.o > 0.02 && st.s > 0.02 && !(state === "out" && front >= 1.05);
      if (shownStar) {
        if (!burst && (state === "in" || state === "out") && front >= 1) {
          burst = true;
          if (state === "in") { flash = 4; ring = 0; }
          for (let k = 0; k < 40; k += 1) { const a = rnd() * Math.PI * 2, v = 0.35 + rnd() * 1.2; spark(scol, srow, Math.cos(a) * v * 2, Math.sin(a) * v, 14 + rnd() * 22); }
        }
        const d = paint(g => { g.translate(scx + st.x, scy + st.y); g.rotate(st.r * Math.PI / 180); g.scale(st.s, st.s); g.translate(-scx, -scy); g.fillStyle = "#fff"; g.globalAlpha = clamp(st.o); g.fill(star, "evenodd"); });
        const reach = Math.ceil(70 * scale * Math.max(1, st.s) / 16) + 2;
        for (let y = Math.max(0, Math.floor(srow) - reach); y < Math.min(rows, Math.floor(srow) + reach); y += 1) for (let x = Math.max(0, Math.floor(scol) - reach * 2); x < Math.min(cols, Math.floor(scol) + reach * 2); x += 1) {
          const [g, c] = cell(d, x, y); if (c > 0.03 && g !== SPACE) { const i = y * cols + x; want[i] = g; level[i] = (state === "in" && front >= 1 && st.s < 0.98) || flash > 0 ? 1.2 : 0.82 + 0.18 * Math.max(0, Math.sin(t / 9)); }
        }
        if (state === "loading") for (let k = 0; k < 4; k += 1) {      // sparks circling the turning asterisk
          const a = t * 0.12 + k * Math.PI / 2, x = Math.round(scol + Math.cos(a) * 7), y = Math.round(srow + Math.sin(a) * 3.4);
          if (x >= 0 && x < cols && y >= 0 && y < rows) { const i = y * cols + x; want[i] = SPARK[k % 4]; level[i] = 1.2; }
        }
      }
      // the shock ring from the asterisk going off: a circle of characters racing out over empty cells
      if (ring >= 0 && ring < 22) {
        const r = ring * 15, life = 1 - ring / 22;
        for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) {
          const i = y * cols + x; if (want[i] !== SPACE) continue;
          const dpx = Math.hypot((x - scol) * 8, (y - srow) * 16) - r;
          if (dpx > -5 && dpx < 5 && rnd() < 0.8) { want[i] = RING[Math.min(2, Math.floor((1 - life) * 3))]; level[i] = life > 0.6 ? 1.2 : 0.4 + 0.6 * life; }
        }
      }
      // sparks and ash: characters in flight, falling
      sparks = sparks.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += p.ash ? 0.01 : 0.045; p.vx *= 0.97; p.life -= 1;
        const x = Math.round(p.x), y = Math.round(p.y);
        if (p.life <= 0 || x < 0 || x >= cols || y < 0 || y >= rows) return false;
        const i = y * cols + x, f = p.life / p.max;
        want[i] = p.ash ? ASH[Math.floor(f * ASH.length) % ASH.length] : SPARK[Math.floor((1 - f) * SPARK.length) % SPARK.length];
        level[i] = p.ash ? 0.4 + 0.3 * f : f > 0.7 ? 1.2 : 0.4 + 0.6 * f;
        return true;
      });
      if (fade < 1) for (let i = 0; i < N; i += 1) level[i] *= fade;
      present(rnd, 2);
    };
  } else {
    // Marlin: his lines bright, the fills as shade by their colour; matched again every frame.
    // A monochrome panel tells fills apart by shade alone: light shades, dimmer than his lines.
    const DENSITY = {"#8B1119": 0.4, "#CC8186": 0.17, "#1E59AB": 0.62, "#E2E2D6": 0, "#C8AF2F": 0.24, "#129969": 0.32};
    const paths = data.pieces.map(p => ({ink: new Path2D(p.ink), fills: p.fills.map(f => ({d: DENSITY[f.colour] ?? 0.4, path: new Path2D(f.d)}))}));
    const gA = new Int16Array(N), cA = new Float32Array(N), gI = new Int16Array(N), cI = new Float32Array(N);
    const place = (g, p) => { g.translate(p.px + p.x, p.py + p.y); g.rotate(p.r * Math.PI / 180); g.scale(Math.max(p.s, 0.0001), Math.max(p.s, 0.0001)); g.translate(-p.px, -p.py); };
    draw = (b, fade, state, t, rnd) => {
      const visible = b.pieces.map(p => clamp(p.o) * clamp(b.whole.o) * fade);
      cells(paint(g => b.pieces.forEach((p, i) => { if (visible[i] <= 0.02) return; g.save(); place(g, p);
        for (const f of paths[i].fills) if (f.d > 0) { g.globalAlpha = f.d * visible[i]; g.fillStyle = "#fff"; g.fill(f.path, "evenodd"); }
        g.globalAlpha = visible[i]; g.fillStyle = "#fff"; g.fill(paths[i].ink, "evenodd"); g.restore(); })), gA, cA);
      cells(paint(g => b.pieces.forEach((p, i) => { if (visible[i] <= 0.02) return; g.save(); place(g, p); g.globalAlpha = visible[i]; g.fillStyle = "#fff"; g.fill(paths[i].ink, "evenodd"); g.restore(); })), gI, cI);
      for (let i = 0; i < N; i += 1) { want[i] = cA[i] > 0.02 ? gA[i] : SPACE; level[i] = cI[i] > 0.12 ? 1 : 0.4; }
      present(rnd, state === "in" ? 6 : 3);
    };
  }
  const behaviour = mark === "scratchy" ? scratchyText : MARKS[mark];
  const c = driver(data, {...options, behaviour}, (b, fade, state, t, rnd) => draw(b, fade, state, t, rnd));
  const dispose = c.dispose;
  c.dispose = () => { dispose(); if (resize) resize.disconnect(); canvas.remove(); };
  c.canvas = canvas;
  return c;
}
