// A planted, freshwater aquascape. Coordinates are metres; the runtime owns light,
// camera and time. All variation is seeded so preview evidence is reproducible.
export function createEnvironment(THREE, scene) {
  const root = new THREE.Group();
  root.name = 'aquarium_environment';
  scene.add(root);
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const clock = { value: 0 };
  let seed = 120904, disposed = false;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
  const geo = g => (geometries.add(g), g);
  const mat = m => (materials.add(m), m);
  const named = (object,name) => {object.name=name;return object;};
  let meshSequence=0;
  const color = new THREE.Color();
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const mix = (a, b, t) => a + (b - a) * t;
  const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
  const groundY=(x,z)=>-2.02+.033*Math.sin(z*10+Math.sin(x*1.6))
    +.065*Math.sin(x*.6+z*.4)+.24*Math.exp(-((x+3.5)**2+(z+2)**2)/5);
  function noise(x, y) {
    const hash = (a,b) => {const n=Math.sin(a*127.1+b*311.7)*43758.5453;return n-Math.floor(n);};
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
    return mix(mix(hash(ix,iy),hash(ix+1,iy),u),mix(hash(ix,iy+1),hash(ix+1,iy+1),u),v);
  }

  function texture(size, sample, repeat = 1) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = sample(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      data[i] = clamp(c[0], 0, 255); data[i + 1] = clamp(c[1], 0, 255);
      data[i + 2] = clamp(c[2], 0, 255); data[i + 3] = c[3] ?? 255;
    }
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.needsUpdate = true;
    textures.add(t); return t;
  }
  // Real CC0 surface scans ship locally. Procedural maps keep the geometry test
  // independent of a DOM; browser asset failures are reported explicitly.
  function scan(filename, fallback, repeatX=1, repeatY=repeatX, srgb=true) {
    if(typeof document==='undefined')return fallback;
    const t=new THREE.TextureLoader().load(new URL('./assets/environment/'+filename,import.meta.url).href,
      loaded=>{if(disposed)loaded.image=null;},undefined,
      ()=>console.warn('Aquarium surface texture unavailable: '+filename));
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeatX,repeatY);
    t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.anisotropy=4;
    textures.add(t);return t;
  }

  // Caustics are projected in world space on the actual shaded surfaces. They
  // travel across stones, leaves and fish rather than floating on a flat overlay.
  function surface(options, motion = '') {
    const m = mat(new THREE.MeshStandardMaterial(options));
    if(motion.includes('aqPectoral'))m.userData.aquariumMotion='fin';
    else if(motion.includes('aqTail'))m.userData.aquariumMotion='fish';
    else if(motion.includes('aqH'))m.userData.aquariumMotion='plant';
    m.onBeforeCompile = shader => {
      shader.uniforms.aqTime = clock;
      shader.vertexShader = 'uniform float aqTime; varying vec3 aqWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        ${motion}
      `).replace('#include <worldpos_vertex>', `
        #include <worldpos_vertex>
        vec4 aqP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          aqP = instanceMatrix * aqP;
        #endif
        aqWorld = (modelMatrix * aqP).xyz;
      `);
      shader.fragmentShader = `uniform float aqTime; varying vec3 aqWorld;
        float aqCaustic(vec2 p) {
          p += .24 * vec2(sin(p.y * 1.9 + aqTime * .17), cos(p.x * 1.5 - aqTime * .13));
          float a = sin(p.x * 4.1 + sin(p.y * 3.3 + aqTime * .18));
          float b = sin(p.y * 4.8 + cos(p.x * 2.7 - aqTime * .15));
          return pow(max(0.0, 1.0 - abs(a + b) * 1.8), 8.0);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float aqLight = aqCaustic(aqWorld.xz * .72 + aqWorld.y * .16);
        float aqDepthLight = smoothstep(-2.2, 4.5, aqWorld.y);
        outgoingLight *= mix(vec3(.91, .97, .96), vec3(1.0), aqDepthLight);
        outgoingLight *= .96 + aqLight * (.15 + aqDepthLight * .12);
        #include <opaque_fragment>
      `);
    };
    m.customProgramCacheKey = () => 'aquarium-caustic-v2:' + motion;
    return m;
  }
  function mesh(g, m, parent = root) {
    const o = new THREE.Mesh(g, m); o.name=(m.name||'aquarium_surface')+'_'+String(++meshSequence).padStart(3,'0');
    if(!g.name)g.name=o.name+'_geometry';
    o.receiveShadow=true; parent.add(o); return o;
  }
  function merge(parts) {
    const positions = [], normals = [], uvs = [];
    for (const { geometry, matrix } of parts) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      if (matrix) g.applyMatrix4(matrix);
      positions.push(...g.attributes.position.array);
      normals.push(...g.attributes.normal.array);
      if (g.attributes.uv) uvs.push(...g.attributes.uv.array);
      else uvs.push(...new Float32Array(g.attributes.position.count * 2));
      g.dispose();
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return g;
  }
  const transform = new THREE.Object3D();
  function matrix(x, y, z, sx = 1, sy = sx, sz = sx) {
    transform.position.set(x, y, z); transform.rotation.set(0, 0, 0);
    transform.scale.set(sx, sy, sz); transform.updateMatrix(); return transform.matrix.clone();
  }

  const sandMap = texture(512, (u, v) => {
    const grain = (random() - .5) * 49;
    const ripple = Math.sin(v * 130 + Math.sin(u * 24) * 1.4) * 5;
    const speck = random() < .015 ? -50 : 0;
    return [165 + grain + ripple + speck, 151 + grain + ripple + speck, 114 + grain + ripple + speck];
  }, 24);
  sandMap.repeat.y = 40;
  const sand = geo(new THREE.PlaneGeometry(50, 80, 110, 130));
  sand.rotateX(-Math.PI / 2);
  sand.translate(0, 0, -20);
  const sp = sand.attributes.position, sandColors=[];
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), z = sp.getZ(i);
    sp.setY(i,groundY(x,z));
    // Static ambient occlusion grounds the two stone islands without a large
    // shadow map or an extra transparent draw beneath every pebble.
    const shade=1-.38*Math.exp(-((x+3.65)**2/2.1+(z+1.8)**2/3.4))
      -.35*Math.exp(-((x-4.25)**2/1.5+(z+2.2)**2/2.6));
    sandColors.push(shade,shade,shade);
  }
  sand.setAttribute('color',new THREE.Float32BufferAttribute(sandColors,3));
  sand.computeVertexNormals();
  const sandDiffuse=scan('sand_01_diff_1k.jpg',sandMap,24,40);
  const sandNormal=scan('sand_01_nor_gl_1k.jpg',null,24,40,false);
  const sandRough=scan('sand_01_rough_1k.jpg',null,24,40,false);
  const shoreMap=scan('coast_sand_rocks_02_diff_1k.jpg',sandMap);
  const sandMaterial=surface({name:'substrate_sand_material',map:sandDiffuse,normalMap:sandNormal,normalScale:new THREE.Vector2(.6,.6),
    roughnessMap:sandRough,roughness:.94,vertexColors:true,color:0xeee3c7});
  sandMaterial.userData.aquariumScans={
    map:{filename:'sand_01_diff_1k.jpg',repeat:[24,40]},
    normalMap:{filename:'sand_01_nor_gl_1k.jpg',repeat:[24,40]},
    roughnessMap:{filename:'sand_01_rough_1k.jpg',repeat:[24,40]},
    bankMap:{filename:'coast_sand_rocks_02_diff_1k.jpg',repeat:[1,1],worldScale:.23}
  };
  const sandCompile=sandMaterial.onBeforeCompile;
  sandMaterial.onBeforeCompile=shader=>{
    sandCompile(shader);shader.uniforms.aqShore={value:shoreMap};
    shader.fragmentShader='uniform sampler2D aqShore;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      #include <map_fragment>
      float aqBank = smoothstep(1.5,3.4,abs(aqWorld.x + sin(aqWorld.z*.5)*.45));
      vec3 aqBed = texture2D(aqShore, aqWorld.xz*.23).rgb;
      diffuseColor.rgb = mix(diffuseColor.rgb,aqBed,aqBank*.84);
    `);
  };
  sandMaterial.customProgramCacheKey=()=> 'aquarium-sand-scan-v2';
  named(mesh(sand,sandMaterial),'substrate_sand_and_planted_banks');

  const rockMap = texture(256, (u, v) => {
    const mineral = noise(u*12,v*12)*22+noise(u*47,v*47)*17+noise(u*111,v*111)*10;
    const vein = Math.pow(clamp(1-Math.abs(noise(u*7,v*7)-.48)*34),3)*14;
    const grain = (random() - .5) * 23;
    return [58 + mineral + vein + grain, 62 + mineral + vein + grain, 52 + mineral + vein + grain];
  }, 2);
  const rockMat = surface({ name:'stone_weathered_strata_material',map:scan('rock_face_03_diff_1k.jpg',rockMap,1.6),
    normalMap:scan('rock_face_03_nor_gl_1k.jpg',null,1.6,1.6,false),normalScale:new THREE.Vector2(.85,.85),
    roughnessMap:scan('rock_face_03_rough_1k.jpg',null,1.6,1.6,false),roughness:.83,vertexColors:true });
  rockMat.userData.aquariumScans={
    map:{filename:'rock_face_03_diff_1k.jpg',repeat:[1.6,1.6]},
    normalMap:{filename:'rock_face_03_nor_gl_1k.jpg',repeat:[1.6,1.6]},
    roughnessMap:{filename:'rock_face_03_rough_1k.jpg',repeat:[1.6,1.6]}
  };
  function rock(x, y, z, sx, sy, sz, phase) {
    const g = geo(new THREE.IcosahedronGeometry(1, 7));
    const p = g.attributes.position, colors = [];
    for (let i = 0; i < p.count; i++) {
      const a = p.getX(i), b = p.getY(i), c = p.getZ(i);
      const bedding=b+a*.23-c*.12;
      const cleft=Math.pow(Math.max(0,-Math.sin(bedding*16+phase)),7)*.05;
      const r = 1 + .075 * Math.sin(a * 5 + b * 3 + phase) * Math.cos(c * 6 + a * 2)
        + .022 * Math.sin(a * 17 + c * 9 + phase)-cleft;
      // A coherent tilted bedding direction and broad worn planes replace the
      // unrelated high-frequency bumps that made the earlier stones spiky.
      const wornX=mix(a,clamp(a,-.79+.035*Math.sin(phase),.83+.04*Math.cos(phase)),.82);
      const wornZ=mix(c,clamp(c,-.82,.80+.05*Math.sin(phase)),.72);
      const ledge=1+.035*Math.sin(bedding*13+phase)-cleft;
      p.setXYZ(i,wornX*r*ledge,Math.min(.84+Math.sin(phase)*.055,b)*r+.035*a,wornZ*r*ledge);
      const algae = clamp((b - .1) * .55 + .22 * Math.sin(a * 13 + c * 7));
      color.setRGB(mix(.83, .43, algae), mix(.87, .59, algae), mix(.79, .33, algae));
      colors.push(color.r, color.g, color.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    // Smooth the duplicate vertices at triangle boundaries while retaining the
    // eroded silhouette. Flat face normals make natural stone read as cut paper.
    const normal = g.attributes.normal, shared = new Map();
    const vertexKey = i => [p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(',');
    for(let i=0;i<p.count;i++) {
      const key=vertexKey(i), sum=shared.get(key)||new THREE.Vector3();
      sum.add(new THREE.Vector3().fromBufferAttribute(normal,i));shared.set(key,sum);
    }
    for(let i=0;i<p.count;i++) {const n=shared.get(vertexKey(i)).normalize();normal.setXYZ(i,n.x,n.y,n.z);}
    const o = named(mesh(g, rockMat),'stone_strata_'+String(Math.round(phase/1.87)+1).padStart(2,'0'));
    o.position.set(x, y, z); o.scale.set(sx, sy, sz);
    o.castShadow=true;
    o.rotation.set(.11 * Math.sin(phase), phase, .16 * Math.cos(phase));
  }
  [
    [-3.75,-1.10,-2.15,1.35,1.25,.95],[-2.55,-1.05,-2.75,.85,1.1,.9],
    [-4.15,-.48,-3.45,1.05,1.95,.95],[-3.15,-1.5,-.75,1.1,.55,.75],
    [-1.96,-1.55,-2.2,.7,.55,.7],[-4.8,-1.2,-.15,.9,.87,.8],
    [4.2,-1.12,-2.8,1.1,1.04,.9],[4.9,-.8,-3.8,1.0,1.45,.85],
    [3.65,-1.64,-1.55,.72,.4,.65],[4.7,-1.7,.1,.75,.42,.65],
    [-1.15,-1.84,-2.1,.32,.2,.3],[2.5,-1.87,-3.3,.42,.2,.29],
    [-2.65,-1.57,-.8,.74,.14,.46],[-2.18,-1.72,-.45,.46,.10,.34],
    [3.24,-1.79,-1.2,.44,.12,.32]
  ].forEach((r, i) => rock(...r, i * 1.87));

  // Small river gravel is one draw call, with per-stone mineral colors.
  const gravel = new THREE.InstancedMesh(geo(new THREE.IcosahedronGeometry(1, 1)),
    surface({ name:'substrate_river_gravel_material',color: 0x8d9078, roughness: .94 }), 180);
  gravel.name='substrate_river_gravel_instances';
  root.add(gravel);
  for (let i = 0; i < 180; i++) {
    const x = (random() - .5) * 12, z = (random() - .5) * 10;
    const s = .018 + random() ** 3 * .105;
    gravel.setMatrixAt(i, matrix(x,groundY(x,z)+s*.18,z,s*1.5,s*.6,s));
    color.setHSL(.11 + random() * .08, .1 + random() * .17, .22 + random() * .29);
    gravel.setColorAt(i, color);
  }

  const grit=new THREE.InstancedMesh(geo(new THREE.IcosahedronGeometry(1,0)),
    surface({name:'substrate_fine_mineral_grains_material',color:0xc7b894,roughness:.92}),1800);
  grit.name='substrate_fine_mineral_grains';root.add(grit);grit.receiveShadow=true;
  for(let i=0;i<1800;i++) {
    const x=(random()-.5)*11,z=-3+random()*7,s=.006+random()**2*.022;
    grit.setMatrixAt(i,matrix(x,groundY(x,z)+s*.2,z,s,s*.58,s*1.3));
    color.setHSL(.075+random()*.10,.15+random()*.22,.25+random()*.46);grit.setColorAt(i,color);
  }

  // One merged branching object gives a recognisable waterlogged root crown:
  // thick eroded limbs split into tapered roots that settle onto the substrate.
  const bark=texture(512,(u,v)=>{
    const grain=noise(u*120+noise(u*12,v*9)*4,v*6)*35;
    const fissure=Math.pow(Math.max(0,Math.sin(u*220+noise(u*18,v*7)*6)),18)*38;
    const weather=noise(u*9,v*14)*24;
    return [72+grain+weather-fissure,46+grain*.58+weather*.63-fissure*.75,25+grain*.33+weather*.43-fissure*.4];
  });
  bark.name='driftwood_procedural_fissured_bark';
  const woodMat=surface({name:'driftwood_waterlogged_bark_material',map:bark,bumpMap:bark,bumpScale:.032,
    roughness:.71,vertexColors:true});
  woodMat.userData.aquariumProcedural='Longitudinal grain, fissures and weathering; actual DataTexture pixels exportable.';
  const woodParts=[];
  function limb(points,radius,tip,phase) {
    const path=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'centripetal');
    const segments=30,sides=10,frames=path.computeFrenetFrames(segments,false),p=[],uv=[],index=[];
    for(let j=0;j<=segments;j++) {
      const t=j/segments,centre=path.getPointAt(t);
      const knot=1+.15*Math.sin(t*12+phase)*Math.sin(t*Math.PI)+.28*Math.exp(-(((t-.28)*11)**2));
      const r=mix(radius,tip,Math.pow(t,.78))*knot;
      for(let k=0;k<=sides;k++) {
        const a=k/sides*Math.PI*2;
        const wrinkle=1+.075*Math.sin(a*5+t*7+phase)+.032*Math.sin(a*11-t*19);
        const radial=frames.normals[j].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[j],Math.sin(a));
        const v=centre.clone().addScaledVector(radial,r*wrinkle);p.push(v.x,v.y,v.z);uv.push(k/sides,t*2.2);
        if(j<segments&&k<sides){const n=j*(sides+1)+k;index.push(n,n+1,n+sides+1,n+1,n+sides+2,n+sides+1);}
      }
    }
    const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();woodParts.push({geometry:g});
  }
  limb([[-3.8,-1.65,-1.35],[-3.35,-.85,-1.6],[-2.72,-.04,-2],[-2.12,.55,-2.2],[-1.32,.82,-2.45]],.28,.032,0);
  limb([[-3.3,-.72,-1.65],[-3.15,.03,-1.95],[-3.43,.75,-2.15],[-3.18,1.21,-2.5]],.16,.016,2);
  limb([[-2.65,.08,-2.02],[-2.30,.12,-1.55],[-1.88,.32,-1.24],[-1.36,.22,-.98]],.12,.012,4);
  limb([[-2.10,.57,-2.2],[-1.76,.98,-2.52],[-1.84,1.31,-2.78]],.065,.008,6);
  limb([[-2.26,.14,-1.55],[-2.02,.59,-1.54],[-1.82,.71,-1.72]],.058,.006,7);
  limb([[-3.38,.66,-2.13],[-3.65,.95,-1.98],[-3.88,.98,-1.8]],.062,.007,8);
  limb([[-3.75,-1.57,-1.35],[-3.14,-1.52,-.84],[-2.67,-1.83,-.21],[-2.05,-1.98,.23]],.18,.016,8);
  limb([[-3.76,-1.6,-1.34],[-4.02,-1.69,-.70],[-4.21,-1.87,-.14],[-4.62,groundY(-4.62,.32),.32]],.16,.012,9);
  limb([[-3.7,-1.54,-1.40],[-3.60,-1.20,-2.02],[-3.00,-1.45,-2.67],[-2.34,-1.91,-3.12]],.14,.014,10);
  for(let i=0;i<12;i++) {
    const a=i*.49,x=-3.68+Math.cos(a)*.17,z=-1.40+Math.sin(a)*.17;
    const endX=x+Math.cos(a)*(.6+random()*.6),endZ=z+Math.sin(a)*(.65+random()*.6);
    limb([[x,-1.65,z],[mix(x,endX,.55),-1.75,mix(z,endZ,.55)],[endX,groundY(endX,endZ)+.018,endZ]],.025+random()*.025,.002,i);
  }
  const woodGeo=merge(woodParts),woodColors=[];
  for(let i=0;i<woodGeo.attributes.position.count;i++) {
    const y=woodGeo.attributes.position.getY(i),light=.69+clamp((y+1.8)*.21)*.31;
    woodColors.push(light,light*.96,light*.88);
  }
  woodGeo.setAttribute('color',new THREE.Float32BufferAttribute(woodColors,3));
  const wood=named(mesh(woodGeo,woodMat),'driftwood_branching_root_crown');wood.castShadow=true;

  const leafMap = texture(256, (u, v) => {
    const midrib = Math.exp(-(((u - .5) * 95) ** 2));
    const vein = Math.pow(Math.max(0, Math.cos(v * 150 - Math.abs(u - .5) * 45)), 17);
    const shade = Math.sin(u * Math.PI) * 16 + random() * 12;
    return [45 + shade + midrib * 45 + vein * 15, 92 + shade + midrib * 29 + vein * 21, 26 + shade * .25 + vein * 5];
  });
  const sway = `
    float aqH = max(0.0, position.y);
    float aqPhase = 0.0;
    #ifdef USE_INSTANCING
      aqPhase = instanceMatrix[3].x * 1.9 + instanceMatrix[3].z * .8;
    #endif
    transformed.x += sin(aqTime * .53 + aqPhase + aqH * .9) * aqH * aqH * .032;
    transformed.z += cos(aqTime * .39 + aqPhase + aqH * .8) * aqH * aqH * .022;
  `;
  const plantDepth=mat(new THREE.MeshDepthMaterial({name:'plants_animated_shadow_material',depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide}));
  plantDepth.userData.aquariumMotion='plant';
  plantDepth.onBeforeCompile=shader=>{
    shader.uniforms.aqTime=clock;
    shader.vertexShader='uniform float aqTime;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+sway);
  };
  plantDepth.customProgramCacheKey=()=> 'aquarium-swaying-plant-shadow-v1';
  const leafMat = surface({ name:'plants_ribbon_and_sword_leaf_material',map: leafMap,bumpMap:leafMap,bumpScale:.006,side: THREE.DoubleSide, roughness: .48, metalness: .03,
    emissive: 0x3e5714, emissiveIntensity: .12 }, sway);
  function leafGeometry(height, width, bend, broad, segments=18) {
    const p = [], uv = [], indices = [];
    for (let j = 0; j <= segments; j++) {
      const t = j / segments, w = width * Math.pow(Math.sin(t * Math.PI), broad ? .8 : .48);
      for (let k = 0; k <= 4; k++) {
        const s = k / 4, edge = (s - .5) * 2;
        const twist=.45*Math.sin(t*2.7)+t*.20,margin=1+(broad?.08:.025)*Math.sin(t*35);
        p.push(edge*w*Math.cos(twist)*margin+Math.sin(t*Math.PI)*height*.026,
          t*height-Math.abs(edge)*.025*Math.sin(t*Math.PI),
          t*t*bend+edge*w*Math.sin(twist)+edge*edge*w*.27+Math.sin(t*13)*edge*w*.045);
        uv.push(s, t);
        if (j < segments && k < 4) {
          const a = j * 5 + k;
          indices.push(a, a + 1, a + 5, a + 1, a + 6, a + 5);
        }
      }
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(indices); g.computeVertexNormals(); return g;
  }
  function plantBed(g, count, centres, low = false, name='plants') {
    const leaves = new THREE.InstancedMesh(g, leafMat, count); root.add(leaves);
    leaves.name=name;
    leaves.receiveShadow=true;
    if(name!=='plants_dwarf_hairgrass'){leaves.castShadow=true;leaves.customDepthMaterial=plantDepth;}
    const perRosette=low?9:7,rosettes=Array.from({length:Math.ceil(count/perRosette)},(_,i)=>{
      const c=centres[i%centres.length];return {x:c[0]+(random()-.5)*c[2],z:c[1]+(random()-.5)*.8,angle:random()*6.28};
    });
    for (let i = 0; i < count; i++) {
      const c=rosettes[Math.floor(i/perRosette)],age=(i%perRosette)/(perRosette-1),s=.43+age*.61+random()*.20;
      transform.position.set(c.x,groundY(c.x,c.z)-.02,c.z);
      transform.rotation.set(low?.15+age*.62:.04+age*.16,c.angle+(i%perRosette)*2.399,.08*Math.sin(i));
      transform.scale.set(s, s, s); transform.updateMatrix(); leaves.setMatrixAt(i, transform.matrix);
      color.setHSL(.20 + random() * .07, .15 + random() * .18, .65 + random() * .22);
      leaves.setColorAt(i, color);
    }
    // GPU displacement can move tips past the static bound.
    leaves.frustumCulled = false;
  }
  plantBed(leafGeometry(3.6, .068, .5, false), 160, [[-4.6,-4.3,2],[-3,-4.6,1.5],[4.7,-4,1.5],[3.5,-4.8,1.2]],false,'plants_vallisneria_clusters');
  plantBed(leafGeometry(1.15, .16, .65, true), 190, [[-3.8,-.55,1.5],[-2.6,-2.3,1.1],[4.0,-1.8,1.2],[-4.7,1,1.4]],true,'plants_cryptocoryne_rosettes');
  plantBed(leafGeometry(.52, .026, .14, false), 300, [[-4,1.35,2],[4.8,1.1,1.7],[-1.8,-2.5,1.3],[3.8,-3.2,1.4]],true,'plants_dwarf_hairgrass');

  // Stem plants give the planting several recognisable habits: paired oval
  // Bacopa leaves and copper-red Ludwigia tips among the taller Vallisneria.
  const smallLeaf=leafGeometry(.29,.085,.12,true,7),bushParts=[];
  const stemLeafMap=texture(256,(u,v)=>{
    const rib=Math.exp(-((u-.5)**2)*3400)*30;
    const vein=Math.pow(Math.max(0,Math.cos(v*110-Math.abs(u-.5)*35)),18)*24;
    const value=145+Math.sin(u*Math.PI)*50+rib+vein+random()*10;
    return [value,value,value];
  });
  for(let j=0;j<8;j++)for(let side=0;side<2;side++) {
    const h=.15+j*.14;
    transform.position.set(Math.sin(h*3)*.04,h,0);
    transform.rotation.set(0,j*1.13+side*Math.PI,.85);
    const s=1-j*.044;transform.scale.set(s,s,s);transform.updateMatrix();
    bushParts.push({geometry:smallLeaf,matrix:transform.matrix.clone()});
  }
  const stem=geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,0,0),new THREE.Vector3(.035,.5,0),new THREE.Vector3(-.03,1.25,.02)]),9,.012,4,false));
  bushParts.push({geometry:stem});const bush=merge(bushParts);
  for(const [tint,centres,count] of [
    [0xa8d450,[[-2.2,-2.7,1.3],[-4.4,.15,1.1],[3.5,-3,1.2]],40],
    [0xc55d32,[[-1.9,-2.6,.9],[4.2,-.65,1.1],[-3.3,-3,.5,-.55]],32],
    [0x718f22,[[-1.8,-2.2,.9],[3.2,-2.5,.8]],22]
  ]) {
    const speciesName=tint===0xc55d32?'ludwigia_copper':tint===0xa8d450?'bacopa_lime':'hygrophila_olive';
    const m=surface({name:'plants_'+speciesName+'_material',map:stemLeafMap,bumpMap:stemLeafMap,bumpScale:.004,color:tint,side:THREE.DoubleSide,roughness:.43,
      emissive:tint,emissiveIntensity:.075},sway);
    const plants=new THREE.InstancedMesh(bush,m,count);plants.frustumCulled=false;plants.receiveShadow=true;root.add(plants);
    plants.name='plants_'+speciesName+'_stems';
    plants.castShadow=true;plants.customDepthMaterial=plantDepth;
    for(let i=0;i<count;i++) {
      const c=centres[i%centres.length],s=.65+random()*.75;
      const x=c[0]+(random()-.5)*c[2],z=c[1]+(random()-.5)*.75;
      transform.position.set(x,c[3]??groundY(x,z)-.015,z);
      transform.rotation.set((random()-.5)*.3,random()*6.28,(random()-.5)*.2);
      transform.scale.set(s,s,s);transform.updateMatrix();plants.setMatrixAt(i,transform.matrix);
    }
  }
  // Fine divided leaves break up the broad ribbons at the front of each island.
  const featherPositions=[],featherUV=[],featherIndices=[];
  for(let j=1;j<=13;j++)for(const side of [-1,1]) {
    const t=j/14, y=t*.9, w=Math.sin(t*Math.PI)*.26, n=featherPositions.length/3;
    featherPositions.push(0,y,0,side*w,y+.10,.05*t,side*w*.83,y+.145,.07*t,0,y+.018,0);
    featherUV.push(.5,t,0,t+.05,1,t+.05,.5,t+.02);
    featherIndices.push(n,n+1,n+2,n,n+2,n+3);
  }
  const feather=geo(new THREE.BufferGeometry());
  feather.setAttribute('position',new THREE.Float32BufferAttribute(featherPositions,3));
  feather.setAttribute('uv',new THREE.Float32BufferAttribute(featherUV,2));
  feather.setIndex(featherIndices);feather.computeVertexNormals();
  const fernMat=surface({name:'plants_divided_frond_material',map:stemLeafMap,color:0x809d28,emissive:0x4e671a,emissiveIntensity:.07,
    side:THREE.DoubleSide,roughness:.48},sway);
  const fronds=new THREE.InstancedMesh(feather,fernMat,170);root.add(fronds);fronds.frustumCulled=false;
  fronds.name='plants_divided_fern_fronds';
  for(let i=0;i<170;i++) {
    const c=[[-2.7,-.3],[-4.6,1.5],[3.75,-.55],[4.8,.8]][i%4];
    const x=c[0]+(random()-.5)*1.0,z=c[1]+(random()-.5)*.55;
    transform.position.set(x,groundY(x,z)-.015,z);
    transform.rotation.set((random()-.5)*1.0,random()*6.28,(random()-.5)*1.7);
    const s=.65+random()*.7;transform.scale.set(s,s,s);transform.updateMatrix();fronds.setMatrixAt(i,transform.matrix);
  }

  const fishMotion = `
    float aqTail = 1.0 - smoothstep(-.72, .16, position.x);
    float aqSwimPhase = modelMatrix[3].x * .8 + modelMatrix[3].z * .4;
    float aqGlide = .72 + .28 * sin(aqTime * .43 + aqSwimPhase);
    transformed.z += sin(aqTime * 4.6 + position.x * 4.5 + aqSwimPhase) * aqTail * aqTail * .10 * aqGlide;
    transformed.z += sin(aqTime * 4.6 + position.x * 2.1 + aqSwimPhase) * aqTail * .012;
  `;
  const finMotion = fishMotion + `
    float aqPectoral = smoothstep(.14, .34, abs(position.z));
    transformed.y += sin(aqTime * 3.1 + position.z * 8.0) * aqPectoral * .045;
    transformed.z += sin(aqTime * 4.2 + position.x * 8.0) * max(0.0, abs(position.y) - .26) * .12;
  `;
  // Sculpted elliptical cross sections: narrow caudal peduncle, full shoulder,
  // tapered forehead and lip. Each species shares geometry within its school.
  function fishBody(depth) {
    const profiles = [[-.70,.025,.025],[-.55,.055,.043],[-.38,.18,.09],[-.1,.31,.15],[.15,.33,.18],[.35,.265,.16],[.51,.17,.115],[.62,.066,.06],[.655,.024,.024]];
    const profile = new THREE.CatmullRomCurve3(profiles.map(p=>new THREE.Vector3(...p)),false,'centripetal');
    const rings=48;
    const p = [], uv = [], index = [];
    for (let i = 0; i <= rings; i++) {
      const section=profile.getPoint(i/rings), x=section.x,h=section.y,w=section.z;
      for (let j = 0; j <= 32; j++) {
        const a = j / 32 * Math.PI * 2;
        p.push(x, Math.cos(a) * h * depth, Math.sin(a) * w);
        uv.push((x + .70) / 1.355, j / 32);
        if (i < rings && j < 32) {
          const n = i * 33 + j;
          index.push(n,n+1,n+33,n+1,n+34,n+33);
        }
      }
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(p,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(index); g.computeVertexNormals(); return g;
  }
  function finGeometry(depth) {
    const p = [], uv = [], ix = [];
    const fans = [
      [[-.58,0,0],[[-1.03,.32,0],[-.93,.18,0],[-.83,0,0],[-.93,-.18,0],[-1.03,-.32,0]]],
      [[.24,.21*depth,0],[[.19,.43*depth,0],[-.08,.56*depth,0],[-.34,.46*depth,0],[-.52,.12*depth,0]]],
      [[.12,-.18*depth,0],[[.02,-.39*depth,0],[-.29,-.43*depth,0],[-.49,-.1*depth,0]]],
      [[.27,-.018,.155],[[.19,-.035,.23],[.12,-.073,.255],[.035,-.095,.25],[-.025,-.073,.222],[.015,-.025,.185],[.11,-.012,.164]]],
      [[.27,-.018,-.155],[[.19,-.035,-.23],[.12,-.073,-.255],[.035,-.095,-.25],[-.025,-.073,-.222],[.015,-.025,-.185],[.11,-.012,-.164]]]
    ];
    // Eight subdivisions along every ray give the fins a soft membrane curve.
    for (const [fanIndex,[origin,edge]] of fans.entries()) {
      const base = p.length / 3;
      for (let r = 0; r <= 8; r++) for (let k = 0; k < edge.length; k++) {
        const t = r / 8;
        p.push(mix(origin[0],edge[k][0],t),mix(origin[1],edge[k][1],t),mix(origin[2],edge[k][2],t) + Math.sin(t*Math.PI)*.018);
        // Two bands in one membrane atlas: visible tail/dorsal silhouettes and
        // lighter pectoral fans, without another material or draw per fish.
        uv.push(k/(edge.length-1),(fanIndex>=3?.5:0)+t*.49);
        if (r < 8 && k < edge.length - 1) {
          const a = base + r * edge.length + k;
          ix.push(a,a+1,a+edge.length,a+1,a+edge.length+1,a+edge.length);
        }
      }
    }
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(ix); g.computeVertexNormals(); return g;
  }
  const finMap = texture(256, (u,v) => {
    const pectoral=v>=.5,radial=(v%.5)*2;
    const ray=Math.pow(Math.max(0,Math.cos(u*120+radial*2)),12);
    const edge=Math.pow(Math.sin(u*Math.PI),.16)*(1-radial*.12);
    return [203+ray*48,186+ray*54,139+ray*75,Math.round(((pectoral?.14:.36)+ray*(pectoral?.34:.50))*edge*255)];
  });
  const eyeBase = geo(new THREE.SphereGeometry(1, 12, 8));
  const iris = merge([{geometry:eyeBase,matrix:matrix(.48,.086,.109,.044,.048,.022)}, {geometry:eyeBase,matrix:matrix(.48,.086,-.109,.044,.048,.022)}]);
  const pupils = merge([{geometry:eyeBase,matrix:matrix(.487,.088,.128,.024,.029,.01)}, {geometry:eyeBase,matrix:matrix(.487,.088,-.128,.024,.029,.01)}]);
  const irisMat = surface({name:'fish_iris_material',color:0xbebf85,metalness:.42,roughness:.28});
  const pupilMat = surface({name:'fish_pupil_material',color:0x050e10,metalness:.1,roughness:.16});
  const gillParts = [];
  for (const side of [-1,1]) {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(.315,.20,side*.109),new THREE.Vector3(.28,.08,side*.175),
      new THREE.Vector3(.28,-.09,side*.157),new THREE.Vector3(.34,-.18,side*.1)
    ]);
    gillParts.push({geometry:geo(new THREE.TubeGeometry(path,12,.006,4,false))});
  }
  const mouthPath = new THREE.CatmullRomCurve3([new THREE.Vector3(.637,.006,-.035),new THREE.Vector3(.665,-.005,0),new THREE.Vector3(.637,.006,.035)]);
  gillParts.push({geometry:geo(new THREE.TubeGeometry(mouthPath,8,.005,4,false))});
  const gillGeo = merge(gillParts);
  const gillMat = surface({name:'fish_gill_and_mouth_material',color:0x4f6256,roughness:.55});
  const fish = [];
  const scaleRelief=texture(512,(u,v)=>{
    const row=Math.floor(v*30),su=(u*42+(row%2)*.5)%1,sv=(v*30)%1;
    const rim=Math.exp(-(((Math.hypot((su-.5)*1.1,sv-.2)-.51)*24)**2));
    const value=185-rim*55+Math.exp(-((su-.4)**2+(sv-.36)**2)*18)*22;
    return [value,value,value];
  });
  scaleRelief.colorSpace=THREE.NoColorSpace;scaleRelief.name='fish_individual_scale_relief';
  const species = [
    {base:[192,187,157],stripe:[60,49,21],depth:1,scale:.69,count:4},
    {base:[34,168,223],stripe:[11,59,84],depth:.76,scale:.53,count:5},
    {base:[236,133,42],stripe:[30,32,26],depth:.91,scale:.62,count:3}
  ];
  species.forEach((s, kind) => {
    const speciesName=['pearl_gourami','blue_rainbowfish','golden_barb'][kind];
    const bodyMap = texture(512,(u,v) => {
      const side = Math.abs(Math.sin(v*Math.PI*2));
      const belly = (1-Math.cos(v*Math.PI*2))*.5;
      const lateral=Math.min(Math.abs(v-.25),Math.abs(v-.75));
      const stripe = kind===0 ? Math.exp(-lateral*lateral*2500)*.45
        : Math.pow(Math.max(0,Math.cos(u*(kind===1?20:38)+.23*Math.sin(v*8))),9)*(kind===1?.18:.65);
      const row = Math.floor(v*30), su = (u*42+(row%2)*.5)%1, sv=(v*30)%1;
      const scaleEdge = Math.exp(-(((Math.hypot((su-.5)*1.1,sv-.2)-.51)*24)**2))*.21;
      const glint = Math.exp(-(((su-.34)*12)**2)-((sv-.34)*9)**2)*.13;
      const pearl=kind===0 ? Math.exp(-((su-.5)**2+(sv-.5)**2)*42)*.22 : 0;
      const shade = .64+side*.3+belly*.17-scaleEdge+glint+pearl;
      const pigment=kind===1?s.base.map((c,i)=>mix([245,137,26][i],c,smoothstep(.35,.62,u)))
        :kind===0?s.base.map((c,i)=>mix(c,[215,143,74][i],smoothstep(.72,1,belly)*.55)):s.base;
      return pigment.map((c,i)=>mix(c,s.stripe[i],stripe)*shade+(belly>.8?15:0)+(random()-.5)*6);
    });
    bodyMap.name='fish_'+speciesName+'_pigment_and_scales';
    const bodyMat = surface({name:'fish_'+speciesName+'_skin_material',map:bodyMap,bumpMap:scaleRelief,bumpScale:.007,roughness:.32,metalness:.08,envMapIntensity:.65},fishMotion);
    const finMat = surface({name:'fish_'+speciesName+'_fin_material',map:finMap,color:kind===1?0xffb836:0xffbb58,
      transparent:true,opacity:.86,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,roughness:.58,envMapIntensity:.2,alphaTest:.012},finMotion);
    const bodyGeo = fishBody(s.depth);let fins=finGeometry(s.depth);
    if(kind===0) {
      const parts=[{geometry:fins}];
      for(const side of [-1,1]) {
        const thread=geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
          new THREE.Vector3(.17,-.24,side*.07),new THREE.Vector3(.04,-.47,side*.09),
          new THREE.Vector3(-.22,-.61,side*.105),new THREE.Vector3(-.42,-.60,side*.10)]),15,.003,4,false));
        const threadUV=thread.attributes.uv;
        for(let k=0;k<threadUV.count;k++)threadUV.setY(k,threadUV.getY(k)*.49);
        parts.push({geometry:thread});
      }
      fins=merge(parts);
    }
    for (let i=0;i<s.count;i++) {
      const group = new THREE.Group(); root.add(group);
      group.name='fish_'+speciesName+'_'+String(i+1).padStart(2,'0');
      group.userData.aquariumSpecies=speciesName;
      group.userData.aquariumSchool=kind===0?'solitary':speciesName+'_shoal';
      mesh(bodyGeo,bodyMat,group).castShadow=true; mesh(fins,finMat,group);
      const e=mesh(iris,irisMat,group), p=mesh(pupils,pupilMat,group), g=mesh(gillGeo,gillMat,group);
      e.scale.y=p.scale.y=g.scale.y=s.depth;
      const scale=s.scale*(.8+random()*.32); group.scale.setScalar(scale);
      fish.push({group,kind,scale,phase:kind===0?random()*Math.PI*2:kind===1?2.7+i*.13:4.3+i*.19,
        speed:kind===0?.030+random()*.012:kind===1?.045:.037,
        radius:kind===0?3.3+random()*1.7:4.7,
        depth:kind===0?1.15+i*.09:kind===1?1.45:1.3,
        y:kind===0?[-.65,2.3,.2,1.4][i]:kind===1?1.50+(i%3)*.13:.44+i*.20,
        z:kind===0?(i<2?-.2:-1.6-i*.23):kind===1?-2.4+(i-2)*.16:-2.1+i*.21,
        wobble:kind===0?random()*Math.PI*2:kind*.8+i*.12});
    }
  });

  // Subtle drifting detritus is one point draw. Larger near-camera particles
  // retain the sense of water depth without looking like snow.
  const particleCount=170, pp=new Float32Array(particleCount*3), pv=[];
  for(let i=0;i<particleCount;i++) {
    pp[i*3]=(random()-.5)*16; pp[i*3+1]=-2+random()*8; pp[i*3+2]=-7+random()*11;
    pv.push(.012+random()*.024);
  }
  const particleGeo=geo(new THREE.BufferGeometry());
  particleGeo.setAttribute('position',new THREE.BufferAttribute(pp,3));
  const particleMat=mat(new THREE.ShaderMaterial({
    name:'water_suspended_particulate_material',
    uniforms:{aqTime:clock},transparent:true,depthWrite:false,
    vertexShader:`uniform float aqTime; varying float opacity;
      void main(){ vec3 p=position; p.x+=sin(aqTime*.07+p.y)*.12;
        vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(15./-mv.z,1.,3.); opacity=clamp(1.-(-mv.z)/19.,.05,.45); }`,
    fragmentShader:`varying float opacity; void main(){float d=length(gl_PointCoord-.5)*2.;
      gl_FragColor=vec4(.63,.80,.68,(1.-smoothstep(.1,1.,d))*opacity*.28);}`
  }));
  root.add(named(new THREE.Points(particleGeo,particleMat),'water_suspended_particulate'));

  const bubbleGeo=geo(new THREE.SphereGeometry(1,10,8));
  const bubbleMat=mat(new THREE.MeshPhysicalMaterial({name:'water_bubble_material',color:0xbce5db,metalness:.13,roughness:.12,
    transparent:true,opacity:.22,depthWrite:false,clearcoat:1,clearcoatRoughness:.1}));
  const bubbles=new THREE.InstancedMesh(bubbleGeo,bubbleMat,20); root.add(bubbles);
  bubbles.name='water_rising_bubble_instances';
  bubbles.frustumCulled=false;
  const bubbleData=Array.from({length:20},()=>({phase:random()*7,speed:.14+random()*.18,size:.013+random()*.021}));

  // Very low-opacity, soft-edged shafts. No hard cone silhouettes or overlays.
  const shaftGeo=geo(new THREE.PlaneGeometry(1,1));
  const shaftMat=mat(new THREE.ShaderMaterial({
    name:'water_soft_light_shaft_material',
    uniforms:{aqTime:clock},transparent:true,depthWrite:false,side:THREE.DoubleSide,
    blending:THREE.AdditiveBlending,
    vertexShader:'varying vec2 q; void main(){q=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform float aqTime; varying vec2 q;void main(){
      float x=abs(q.x-.5)*2.;float w=pow(max(0.,1.-x*x),3.);
      float y=smoothstep(0.,.35,q.y)*(1.-smoothstep(.85,1.,q.y));
      gl_FragColor=vec4(.40,.63,.51,w*y*.016*(.85+.15*sin(aqTime*.11+q.y*4.)));}`
  }));
  for(let i=0;i<4;i++) {
    const ray=mesh(shaftGeo,shaftMat);ray.position.set(-4.6+i*2.6,2.4,-4.2-i*.18);
    ray.name='water_light_shaft_'+String(i+1).padStart(2,'0');
    ray.scale.set(.65+i*.22,9,1);ray.rotation.z=-.23;ray.renderOrder=2;
  }

  const pathPosition = (f,t,out,migration) => {
    if (migration && f.kind === 2) {
      // The three barbs share one continuous foreground circuit between the
      // wall and an exterior TV. Analytic time, depth and heading remain equal
      // in both renderers, including the unlit gap and after reconnects.
      const a = t * .075 + f.phase + Math.sin(t * .07 + f.kind) * .055;
      const p = (1 + Math.cos(a)) * .5;
      out.copy(migration.wall).multiplyScalar((1 - p) ** 2)
        .addScaledVector(migration.bend, 2 * p * (1 - p)).addScaledVector(migration.tv, p * p);
      out.x += Math.sin(a) * .32;
      out.y += Math.sin(a * 2 + f.wobble) * .055;
      out.z += Math.sin(a) * .4;
      return;
    }
    // A broad continuous turn leaves room for the body to follow its heading.
    // The shoal shares its slow speed changes; there is no wrapping or local
    // steering integration, so skipped frames and reconnects sample one world.
    const a=t*f.speed+f.phase+Math.sin(t*.07+f.kind)*.055;
    out.set(Math.sin(a)*f.radius,
      f.y+.18*Math.sin(a*1.3+f.wobble)+.035*Math.sin(t*.19+f.phase),
      f.z+f.depth*Math.cos(a)+.12*Math.sin(a*2+f.wobble));
  };
  const current=new THREE.Vector3(), previous=new THREE.Vector3(), next=new THREE.Vector3();
  root.traverse(object=>{if(object.geometry&&!object.geometry.name)object.geometry.name=object.name+'_geometry';});
  const fishGroups = new Set(fish.map(f => f.group));
  function setBackdropVisible(visible) {
    // The companion projects the existing 3D fish into the room. Tank surfaces,
    // plant cards and water particles stay on TV, without changing any poses.
    for (const child of root.children) if (!fishGroups.has(child)) child.visible = Boolean(visible);
  }
  function update(seconds, migration = null) {
    if(disposed || !Number.isFinite(seconds)) return;
    clock.value=seconds;
    for(const f of fish) {
      pathPosition(f,seconds,current,migration);pathPosition(f,seconds-.04,previous,migration);pathPosition(f,seconds+.04,next,migration);
      f.group.position.copy(current); next.sub(previous).normalize();
      f.group.rotation.set(0,Math.atan2(-next.z,next.x),Math.atan2(next.y,Math.hypot(next.x,next.z)));
      // Keep the foreground shoal small enough to swim through the TV aperture.
      // Scale is constant along its path and identical on both displays.
      f.group.scale.setScalar(f.scale * (migration && f.kind === 2 ? .43 : 1));
    }
    for(let i=0;i<particleCount;i++) pp[i*3+1]=-2+((i/particleCount*8+seconds*pv[i])%8);
    particleGeo.attributes.position.needsUpdate=true;
    for(let i=0;i<bubbleData.length;i++) {
      const b=bubbleData[i], y=-1.7+((seconds*b.speed+b.phase)%7);
      bubbles.setMatrixAt(i,matrix(-3.8+Math.sin(y*2.1+i)*.065,y,-1.35+Math.cos(y*1.7+i)*.055,b.size,b.size*1.08,b.size));
    }
    bubbles.instanceMatrix.needsUpdate=true;
  }
  update(0);
  return { update, setBackdropVisible, dispose() {
    if(disposed)return;disposed=true;scene.remove(root);
    root.traverse(o=>{if(o.isInstancedMesh)o.dispose();});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
    root.clear();fish.length=0;geometries.clear();materials.clear();textures.clear();
  }};
}
