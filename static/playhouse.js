import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";
import { loadMarlinPuppet } from "./marlin-puppet.mjs";
import * as CANNON from "./vendor/cannon-es.js";

const Core = window.MadridPlayhouseCore;
const canvas = document.getElementById("playhouse-canvas");
const layer = canvas && canvas.closest(".playhouse-layer");
const fallback = document.getElementById("playhouse-fallback");
const loadStatus = document.getElementById("playhouse-load-status");
const sensorEl = document.getElementById("playhouse-sensor");
const timeEl = document.getElementById("playhouse-time");
const scoreEl = document.getElementById("playhouse-score");
const comboEl = document.getElementById("playhouse-combo");
const binskyFillEl = document.getElementById("playhouse-binsky-fill");
const instructionEl = document.getElementById("playhouse-instruction");
const resultsEl = document.getElementById("playhouse-results");
const rankEl = document.getElementById("playhouse-rank");
const finalScoreEl = document.getElementById("playhouse-final-score");

if (!canvas || !Core) {
  throw new Error("Playhouse markup or core module is missing");
}

const PALETTE = {
  ink: 0x111111,
  cream: 0xe7d9bd,
  orange: 0xff4f00,
  yellow: 0xf5c400,
  red: 0xd92323,
  tape: 0x25211f,
  brown: 0x5e3c29,
  green: 0x37583b,
  blue: 0x2f4c69,
  gray: 0x6f6b65,
  white: 0xf5ead3
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;

const effect = new OutlineEffect(renderer, {
  defaultThickness: 0.0035,
  defaultColor: [0.045, 0.035, 0.03],
  defaultAlpha: 0.62,
  defaultKeepAlive: true
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x17120f);
scene.fog = new THREE.FogExp2(0x17120f, 0.026);

const camera = new THREE.PerspectiveCamera(58, 4 / 3, 0.05, 60);
// The Polycam scan encloses the camera. Starting inside its front boundary
// removes the exterior wall and makes the room read as a window with depth.
const baseCamera = new THREE.Vector3(0, 2.48, 3.48);
camera.position.copy(baseCamera);
camera.lookAt(0, 1.25, -1.35);

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.62;
world.defaultContactMaterial.restitution = 0.18;

const hemi = new THREE.HemisphereLight(0xffe3b8, 0x342321, 1.8);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffd1a0, 4.6);
key.position.set(-3.4, 7.2, 5.2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -7;
key.shadow.camera.right = 7;
key.shadow.camera.top = 7;
key.shadow.camera.bottom = -5;
scene.add(key);
const practical = new THREE.PointLight(PALETTE.orange, 9, 8, 1.8);
practical.position.set(3.4, 2.7, -2.6);
scene.add(practical);
const tvGlow = new THREE.PointLight(0x5f87b6, 7, 5, 2);
tvGlow.position.set(-3.1, 1.45, -2.25);
scene.add(tvGlow);

const floorMaterial = new CANNON.Material("floor");
const propMaterial = new CANNON.Material("prop");
world.addContactMaterial(new CANNON.ContactMaterial(floorMaterial, propMaterial, {
  friction: 0.68,
  restitution: 0.16
}));

const floorBody = new CANNON.Body({ mass: 0, material: floorMaterial });
floorBody.addShape(new CANNON.Plane());
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

function wallBody(position, size) {
  const body = new CANNON.Body({ mass: 0, material: floorMaterial, position: new CANNON.Vec3(...position) });
  body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
  world.addBody(body);
  return body;
}

wallBody([-4.55, 2, -0.5], [0.2, 4, 9.5]);
wallBody([4.55, 2, -0.5], [0.2, 4, 9.5]);
wallBody([0, 2, -5.15], [9.3, 4, 0.2]);

const matCache = new Map();
function material(color, roughness = 0.82, metalness = 0.04, emissive = 0x000000) {
  const keyName = [color, roughness, metalness, emissive].join("/");
  if (!matCache.has(keyName)) {
    matCache.set(keyName, new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity: emissive ? 1.45 : 0 }));
  }
  return matCache.get(keyName);
}

function boxMesh(size, color, roughness, metalness) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, roughness, metalness));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const syncObjects = [];
const scoredBodies = new WeakMap();
const breakableProps = [];
let score = 0;
let combo = 1;
let comboDeadline = 0;
let nextBinskyAt = 2600;
let binskyCharge = 0;
let programmingControl = false;
function claimProgrammingControl() {
  if (programmingControl) return;
  programmingControl = true;
  fetch("/api/programming/control", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: "{}"
  }).catch(() => {});
}

function impactPosition(event, body) {
  if (event.contact && event.contact.bi === body) {
    return body.position.vadd(event.contact.ri);
  }
  if (event.contact && event.contact.bj === body) {
    return body.position.vadd(event.contact.rj);
  }
  return body.position;
}

function registerScoring(body, type) {
  body.addEventListener("collide", (event) => {
    if (!game.running) return;
    const now = performance.now();
    const last = scoredBodies.get(body) || 0;
    if (now - last < 320) return;
    let impact = 0;
    try { impact = Math.abs(event.contact.getImpactVelocityAlongNormal()); } catch (_) { impact = body.velocity.length(); }
    if (impact < 1.15) return;
    scoredBodies.set(body, now);
    combo = now <= comboDeadline ? Math.min(24, combo + 1) : 1;
    comboDeadline = now + 1450;
    const award = Core.collisionAward(impact, type, combo);
    score += award;
    binskyCharge += award;
    game.cameraShake = Math.min(0.34, game.cameraShake + impact * 0.009);
    const point = impactPosition(event, body);
    makeCallout("+" + award, Core.collisionLabel(type, combo, impact), new THREE.Vector3(point.x, point.y, point.z));
    updateHud();
    if (!binsky.active && score >= nextBinskyAt) {
      nextBinskyAt += 3200 + Math.floor(score / 9000) * 800;
      triggerBinsky();
    }
  });
}

