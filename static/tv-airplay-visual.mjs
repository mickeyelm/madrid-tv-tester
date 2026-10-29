import * as THREE from "./vendor/three/three.module.js";

/* CH 20 PHOSPHOR BIOSPHERE
 *
 * One bounded WebGL renderer, three dimensional signal states, one feedback
 * compositor. Nothing in this module opens audio hardware: it only consumes
 * analysis values supplied by tv-airplay.js from the native CoreAudio tap.
 */

const SCENES = ["ORGANISM", "HABITAT", "STORM"];
const MODES = ["auto", "organism", "habitat", "storm"];
const INTENSITIES = {
  low: { feedback: 0.78, energy: 0.72, scale: 0.58 },
  normal: { feedback: 0.86, energy: 1.0, scale: 0.72 },
  max: { feedback: 0.91, energy: 1.34, scale: 0.84 }
};

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BIOSPHERE_SHADER = `
  precision highp float;

  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uLow;
  uniform float uMid;
  uniform float uHigh;
  uniform float uRms;
  uniform float uImpact;
  uniform float uEnergy;
  uniform float uScene;
  uniform float uNextScene;
  uniform float uMorph;
  uniform float uStepBudget;
  uniform float uSpectrum[16];
  uniform float uWave[16];

  #define PI 3.14159265359
  #define FAR 15.0

  mat2 rotate2d(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i);
    float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash31(i + vec3(1.0));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }

  float sdSphere(vec3 p, float radius) {
    return length(p) - radius;
  }

  float sdBox(vec3 p, vec3 bounds) {
    vec3 q = abs(p) - bounds;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }

  float sdTorus(vec3 p, vec2 radius) {
    vec2 q = vec2(length(p.xz) - radius.x, p.y);
    return length(q) - radius.y;
  }

  float smoothUnion(float a, float b, float amount) {
    float h = clamp(0.5 + 0.5 * (b - a) / amount, 0.0, 1.0);
    return mix(b, a, h) - amount * h * (1.0 - h);
  }

  float organism(vec3 p) {
    float time = uTime * 0.28;
    p.xz *= rotate2d(time * 0.42 + uLow * 0.5);
    p.xy *= rotate2d(sin(time * 0.37) * 0.35 + uMid * 0.4);
    float breath = 1.03 + uLow * 0.3 + sin(time * 2.0) * 0.035;
    float body = sdSphere(p, breath);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float angle = fi * PI / 3.0 + time * (0.22 + 0.035 * fi);
      vec3 node = vec3(
        cos(angle) * (0.72 + uMid * 0.22),
        sin(angle * 1.7 + time) * (0.38 + uHigh * 0.2),
        sin(angle) * (0.72 + uLow * 0.18)
      );
      float band = uSpectrum[i * 2];
      body = smoothUnion(body, sdSphere(p - node, 0.34 + band * 0.28), 0.42);
    }
    vec3 bore = p;
    bore.yz *= rotate2d(time * 0.7);
    float aperture = sdTorus(bore, vec2(0.62 + uMid * 0.2, 0.12 + uHigh * 0.08));
    body = max(body, -aperture);
    float membrane = sin(p.x * 8.0 + time * 3.0) *
      sin(p.y * 7.0 - time * 2.0) * sin(p.z * 6.0) * (0.018 + uHigh * 0.04);
    return body + membrane - uImpact * 0.04;
  }

  float habitat(vec3 p) {
    float time = uTime * 0.18;
    p.xz *= rotate2d(0.14 * sin(time));
    vec3 cell = p;
    cell.xz = mod(cell.xz + 1.6, 3.2) - 1.6;
    float row = floor((p.x + 1.6) / 3.2) + floor((p.z + 1.6) / 3.2) * 3.0;
    float lift = sin(row * 2.17 + time * 2.0) * (0.35 + uMid * 0.42);
    cell.y += lift;
    float monolith = sdBox(cell, vec3(0.18 + uHigh * 0.08, 0.9 + uLow, 0.18 + uHigh * 0.08));
    float crown = sdSphere(cell - vec3(0.0, 0.92 + uLow, 0.0), 0.38 + uSpectrum[8] * 0.28);
    float structure = smoothUnion(monolith, crown, 0.22);
    float ground = p.y + 1.45 + sin(p.x * 0.65 + time) * sin(p.z * 0.7 - time) * 0.12;
    float rings = abs(sdTorus(vec3(p.x, p.y + 0.1, p.z), vec2(2.25 + uLow, 0.035 + uHigh * 0.04))) - 0.025;
    return min(min(structure, ground), rings);
  }

  float storm(vec3 p) {
    float time = uTime * 0.48;
    p.xz *= rotate2d(time * 0.18);
    p.xy *= rotate2d(sin(time * 0.24) * 0.4);
    float wave = uWave[8] * 0.7;
    float ribbonAProfile = abs(p.y - sin(p.x * 1.7 + time * 2.2) * 0.52 -
      sin(p.z * 2.4 - time) * 0.24 - wave) - (0.045 + uMid * 0.075);
    float ribbonA = max(
      ribbonAProfile,
      abs(p.z + sin(p.x * 0.72 - time) * 0.36) - (0.16 + uLow * 0.18)
    );
    vec3 q = p;
    q.yz *= rotate2d(PI * 0.5 + 0.5 * sin(time));
    float ribbonBProfile = abs(q.y - sin(q.x * 2.1 - time * 1.8) * 0.48 -
      cos(q.z * 1.5 + time) * 0.25) - (0.035 + uHigh * 0.065);
    float ribbonB = max(
      ribbonBProfile,
      abs(q.z + cos(q.x * 0.58 + time * 1.2) * 0.42) - (0.13 + uMid * 0.16)
    );
    float core = sdTorus(p, vec2(1.15 + uLow * 0.5, 0.07 + uImpact * 0.1));
    float turbulence = (noise3(p * 2.8 + time) - 0.5) * (0.11 + uHigh * 0.12);
    return min(min(ribbonA, ribbonB), core) + turbulence;
  }

  float sceneDistance(vec3 p, float scene) {
    if (scene < 0.5) { return organism(p); }
    if (scene < 1.5) { return habitat(p); }
    return storm(p);
  }

  float mapWorld(vec3 p) {
    float fromDistance = sceneDistance(p, uScene);
    float toDistance = sceneDistance(p, uNextScene);
    return mix(fromDistance, toDistance, smoothstep(0.0, 1.0, uMorph));
  }

  vec3 normalAt(vec3 p) {
    vec2 e = vec2(0.0025, 0.0);
    return normalize(vec3(
      mapWorld(p + e.xyy) - mapWorld(p - e.xyy),
      mapWorld(p + e.yxy) - mapWorld(p - e.yxy),
      mapWorld(p + e.yyx) - mapWorld(p - e.yyx)
    ));
  }

  vec3 cameraRay(vec2 uv, vec3 origin, vec3 target, float lens) {
    vec3 forward = normalize(target - origin);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up = cross(forward, right);
    return normalize(forward * lens + right * uv.x + up * uv.y);
  }

  vec3 phosphorPalette(float value) {
    vec3 orange = vec3(1.0, 0.31, 0.0);
    vec3 gold = vec3(1.0, 0.84, 0.0);
    vec3 paper = vec3(0.94, 0.93, 0.91);
    vec3 blue = vec3(0.0, 0.27, 1.0);
    vec3 first = mix(orange, gold, smoothstep(0.15, 0.6, value));
    return mix(first, mix(paper, blue, uHigh * 0.28), smoothstep(0.7, 1.0, value));
  }

  vec3 background(vec2 uv, vec3 ray) {
    float horizon = pow(max(0.0, 1.0 - abs(ray.y + 0.08)), 9.0);
    float field = noise3(ray * 8.0 + vec3(0.0, 0.0, uTime * 0.08));
    float stars = step(0.988 - uHigh * 0.018, hash21(floor((uv + 1.0) * uResolution.xy * 0.17)));
    float pulse = 0.35 + 0.65 * sin(uTime * 0.8 + uv.x * 4.0);
    vec3 ink = vec3(0.006, 0.007, 0.006);
    ink += vec3(0.12, 0.025, 0.0) * horizon * (0.25 + uLow);
    ink += vec3(1.0, 0.31, 0.0) * stars * (0.2 + uHigh * 1.4) * pulse;
    ink += vec3(0.03, 0.012, 0.0) * field * uEnergy;
    return ink;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= uResolution.x / max(1.0, uResolution.y);
    float sceneMix = mix(uScene, uNextScene, uMorph);
    float cameraTime = uTime * (0.09 + uMid * 0.035);
    float cameraRadius = sceneMix > 0.6 && sceneMix < 1.7 ? 6.8 : 4.25;
    cameraRadius -= uLow * 0.48 + uImpact * 0.18;
    vec3 origin = vec3(
      sin(cameraTime) * cameraRadius,
      0.45 + sin(cameraTime * 0.73) * 0.55 + uMid * 0.22,
      cos(cameraTime) * cameraRadius
    );
    if (sceneMix > 1.65) {
      origin = vec3(sin(cameraTime * 0.7) * 3.7, 0.2, cos(cameraTime * 0.7) * 3.7);
    }
    vec3 target = vec3(0.0, sceneMix > 0.6 && sceneMix < 1.7 ? -0.28 : 0.0, 0.0);
    vec3 ray = cameraRay(uv, origin, target, 1.75 + uRms * 0.16);
    vec3 color = background(uv, ray);
    float travel = 0.0;
    float glow = 0.0;
    bool hit = false;
    vec3 point = origin;

    for (int stepIndex = 0; stepIndex < 84; stepIndex++) {
      if (float(stepIndex) >= uStepBudget) { break; }
      point = origin + ray * travel;
      float distanceToSurface = mapWorld(point);
      glow += exp(-8.0 * abs(distanceToSurface)) * (0.008 + uHigh * 0.015);
      if (abs(distanceToSurface) < 0.0035) {
        hit = true;
        break;
      }
      travel += max(0.012, abs(distanceToSurface) * 0.68);
      if (travel > FAR) { break; }
    }

    if (hit) {
      vec3 normal = normalAt(point);
      vec3 lightA = normalize(vec3(-0.8, 1.1, 0.5));
      vec3 lightB = normalize(vec3(0.7, -0.2, -0.8));
      float diffuse = max(0.0, dot(normal, lightA));
      float coldEdge = max(0.0, dot(normal, lightB));
      float fresnel = pow(1.0 - max(0.0, dot(normal, -ray)), 2.4);
      float bands = uSpectrum[int(mod(floor(abs(point.x * 3.0 + point.y * 5.0)), 16.0))];
      float energy = clamp(diffuse * 0.62 + fresnel * (0.65 + uHigh) + bands * 0.5, 0.0, 1.6);
      vec3 material = phosphorPalette(energy);
      float metal = 0.12 + diffuse * 0.55 + fresnel * 0.9;
      if (sceneMix > 1.65) {
        material = mix(vec3(1.0, 0.12, 0.0), vec3(1.0, 0.72, 0.0), diffuse);
        color = material * (0.16 + fresnel * 0.72 + diffuse * 0.34) * uEnergy;
        color += vec3(0.0, 0.18, 1.0) * coldEdge * (0.18 + uHigh * 0.58);
      } else {
        color = material * metal * uEnergy;
        color += vec3(0.0, 0.12, 0.8) * coldEdge * uHigh * 0.42;
      }
      color += vec3(1.0, 0.31, 0.0) * uImpact * fresnel * 1.4;
      color *= exp(-travel * 0.045);
    }

    color += phosphorPalette(0.25 + uHigh) * glow * uEnergy;
    float aperture = smoothstep(1.42, 0.12, length(uv * vec2(0.76, 1.0)));
    color *= 0.42 + aperture * 0.72;
    color += vec3(0.06, 0.012, 0.0) * uImpact * step(0.988, hash21(gl_FragCoord.xy + floor(uTime * 24.0)));
    gl_FragColor = vec4(color, 1.0);
  }
`;

