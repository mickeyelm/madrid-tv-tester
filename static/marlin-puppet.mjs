// CH 15: Marlin's captured body (marlin-jokes-brando-v3.glb, the photographed paint-and-fabric
// puppet, the station's own rig) in place of the primitive puppet. Forward kinematics on the
// rig's own skeleton: every frame starts from the rest pose, the model is scaled to the body's
// torso and set on its hips, then each bone, parents first, turns from where it points to the
// body segment it stands for. The body is the Playhouse's 13 smoothed points (webcam, Kinect or
// the demo dance), in Playhouse world space.
import * as THREE from "three";

const CHAIN = [
  // bone, the bone it points at, body point it starts from, body point it reaches for
  ["pelvis", "torso", "hips", "shoulders"],
  ["torso", "neck", "hips", "shoulders"],
  ["neck", "head", "shoulders", "nose"],
  ["upper_arm.L", "forearm.L", "leftShoulder", "leftElbow"],
  ["forearm.L", "hand.L", "leftElbow", "leftWrist"],
  ["upper_arm.R", "forearm.R", "rightShoulder", "rightElbow"],
  ["forearm.R", "hand.R", "rightElbow", "rightWrist"],
  ["thigh.L", "shin.L", "leftHip", "leftKnee"],
  ["shin.L", "foot.L", "leftKnee", "leftAnkle"],
  ["thigh.R", "shin.R", "rightHip", "rightKnee"],
  ["shin.R", "foot.R", "rightKnee", "rightAnkle"]
];

export async function loadMarlinPuppet(loader, url) {
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  const bones = new Map(), rest = new Map();
  model.traverse((o) => {
    if (o.isBone) { const name = o.name.replace(/([LR])$/, ".$1"); bones.set(name, o); rest.set(name, o.quaternion.clone()); }
    if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; }
  });
  for (const [bone, child] of CHAIN) { if (!bones.get(bone) || !bones.get(child)) { throw new Error("rig is missing " + bone + " or " + child); } }
  const holder = new THREE.Group();
  holder.add(model);
  holder.updateMatrixWorld(true);
  const at = (name) => bones.get(name).getWorldPosition(new THREE.Vector3());
  const feet = () => at("foot.L").add(at("foot.R")).multiplyScalar(0.5);
  const restHeight = at("head").distanceTo(feet());
  // Which of the rig's sides is "left" in Playhouse terms: the body's left shoulder sits at -x.
  const swap = at("upper_arm.L").x > at("upper_arm.R").x;
  const side = (name) => (swap ? name.replace(/\.L$/, ".X").replace(/\.R$/, ".L").replace(/\.X$/, ".R") : name);

  const from = new THREE.Vector3(), to = new THREE.Vector3(), here = new THREE.Vector3(), there = new THREE.Vector3();
  const turn = new THREE.Quaternion(), world = new THREE.Quaternion(), parentWorld = new THREE.Quaternion();
  let scale = 1;
  const pelvisAt = new THREE.Vector3();
  function update(p) {
    const point = {
      hips: p.leftHip.clone().add(p.rightHip).multiplyScalar(0.5),
      shoulders: p.leftShoulder.clone().add(p.rightShoulder).multiplyScalar(0.5),
      ankles: p.leftAnkle.clone().add(p.rightAnkle).multiplyScalar(0.5)
    };
    const get = (name) => point[name] || p[name];
    for (const [name, q] of rest) { bones.get(name).quaternion.copy(q); }
    // ponytail: one uniform scale, head to feet, so the feet reach the floor; Marlin keeps his puppet
    // proportions (short legs, big head) instead of stretching each limb to the body's.
    scale += ((p.nose.distanceTo(point.ankles) / restHeight) - scale) * 0.2;
    holder.scale.setScalar(scale);
    holder.position.set(0, 0, 0);
    holder.updateMatrixWorld(true);
    pelvisAt.copy(at("pelvis"));                               // measured before the holder moves
    holder.position.copy(point.hips).sub(pelvisAt);
    holder.updateMatrixWorld(true);
    for (const [boneName, childName, a, b] of CHAIN) {
      const bone = bones.get(side(boneName)), child = bones.get(side(childName));
      bone.getWorldPosition(here); child.getWorldPosition(there);
      from.copy(there).sub(here).normalize();
      to.copy(get(b)).sub(get(a));
      if (to.lengthSq() < 1e-8 || from.lengthSq() < 1e-8) { continue; }
      to.normalize();
      turn.setFromUnitVectors(from, to);
      bone.getWorldQuaternion(world);
      world.premultiply(turn);
      bone.parent.getWorldQuaternion(parentWorld);
      bone.quaternion.copy(parentWorld.invert().multiply(world));
      bone.updateMatrixWorld(true);
    }
  }
  function dispose() {
    model.traverse((o) => {
      if (o.geometry) { o.geometry.dispose(); }
      for (const m of [].concat(o.material || [])) { for (const v of Object.values(m)) { if (v && v.isTexture) { v.dispose(); } } m.dispose(); }
    });
    holder.removeFromParent();
  }
  return { object: holder, update, dispose };
}