function addPhysicsBox({ position, size, color, mass = 1, type = "vhs", rotation = [0, 0, 0], roughness = 0.84, metalness = 0.03, detail }) {
  const mesh = boxMesh(size, color, roughness, metalness);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  scene.add(mesh);
  const body = new CANNON.Body({
    mass,
    material: propMaterial,
    position: new CANNON.Vec3(...position),
    shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)),
    linearDamping: 0.035,
    angularDamping: 0.055
  });
  body.quaternion.setFromEuler(...rotation);
  body.allowSleep = true;
  body.sleepSpeedLimit = 0.18;
  body.sleepTimeLimit = 1.2;
  body.userData = { type };
  world.addBody(body);
  syncObjects.push({
    mesh,
    body,
    initialPosition: body.position.clone(),
    initialQuaternion: body.quaternion.clone()
  });
  breakableProps.push(body);
  registerScoring(body, type);
  if (detail) detail(mesh);
  return { mesh, body };
}

function labelPlane(text, bg, fg, width = 0.42, height = 0.13) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 80;
  const ctx = c.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = fg;
  ctx.font = "900 30px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  return mesh;
}

function decorateVhs(mesh, index) {
  const labels = ["HOME", "TAPE", "SP", "MADRiD", "1999", "EP", "REC"];
  const p = labelPlane(labels[index % labels.length], index % 3 === 0 ? "#ff4f00" : "#e7d9bd", "#111111");
  p.position.set(0, 0, 0.091);
  mesh.add(p);
}

function addStaticRoomFurniture() {
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 9.5), material(0x5c4638, 0.98));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.012, -0.6);
  carpet.receiveShadow = true;
  scene.add(carpet);

  const couch = new THREE.Group();
  couch.add(boxMesh([3.4, 0.52, 1.1], 0x6e4a39));
  const back = boxMesh([3.4, 1.05, 0.28], 0x75503d);
  back.position.set(0, 0.57, -0.45);
  couch.add(back);
  for (const x of [-1.4, 1.4]) {
    const arm = boxMesh([0.42, 0.75, 1.15], 0x62402f);
    arm.position.set(x, 0.24, 0);
    couch.add(arm);
  }
  couch.position.set(2.45, 0.38, -3.55);
  couch.rotation.y = -0.13;
  scene.add(couch);
  wallBody([2.45, 0.55, -3.55], [3.55, 1.1, 1.1]);

  const tv = new THREE.Group();
  const shell = boxMesh([1.55, 1.15, 0.72], 0x2b2925, 0.7, 0.14);
  tv.add(shell);
  const glass = boxMesh([1.25, 0.82, 0.025], 0x26384b, 0.25, 0.1);
  glass.position.z = 0.374;
  tv.add(glass);
  const glow = new THREE.MeshBasicMaterial({ color: 0x4c6e8c, transparent: true, opacity: 0.52 });
  const scanline = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 0.03), glow);
  scanline.position.set(0, 0.12, 0.39);
  tv.add(scanline);
  tv.position.set(-3.05, 1.05, -3.6);
  tv.rotation.y = 0.22;
  scene.add(tv);
  const stand = boxMesh([1.85, 0.7, 0.9], PALETTE.brown);
  stand.position.set(-3.05, 0.36, -3.6);
  stand.rotation.y = 0.22;
  scene.add(stand);
  wallBody([-3.05, 0.8, -3.6], [1.9, 1.6, 1]);

  const coffee = boxMesh([2.0, 0.18, 1.15], 0x60422e, 0.52, 0.02);
  coffee.position.set(0.15, 0.56, -1.8);
  scene.add(coffee);
  wallBody([0.15, 0.5, -1.8], [2.0, 0.9, 1.15]);

  const shelf = boxMesh([0.45, 2.75, 2.2], 0x49301f);
  shelf.position.set(-4.1, 1.38, -1.0);
  scene.add(shelf);
  wallBody([-4.1, 1.38, -1.0], [0.5, 2.75, 2.2]);

  const doorway = new THREE.Group();
  const left = boxMesh([0.24, 2.8, 0.2], 0x352a23);
  const right = left.clone();
  left.position.x = -0.8;
  right.position.x = 0.8;
  doorway.add(left, right);
  const top = boxMesh([1.84, 0.24, 0.2], 0x352a23);
  top.position.y = 1.28;
  doorway.add(top);
  doorway.position.set(1.1, 1.4, -5.0);
  scene.add(doorway);
}