const FEEDBACK_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tCurrent;
  uniform sampler2D tPrevious;
  uniform float uRetention;
  uniform float uImpact;
  uniform float uTime;

  void main() {
    vec2 center = vUv - 0.5;
    vec2 trailUv = center * (0.995 - uImpact * 0.005) + 0.5;
    trailUv.x += sin((vUv.y + uTime * 0.025) * 42.0) * 0.0007 * (0.2 + uImpact);
    vec3 current = texture2D(tCurrent, vUv).rgb;
    vec3 previous = texture2D(tPrevious, trailUv).rgb * uRetention;
    previous.r *= 0.995;
    previous.g *= 0.975;
    previous.b *= 0.94;
    vec3 phosphor = max(current, previous);
    phosphor += current * previous * 0.22;
    gl_FragColor = vec4(phosphor, 1.0);
  }
`;

const COMPOSITE_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSignal;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uImpact;
  uniform float uHigh;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 uv = vUv;
    vec2 centered = uv * 2.0 - 1.0;
    float curve = dot(centered, centered) * 0.018;
    uv = centered * (1.0 + curve) * 0.5 + 0.5;
    float tear = step(0.93, uImpact) * step(0.82, hash21(vec2(floor(uv.y * 24.0), floor(uTime * 18.0))));
    uv.x += tear * (hash21(vec2(uv.y, uTime)) - 0.5) * 0.035;

    vec2 offset = vec2((0.8 + uImpact * 1.8) / uResolution.x, 0.0);
    vec3 color;
    color.r = texture2D(tSignal, uv + offset).r;
    color.g = texture2D(tSignal, uv).g;
    color.b = texture2D(tSignal, uv - offset).b;

    float scanline = 0.78 + 0.22 * sin(gl_FragCoord.y * 3.14159265);
    float triad = mod(gl_FragCoord.x, 3.0);
    vec3 mask = triad < 1.0 ? vec3(1.0, 0.82, 0.74) :
      (triad < 2.0 ? vec3(0.86, 1.0, 0.78) : vec3(0.76, 0.84, 1.0));
    color *= scanline * mask;
    color += (hash21(gl_FragCoord.xy + floor(uTime * 30.0)) - 0.5) * (0.018 + uHigh * 0.012);
    float frame = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    color *= frame;
    color = color / (1.0 + color);
    color = pow(max(color, 0.0), vec3(0.88));
    gl_FragColor = vec4(color, 1.0);
  }
`;

