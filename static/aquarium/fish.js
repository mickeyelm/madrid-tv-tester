/* CH 12 web edition: the stand-in subject. Builds a procedural clownfish caught
 * on the hook tip (runtime.js places the tip at 0.52, 0.34..0.48, -0.04) and
 * returns the shape character.js consumes: { scene, animations }. */
export function buildFish(THREE) {
  const mat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.04 }, extra));
  const orange = mat(0xf0661a);
  const white = mat(0xf7f2e8, { roughness: 0.65 });
  const dark = mat(0x16110d, { roughness: 0.35 });
  const fin = mat(0xffa14a, { roughness: 0.7, transparent: true, opacity: 0.75, side: THREE.DoubleSide });

  const fish = new THREE.Group(); fish.name = 'fish';
  // A sphere whose poles point along +x (the length), so latitude bands are body stripes.
  // Mouth at the group origin, tail toward +x.
  const along = (geometry, material) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.z = -Math.PI / 2;
    mesh.scale.set(0.2, 0.36, 0.13); // height, length, width
    mesh.position.x = 0.36;
    return mesh;
  };
  fish.add(along(new THREE.SphereGeometry(1, 32, 20), orange));
  for (const [theta, width] of [[2.35, 0.17], [1.5, 0.22], [0.75, 0.17]]) {
    fish.add(along(new THREE.SphereGeometry(1.012, 32, 6, 0, Math.PI * 2, theta - width / 2, width), white));
  }
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), white);
    eye.position.set(0.1, 0.05, side * 0.08);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 6), dark);
    pupil.position.set(0.09, 0.05, side * 0.102);
    fish.add(eye, pupil);
    const pectoral = new THREE.CircleGeometry(0.08, 10); pectoral.translate(0.08, 0, 0);
    const flap = new THREE.Mesh(pectoral, fin);
    flap.name = side < 0 ? 'finL' : 'finR';
    flap.scale.set(1.5, 0.75, 1);
    flap.position.set(0.22, -0.03, side * 0.115);
    flap.rotation.set(0, side * 0.9, -0.45);
    fish.add(flap);
  }
  const outline = points => new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))), fin);
  fish.add(outline([[0.2, 0.14], [0.28, 0.28], [0.4, 0.3], [0.52, 0.22], [0.58, 0.14]]));
  const tail = new THREE.Group(); tail.name = 'tail'; tail.position.x = 0.7;
  tail.add(outline([[0, 0], [0.17, 0.17], [0.25, 0.14], [0.13, 0], [0.25, -0.14], [0.17, -0.17]]));
  fish.add(tail);

  // Hooked by the mouth, rising up and to the left over the hook's bend, tail toward the camera.
  fish.position.set(0.56, 0.52, -0.04);
  fish.scale.setScalar(1.1);
  const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 2.2));
  fish.quaternion.copy(base);

  const quaternions = (name, period, steps, angles) => {
    const times = [], values = [], q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i <= steps; i++) {
      const t = period * i / steps; times.push(t);
      const [x, y, z, pre] = angles(t / period);
      q.setFromEuler(e.set(x, y, z)); if (pre) q.premultiply(pre);
      values.push(q.x, q.y, q.z, q.w);
    }
    return new THREE.QuaternionKeyframeTrack(name + '.quaternion', times, values);
  };
  const TAU = Math.PI * 2;
  const wobble = quaternions('fish', 2.4, 12, u => [Math.sin(u * TAU) * 0.09, Math.sin(u * TAU * 2) * 0.12, 0, base]);
  const wag = quaternions('tail', 1.2, 8, u => [0, Math.sin(u * TAU) * 0.5, 0, null]);
  const flapTimes = [0, 0.4, 0.8];
  const fins = [
    new THREE.NumberKeyframeTrack('finL.rotation[y]', flapTimes, [-0.6, -1.2, -0.6]),
    new THREE.NumberKeyframeTrack('finR.rotation[y]', flapTimes, [0.6, 1.2, 0.6])
  ];
  const scene = new THREE.Group(); scene.add(fish);
  return {
    scene,
    animations: [
      new THREE.AnimationClip('wobble', 2.4, [wobble]),
      new THREE.AnimationClip('wag', 1.2, [wag]),
      new THREE.AnimationClip('fins', 0.8, fins)
    ]
  };
}