function addClutter() {
  const piles = [
    [-3.25, -1.25], [-2.25, 0.3], [3.18, -1.5], [2.75, 0.72], [-1.25, -3.65], [3.58, -3.55]
  ];
  let vhsIndex = 0;
  for (const [px, pz] of piles) {
    const layers = 4 + (vhsIndex % 4);
    for (let y = 0; y < layers; y += 1) {
      const count = y < 2 ? 3 : 2;
      for (let x = 0; x < count; x += 1) {
        const jitter = ((vhsIndex * 17) % 11 - 5) * 0.008;
        const position = [px + (x - (count - 1) / 2) * 0.44 + jitter, 0.1 + y * 0.19, pz + ((y + x) % 2) * 0.08];
        addPhysicsBox({
          position,
          size: [0.4, 0.18, 0.58],
          color: vhsIndex % 7 === 0 ? 0x493f38 : PALETTE.tape,
          mass: 0.38,
          type: "vhs",
          rotation: [0, jitter * 5, jitter],
          detail: (mesh) => decorateVhs(mesh, vhsIndex)
        });
        vhsIndex += 1;
      }
    }
  }

  const analog = [
    { p: [-2.35, 0.34, -2.2], s: [1.1, 0.62, 0.72], c: 0x4e4d48, m: 5.5, label: "VCR" },
    { p: [2.9, 0.26, -0.15], s: [1.25, 0.48, 0.72], c: 0x282a27, m: 5.8, label: "TUNER" },
    { p: [3.1, 0.72, -0.28], s: [1.05, 0.44, 0.66], c: 0x727069, m: 4.7, label: "DECK" },
    { p: [-3.18, 0.34, 1.16], s: [0.88, 0.64, 0.66], c: 0x34332f, m: 4.2, label: "UHF" },
    { p: [0.25, 0.23, -0.94], s: [0.96, 0.4, 0.62], c: 0x605e56, m: 4.3, label: "BETAMAX" }
  ];
  analog.forEach((a, i) => addPhysicsBox({
    position: a.p,
    size: a.s,
    color: a.c,
    mass: a.m,
    type: "analog",
    roughness: 0.54,
    metalness: 0.22,
    rotation: [0, (i - 2) * 0.08, 0],
    detail: (mesh) => {
      const label = labelPlane(a.label, "#f5c400", "#111111", 0.46, 0.12);
      label.position.set(0, 0, a.s[2] / 2 + 0.006);
      mesh.add(label);
      for (const x of [-0.35, 0.35]) {
        const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12), material(0x151515, 0.4, 0.45));
        knob.rotation.x = Math.PI / 2;
        knob.position.set(x, -0.08, a.s[2] / 2 + 0.035);
        mesh.add(knob);
      }
    }
  }));

  for (let i = 0; i < 18; i += 1) {
    const side = i % 2 ? -1 : 1;
    addPhysicsBox({
      position: [side * (1.5 + (i % 5) * 0.37), 0.055 + Math.floor(i / 10) * 0.07, 1.15 - (i % 4) * 0.35],
      size: [0.32, 0.09, 0.2],
      color: [PALETTE.cream, PALETTE.orange, PALETTE.blue, PALETTE.yellow][i % 4],
      mass: 0.11,
      type: "cassette",
      rotation: [0.04 * (i % 3), i * 0.23, 0.06 * (i % 2)]
    });
  }

  for (let i = 0; i < 20; i += 1) {
    const angle = i * 2.11;
    const meshBody = addPhysicsBox({
      position: [Math.cos(angle) * (2.1 + (i % 3) * 0.35), 0.07 + (i % 4) * 0.035, -0.1 + Math.sin(angle) * 2.2],
      size: [0.5 + (i % 3) * 0.12, 0.12, 0.38 + (i % 2) * 0.15],
      color: [0xb56449, 0x48627b, 0xc9a965, 0x637a54, 0x7d5073][i % 5],
      mass: 0.16,
      type: "laundry",
      rotation: [0.1, angle, 0.12]
    });
    meshBody.mesh.scale.y = 0.72;
  }
}

addStaticRoomFurniture();
addClutter();

function loadApartmentScan() {
  loadStatus.textContent = "BUILDING THE PLAYHOUSE";
  const loader = new GLTFLoader();
  loader.load("static/playhouse/apartment.glb", (gltf) => {
    const apartment = gltf.scene;
    apartment.traverse((node) => {
      if (!node.isMesh) return;
      node.receiveShadow = true;
      node.castShadow = false;
      const originals = Array.isArray(node.material) ? node.material : [node.material];
      const adjusted = originals.map((original) => {
        const copy = original ? original.clone() : material(PALETTE.gray);
        copy.roughness = 0.9;
        copy.metalness = 0;
        copy.side = THREE.DoubleSide;
        // Keep the scan in the opaque render pass but out of the depth buffer:
        // it paints first as the physical set, then Marlin and every prop stay
        // crisply in front even where the raw scan has stray reconstruction.
        copy.transparent = false;
        copy.opacity = 1;
        copy.depthWrite = false;
        // Polycam includes the outside faces of the room shell. This TV-set
        // cutaway removes the front wall while preserving the deep hall.
        copy.clippingPlanes = [
          new THREE.Plane(new THREE.Vector3(0, 0, -1), 2.15)
        ];
        if (copy.map) copy.map.colorSpace = THREE.SRGBColorSpace;
        return copy;
      });
      node.material = Array.isArray(node.material) ? adjusted : adjusted[0];
    });
    const box = new THREE.Box3().setFromObject(apartment);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longAxis = Math.max(size.x, size.z);
    const scale = 10.8 / Math.max(0.1, longAxis);
    apartment.scale.setScalar(scale);
    apartment.position.set(-center.x * scale, -box.min.y * scale - 0.025, -center.z * scale - 0.95);
    if (size.x > size.z) apartment.rotation.y = Math.PI / 2;
    apartment.renderOrder = -2;
    scene.add(apartment);
    fallback.classList.add("is-hidden");
  }, (event) => {
    if (event.total) loadStatus.textContent = "APARTMENT " + Math.round(event.loaded / event.total * 100) + "%";
  }, (error) => {
    console.error("Playhouse apartment load failed", error);
    loadStatus.textContent = "SCAN OFFLINE / PROCEDURAL ROOM ACTIVE";
    setTimeout(() => fallback.classList.add("is-hidden"), 2200);
  });
}
(function proceduralRoom() { const floor = new THREE.Mesh(new THREE.PlaneGeometry(9.3, 9.5), material(0x3a2d25, 0.96)); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -0.5); floor.receiveShadow = true; scene.add(floor); [[[-4.55, 2, -0.5], [0.2, 4, 9.5]], [[4.55, 2, -0.5], [0.2, 4, 9.5]], [[0, 2, -5.15], [9.3, 4, 0.2]]].forEach(([p, s]) => { const wall = boxMesh(s, 0x8a7a66, 0.95, 0); wall.castShadow = false; wall.position.set(...p); scene.add(wall); }); loadStatus.textContent = "PROCEDURAL ROOM ACTIVE"; setTimeout(() => fallback.classList.add("is-hidden"), 1200); }());