function makeTarget(width, height) {
  return new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false
  });
}

function modeToScene(mode) {
  const index = MODES.indexOf(mode);
  return index > 0 ? index - 1 : null;
}

export function createMadridAirplayVisual(canvas, options = {}) {
  if (!canvas) { throw new Error("airplay WebGL canvas missing"); }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: Boolean(options.preserveDrawingBuffer)
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x050505, 1);

  const quad = new THREE.PlaneGeometry(2, 2);
  const camera = new THREE.Camera();
  const biosphereUniforms = {
    uResolution: { value: new THREE.Vector2(640, 360) },
    uTime: { value: 0 },
    uLow: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uRms: { value: 0 },
    uImpact: { value: 0 },
    uEnergy: { value: 1 },
    uScene: { value: 0 },
    uNextScene: { value: 0 },
    uMorph: { value: 0 },
    uStepBudget: { value: 64 },
    uSpectrum: { value: new Float32Array(16) },
    uWave: { value: new Float32Array(16) }
  };
  const biosphereMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: BIOSPHERE_SHADER,
    uniforms: biosphereUniforms,
    depthTest: false,
    depthWrite: false
  });
  const biosphereScene = new THREE.Scene();
  biosphereScene.add(new THREE.Mesh(quad, biosphereMaterial));

  const feedbackUniforms = {
    tCurrent: { value: null },
    tPrevious: { value: null },
    uRetention: { value: 0.86 },
    uImpact: { value: 0 },
    uTime: { value: 0 }
  };
  const feedbackMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FEEDBACK_SHADER,
    uniforms: feedbackUniforms,
    depthTest: false,
    depthWrite: false
  });
  const feedbackScene = new THREE.Scene();
  feedbackScene.add(new THREE.Mesh(quad, feedbackMaterial));

  const compositeUniforms = {
    tSignal: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uImpact: { value: 0 },
    uHigh: { value: 0 }
  };
  const compositeMaterial = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: COMPOSITE_SHADER,
    uniforms: compositeUniforms,
    depthTest: false,
    depthWrite: false
  });
  const compositeScene = new THREE.Scene();
  compositeScene.add(new THREE.Mesh(quad, compositeMaterial));

  let width = 1;
  let height = 1;
  let qualityScale = INTENSITIES.normal.scale;
  let sceneTarget = makeTarget(2, 2);
  let feedbackA = makeTarget(2, 2);
  let feedbackB = makeTarget(2, 2);
  let mode = "auto";
  let intensity = "normal";
  let currentScene = 0;
  let nextScene = 0;
  let morphStartedAt = 0;
  let sceneStartedAt = performance.now();
  let renderSamples = [];
  let renderedFrames = 0;
  let lastFrameAt = 0;
  let frameRate = 30;
  let failed = false;

  function disposeTargets() {
    sceneTarget.dispose();
    feedbackA.dispose();
    feedbackB.dispose();
  }

  function rebuildTargets() {
    const renderWidth = Math.max(320, Math.round(width * qualityScale));
    const renderHeight = Math.max(180, Math.round(height * qualityScale));
    disposeTargets();
    sceneTarget = makeTarget(renderWidth, renderHeight);
    feedbackA = makeTarget(renderWidth, renderHeight);
    feedbackB = makeTarget(renderWidth, renderHeight);
    biosphereUniforms.uResolution.value.set(renderWidth, renderHeight);
    renderer.setRenderTarget(feedbackA);
    renderer.clear();
    renderer.setRenderTarget(feedbackB);
    renderer.clear();
    renderer.setRenderTarget(null);
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(bounds.width || 1280));
    const nextHeight = Math.max(1, Math.round(bounds.height || 720));
    if (nextWidth === width && nextHeight === height) { return; }
    width = nextWidth;
    height = nextHeight;
    renderer.setSize(width, height, false);
    compositeUniforms.uResolution.value.set(width, height);
    rebuildTargets();
  }

  function setQuality(scale) {
    const bounded = Math.max(0.48, Math.min(INTENSITIES[intensity].scale, scale));
    if (Math.abs(bounded - qualityScale) < 0.01) { return; }
    qualityScale = bounded;
    rebuildTargets();
  }

  function beginScene(scene, now) {
    const bounded = Math.max(0, Math.min(2, scene));
    // State arrives every 400 ms. Reapplying the already-selected target must
    // not restart its 2.1-second morph or fixed modes can never finish.
    if (bounded === nextScene) { return; }
    nextScene = bounded;
    morphStartedAt = now || performance.now();
  }

  function updateDirector(now, signal) {
    const fixedScene = modeToScene(mode);
    if (fixedScene !== null) {
      beginScene(fixedScene, now);
    } else if (nextScene === currentScene) {
      const age = now - sceneStartedAt;
      const musicalExit = age > 45000 && signal.impact > 0.58 && signal.rms > 0.025;
      if (musicalExit || age > 90000) {
        beginScene((currentScene + 1) % SCENES.length, now);
      }
    }

    let morph = 0;
    if (nextScene !== currentScene) {
      morph = Math.min(1, (now - morphStartedAt) / 2100);
      if (morph >= 1) {
        currentScene = nextScene;
        sceneStartedAt = now;
        morphStartedAt = 0;
        morph = 0;
      }
    }
    biosphereUniforms.uScene.value = currentScene;
    biosphereUniforms.uNextScene.value = nextScene;
    biosphereUniforms.uMorph.value = morph;
    if (typeof options.onSceneChange === "function") {
      options.onSceneChange(SCENES[morph > 0.5 ? nextScene : currentScene], morph);
    }
  }

  function aggregate(source, target, signed) {
    const input = source || [];
    for (let index = 0; index < target.length; index += 1) {
      const from = Math.floor(index * input.length / target.length);
      const to = Math.max(from + 1, Math.floor((index + 1) * input.length / target.length));
      let total = 0;
      let count = 0;
      for (let sample = from; sample < to && sample < input.length; sample += 1) {
        const value = Number(input[sample]) || 0;
        total += signed ? Math.max(-1, Math.min(1, value)) : Math.max(0, Math.min(1, value));
        count += 1;
      }
      target[index] = count ? total / count : 0;
    }
  }

  function govern(renderMilliseconds) {
    renderSamples.push(renderMilliseconds);
    if (renderSamples.length > 90) { renderSamples.shift(); }
    if (renderSamples.length < 90 || renderedFrames % 90 !== 0) { return; }
    const average = renderSamples.reduce((total, value) => total + value, 0) / renderSamples.length;
    frameRate = Math.min(30, Math.round(1000 / Math.max(1, average)));
    if (average > 31 && qualityScale > 0.5) {
      setQuality(qualityScale - 0.1);
    } else if (average < 18 && qualityScale < INTENSITIES[intensity].scale) {
      setQuality(qualityScale + 0.06);
    }
  }

  function render(now, signal = {}) {
    if (failed || now - lastFrameAt < 30) { return false; }
    lastFrameAt = now;
    resize();
    updateDirector(now, signal);
    const renderStarted = performance.now();
    const profile = INTENSITIES[intensity];
    const live = signal.live ? 1 : 0;

    biosphereUniforms.uTime.value = now / 1000;
    biosphereUniforms.uLow.value = Number(signal.low) || 0;
    biosphereUniforms.uMid.value = Number(signal.mid) || 0;
    biosphereUniforms.uHigh.value = Number(signal.high) || 0;
    biosphereUniforms.uRms.value = Number(signal.rms) || 0;
    biosphereUniforms.uImpact.value = Number(signal.impact) || 0;
    biosphereUniforms.uEnergy.value = profile.energy * (0.68 + live * 0.32);
    biosphereUniforms.uStepBudget.value = qualityScale < 0.58 ? 48 : (qualityScale < 0.72 ? 62 : 78);
    aggregate(signal.spectrum, biosphereUniforms.uSpectrum.value, false);
    aggregate(signal.waveform, biosphereUniforms.uWave.value, true);

    renderer.setRenderTarget(sceneTarget);
    renderer.render(biosphereScene, camera);

    feedbackUniforms.tCurrent.value = sceneTarget.texture;
    feedbackUniforms.tPrevious.value = feedbackA.texture;
    feedbackUniforms.uRetention.value = profile.feedback - (Number(signal.impact) || 0) * 0.06;
    feedbackUniforms.uImpact.value = Number(signal.impact) || 0;
    feedbackUniforms.uTime.value = now / 1000;
    renderer.setRenderTarget(feedbackB);
    renderer.render(feedbackScene, camera);

    compositeUniforms.tSignal.value = feedbackB.texture;
    compositeUniforms.uTime.value = now / 1000;
    compositeUniforms.uImpact.value = Number(signal.impact) || 0;
    compositeUniforms.uHigh.value = Number(signal.high) || 0;
    renderer.setRenderTarget(null);
    renderer.render(compositeScene, camera);

    const swap = feedbackA;
    feedbackA = feedbackB;
    feedbackB = swap;
    renderedFrames += 1;
    govern(performance.now() - renderStarted);
    return true;
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    failed = true;
    if (typeof options.onFailure === "function") {
      options.onFailure("WEBGL CONTEXT LOST");
    }
  });

  canvas.addEventListener("webglcontextrestored", () => {
    failed = false;
    rebuildTargets();
  });

  resize();

  return {
    render,
    resize,
    setMode(value) {
      const normalized = String(value || "").toLowerCase();
      if (MODES.indexOf(normalized) < 0) { return false; }
      mode = normalized;
      const fixedScene = modeToScene(mode);
      if (fixedScene !== null) { beginScene(fixedScene, performance.now()); }
      return true;
    },
    setIntensity(value) {
      const normalized = String(value || "").toLowerCase();
      if (!INTENSITIES[normalized]) { return false; }
      intensity = normalized;
      setQuality(INTENSITIES[intensity].scale);
      return true;
    },
    setSceneForQA(value) {
      const scene = typeof value === "number" ? value : SCENES.indexOf(String(value).toUpperCase());
      if (scene < 0 || scene > 2) { return false; }
      currentScene = scene;
      nextScene = scene;
      sceneStartedAt = performance.now();
      morphStartedAt = 0;
      return true;
    },
    status() {
      return {
        webgl: !failed,
        mode,
        intensity,
        scene: SCENES[currentScene],
        nextScene: SCENES[nextScene],
        qualityScale: Number(qualityScale.toFixed(2)),
        fps: frameRate,
        frames: renderedFrames
      };
    },
    dispose() {
      disposeTargets();
      quad.dispose();
      biosphereMaterial.dispose();
      feedbackMaterial.dispose();
      compositeMaterial.dispose();
      renderer.dispose();
    }
  };
}
