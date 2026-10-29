/* CH 12 owns one render loop and one local audio graph. No station routes. */
export function createLifecycle({ loadScene, requestFrame, cancelFrame, audio }) {
  let requested = false, visible = true, disposed = false, state = {};
  let scene = null, loading = null, frame = null, error = null;
  let seconds = 0, lastTime = null, frameCount = 0, view = 'scene', profile = 'reef';
  let roomSource = null, room = null, roomError = null;
  const active = () => requested && visible && !state.desktop_mode && !disposed;
  const volume = () => {
    if (!active() || !scene || state.muted || state.aquarium?.muted || room?.output === 'companion') return 0;
    const value = Number(state.aquarium?.volume ?? state.volume ?? 75);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) / 100 : 0;
  };
  function tick(timestamp) {
    frame = null;
    if (!active() || !scene) return;
    if (roomSource) {
      try {
        room = roomFrame(roomSource(timestamp));
        seconds = room.seconds;
        roomError = null;
      } catch (failure) {
        // A missing clock sample must not start a second, drifting simulation.
        // Keep the last shared frame while the transport reconnects.
        roomError = String(failure.message || failure);
        if (!room) { frame = requestFrame(tick); return; }
      }
      lastTime = null;
    } else {
      seconds += lastTime === null ? 0 : Math.min(0.05, Math.max(0, (timestamp - lastTime) / 1000));
      lastTime = timestamp;
    }
    try {
      scene.render(seconds, view, profile, room);
      audio.setLevel(volume());
      frameCount++;
      frame = requestFrame(tick);
    } catch (failure) {
      error = String(failure.message || failure);
      scene.dispose();
      scene = null;
      lastTime = null;
      audio.setLevel(0);
    }
  }
  function sync() {
    if (!active()) {
      if (frame !== null) cancelFrame(frame);
      frame = null;
      lastTime = null;
      audio.setLevel(0);
      return;
    }
    if (!scene && !loading && !error) {
      loading = Promise.resolve().then(loadScene).then(result => {
        if (disposed) result.dispose();
        else { scene = result; scene.resize(); }
      }).catch(failure => { error = String(failure.message || failure); }).finally(() => {
        loading = null;
        sync();
      });
    }
    if (scene && frame === null) frame = requestFrame(tick);
    audio.setLevel(volume());
  }
  return Object.freeze({
    setActive(value, nextState = {}) {
      if (disposed) return;
      if (value && !requested) error = null;
      requested = Boolean(value);
      state = nextState || {};
      sync();
    },
    setVisible(value) { visible = Boolean(value); sync(); },
    // The caller owns transport, clock estimation and output-delay compensation.
    // Each sample is one immutable room scene shared by all display crops.
    setRoomSource(source) {
      if (disposed) return;
      if (source !== null && typeof source !== 'function') throw new TypeError('Room source must be a function or null.');
      roomSource = source;
      if (!source) room = null;
      roomError = null;
      lastTime = null;
      sync();
    },
    setView(value) { view = value === 'portrait' ? 'portrait' : 'scene'; },
    setProfile(value) {
      profile = ['reef', 'feeding', 'drift', 'abyss'].includes(value) ? value : 'reef';
    },
    resize() { if (active() && scene) scene.resize(); },
    unlockAudio() { audio.unlock?.(); },
    diagnostics() {
      return Object.freeze({ active: active(), loading: Boolean(loading), ready: Boolean(scene),
        framePending: frame !== null, frames: frameCount, seconds, view, error, roomError,
        room: room && Object.freeze({ seconds: room.seconds, output: room.output, main: room.main,
          tv: [...room.tv], wall: [...room.wall],
          viewRect: [...(room.output === 'tv' ? room.tv : room.wall)],
          wallAspect: room.wallAspect, focus: { ...room.focus } }),
        audio: Object.freeze({ ...audio.diagnostics() }), ...(scene?.diagnostics() || {}) });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sync();
      scene?.dispose();
      scene = null;
      audio.dispose();
    }
  });
}