function makeCone(radius, height, color) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 16), material(color, 0.68));
  mesh.castShadow = true;
  return mesh;
}

function makeSphere(radius, color, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 12), material(color, 0.72));
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  return mesh;
}

function makeCylinder(radius, color) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.86, 1, 12), material(color, 0.72));
  mesh.castShadow = true;
  return mesh;
}

const marlin = new THREE.Group();
scene.add(marlin);
const marlinParts = {
  torso: makeCylinder(0.24, PALETTE.cream),
  head: makeSphere(0.25, 0xd7c1a3, 0.78, 1.12, 0.72),
  leftUpper: makeCylinder(0.085, PALETTE.cream),
  leftLower: makeCylinder(0.075, PALETTE.cream),
  rightUpper: makeCylinder(0.085, PALETTE.cream),
  rightLower: makeCylinder(0.075, PALETTE.cream),
  leftThigh: makeCylinder(0.11, PALETTE.cream),
  leftShin: makeCylinder(0.09, PALETTE.cream),
  rightThigh: makeCylinder(0.11, PALETTE.cream),
  rightShin: makeCylinder(0.09, PALETTE.cream)
};
marlinParts.head.material = new THREE.MeshStandardMaterial({
  color: 0xd7c1a3,
  roughness: 0.7,
  emissive: 0x24160e,
  emissiveIntensity: 0.72
});
Object.values(marlinParts).forEach((part) => marlin.add(part));

const face = new THREE.Group();
for (const x of [-0.075, 0.075]) {
  const eye = makeSphere(0.036, 0x17130f, 0.9, 1.2, 0.48);
  eye.position.set(x, 0.04, 0.295);
  face.add(eye);
}
const nose = makeCone(0.06, 0.18, 0xcaaa88);
nose.rotation.x = Math.PI / 2;
nose.position.set(0, -0.02, 0.35);
face.add(nose);
const mouth = boxMesh([0.12, 0.018, 0.018], 0x5f2418);
mouth.position.set(0, -0.12, 0.295);
face.add(mouth);
marlinParts.head.add(face);

const hat = makeCone(0.21, 0.58, PALETTE.red);
hat.position.y = 0.49;
hat.rotation.z = -0.1;
marlinParts.head.add(hat);
const hatBall = makeSphere(0.075, PALETTE.red);
hatBall.position.set(-0.055, 0.78, 0);
marlinParts.head.add(hatBall);

const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.12, 8), material(PALETTE.yellow));
collar.position.y = 0.54;
marlinParts.torso.add(collar);

for (let i = 0; i < 9; i += 1) {
  const dot = makeSphere(0.033, i % 2 ? PALETTE.orange : PALETTE.blue);
  dot.position.set(((i % 3) - 1) * 0.13, 0.36 - Math.floor(i / 3) * 0.3, 0.225);
  marlinParts.torso.add(dot);
}

const shoes = { left: makeSphere(0.16, PALETTE.red, 1.45, 0.62, 2.0), right: makeSphere(0.16, PALETTE.red, 1.45, 0.62, 2.0) };
marlin.add(shoes.left, shoes.right);

const strings = new THREE.LineSegments(
  new THREE.BufferGeometry().setFromPoints(new Array(10).fill(0).map(() => new THREE.Vector3())),
  new THREE.LineBasicMaterial({ color: 0xf3e6c9, transparent: true, opacity: 0.72 })
);
marlin.add(strings);

function setSegment(mesh, a, b, thicknessScale = 1) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const distance = Math.max(0.05, a.distanceTo(b));
  mesh.position.copy(mid);
  mesh.scale.set(thicknessScale, distance, thicknessScale);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}

const handBodies = {};
for (const name of ["leftWrist", "rightWrist", "leftAnkle", "rightAnkle", "head"]) {
  const radius = name === "head" ? 0.23 : name.includes("Ankle") ? 0.2 : 0.17;
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: propMaterial });
  body.addShape(new CANNON.Sphere(radius));
  body.collisionResponse = true;
  world.addBody(body);
  handBodies[name] = body;
}

const targetPose = {};
const smoothPose = {};
const JOINTS = ["nose", "leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftWrist", "rightWrist", "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle"];

