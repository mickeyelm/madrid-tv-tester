import * as THREE from './vendor/three/three.module.js';

// Real depth-tested filaments; GPU vibration leaves the audio clock undisturbed.
export class PocketScene {
  constructor(width=960,height=600) {
    this.canvas=document.createElement('canvas');
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
    this.renderer.setPixelRatio(1);this.renderer.setClearColor(0x080b0c);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(34,1,.1,40);
    this.group=new THREE.Group();this.scene.add(this.group);
    this.energy=new Float32Array(8);this.last=0;this.disposed=false;
    this.geometries=new Set();this.materials=new Set();this.textures=[];
    // Large studio softboxes reflected in the brass make its bevels readable.
    const studio=document.createElement('canvas');studio.width=512;studio.height=256;
    const studioCtx=studio.getContext('2d');studioCtx.fillStyle='#171b20';studioCtx.fillRect(0,0,512,256);
    for(const [x,y,w,h,color] of [[45,30,125,70,'#fff2d7'],[300,75,45,135,'#a9c4d6'],[205,190,130,12,'#d86e30']]){
      studioCtx.fillStyle=color;studioCtx.fillRect(x,y,w,h);
    }
    const studioTexture=new THREE.CanvasTexture(studio);studioTexture.mapping=THREE.EquirectangularReflectionMapping;studioTexture.colorSpace=THREE.SRGBColorSpace;
    const pmrem=new THREE.PMREMGenerator(this.renderer);this.environment=pmrem.fromEquirectangular(studioTexture);this.scene.environment=this.environment.texture;pmrem.dispose();studioTexture.dispose();
    const material=(opts)=>{const m=new THREE.MeshStandardMaterial(opts);this.materials.add(m);return m;};
    const brass=material({color:0x9c7437,metalness:.88,roughness:.25});
    const edge=material({color:0xe8c991,metalness:.9,roughness:.19});
    const graphite=material({color:0x252b2b,metalness:.65,roughness:.38});
    const black=material({color:0x080b0c,metalness:.3,roughness:.6});
    const ceramic=material({color:0xdfd5b8,metalness:.12,roughness:.37});
    const copper=material({color:0xc36331,metalness:.65,roughness:.27});
    this.scene.add(new THREE.HemisphereLight(0xe0efff,0x181a15,2.1));
    for(const [color,power,x,y,z] of [[0xffddad,3,-3,4,5],[0x92b9c8,1.5,4,-1,3],[0xff6622,1.5,-2,-2,1]]){
      const light=new THREE.DirectionalLight(color,power);light.position.set(x,y,z);this.scene.add(light);
    }
    // Repeated terminals, cooling fins and etched ruler ticks are instanced.
    this.instances=[];const batches=new Map();
    const box=new THREE.BoxGeometry(1,1,1),cylinder=new THREE.CylinderGeometry(1,1,1,24),ring=new THREE.TorusGeometry(1,.12,8,32);
    const part=(geo,mat,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0)=>{
      const key=geo.uuid+mat.uuid;if(!batches.has(key))batches.set(key,{geo,mat,transforms:[]});
      const obj=new THREE.Object3D();obj.position.set(x,y,z);obj.scale.set(sx,sy,sz);obj.rotation.set(rx,ry,rz);obj.updateMatrix();
      batches.get(key).transforms.push(obj.matrix.clone());this.geometries.add(geo);
    };
    const shape=new THREE.Shape();
    shape.moveTo(-.18,-1.76);shape.lineTo(.18,-1.76);shape.quadraticCurveTo(.25,-1.76,.25,-1.69);shape.lineTo(.25,1.69);shape.quadraticCurveTo(.25,1.76,.18,1.76);shape.lineTo(-.18,1.76);shape.quadraticCurveTo(-.25,1.76,-.25,1.69);shape.lineTo(-.25,-1.69);shape.quadraticCurveTo(-.25,-1.76,-.18,-1.76);
    const rail=new THREE.ExtrudeGeometry(shape,{depth:.14,bevelEnabled:true,bevelThickness:.035,bevelSize:.025,bevelSegments:3,steps:1});
    for(const sign of [-1,1]){
      part(rail,brass,sign*3.05,0,-.15,1,1,1);part(box,graphite,sign*3.05,0,-.23,.61,3.65,.12);part(box,edge,sign*3.25,0,-.035,.015,3.32,.035);
      for(const y of [-1.63,1.63]){
        part(cylinder,black,sign*3.05,y,.045,.077,.022,.077,Math.PI/2);part(cylinder,edge,sign*3.05,y,.06,.047,.02,.047,Math.PI/2);part(box,graphite,sign*3.05,y,.075,.052,.009,.003,0,0,.35);
      }
      for(let j=0;j<8;j++){
        const y=(j-3.5)*.4;
        part(box,graphite,sign*2.99,y,.02,.32,.25,.13);part(cylinder,ceramic,sign*2.84,y,.11,.092,.2,.092,0,0,Math.PI/2);
        part(cylinder,brass,sign*2.72,y,.11,.062,.16,.062,0,0,Math.PI/2);part(ring,edge,sign*2.66,y,.11,.069,.069,.069,0,Math.PI/2);
        for(let n=0;n<8;n++)part(ring,copper,sign*(2.84+n*.018),y,.11,.096,.096,.096,0,Math.PI/2);
        part(cylinder,edge,sign*3.08,y,.09,.071,.08,.071,Math.PI/2);part(box,black,sign*3.08,y,.135,.072,.012,.004,0,0,-.45);
      }
    }
    part(box,graphite,0,0,-.43,6.75,3.83,.15);part(box,black,0,0,-.335,6.12,3.58,.045);
    for(const y of [-1.87,1.87]){
      part(box,edge,0,y,-.33,6.52,.022,.04);
      for(let i=0;i<=64;i++)part(box,brass,(i/64-.5)*5.25,y+(y<0?.07:-.07),-.3,.006,i%8===0?.065:.026,.006);
    }
    for(const x of [-3.15,3.15])for(const y of [-1.85,1.85])part(cylinder,black,x,y,-.53,.13,.1,.13,Math.PI/2);
    for(const {geo,mat,transforms} of batches.values()){
      const mesh=new THREE.InstancedMesh(geo,mat,transforms.length);transforms.forEach((m,i)=>mesh.setMatrixAt(i,m));this.group.add(mesh);this.instances.push(mesh);
    }
    const backGeo=new THREE.PlaneGeometry(5.65,3.48);this.geometries.add(backGeo);
    const backMat=new THREE.ShaderMaterial({vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`varying vec2 vUv;void main(){vec2 p=vUv-.5;float vign=exp(-dot(p*vec2(1.,1.4),p*vec2(1.,1.4))*6.);float grid=pow(abs(cos(vUv.x*3.14159265*32.)),100.);float grain=fract(sin(dot(vUv,vec2(12.9898,7823.233)))*43758.5453);vec3 col=vec3(.017,.022,.023)+vec3(.024,.015,.006)*vign+grid*.011+grain*.004;gl_FragColor=vec4(col,1.);}`});
    this.materials.add(backMat);const back=new THREE.Mesh(backGeo,backMat);back.position.z=-.3;this.group.add(back);
    this.uniforms={time:{value:0},energy:{value:this.energy},motion:{value:1}};
    const vertexShader=`uniform float time;uniform float energy[8];uniform float motion;varying vec3 tint;varying float strength;
      void main(){float u=position.x;float angle=position.y;int j=int(position.z+.5);float index=float(j);float a=energy[j];float center=.27+mod(index*3.,7.)*.065;
      float envelope=exp(-pow((u-center)*7.,2.))*sin(u*3.14159265);float radius=.003+envelope*(.17+a*.16);
      float harmonic=1.+.15*sin(u*35.+index+time*1.2*motion)*a;
      float wave=sin(u*25.-time*20.)*sin(u*3.14159265)*a*.025*motion;float twist=angle+u*1.8+sin(time*.25+index)*.1*motion;
      vec3 p=vec3((u-.5)*5.32,(index-3.5)*.4+cos(twist)*radius*harmonic+wave,.11+sin(twist)*radius*harmonic);
      tint=mix(vec3(1.,.23,.025),vec3(1.,.69,.22),mod(index,3.)*.43);strength=.32+.43*(.5+.5*sin(twist))+a*.32;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`;
    const filamentMat=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader,fragmentShader:`varying vec3 tint;varying float strength;void main(){gl_FragColor=vec4(tint*strength,strength);}`,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});this.materials.add(filamentMat);
    const vertices=[],segments=112,sides=20;const point=(u,k,j)=>vertices.push(u,k/sides*Math.PI*2,j);
    for(let j=0;j<8;j++){
      for(let k=0;k<sides;k++)for(let i=0;i<segments;i++){point(i/segments,k,j);point((i+1)/segments,k,j);}
      for(let i=2;i<segments;i+=2)for(let k=0;k<sides;k++){point(i/segments,k,j);point(i/segments,k+1,j);}
    }
    const filaments=new THREE.BufferGeometry();filaments.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.geometries.add(filaments);
    const wires=new THREE.LineSegments(filaments,filamentMat);wires.frustumCulled=false;this.group.add(wires);
    // Small luminous intersections reveal the curved surface when a note blooms.
    const nodes=[];
    for(let j=0;j<8;j++)for(let i=12;i<104;i+=7)for(let k=0;k<20;k+=4)nodes.push(i/112,k/20*Math.PI*2,j);
    const nodeGeo=new THREE.BufferGeometry();nodeGeo.setAttribute('position',new THREE.Float32BufferAttribute(nodes,3));this.geometries.add(nodeGeo);
    const nodeMat=new THREE.ShaderMaterial({uniforms:this.uniforms,vertexShader:vertexShader.replace('gl_Position=','gl_PointSize=1.2+a*1.6;gl_Position='),fragmentShader:`varying vec3 tint;varying float strength;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(tint*(.5+strength),(1.-d*2.)*strength);}`,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
    this.materials.add(nodeMat);const nodesMesh=new THREE.Points(nodeGeo,nodeMat);nodesMesh.frustumCulled=false;this.group.add(nodesMesh);
    // Local glow avoids an expensive full-screen bloom pass on phone and TV.
    const glowCanvas=document.createElement('canvas');glowCanvas.width=64;glowCanvas.height=64;
    const ctx=glowCanvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,225,140,.6)');gradient.addColorStop(.15,'rgba(255,135,25,.22)');gradient.addColorStop(1,'rgba(255,80,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
    const texture=new THREE.CanvasTexture(glowCanvas);this.textures.push(texture);this.glows=[];
    for(let j=0;j<8;j++){
      const mat=new THREE.SpriteMaterial({map:texture,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.35});this.materials.add(mat);
      const sprite=new THREE.Sprite(mat);sprite.position.set((.27+(j*3%7)*.065-.5)*5.32,(j-3.5)*.4,.14);sprite.scale.set(1.5,.65,1);this.group.add(sprite);this.glows.push(sprite);
    }
    this.sparks=Array.from({length:96},()=>({life:0,x:0,y:0,z:0,v:0}));this.sparkPositions=new Float32Array(96*3);this.sparkPositions.fill(100);
    const sparkGeo=new THREE.BufferGeometry();sparkGeo.setAttribute('position',new THREE.BufferAttribute(this.sparkPositions,3).setUsage(THREE.DynamicDrawUsage));this.geometries.add(sparkGeo);this.sparkGeo=sparkGeo;
    const sparkMat=new THREE.PointsMaterial({color:0xffc576,size:.024,map:texture,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});this.materials.add(sparkMat);
    const sparks=new THREE.Points(sparkGeo,sparkMat);sparks.frustumCulled=false;this.group.add(sparks);this.resize(width,height);
  }
  resize(w,h){
    w=Math.max(1,Math.round(w));h=Math.max(1,Math.round(h));if(this.width===w&&this.height===h)return;
    this.width=w;this.height=h;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;
    const halfHeight=Math.max(2.35,3.75/this.camera.aspect,this.camera.aspect<1.5?3.15:0);
    this.camera.position.set(0,.15,halfHeight/Math.tan(17*Math.PI/180));this.camera.lookAt(0,0,0);this.camera.updateProjectionMatrix();
  }
  excite(note,velocity=1){
    if(!Number.isFinite(note)||!Number.isFinite(velocity))return;
    const index=((Math.round(note)%8)+8)%8;this.energy[index]=Math.min(1.5,this.energy[index]+Math.max(0,velocity));
    for(let n=0;n<8;n++){const p=this.sparks.find(p=>p.life<=0);if(!p)break;p.life=.6+n*.055;p.x=(.27+(index*3%7)*.065-.5)*5.32;p.y=(index-3.5)*.4;p.z=.18;p.v=(n-3.5)*.19;}
  }
  render(ms,beat=0,reduced=false){
    if(this.disposed)return;
    const dt=Math.min(.1,Math.max(0,(ms-this.last)/1000)||.033);this.last=ms;
    this.uniforms.time.value=ms/1000;this.uniforms.motion.value=reduced?0:1;
    this.group.rotation.set(-.18,.2+(reduced?0:Math.sin(ms*.00012)*.055),-.018);
    for(let j=0;j<8;j++){this.energy[j]*=Math.exp(-dt*2.5);this.glows[j].material.opacity=.22+this.energy[j]*.32;}
    this.sparks.forEach((p,i)=>{p.life-=dt;p.y+=dt*.12;p.x+=dt*p.v;p.z+=dt*.1;this.sparkPositions[i*3]=p.life>0&&!reduced?p.x:100;this.sparkPositions[i*3+1]=p.y;this.sparkPositions[i*3+2]=p.z;});
    this.sparkGeo.attributes.position.needsUpdate=true;this.renderer.render(this.scene,this.camera);
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.instances.forEach(m=>m.dispose());this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());this.environment.dispose();this.renderer.dispose();}
}
window.PocketScene=PocketScene;
window.dispatchEvent(new Event('pocket-scene-ready'));