function roomFrame(value) {
  if (!value || !Number.isFinite(value.seconds) || value.seconds < 0) throw new Error('Waiting for a valid room clock.');
  const tv = value.tv;
  const wall = value.wall ?? [0, 0, 1, 1];
  for (const [label, rect] of [['TV', tv], ['wall', wall]]) {
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) ||
        rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > 1.000001 || rect[1] + rect[3] > 1.000001) {
      throw new Error(`Room ${label} bounds must fit within the scene.`);
    }
  }
  if (!['tv', 'companion'].includes(value.output) || !['tv', 'companion'].includes(value.main)) {
    throw new Error('Unknown room display role.');
  }
  const wallAspect = value.wallAspect ?? 16 / 9;
  if (!Number.isFinite(wallAspect) || wallAspect < 0.25 || wallAspect > 4) throw new Error('Invalid room wall aspect ratio.');
  const focus = value.focus || { x: tv[0] + tv[2] / 2, y: tv[1] + tv[3] / 2 };
  if (![focus.x, focus.y].every(Number.isFinite)) throw new Error('Invalid room focus.');
  return { seconds: value.seconds, tv: [...tv], wall: [...wall], output: value.output, main: value.main,
    wallAspect, focus: { x: Math.max(0, Math.min(1, focus.x)), y: Math.max(0, Math.min(1, focus.y)) } };
}