function fallbackPose(now) {
  const t = now * 0.001;
  const swing = Math.sin(t * 1.13);
  const kick = Math.sin(t * 1.83);
  return {
    nose: { x: 0, y: 2.43, z: 1.15 },
    leftShoulder: { x: -0.34, y: 2.08, z: 1.15 }, rightShoulder: { x: 0.34, y: 2.08, z: 1.15 },
    leftElbow: { x: -0.58, y: 1.74 + swing * 0.28, z: 1.08 }, rightElbow: { x: 0.58, y: 1.74 - swing * 0.28, z: 1.08 },
    leftWrist: { x: -0.84, y: 1.46 + swing * 0.48, z: 0.95 }, rightWrist: { x: 0.84, y: 1.46 - swing * 0.48, z: 0.95 },
    leftHip: { x: -0.19, y: 1.35, z: 1.15 }, rightHip: { x: 0.19, y: 1.35, z: 1.15 },
    leftKnee: { x: -0.24, y: 0.77 + kick * 0.15, z: 1.13 }, rightKnee: { x: 0.24, y: 0.77 - kick * 0.15, z: 1.13 },
    leftAnkle: { x: -0.3, y: 0.13 + Math.max(0, kick) * 0.3, z: 0.98 }, rightAnkle: { x: 0.3, y: 0.13 + Math.max(0, -kick) * 0.3, z: 0.98 }
  };
}

function applyPose(pose, now) {
  const fallbackData = fallbackPose(now);
  JOINTS.forEach((name) => {
    const incoming = pose && pose[name] ? pose[name] : fallbackData[name];
    if (!targetPose[name]) targetPose[name] = new THREE.Vector3();
    if (!smoothPose[name]) smoothPose[name] = new THREE.Vector3();
    targetPose[name].set(incoming.x, incoming.y, incoming.z);
    smoothPose[name].lerp(targetPose[name], 0.22);
  });

  const p = smoothPose;
  const shoulders = p.leftShoulder.clone().add(p.rightShoulder).multiplyScalar(0.5);
  const hips = p.leftHip.clone().add(p.rightHip).multiplyScalar(0.5);
  setSegment(marlinParts.torso, hips, shoulders, 1);
  setSegment(marlinParts.leftUpper, p.leftShoulder, p.leftElbow);
  setSegment(marlinParts.leftLower, p.leftElbow, p.leftWrist, 0.9);
  setSegment(marlinParts.rightUpper, p.rightShoulder, p.rightElbow);
  setSegment(marlinParts.rightLower, p.rightElbow, p.rightWrist, 0.9);
  setSegment(marlinParts.leftThigh, p.leftHip, p.leftKnee);
  setSegment(marlinParts.leftShin, p.leftKnee, p.leftAnkle, 0.92);
  setSegment(marlinParts.rightThigh, p.rightHip, p.rightKnee);
  setSegment(marlinParts.rightShin, p.rightKnee, p.rightAnkle, 0.92);
  marlinParts.head.position.copy(p.nose);
  if (marlinPuppet) marlinPuppet.update(p);
  shoes.left.position.copy(p.leftAnkle).add(new THREE.Vector3(0, -0.02, 0.08));
  shoes.right.position.copy(p.rightAnkle).add(new THREE.Vector3(0, -0.02, 0.08));

  const colliderTargets = {
    leftWrist: p.leftWrist,
    rightWrist: p.rightWrist,
    leftAnkle: p.leftAnkle,
    rightAnkle: p.rightAnkle,
    head: p.nose
  };
  const colliderDt = Math.max(1 / 120, Math.min(1 / 20, (now - (applyPose.lastAt || now - 16)) / 1000));
  Object.entries(colliderTargets).forEach(([name, target]) => {
    const body = handBodies[name];
    body.velocity.set(
      Core.clamp((target.x - body.position.x) / colliderDt, -14, 14),
      Core.clamp((target.y - body.position.y) / colliderDt, -14, 14),
      Core.clamp((target.z - body.position.z) / colliderDt, -14, 14)
    );
    body.position.copy(target);
    body.wakeUp();
  });
  applyPose.lastAt = now;

  const stringPositions = strings.geometry.attributes.position;
  const stringTargets = [p.leftWrist, p.rightWrist, p.leftShoulder, p.rightShoulder, p.nose];
  stringTargets.forEach((point, index) => {
    stringPositions.setXYZ(index * 2, point.x, 3.65, point.z);
    stringPositions.setXYZ(index * 2 + 1, point.x, point.y, point.z);
  });
  stringPositions.needsUpdate = true;
}

const kitten = new THREE.Group();
kitten.visible = false;
scene.add(kitten);
const catTorso = makeSphere(0.32, 0x8b6a49, 1.5, 0.75, 0.78);
const catHead = makeSphere(0.24, 0x9a7652, 1, 0.92, 0.92);
catHead.position.set(0.39, 0.12, 0);
kitten.add(catTorso, catHead);
for (const side of [-1, 1]) {
  const ear = makeCone(0.09, 0.22, 0x8b6a49);
  ear.position.set(0.39 + side * 0.12, 0.34, 0);
  kitten.add(ear);
}
for (let i = -2; i <= 2; i += 1) {
  const stripe = boxMesh([0.045, 0.38, 0.48], 0x3b2c23);
  stripe.rotation.z = Math.PI / 2;
  stripe.position.set(i * 0.16 - 0.06, 0.07, 0);
  kitten.add(stripe);
}
const catEyes = [];
for (const z of [-0.09, 0.09]) {
  const eye = makeSphere(0.048, 0x220000, 0.6, 1, 0.45);
  eye.material = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 8, roughness: 0.25 });
  eye.position.set(0.595, 0.16, z);
  catHead.add(eye);
  catEyes.push(eye);
}
const catTail = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.055, 10, 24, Math.PI * 1.35), material(0x6f5138));
catTail.rotation.x = Math.PI / 2;
catTail.position.set(-0.38, 0.2, 0);
kitten.add(catTail);
const halo = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 10, 32), new THREE.MeshBasicMaterial({ color: PALETTE.yellow }));
halo.rotation.x = Math.PI / 2;
halo.position.set(0.39, 0.62, 0);
halo.visible = false;
kitten.add(halo);
const catLight = new THREE.PointLight(0xff0000, 0, 3.8, 2);
kitten.add(catLight);
catLight.position.set(0.55, 0.18, 0);

