import { buildFish } from './fish.js';

// Web edition: the subject is the procedural stand-in built in ./fish.js.
// It returns the loader's { scene, animations } shape, so the rest runs unchanged.
export async function createCharacter(THREE) {
  const asset = buildFish(THREE);
  const group = asset.scene;
  group.name = 'WebEditionFish';
  const mixer = new THREE.AnimationMixer(group);
  for (const clip of asset.animations) mixer.clipAction(clip).play();
  const textures = new Set(), materials = new Set(), geometries = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) {
        textures.add(value); value.anisotropy = 4;
      }
    }
  });
  let disposed = false;
  return {
    group,
    metadata: Object.freeze({ method: 'Procedural fish, web edition stand-in',
      reference: 'none',
      likeness: 'none', animatedClips: asset.animations.length,
      inferred: 'none' }),
    update(seconds) { if (!disposed) mixer.setTime(seconds % 30); },
    dispose() {
      if (disposed) return;
      disposed = true; mixer.stopAllAction(); mixer.uncacheRoot(group);
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
      for (const item of textures) item.dispose();
      group.removeFromParent();
    }
  };
}