// Both outputs crop the exact same physical camera across the union of the
// projected wall and TV, including a TV outside the projection. Canvas resolution
// and refresh rate cannot change the shared camera or its physical scale.
export function configureAquariumCamera(camera, { width = 960, height = 720, view = 'scene', room = null, focusTarget = null, migrationTarget = null } = {}) {
  const portrait = !room && view === 'portrait';
  camera.clearViewOffset();
  camera.aspect = room ? room.wallAspect ?? 16 / 9 : width / height;
  camera.fov = portrait ? 30 : 43;
  camera.position.set(portrait ? 1.6 : 0, portrait ? 1.15 : 1, portrait ? 3.2 : 9);
  camera.lookAt(portrait ? 1.6 : 0, portrait ? 1.08 : 0.7, portrait ? 0.4 : 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const roomPoint = (target, x, y, depth) => {
    target.set(x * 2 - 1, 1 - y * 2, 0.5).unproject(camera);
    const distance = (depth - camera.position.z) / (target.z - camera.position.z);
    target.sub(camera.position).multiplyScalar(distance).add(camera.position);
  };
  if (focusTarget) {
    if (room) {
      const focus = room.focus || { x: room.tv[0] + room.tv[2] / 2, y: room.tv[1] + room.tv[3] / 2 };
      // A low, exterior TV looks into the foreground water. Bring the focal
      // subject forward along its screen ray so it cannot sink into the sand.
      const focusDepth = Math.min(5, 0.4 + Math.max(0, focus.y - 0.6) * 20);
      roomPoint(focusTarget, focus.x, focus.y, focusDepth);
    } else focusTarget.set(1.6, 0.2, 0.4);
  }
  if (migrationTarget) {
    migrationTarget.enabled = false;
    if (room) {
      const tv = room.tv, wall = room.wall ?? [0, 0, 1, 1];
      if (tv[0] < wall[0] || tv[1] < wall[1] || tv[0] + tv[2] > wall[0] + wall[2] || tv[1] + tv[3] > wall[1] + wall[3]) {
        // One foreground swim route joins the actual display areas. Derive it
        // before cropping; display roles and the moving focal subject never
        // steer fish. Depth keeps a low television's fish above the sand.
        roomPoint(migrationTarget.wall, wall[0] + wall[2] * .58, wall[1] + wall[3] * .52, 4.4);
        roomPoint(migrationTarget.tv, tv[0] + tv[2] * .5, tv[1] + tv[3] * .48, 4.4);
        migrationTarget.bend.copy(migrationTarget.wall).lerp(migrationTarget.tv, .5);
        if (tv[1] >= wall[1] + wall[3]) {
          // A lower TV is approached through the open wall's lower middle,
          // then the fish turn toward it through the unlit physical gap.
          roomPoint(migrationTarget.bend, wall[0] + wall[2] * .46, wall[1] + wall[3] * 1.02, 4.4);
        }
        migrationTarget.enabled = true;
      }
    }
  }
  if (room) {
    const fullWidth = 1600, fullHeight = fullWidth / camera.aspect;
    const [x, y, w, h] = room.output === 'tv' ? room.tv : room.wall ?? [0, 0, 1, 1];
    camera.setViewOffset(fullWidth, fullHeight, x * fullWidth, y * fullHeight, w * fullWidth, h * fullHeight);
  }
}

export function configureAquariumBackdrop(scene, environment, room, color) {
  scene.background.setHex(room ? 0x000000 : color);
  environment.setBackdropVisible(!room);
}

export function configureAquariumSubject(subject, bounds, camera, { room = null, focus, seconds = 0 } = {}) {
  subject.rotation.z = Math.sin(seconds * .22) * .018;
  subject.rotation.y = Math.sin(seconds * .15) * .035 - .07;
  subject.scale.setScalar(1);
  subject.position.set(0, 0, 0);
  if (room) {
    subject.updateMatrix();
    const inCamera = bounds.clone().applyMatrix4(camera.matrixWorldInverse.clone().multiply(subject.matrix));
    const size = inCamera.getSize(subject.position.clone());
    const distance = -focus.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const height = 2 * Math.tan(camera.fov * Math.PI / 360) * room.tv[3] * .72;
    const width = 2 * Math.tan(camera.fov * Math.PI / 360) * room.wallAspect * room.tv[2] * .8;
    // Include the nearest depth of the real animated bounds in the fit. The TV
    // aperture sets one shared apparent size even while focus moves to the wall.
    const scale = Math.min(height * distance / (size.y + height * size.z / 2),
      width * distance / (size.x + width * size.z / 2));
    subject.scale.setScalar(scale);
    bounds.getCenter(subject.position).applyQuaternion(subject.quaternion).multiplyScalar(-scale);
  }
  subject.position.add(focus);
  subject.position.x += Math.sin(seconds * .19) * .055 * subject.scale.x;
  subject.position.y += Math.sin(seconds * .3) * .045 * subject.scale.x;
}

export function createOceanAudio({ Context = globalThis.AudioContext || globalThis.webkitAudioContext,
  schedule = globalThis.setTimeout, unschedule = globalThis.clearTimeout } = {}) {
  let context = null, master = null, level = 0, timer = null, transition = null;
  let disposed = false, blocked = false, error = null;
  const sources = [];
  const MAX_GAIN = 0.055;
  function build() {
    context = new Context();
    master = context.createGain(); master.gain.value = 0; master.connect(context.destination);
    const buffer = context.createBuffer(1, context.sampleRate * 12, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < samples.length; i++) {
      brown = (brown + (Math.random() * 2 - 1) * 0.025) / 1.025;
      samples[i] = brown * 2.8;
    }
    // Crossfade the loop seam so the wash stays continuous.
    const seam = Math.floor(context.sampleRate * 0.08);
    for (let i = 0; i < seam; i++) samples[samples.length - seam + i] =
      samples[samples.length - seam + i] * (1 - i / seam) + samples[i] * (i / seam);
    const noise = context.createBufferSource(); noise.buffer = buffer; noise.loop = true;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 690;
    const swell = context.createGain(); swell.gain.value = 0.64;
    noise.connect(filter); filter.connect(swell); swell.connect(master);
    const lfo = context.createOscillator(); lfo.frequency.value = 0.075;
    const depth = context.createGain(); depth.gain.value = 0.22;
    lfo.connect(depth); depth.connect(swell.gain);
    const bubbles = context.createBiquadFilter(); bubbles.type = 'bandpass';
    bubbles.frequency.value = 420; bubbles.Q.value = 2.5;
    const bubbleGain = context.createGain(); bubbleGain.gain.value = 0.025;
    noise.connect(bubbles); bubbles.connect(bubbleGain); bubbleGain.connect(master);
    const drift = context.createOscillator(); drift.frequency.value = 0.13;
    const driftDepth = context.createGain(); driftDepth.gain.value = 180;
    drift.connect(driftDepth); driftDepth.connect(bubbles.frequency);
    sources.push(noise, lfo, drift);
    sources.forEach(source => source.start());
  }
  function ramp(target, duration) {
    if (!master) return;
    const gain = master.gain, time = context.currentTime;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(time);
    else { gain.cancelScheduledValues(time); gain.setValueAtTime(gain.value, time); }
    gain.linearRampToValueAtTime(target, time + duration);
  }
  function resume() {
    if (!context || disposed || !level || transition) return;
    blocked = false;
    transition = Promise.resolve(context.resume()).then(() => {
      blocked = context.state !== 'running';
      // Resume may complete after channel exit: keep the graph silent and suspend again.
      if (!level || disposed) {
        ramp(0, 0);
        return context.state !== 'closed' ? context.suspend() : undefined;
      }
      ramp(level * MAX_GAIN, 1.4);
    }).catch(failure => { blocked = true; error = String(failure.message || failure); }).finally(() => {
      transition = null;
      // Re-entry while a previous suspend was in flight must recover without another station poll.
      if (!disposed && level && !blocked && context.state === 'suspended') resume();
    });
  }
  return Object.freeze({
    setLevel(value) {
      if (disposed) return;
      const next = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      if (next === level) return;
      level = next;
      if (timer !== null) { unschedule(timer); timer = null; }
      if (level && !context && Context) {
        try { build(); } catch (failure) { error = String(failure.message || failure); }
      }
      if (!context || !master) return;
      if (level) {
        if (context.state === 'running' && !transition) ramp(level * MAX_GAIN, 1.4);
        else resume();
      } else {
        ramp(0, 0.12);
        timer = schedule(() => {
          timer = null;
          if (level || disposed || transition || context.state === 'closed') return;
          transition = Promise.resolve(context.suspend()).catch(failure => {
            error = String(failure.message || failure);
          }).finally(() => { transition = null; if (level && !disposed) resume(); });
        }, 150);
      }
    },
    unlock() { if (level) resume(); },
    diagnostics() { return { state: context?.state || 'uninitialized', level, targetGain: level * MAX_GAIN,
      maximumGain: MAX_GAIN, blocked, error }; },
    dispose() {
      if (disposed) return;
      disposed = true; level = 0;
      if (timer !== null) unschedule(timer);
      ramp(0, 0);
      sources.forEach(source => { try { source.stop(); source.disconnect(); } catch (_) {} });
      if (context && context.state !== 'closed') context.close().catch(() => {});
    }
  });
}

async function buildScene(canvas) {
  const [THREE, { createEnvironment }, { createCharacter }] = await Promise.all([
    import('../vendor/three/three.module.js'), import('./environment.js?v=20261003room5'), import('./character.js')
  ]);
  let renderer, environment, character, reflection;
  const scene = new THREE.Scene();
  const suspension = new THREE.Group();
  function dispose() {
    environment?.dispose(); character?.dispose(); reflection?.dispose();
    scene.traverse(item => { if (item.shadow) item.shadow.dispose(); });
    suspension.traverse(item => {
      if (item.userData.hook) { item.geometry?.dispose(); item.material?.dispose(); }
    });
    renderer?.dispose();
  }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    scene.background = new THREE.Color(0x082d32);
    scene.fog = new THREE.FogExp2(0x082d32, 0.038);
    scene.add(new THREE.HemisphereLight(0xcadce0, 0x303b29, 0.53));
    const key = new THREE.DirectionalLight(0xfff4e4, 3.5); key.position.set(-2, 7, 1);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 3; key.shadow.intensity = 0.62;
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 22 });
    key.shadow.bias = -0.00015; key.shadow.normalBias = 0.02;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb7d8d9, 0.35); fill.position.set(4, 2, 5); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xd0e7bb, 1.15); rim.position.set(-3, 5, -4); scene.add(rim);
    // Tiny local studio environment gives the polished metal broad reflected highlights.
    const studio = new THREE.Scene(); studio.background = new THREE.Color(0x3c6970);
    for (const [x, y, z, color] of [[-3, 5, 1, 0xcff9ea], [4, 2, 3, 0x719492], [0, -4, 0, 0x232c25]]) {
      const panel = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8), new THREE.MeshBasicMaterial({ color }));
      panel.position.set(x, y, z); studio.add(panel);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    reflection = pmrem.fromScene(studio, 0.025, 0.1, 30);
    scene.environment = reflection.texture; scene.environmentIntensity = 0.48; pmrem.dispose();
    studio.traverse(item => { item.geometry?.dispose(); item.material?.dispose(); });
    environment = createEnvironment(THREE, scene);
    character = await createCharacter(THREE);
    suspension.add(character.group);
    const metal = new THREE.MeshStandardMaterial({ color: 0xc1d4d4, metalness: 0.94, roughness: 0.19, envMapIntensity: 1.6 });
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.58, 2.2, -0.12), new THREE.Vector3(-0.58, 0.8, -0.12),
      new THREE.Vector3(-0.53, 0.03, -0.12), new THREE.Vector3(-0.3, -0.2, -0.08),
      new THREE.Vector3(0.08, -0.23, -0.05), new THREE.Vector3(0.4, -0.09, -0.04),
      new THREE.Vector3(0.52, 0.22, -0.04)
    ]);
    const hook = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.068, 12, false), metal);
    hook.castShadow = true; hook.receiveShadow = true; hook.userData.hook = true; suspension.add(hook);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.069, 0.28, 12), metal.clone());
    tip.position.set(0.52, 0.34, -0.04); tip.userData.hook = true; suspension.add(tip);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.039, 8, 24), metal.clone());
    eye.position.set(-0.58, 2.31, -0.12); eye.userData.hook = true; suspension.add(eye);
    const subjectBounds = new THREE.Box3();
    for (let second = 0; second < 30; second += .5) {
      character.update(second);
      subjectBounds.expandByObject(suspension);
    }
    character.update(0);
    // The hanging line intentionally leaves the frame; it must not shrink the
    // seated subject and hook when their complete visible bounds are fitted.
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 7, 6),
      new THREE.MeshStandardMaterial({ color: 0xa6cbc5, transparent: true, opacity: 0.6, roughness: 0.45 }));
    line.position.set(-0.58, 5.92, -0.12); line.userData.hook = true; suspension.add(line);
    suspension.position.set(1.6, 0.2, 0.4); scene.add(suspension);
    const camera = new THREE.PerspectiveCamera(43, 4 / 3, 0.1, 60);
    const focusPoint = new THREE.Vector3();
    const migration = { wall: new THREE.Vector3(), bend: new THREE.Vector3(), tv: new THREE.Vector3(), enabled: false };
    let width = 0, height = 0;
    function resize() {
      // offset/client sizes preserve logical 4:3 under the TV's anamorphic CSS transform.
      const w = Math.max(1, canvas.clientWidth || 960), h = Math.max(1, canvas.clientHeight || 720);
      if (w === width && h === height) return;
      width = w; height = h; renderer.setSize(w, h, false);
    }
    return {
      resize,
      render(seconds, view, profile, room = null) {
        if (renderer.getContext().isContextLost()) throw new Error('WebGL context lost; re-enter the channel after recovery.');
        resize();
        const settings = {
          reef: { speed: 1, exposure: 0.95, color: 0x082d32, fog: 0.038 },
          feeding: { speed: 1.15, exposure: 1.05, color: 0x123a35, fog: 0.034 },
          drift: { speed: 0.62, exposure: 0.78, color: 0x092630, fog: 0.045 },
          abyss: { speed: 0.34, exposure: 0.48, color: 0x020b17, fog: 0.062 }
        }[profile] || { speed: 1, exposure: 0.95, color: 0x082d32, fog: 0.038 };
        const motionTime = seconds * settings.speed;
        renderer.toneMappingExposure = settings.exposure;
        configureAquariumBackdrop(scene, environment, room, settings.color);
        scene.fog.color.setHex(settings.color);
        scene.fog.density = settings.fog;
        configureAquariumCamera(camera, { width, height, view, room, focusTarget: focusPoint, migrationTarget: migration });
        configureAquariumSubject(suspension, subjectBounds, camera, { room, focus: focusPoint, seconds: motionTime });
        environment.update(motionTime, migration.enabled ? migration : null); character.update(motionTime);
        renderer.render(scene, camera);
      },
      diagnostics: () => ({ width, height, drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures, character: character.metadata || null }),
      dispose
    };
  } catch (failure) { dispose(); throw failure; }
}

export function createAquarium(canvas) {
  return createLifecycle({ loadScene: () => buildScene(canvas), audio: createOceanAudio(),
    requestFrame: callback => globalThis.requestAnimationFrame(callback),
    cancelFrame: handle => globalThis.cancelAnimationFrame(handle) });
}