const catBody = new CANNON.Body({ mass: 2.2, material: propMaterial, shape: new CANNON.Sphere(0.34), linearDamping: 0.08, angularDamping: 0.16 });
catBody.position.set(1.2, 0.45, -2.4);
catBody.collisionResponse = true;
world.addBody(catBody);
catBody.collisionFilterMask = 0;

const binsky = { active: false, startedAt: 0, cuteUntil: 0, impulseAt: 0, take: 0 };

async function playBinskyAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!playBinskyAudio.context) playBinskyAudio.context = new AudioContextClass();
    const context = playBinskyAudio.context;
    if (window.MadridStationAPI && window.MadridStationAPI.state.sound_enabled !== true) return; await context.resume();
    if (!playBinskyAudio.buffer) {
      const response = await fetch("static/playhouse/binsky-audio.m4a");
      playBinskyAudio.buffer = await context.decodeAudioData(await response.arrayBuffer());
    }
    const takes = [{ offset: 0.25, duration: 1.15 }, { offset: 4.85, duration: 1.2 }, { offset: 7.60, duration: 1.65 }];
    const take = takes[binsky.take++ % takes.length];
    const source = context.createBufferSource();
    source.buffer = playBinskyAudio.buffer;
    source.detune.value = -80 + (binsky.take % 3) * 55;
    const pre = context.createGain();
    pre.gain.value = 7.5;
    const shaper = context.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i += 1) {
      const x = i / (curve.length - 1) * 2 - 1;
      curve[i] = Math.max(-0.7, Math.min(0.7, Math.round(x * 7) / 7));
    }
    shaper.curve = curve;
    shaper.oversample = "2x";
    const dry = context.createGain();
    dry.gain.value = 0.78;
    const delay = context.createDelay(1.2);
    delay.delayTime.value = 0.215;
    const feedback = context.createGain();
    feedback.gain.value = 0.48;
    const wet = context.createGain();
    wet.gain.value = 0.42;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 4;
    limiter.ratio.value = 18;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.16;
    source.connect(pre).connect(shaper);
    shaper.connect(dry).connect(limiter);
    shaper.connect(delay).connect(wet).connect(limiter);
    delay.connect(feedback).connect(delay);
    limiter.connect(context.destination);
    source.start(0, take.offset, take.duration);
  } catch (error) {
    console.warn("Binsky audio unavailable", error);
  }
}

function playAngelChime() {
  try {
    const context = playBinskyAudio.context;
    if (!context) return;
    [880, 1174.66, 1567.98].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, context.currentTime + index * 0.08);
      gain.gain.linearRampToValueAtTime(0.085, context.currentTime + index * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 1.1 + index * 0.08);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + index * 0.08);
      oscillator.stop(context.currentTime + 1.2 + index * 0.08);
    });
  } catch (_) {}
}

function triggerBinsky() {
  if (!game.active || binsky.active) return;
  claimProgrammingControl();
  binsky.active = true;
  binsky.startedAt = performance.now();
  binsky.cuteUntil = 0;
  binsky.impulseAt = 0;
  binskyCharge = 0;
  nextBinskyAt = Math.max(nextBinskyAt, score + 18000);
  kitten.visible = true;
  halo.visible = false;
  catEyes.forEach((eye) => { eye.visible = true; });
  catLight.intensity = 22;
  catBody.collisionFilterMask = -1;
  catBody.position.set((Math.random() - 0.5) * 2.4, 0.62, -0.8);
  catBody.velocity.set((Math.random() - 0.5) * 5, 4.8, (Math.random() - 0.5) * 4);
  layer.classList.add("is-binsky");
  instructionEl.textContent = "BINSKY MODE / EVIL SIGNAL DETECTED";
  makeCallout("BINSKY", "MODE", new THREE.Vector3(0, 2.45, -0.2), true);
  playBinskyAudio();
}

function finishBinsky() {
  binsky.active = false;
  binsky.cuteUntil = performance.now() + 12000;
  layer.classList.remove("is-binsky");
  catEyes.forEach((eye) => { eye.visible = false; });
  catLight.intensity = 0;
  halo.visible = true;
  catBody.collisionFilterMask = 0;
  catBody.velocity.set(0, 0, 0);
  catBody.angularVelocity.set(0, 0, 0);
  nextBinskyAt = score + 18000;
  instructionEl.textContent = game.running ? "BINSKY IS AN ANGEL AGAIN" : "ROUND COMPLETE";
  playAngelChime();
}

function updateBinsky(now) {
  if (binsky.active) {
    const elapsed = (now - binsky.startedAt) / 1000;
    if (elapsed >= Core.BINSKY_SECONDS) {
      finishBinsky();
      return;
    }
    if (Math.abs(catBody.position.x) > 3.8 || catBody.position.z > 1.75 ||
        catBody.position.z < -4.2 || catBody.position.y > 3.4 || catBody.position.y < -0.25) {
      catBody.position.set((Math.random() - 0.5) * 2.2, 0.65, -0.7);
      catBody.velocity.set((Math.random() - 0.5) * 4, 4.2, (Math.random() - 0.5) * 4);
    }
    if (now >= binsky.impulseAt) {
      binsky.impulseAt = now + 420;
      catBody.velocity.set(
        -catBody.position.x * 1.25 + (Math.random() - 0.5) * 7,
        3.2 + Math.random() * 4.8,
        (-0.7 - catBody.position.z) * 1.1 + (Math.random() - 0.5) * 7
      );
      catBody.angularVelocity.set(Math.random() * 12, Math.random() * 14, Math.random() * 12);
      breakableProps.forEach((body, index) => {
        if ((index + Math.floor(now / 400)) % 5 !== 0) return;
        const dx = body.position.x - catBody.position.x;
        const dz = body.position.z - catBody.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 2.9) {
          const power = Math.max(1, 3.2 - dist) * (1.2 + Math.random() * 2.4);
          body.applyImpulse(new CANNON.Vec3(dx * power, power * 1.5, dz * power));
          body.wakeUp();
        }
      });
    }
    kitten.rotation.set(Math.sin(now * 0.018) * 0.35, now * 0.012, Math.cos(now * 0.021) * 0.4);
  } else if (binsky.cuteUntil > now) {
    catBody.position.set(2.75, 0.34, -3.0);
    kitten.rotation.set(0, -0.7, 0);
    kitten.scale.set(1, 0.72, 1);
    halo.rotation.z = now * 0.001;
  } else if (binsky.cuteUntil) {
    kitten.visible = false;
    kitten.scale.set(1, 1, 1);
    binsky.cuteUntil = 0;
  }
  kitten.position.copy(catBody.position);
}

const callouts = [];
function makeCallout(number, label, position, huge = false) {
  const c = document.createElement("canvas");
  c.width = huge ? 1024 : 512;
  c.height = huge ? 512 : 256;
  const ctx = c.getContext("2d");
  ctx.fillStyle = huge ? "#d92323" : "#ff4f00";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = huge ? 30 : 18;
  ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
  ctx.fillStyle = "#f5c400";
  ctx.font = `900 ${huge ? 170 : 100}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(number, c.width / 2, c.height * 0.43);
  ctx.fillStyle = "#111111";
  ctx.font = `900 ${huge ? 68 : 38}px monospace`;
  ctx.fillText(label, c.width / 2, c.height * 0.76);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(huge ? 4.8 : 2.2, huge ? 2.4 : 1.1, 1);
  sprite.position.copy(position);
  sprite.renderOrder = 500;
  scene.add(sprite);
  callouts.push({ sprite, texture, born: performance.now(), huge });
}

function updateCallouts(now) {
  for (let i = callouts.length - 1; i >= 0; i -= 1) {
    const item = callouts[i];
    const age = (now - item.born) / 1000;
    item.sprite.position.y += 0.012;
    item.sprite.material.opacity = Math.max(0, 1 - Math.max(0, age - 0.75) / 0.5);
    item.sprite.scale.multiplyScalar(1 + 0.005 * Math.max(0, 0.4 - age));
    if (age > 1.28) {
      scene.remove(item.sprite);
      item.sprite.material.dispose();
      item.texture.dispose();
      callouts.splice(i, 1);
    }
  }
}

const game = {
  active: false,
  running: false,
  ended: false,
  startedAt: 0,
  lastFrame: performance.now(),
  lastPosePoll: 0,
  lastCommandId: null,
  pose: null,
  poseFresh: false,
  personSince: 0,
  cameraShake: 0
};

function updateHud() {
  scoreEl.textContent = String(Math.max(0, Math.round(score))).padStart(6, "0");
  comboEl.textContent = "COMBO ×" + String(combo).padStart(2, "0");
  const denominator = Math.max(1, nextBinskyAt - (nextBinskyAt > 2600 ? 3200 : 0));
  const progress = binsky.active ? 1 : Math.min(1, binskyCharge / denominator);
  binskyFillEl.style.transform = "scaleX(" + progress.toFixed(3) + ")";
}

function startRound() {
  if (!game.active) return;
  claimProgrammingControl();
  score = 0;
  combo = 1;
  comboDeadline = 0;
  nextBinskyAt = 2600;
  binskyCharge = 0;
  game.running = true;
  game.ended = false;
  game.startedAt = performance.now();
  resultsEl.classList.remove("is-shown");
  instructionEl.textContent = game.poseFresh ? "MOVE MARLIN / MAKE THE BIGGEST MESS" : "DEMO BODY ACTIVE / KINECT CALIBRATING";
  updateHud();
}

function resetRound() {
  if (binsky.active) finishBinsky();
  game.running = false;
  game.ended = false;
  score = 0;
  combo = 1;
  nextBinskyAt = 2600;
  binskyCharge = 0;
  syncObjects.forEach(({ body, initialPosition, initialQuaternion }) => {
    body.position.copy(initialPosition);
    body.quaternion.copy(initialQuaternion);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.wakeUp();
  });
  resultsEl.classList.remove("is-shown");
  instructionEl.textContent = "STEP INTO FRAME / HOLD STILL TO ENTER";
  timeEl.textContent = Core.formatTime(Core.ROUND_SECONDS);
  updateHud();
}

function endRound() {
  game.running = false;
  game.ended = true;
  timeEl.textContent = "00:00";
  rankEl.textContent = Core.rankForScore(score);
  finalScoreEl.textContent = String(Math.round(score)).padStart(6, "0");
  resultsEl.classList.add("is-shown");
  instructionEl.textContent = "PROPERTY INSPECTION COMPLETE";
  makeCallout(String(Math.round(score)), Core.rankForScore(score), new THREE.Vector3(0, 2.0, -0.4), true);
}

async function pollKinect(now) {
  if (!game.active || now - game.lastPosePoll < 110) return;
  game.lastPosePoll = now;
  try {
    const response = await fetch("/api/kinect", { cache: "no-store" });
    const data = await response.json();
    const people = Number(data.people || (data.joints ? 1 : 0));
    game.poseFresh = Boolean(data.available && data.fresh && people > 0 && data.joints);
    if (game.poseFresh) {
      const mapped = {};
      JOINTS.forEach((name) => {
        if (data.joints[name]) mapped[name] = Core.mapJoint(data.joints[name], 0.8);
      });
      game.pose = mapped;
      sensorEl.textContent = "KINECT: BODY LOCK";
      sensorEl.classList.add("is-live");
      if (!game.personSince) game.personSince = now;
      if (!game.running && !game.ended && now - game.personSince > 1500) startRound();
    } else {
      game.pose = null;
      game.personSince = 0;
      sensorEl.textContent = data.available ? "KINECT: FINDING BODY" : "KINECT: DEMO INPUT";
      sensorEl.classList.remove("is-live");
    }
  } catch (_) {
    game.poseFresh = false;
    game.pose = null;
    game.personSince = 0;
    sensorEl.textContent = "KINECT: DEMO INPUT";
    sensorEl.classList.remove("is-live");
  }
}

function updateGameClock(now) {
  if (!game.running) return;
  const remaining = Core.ROUND_SECONDS - (now - game.startedAt) / 1000;
  timeEl.textContent = Core.formatTime(remaining);
  if (remaining <= 0) endRound();
  if (now > comboDeadline && combo !== 1) {
    combo = 1;
    updateHud();
  }
}

function updateCamera(now) {
  const head = smoothPose.nose || new THREE.Vector3(0, 2.3, 1.1);
  const parallax = new THREE.Vector3(head.x * 0.24, (head.y - 2.2) * 0.13, (head.z - 1.1) * 0.18);
  const crash = game.cameraShake;
  if (game.cameraShake > 0.001) game.cameraShake *= 0.9;
  const targetPosition = baseCamera.clone().add(parallax).add(new THREE.Vector3(
    (Math.random() - 0.5) * crash,
    (Math.random() - 0.5) * crash,
    -crash * 0.5
  ));
  camera.position.lerp(targetPosition, 0.09);
  camera.lookAt(head.x * 0.08, 1.32 + (head.y - 2.2) * 0.04, -1.2);
  camera.fov += ((binsky.active ? 52 : 58) - camera.fov) * 0.08;
  camera.updateProjectionMatrix();
}

function render(now) {
  requestAnimationFrame(render);
  const dt = Math.min(0.034, Math.max(0.001, (now - game.lastFrame) / 1000));
  game.lastFrame = now;
  pollKinect(now);
  if (!game.active) return;
  const pose = game.poseFresh && game.pose ? game.pose : fallbackPose(now);
  applyPose(pose, now);
  world.step(1 / 60, dt, 3);
  syncObjects.forEach(({ mesh, body }) => {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  });
  updateGameClock(now);
  updateBinsky(now);
  updateCallouts(now);
  updateCamera(now);
  effect.render(scene, camera);
}

function resize() {
  const width = Math.max(1, canvas.clientWidth || window.innerWidth);
  const height = Math.max(1, canvas.clientHeight || window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function handleCommand(state) {
  const surface = state && state.surfaces && state.surfaces.playhouse;
  if (!surface) return;
  const id = Number(surface.command_id || 0);
  if (game.lastCommandId === null) {
    game.lastCommandId = id;
    return;
  }
  if (!id || id === game.lastCommandId) return;
  game.lastCommandId = id;
  if (surface.command === "start") startRound();
  if (surface.command === "reset") resetRound();
  if (surface.command === "binsky") triggerBinsky();
  if (surface.command === "calibrate") {
    game.personSince = 0;
    instructionEl.textContent = "KINECT CALIBRATION / FACE THE SENSOR";
  }
}

// Marlin's captured body replaces the primitive puppet once it has loaded (marlin-puppet.mjs); the first visit loads it.
let marlinPuppet = null, marlinPuppetLoading = false;
function loadMarlinBody() {
  if (marlinPuppet || marlinPuppetLoading) return;
  marlinPuppetLoading = true;
  loadMarlinPuppet(new GLTFLoader(), "static/assets/marlin-jokes-brando-v3.glb").then((puppet) => {
    marlinPuppet = puppet; scene.add(puppet.object);
    Object.values(marlinParts).forEach((part) => { part.visible = false; });
    shoes.left.visible = false; shoes.right.visible = false;
  }).catch(() => { marlinPuppetLoading = false; });
}
function setActive(active, state) {
  if (active) loadMarlinBody();
  const wasActive = game.active;
  game.active = Boolean(active);
  handleCommand(state);
  const selected = state && state.programming && state.programming.selected;
  const scheduled = selected && selected.channel === "playhouse" &&
    selected.status === "scheduled";
  const presentation = scheduled ? selected.presentation || {} : {};
  if (game.active && programmingControl && scheduled) {
    resetRound();
    programmingControl = false;
  }
  if (game.active && !wasActive) {
    programmingControl = false;
    resize();
    instructionEl.textContent = game.ended ? "START AGAIN FROM THE REMOTE" :
      presentation.prompt || "STEP INTO FRAME / HOLD STILL TO ENTER";
  } else if (game.active && !programmingControl && !game.running) {
    if (presentation.prompt) instructionEl.textContent = presentation.prompt;
  }
  if (!game.active && wasActive) {
    programmingControl = false;
    layer.classList.remove("is-binsky");
  }
}

window.MadridPlayhouse = { setActive, startRound, resetRound, triggerBinsky };
requestAnimationFrame(render);
