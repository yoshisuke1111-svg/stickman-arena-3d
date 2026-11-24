import * as THREE from '/vendor/three.module.js';
import { disposeVisual, slashGeometry, createFlowTube, updateFlowTube, animateFlowTube, createShockShell, updateShockShell, animateShockShell, setWeaponPose, poseHoldingArm, createRibbon, updateRibbon, createDragon, updateDragonTail } from './combat-visuals.js';
import { createAbilityHud } from './ability-hud.js';

const $ = id => document.getElementById(id);
const abilityHud = createAbilityHud();
const host = $('world');
const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
const smallDevice=matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,smallDevice?1.25:1.7));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=false;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.28;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#483265');
scene.fog = new THREE.FogExp2('#483265', .0145);
const camera = new THREE.PerspectiveCamera(57,innerWidth/innerHeight,.1,270);
const clock=new THREE.Clock();
// One shared heading for the weapon, whole stick figure and follow camera.
// Camera elevation remains constant, but it orbits with the player heading.
const FOLLOW_CAM_PITCH=.68;
let camDistance=15.3,elapsed=0,aimYaw=0,aimPitch=0;
const targetLook = new THREE.Vector3(0,1.3,0);
const targetCamera = new THREE.Vector3(11,13,-14);
camera.position.copy(targetCamera);

const mat=(color,metal=.05,rough=.86,em=0)=>new THREE.MeshStandardMaterial({color,metalness:metal,roughness:rough,emissive:color,emissiveIntensity:em});
const tealMat=new THREE.MeshBasicMaterial({color:'#9df0eb'}), pinkMat=new THREE.MeshBasicMaterial({color:'#ff8c8b'}), goldMat=new THREE.MeshBasicMaterial({color:'#ffc37a'});
function box(w,h,d,m,x=0,y=0,z=0,shadow=true) {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);
  mesh.position.set(x,y,z);mesh.castShadow=shadow;mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
scene.add(new THREE.HemisphereLight('#e5c8ff','#2e203d',2.05));
const sun=new THREE.DirectionalLight('#ffe2c1',2.35);sun.position.set(-17,31,9);sun.castShadow=true;
sun.shadow.mapSize.set(smallDevice?1024:2048,smallDevice?1024:2048);
sun.shadow.camera.left=-27;sun.shadow.camera.right=27;sun.shadow.camera.top=27;sun.shadow.camera.bottom=-27;
sun.shadow.bias=-.00016;sun.shadow.normalBias=.03;scene.add(sun);
const moonFill=new THREE.DirectionalLight('#a99fff',.5);moonFill.position.set(15,15,-21);scene.add(moonFill);
const blueLight=new THREE.PointLight('#74d9ef',19,33,2);blueLight.position.set(-8,7,7);scene.add(blueLight);
const amberLight=new THREE.PointLight('#f6ae6e',19,31,2);amberLight.position.set(10,5,-8);scene.add(amberLight);

// Flat-color three-dimensional stage: dark solid platforms, orange rims and
// a simple purple backdrop, rather than an ornate forest diorama.
scene.background.set('#624184');
scene.fog=null;
const flat=color=>new THREE.MeshBasicMaterial({color});
const platform=flat('#151324'),surface=flat('#e18b28'),rim=flat('#ffb455'),floorTop=flat('#594078'),edge=flat('#141322');
box(24.8,1.0,24.8,platform,0,-.53,0,false);
box(24.25,.08,24.25,floorTop,0,-.025,0,false);
for(const side of [-1,1]){
  box(24.7,.20,.42,surface,0,.055,side*12.05,false);
  box(.42,.20,24.7,surface,side*12.05,.055,0,false);
  box(24.7,1.05,.40,edge,0,-.43,side*12.09,false);
  box(.40,1.05,24.7,edge,side*12.09,-.43,0,false);
}
const upper=new THREE.MeshBasicMaterial({color:'#251d38',transparent:true,opacity:.12,depthWrite:false,side:THREE.DoubleSide});
for(const side of [-1,1]){
  box(24.7,.22,.35,platform,0,.18,side*11.8,false);
  box(.35,.22,24.7,platform,side*11.8,.18,0,false);
  box(24.7,7.65,.04,upper,0,4.12,side*11.8,false);
  box(.04,7.65,24.7,upper,side*11.8,4.12,0,false);
}
const blocks=[[-4.4,-1.6,2.7,2.7,2.15],[4.4,1.6,2.7,2.7,2.15],[-1.6,5.5,2.2,1.9,1.25],[1.6,-5.5,2.2,1.9,1.25]];
for(const [x,z,w,d,h] of blocks){
  box(w,h,d,platform,x,h/2,z,false);
  box(w,.16,d,surface,x,h-.08,z,false);
  box(w,.045,d,rim,x,h-.022,z,false);
}
// Distant low-contrast silhouettes, kept outside the combat space.
const silhouetteColors=['#50346e','#583876','#4b3067'];
for(let i=0;i<14;i++){
  const a=i*Math.PI*2/14;
  const hill=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),flat(silhouetteColors[i%3]));
  hill.scale.set(14+(i%3)*4,6+(i%4)*2,12);
  hill.position.set(Math.sin(a)*34,-3,Math.cos(a)*34);
  scene.add(hill);
}
const fireflies=[];

const cyl=new THREE.CylinderGeometry(1,1,1,9),ballGeo=new THREE.SphereGeometry(1,14,10),boxGeo=new THREE.BoxGeometry(1,1,1);
function bodyPiece(parent,geo,material,pos,scale){const m=new THREE.Mesh(geo,material);m.position.set(...pos);m.scale.set(...scale);m.castShadow=true;parent.add(m);return m;}
function buildFighter(p){
  const root=new THREE.Group();scene.add(root);
  const colorMat=new THREE.MeshBasicMaterial({color:p.c||'#43e7db'}),dark=colorMat,glow=colorMat;
  bodyPiece(root,ballGeo,colorMat,[0,1.95,0],[.29,.29,.29]);
  bodyPiece(root,cyl,colorMat,[0,1.23,0],[.105,.86,.105]);
  bodyPiece(root,ballGeo,colorMat,[0,.8,0],[.11,.11,.11]);
  bodyPiece(root,ballGeo,glow,[0,1.6,0],[.11,.10,.11]);
  const leftArm=new THREE.Group(),rightArm=new THREE.Group(),leftLeg=new THREE.Group(),rightLeg=new THREE.Group();
  leftArm.position.set(-.26,1.54,0);rightArm.position.set(.26,1.54,0);
  leftLeg.position.set(-.15,.79,0);rightLeg.position.set(.15,.79,0);
  root.add(leftArm,rightArm,leftLeg,rightLeg);
  for(const limb of [leftArm]){bodyPiece(limb,cyl,colorMat,[0,-.37,0],[.09,.69,.09]);bodyPiece(limb,ballGeo,colorMat,[0,-.71,0],[.11,.11,.11]);}
  for(const limb of [leftLeg,rightLeg]){bodyPiece(limb,cyl,colorMat,[0,-.37,0],[.1,.75,.1]);bodyPiece(limb,ballGeo,dark,[0,-.76,.12],[.14,.11,.24]);}
  rightArm.position.set(0,0,0);
  const armUpper=bodyPiece(rightArm,cyl,colorMat,[0,0,0],[.09,.5,.09]);
  const armFore=bodyPiece(rightArm,cyl,colorMat,[0,0,0],[.09,.5,.09]);
  const elbowJoint=bodyPiece(rightArm,ballGeo,colorMat,[0,0,0],[.10,.10,.10]);
  const hand=bodyPiece(rightArm,ballGeo,colorMat,[0,0,0],[.11,.11,.11]);
  const weaponGroup=new THREE.Group();scene.add(weaponGroup);
  const weaponTrail=createRibbon(18,'#a6f5ff',.30);scene.add(weaponTrail.mesh);
  const bodyTrail=createRibbon(24,'#6adcf1',.20);scene.add(bodyTrail.mesh);
  const nameSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(document.createElement('canvas')),depthTest:false,transparent:true}));
  nameSprite.position.set(0,2.68,0);nameSprite.scale.set(2.7,.7,1);root.add(nameSprite);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.40,.455,40),new THREE.MeshBasicMaterial({color:p.c||'#49edda',transparent:true,opacity:.28,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.04;root.add(ring);
  const model={root,leftArm,rightArm,leftLeg,rightLeg,weaponGroup,armUpper,armFore,elbowJoint,hand,weaponTrail,bodyTrail,nameSprite,ring,headMat:colorMat,glow,lastWeapon:'',lastLabel:'',target:p,display:{x:p.x,y:p.y,z:p.z,f:p.f,pitch:p.pitch||0,hs:p.hs||0,dash:0},bodyYaw:p.f,walkPhase:Math.random()*6.28,trailAt:0};
  replaceWeapon(model,p.w);labelSprite(model,p);
  return model;
}
function addPart(g,geo,m,x,y,z,sx=1,sy=1,sz=1){const v=new THREE.Mesh(geo,m);v.position.set(x,y,z);v.scale.set(sx,sy,sz);v.castShadow=true;g.add(v);return v;}
function replaceWeapon(model,w){
  if(model.lastWeapon===w)return;
  const group=model.weaponGroup;
  while(group.children.length){const m=group.children[0];group.remove(m);if(m.geometry!==boxGeo&&m.geometry!==cyl&&m.geometry!==ballGeo)m.geometry?.dispose();}
  const steel=mat('#eee0cc',.22,.37),black=mat('#332b3a',.1,.77),edge=mat(model.target.c||'#57e7ee',.04,.67,.22);
  if(w==='blade'){
    addPart(group,boxGeo,black,0,0,.10,.13,.16,.45);
    addPart(group,boxGeo,steel,0,0,.32,.62,.09,.13);
    addPart(group,boxGeo,steel,0,0,.97,.18,.11,1.28);
    addPart(group,boxGeo,edge,0,.075,1.01,.04,.04,1.11);
    addPart(group,ballGeo,edge,0,0,1.64,.085,.085,.18);
  } else if(w==='katana'){
    // Long, slender blade with a contrasting grip and small tsuba guard.
    addPart(group,boxGeo,black,0,0,.38,.15,.16,.7);
    addPart(group,boxGeo,edge,0,0,.82,.6,.085,.14);
    const blade=addPart(group,boxGeo,steel,0,0,1.75,.145,.058,1.75);
    blade.rotation.x=-.045;
    addPart(group,boxGeo,edge,0,.054,1.67,.025,.022,1.52);
    addPart(group,ballGeo,steel,0,0,2.67,.05,.06,.15);
  } else if(w==='axe'){
    addPart(group,cyl,black,0,0,.69,.065,1.62,.065).rotation.x=Math.PI/2;
    const shape=new THREE.Shape();
    shape.moveTo(-.10,-.12);shape.quadraticCurveTo(-.34,-.12,-.50,-.38);
    shape.quadraticCurveTo(-.72,-.02,-.48,.38);shape.quadraticCurveTo(-.31,.17,-.10,.14);
    shape.lineTo(.10,.14);shape.quadraticCurveTo(.31,.17,.48,.38);
    shape.quadraticCurveTo(.72,-.02,.50,-.38);shape.quadraticCurveTo(.34,-.12,.10,-.12);shape.closePath();
    const head=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.12,bevelEnabled:true,bevelSize:.025,bevelThickness:.02,bevelSegments:1,steps:1}),steel);
    head.rotation.x=Math.PI/2;head.position.set(0,.06,1.47);head.castShadow=true;group.add(head);
    addPart(group,cyl,mat('#b9a273',.25,.5),0,0,1.47,.11,.19,.11).rotation.x=Math.PI/2;
  } else if(w==='bomb'){
    addPart(group,ballGeo,black,0,0,.44,.27,.27,.27);
    addPart(group,boxGeo,edge,0,.27,.44,.08,.23,.09);
    addPart(group,ballGeo,steel,0,.41,.44,.07,.07,.07);
  } else if(w==='hammer'){
    addPart(group,boxGeo,black,0,0,.59,.15,.15,1.28);
    addPart(group,boxGeo,steel,0,0,1.35,.92,.47,.5);
    addPart(group,boxGeo,edge,0,.14,1.35,.96,.09,.51);
    for(const x of [-.41,.41])addPart(group,boxGeo,black,x,-.02,1.35,.10,.5,.53);
  } else {
    addPart(group,boxGeo,black,0,.07,.45,.39,.27,.94);
    addPart(group,boxGeo,steel,0,.02,.98,.23,.2,.66);
    addPart(group,boxGeo,edge,0,.02,1.34,.28,.24,.08);
    addPart(group,boxGeo,black,0,-.26,.22,.15,.52,.23);
  }
  model.lastWeapon=w;
}
function labelSprite(m,p){
  const label=p.n+String(p.hp)+p.dead;if(m.lastLabel===label)return;m.lastLabel=label;
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=90;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,320,90);
  ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillStyle='#ffffff';ctx.fillText(p.n.slice(0,14),160,38,285);
  ctx.fillStyle='#58445f';ctx.fillRect(26,56,268,11);
  ctx.fillStyle=p.dead?'#a84b5c':p.c;ctx.fillRect(26,56,268*Math.max(0,p.hp)/100,11);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  if(m.nameSprite.material.map)m.nameSprite.material.map.dispose();
  m.nameSprite.material.map=texture;m.nameSprite.material.needsUpdate=true;
}
function destroyModel(m){
  scene.remove(m.root);scene.remove(m.weaponGroup);
  m.nameSprite.material.map?.dispose();m.nameSprite.material.dispose();
  disposeVisual(m.weaponTrail.mesh);disposeVisual(m.bodyTrail.mesh);
  // Body geometry is shared between fighters, so do not dispose it here.
  const materials=new Set();m.root.traverse(o=>{if(o.material&&o!==m.nameSprite)materials.add(o.material);});
  for(const material of materials)material.dispose();
  m.weaponGroup.traverse(o=>{if(o.geometry&&![boxGeo,cyl,ballGeo].includes(o.geometry))o.geometry.dispose();});
}
const playerModels=new Map();
// A thick swept crescent rather than a wireframe torus: inspired by the
// broad, bright blade strokes visible in the reference videos.
function crescentGeometry(radius=1.0,angleWidth=Math.PI*1.25){return slashGeometry(radius,angleWidth);}
function crescentMesh(color,size=1,opacity=.82){
  return new THREE.Mesh(crescentGeometry(size),new THREE.MeshBasicMaterial({color,transparent:true,opacity,vertexColors:true,side:THREE.DoubleSide,depthWrite:false,fog:false}));
}
const bullets=new Map();
const thrownBombs=new Map();
const axeTunnels=new Map(),axePulses=new Map();
const effects=[];
// Local aim guide stays visible even when WASD rotates the camera independently.
const aimGuide=new THREE.Group();scene.add(aimGuide);
const guideGeometry=new THREE.BufferGeometry();guideGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
const aimLine=new THREE.Line(guideGeometry,new THREE.LineBasicMaterial({color:'#ffe0b6',transparent:true,opacity:.46,depthTest:false}));
const aimDot=new THREE.Mesh(new THREE.OctahedronGeometry(.11),new THREE.MeshBasicMaterial({color:'#ffe8c5',transparent:true,opacity:.82,depthTest:false}));
aimLine.renderOrder=5;aimDot.renderOrder=6;aimGuide.add(aimLine,aimDot);
let lastPlayers=[];
function syncWorld(players,shots,bombStates=[],tunnels=[],pulses=[]){
  const idSet=new Set();
  for(const p of players){
    idSet.add(p.id);
    let model=playerModels.get(p.id);
    if(!model){model=buildFighter(p);playerModels.set(p.id,model);}
    model.target=p;
    if(model.lastWeapon!==p.w)replaceWeapon(model,p.w);
    labelSprite(model,p);
    if(model.headMat.color.getStyle()!==p.c){model.headMat.color.set(p.c);model.glow.color.set(p.c);model.ring.material.color.set(p.c);}
    model.ring.material.opacity=p.id===selfId?.45:.12;
  }
  for(const [id,m] of playerModels)if(!idSet.has(id)){destroyModel(m);playerModels.delete(id);}
  const bulletIds=new Set();
  for(const p of shots){
    bulletIds.add(p.id);
    let b=bullets.get(p.id);
    if(!b){
      const color=p.kind==='dragon'?'#39e7ff':p.kind==='axeWave'?'#4bf3db':p.kind==='slash'?'#b7ffff':p.color;
      let group,tail=null;
      if(p.kind==='dragon'){
        const dragon=createDragon();group=dragon.group;tail=dragon.tail;
      }else{
        group=new THREE.Group();
        if(p.kind==='slash'||p.kind==='axeWave'){
          const stroke=crescentMesh(color,p.kind==='axeWave'?1.26:1.02,.88);
          stroke.rotation.z=-Math.PI/2;group.add(stroke);
        }else{
          const core=new THREE.Mesh(new THREE.SphereGeometry(.16,12,8),new THREE.MeshBasicMaterial({color}));group.add(core);
        }
      }
      group.rotation.order='YXZ';group.position.set(p.x,p.y,p.z);scene.add(group);
      b={group,tail,kind:p.kind,target:new THREE.Vector3(p.x,p.y,p.z),state:p};bullets.set(p.id,b);
    }
    b.target.set(p.x,p.y,p.z);b.state=p;
    b.group.rotation.set(-(p.pitch||0),p.f,0,'YXZ');
    if(b.tail)updateDragonTail(b,p);
  }
  for(const [id,b] of bullets)if(!bulletIds.has(id)){
    disposeVisual(b.group);bullets.delete(id);
  }
  const bombIds=new Set();
  for(const p of bombStates){
    bombIds.add(p.id);
    let b=thrownBombs.get(p.id);
    if(!b){
      const group=new THREE.Group();scene.add(group);
      const shell=new THREE.Mesh(new THREE.SphereGeometry(.255,16,12),mat('#20242d',.68,.3));shell.castShadow=true;group.add(shell);
      const band=new THREE.Mesh(new THREE.TorusGeometry(.256,.037,7,20),mat('#ffb75f',.45,.34,.6));band.rotation.x=Math.PI/2;group.add(band);
      const fuse=new THREE.Mesh(new THREE.CylinderGeometry(.043,.055,.29,7),mat('#ffe4b0',.0,.4,.8));fuse.position.y=.29;group.add(fuse);
      const spark=new THREE.PointLight('#ff8c4a',2,2.5);spark.position.y=.43;group.add(spark);
      b={group,band,spark};thrownBombs.set(p.id,b);
    }
    b.group.position.set(p.x,p.y,p.z);
    b.group.rotation.y+=.08;
    b.band.material.emissiveIntensity=p.fuse<.55?2:.6;
    b.spark.intensity=p.fuse<.55?4:1.7;
  }
  for(const [id,b] of thrownBombs)if(!bombIds.has(id)){
    scene.remove(b.group);b.group.traverse(obj=>{if(obj.isMesh){obj.geometry.dispose();obj.material.dispose();}});thrownBombs.delete(id);
  }
}
function syncAxeWorld(tunnels,pulses){
  const ids=new Set();
  for(const t of tunnels){
    ids.add(t.id);let v=axeTunnels.get(t.id);
    if(!v){v=createFlowTube(t);scene.add(v.group);axeTunnels.set(t.id,v);}
    else updateFlowTube(v,t);
  }
  for(const [id,v] of axeTunnels)if(!ids.has(id)){disposeVisual(v.group);axeTunnels.delete(id);}
  const pulseIds=new Set();
  for(const p of pulses){
    pulseIds.add(p.id);let v=axePulses.get(p.id);
    if(!v){v=createShockShell(p);scene.add(v.group);axePulses.set(p.id,v);}
    else updateShockShell(v,p);
  }
  for(const [id,v] of axePulses)if(!pulseIds.has(id)){disposeVisual(v.group);axePulses.delete(id);}
}
function animateAxeWorld(dt){
  const now=performance.now();
  for(const v of axeTunnels.values())animateFlowTube(v,now);
  for(const b of bullets.values())b.group.position.lerp(b.target,1-Math.exp(-dt*30));
  for(const v of axePulses.values())animateShockShell(v,now,playerModels.get(v.state.owner)?.weaponHead);
}
function burst(type,x,y,z,color){
  const group=new THREE.Group();group.position.set(x,y,z);scene.add(group);
  const count=type==='explode'?44:type==='super'?25:type==='ko'?28:7;
  const bits=[];
  for(let i=0;i<count;i++){
    const mesh=new THREE.Mesh(new THREE.OctahedronGeometry(type==='super'?.10:.075),new THREE.MeshBasicMaterial({color:type==='hit'?'#f0feff':(i%4===0?'#ffffff':color),transparent:true,opacity:1,depthWrite:false}));
    group.add(mesh);
    let a=i*2.3999, h=Math.cos(a*.8);
    bits.push({mesh,v:new THREE.Vector3(Math.cos(a)*(type==='explode'?10:type==='super'?7:3),h*(type==='explode'?6:type==='super'?4:3),Math.sin(a)*(type==='explode'?10:type==='super'?7:3))});
  }
  let ring;
  if(type==='super'||type==='explode'){
    ring=new THREE.Mesh(new THREE.RingGeometry(.6,.8,42),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.85,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2;ring.position.y=-y+.09;group.add(ring);
  }
  effects.push({group,bits,ring,t:0,max:type==='explode'?.82:type==='super'?.66:.5});
}
function animateEffects(dt){
  for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.t+=dt;const life=1-e.t/e.max;
    for(const bit of e.bits){bit.mesh.position.addScaledVector(bit.v,dt);bit.mesh.material.opacity=Math.max(0,life);bit.mesh.rotation.x+=dt*9;bit.mesh.rotation.y+=dt*13;}
    if(e.ring){const scale=1+e.t*5;e.ring.scale.setScalar(scale);e.ring.material.opacity=Math.max(0,life*.8);}
    if(e.extra)for(const m of e.extra){m.material.opacity=Math.max(0,life*.90);const scale=1+e.t*(e.heavy?.65:1.5);m.scale.setScalar(scale);m.rotation.z+=dt*(e.heavy?7:2.4);}
    if(e.t>=e.max){scene.remove(e.group);e.group.traverse(obj=>{if(obj.isMesh){obj.geometry.dispose();obj.material.dispose();}});effects.splice(i,1);}
  }
}
// Skill geometry and ordinary strikes are rendered from their live positions.
// Only the Super has a release flash; ordinary swings do not spawn fake crescents.
function castEffect(e){
  const kind=e.variant||e.kind;
  if(kind!=='fanSlashes')return;
  const m=playerModels.get(e.id);
  if(!m)return;
  const at=m.weaponHead||new THREE.Vector3(e.x,e.y,e.z);
  burst('hit',at.x,at.y,at.z,'#c2fdff');
}
const previewGroup=new THREE.Group();scene.add(previewGroup);
function makePreview(){
  for(const [i,c] of ['#43f0dd','#ff759c','#ffbf63'].entries()){
    const body=new THREE.Group();previewGroup.add(body);
    const cm=mat(c,.25,.5,.6);
    const add=(geo,x,y,z,s)=>{const mesh=new THREE.Mesh(geo,cm);mesh.position.set(x,y,z);mesh.scale.set(...s);mesh.castShadow=true;body.add(mesh);};
    add(ballGeo,0,1.92,0,[.31,.31,.31]);add(cyl,0,1.28,0,[.15,.87,.15]);
    for(const side of [-1,1]){add(cyl,side*.31,1.24,.03,[.09,.7,.09]);add(cyl,side*.16,.43,0,[.1,.82,.1]);}
    body.position.set((i-1)*3.0,0,1.3);body.rotation.y=Math.PI+.5;
    body.userData.order=i;
  }
}
makePreview();
function animatePreview(t){previewGroup.visible=!joined;
  for(const o of previewGroup.children){const i=o.userData.order;o.rotation.y+=.0035;o.position.y=Math.sin(t*1.8+i*1.7)*.09;}
}

// Network: the Node/WebSocket server owns hit detection, HP, knockback, scores and timers.
let socket, selfId=null,roomCode='',phase='home',joined=false,isHost=false,latestState=null,localWeapon='blade',reconnectTimer=null;
let previousHp=100, toastTimer=null,soundEnabled=false,audioCtx=null;
let keys={w:false,s:false,a:false,d:false,jump:false,skill:false,super:false};
const touch={w:false,s:false,a:false,d:false,jump:false,skill:false,super:false};
const weaponNames={blade:'BLADE',hammer:'HAMMER',blaster:'BLASTER',katana:'KATANA',bomb:'BOMB',axe:'AXE'};
const weaponHotkeys=['blade','hammer','blaster','katana','bomb','axe'];
function send(packet){if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(packet));return true;}toast('サーバーに接続していません');return false;}
function connect(){
  clearTimeout(reconnectTimer);
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
  $('netStatus').classList.remove('off');$('netStatus').lastChild.textContent='接続中';
  socket.onopen=()=>{
    $('netStatus').lastChild.textContent='オンライン';
    if(joined&&roomCode)socket.send(JSON.stringify({t:'join',code:roomCode,name:$('nameInput').value}));
  };
  socket.onmessage=e=>{
    let m;try{m=JSON.parse(e.data);}catch{return;}
    if(m.t==='joined'){
      selfId=m.id;roomCode=m.code;joined=true;previousHp=100;
      history.replaceState(null,'',`${location.pathname}?room=${m.code}`);
      $('bigCode').textContent=roomCode;$('hudRoomCode').textContent=roomCode;
      send({t:'weapon',weapon:localWeapon});
      updateScreen();
    } else if(m.t==='state'){
      latestState=m;phase=m.phase;isHost=m.host===selfId;
      const me=m.players.find(p=>p.id===selfId);
      if(me && previousHp>me.hp && me.hp>0){$('flash').classList.add('on');setTimeout(()=>$('flash').classList.remove('on'),100);}
      if(me&&(!lastPlayers.some(p=>p.id===me.id)||lastPlayers.find(p=>p.id===me.id)?.dead&&!me.dead)){
        aimYaw=me.f;aimPitch=me.pitch||0;
      }
      lastPlayers=m.players;
      previousHp=me?.hp??100;
      syncWorld(m.players,m.shots,m.bombs||[],m.tunnels||[],m.pulses||[]);
      syncAxeWorld(m.tunnels||[],m.pulses||[]);
      handleEvents(m.events);
      updateScreen();updateStats(m,me);
    } else if(m.t==='error'){
      toast(m.message);$('entryError').textContent=m.message;$('entryError').classList.remove('hidden');
      if(joined){joined=false;selfId=null;roomCode='';latestState=null;phase='home';syncWorld([],[],[]);syncAxeWorld([],[]);history.replaceState(null,'',location.pathname);updateScreen();}
    }
  };
  socket.onclose=()=>{
    abilityHud.sync(null,false);
    $('netStatus').classList.add('off');$('netStatus').lastChild.textContent='再接続中';
    reconnectTimer=setTimeout(connect,1700);
  };
  socket.onerror=()=>{};
}
function toast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),2800);}
function updateScreen(){
  const inBattle=joined&&phase==='battle';
  document.body.classList.toggle('playing',inBattle);
  $('landing').classList.toggle('hidden',joined);
  $('roomPanel').classList.toggle('hidden',!joined||inBattle);
  $('hud').classList.toggle('hidden',!inBattle);
  $('battleHeader').classList.toggle('hidden',!inBattle);
  if(!latestState||!joined)return;
  const players=latestState.players;
  $('panelTitle').textContent=phase==='finished'?'ラウンド終了！':'対戦の準備';
  const leader=[...players].sort((a,b)=>b.k-a.k||a.d-b.d)[0];
  $('panelSubtitle').textContent=phase==='finished'?`最多KO: ${leader?.n??'なし'}（${leader?.k??0} KO）`:'友達を招待して、好きな武器を選ぼう。';
  $('countTag').textContent=`${players.length} / 8`;
  const list=$('playerList');list.replaceChildren();
  for(const p of players){
    const chip=document.createElement('div');chip.className='player-chip';
    const color=document.createElement('div');color.className='chip-dot';color.style.background=p.c;
    const name=document.createElement('span');name.textContent=p.n+(p.id===selfId?' (YOU)':'')+(p.id===latestState.host?' ★':'');
    chip.append(color,name);list.append(chip);
  }
  $('startBtn').textContent=phase==='finished'?'もう一度バトル →':'バトル開始 →';
  $('startBtn').disabled=!isHost;
  $('addBotBtn').disabled=!isHost||players.length>=8;
  $('removeBotBtn').disabled=!isHost||!players.some(p=>p.bot);
  $('roomHint').textContent=isHost?'部屋主です。CPUを追加して1人でも練習できます。':'部屋主がゲームを開始するまで準備中です。';
}
function updateStats(m,me){
  abilityHud.sync(me,m.phase==='battle');
  $('matchClock').textContent=`${String(Math.floor(m.time/60)).padStart(2,'0')}:${String(m.time%60).padStart(2,'0')}`;
  if(me){
    $('myName').textContent=me.n;$('hpText').textContent=me.dead?'KO':`${me.hp} HP`;
    $('hpFill').style.width=`${Math.max(0,me.hp)}%`;
    $('hpFill').style.background=me.hp<25?'linear-gradient(90deg,#eb5f66,#f6a26a)':'linear-gradient(90deg,#32c4bb,#7affd1)';
    $('weaponName').textContent=weaponNames[me.w]||me.w;
  }
  const board=$('leaderboard');board.replaceChildren();
  for(const p of [...m.players].sort((a,b)=>b.k-a.k).slice(0,8)){
    const row=document.createElement('div');row.className='score-line'+(p.id===selfId?' self':'');
    const name=document.createElement('span');name.className='score-name';name.textContent=p.n;
    const score=document.createElement('b');score.textContent=p.k;
    row.append(name,score);board.append(row);
  }
  const notice=$('message');
  const text=me?.dead?'YOU WERE KNOCKED OUT':null;
  notice.textContent=text||'';notice.classList.toggle('hidden',!text);
}
function addFeed(t){const div=document.createElement('div');div.textContent=t;$('killFeed').prepend(div);setTimeout(()=>div.remove(),3700);while($('killFeed').children.length>5)$('killFeed').lastChild.remove();}
function handleEvents(events){
  for(const e of events){
    if(e.type==='hit'){burst('hit',e.x,e.y,e.z,e.color);playSound(380,.10,'triangle');}
    else if(e.type==='attack'){
      playSound(e.weapon==='hammer'?180:360,.12,'triangle');
    }
    else if(e.type==='skillcast'){castEffect(e);playSound(e.weapon==='katana'?760:265,.22,'sawtooth');}
    else if(e.type==='impact'){if(!['axeFrontShock','tunnelPulse','hammerSpin'].includes(e.kind))burst('hit',e.x,e.y,e.z,'#d4fbff');}
    else if(e.type==='projectileBreak'||e.type==='bounce'){burst('hit',e.x,e.y,e.z,'#a4eaff');}
    else if(e.type==='super'){castEffect(e);playSound(140,.36,'sawtooth');}
    else if(e.type==='explode'){burst('explode',e.x,e.y,e.z,e.color||'#ffba66');playSound(95,.45,'sawtooth');}
    else if(e.type==='ko'){burst('ko',e.x,1.2,e.z,'#ff789b');addFeed(e.by?`${e.by} ⚔ ${e.name}`:`${e.name} が落下した`);playSound(110,.28,'triangle');}
    else if(e.type==='join'&&joined&&phase==='lobby'){toast(e.name+' が参加');}
    else if(e.type==='start'){toast('FIGHT!');playSound(740,.2,'sine');}
    else if(e.type==='end')toast('試合終了！最多KOのプレイヤーが勝者');
    else if(e.type==='dash')playSound(310,.08,'sine');
  }
}
function playSound(freq,seconds,type='sine'){
  if(!soundEnabled)return;
  try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();
    const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(50,freq*.55),audioCtx.currentTime+seconds);
    gain.gain.setValueAtTime(.055,audioCtx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+seconds);
    osc.connect(gain).connect(audioCtx.destination);osc.start();osc.stop(audioCtx.currentTime+seconds);
  }catch{}
}
$('soundToggle').onclick=()=>{soundEnabled=!soundEnabled;$('soundToggle').textContent=soundEnabled?'♫':'♪';toast(soundEnabled?'効果音 ON':'効果音 OFF');};
$('nameInput').value=localStorage.getItem('stickArenaName')||'プレイヤー';
const queryRoom=(new URL(location.href)).searchParams.get('room');if(queryRoom)$('codeInput').value=queryRoom.toUpperCase();
function enter(t){
  const name=$('nameInput').value.trim()||'プレイヤー';localStorage.setItem('stickArenaName',name);
  $('entryError').classList.add('hidden');
  if(t==='create')send({t:'create',name});
  else {const code=$('codeInput').value.replace(/\s/g,'').toUpperCase();if(!/^[A-Z2-9]{5}$/.test(code)){toast('部屋コードは5文字です');return;}send({t:'join',name,code});}
}
$('createBtn').onclick=()=>enter('create');$('joinBtn').onclick=()=>enter('join');
$('codeInput').onkeydown=e=>{if(e.key==='Enter')enter('join');};
$('startBtn').onclick=()=>send({t:'start'});$('addBotBtn').onclick=()=>send({t:'bot'});$('removeBotBtn').onclick=()=>send({t:'removeBots'});
$('exitRoomBtn').onclick=()=>{location.href=location.pathname;};
$('copyBtn').onclick=async()=>{
  const url=`${location.origin}${location.pathname}?room=${roomCode}`;
  try{await navigator.clipboard.writeText(url);toast('招待URLをコピーしました');}
  catch{window.prompt('このURLをコピーしてください',url);}
};
function chooseWeapon(weapon){if(!weaponNames[weapon])return;localWeapon=weapon;
  for(const btn of document.querySelectorAll('[data-weapon]'))btn.classList.toggle('active',btn.dataset.weapon===weapon);
  if(joined)send({t:'weapon',weapon});
}
for(const btn of document.querySelectorAll('[data-weapon]'))btn.onclick=()=>chooseWeapon(btn.dataset.weapon);
const keyMap={KeyW:'w',KeyA:'a',KeyS:'s',KeyD:'d',ArrowUp:'w',ArrowLeft:'a',ArrowDown:'s',ArrowRight:'d',Space:'jump',KeyE:'skill',KeyQ:'super'};
window.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLInputElement || !joined || phase!=='battle')return;
  const action=keyMap[e.code];if(action){keys[action]=true;e.preventDefault();}
  if(e.code==='KeyR'){aimPitch=0;toast('武器を水平に戻した');}

});
window.addEventListener('keyup',e=>{const action=keyMap[e.code];if(action)keys[action]=false;});
window.addEventListener('blur',()=>{for(const k in keys)keys[k]=false;for(const k in touch)touch[k]=false;});
// Mouse, body and camera share a single yaw. Capture mouse on click so
// continuous rotation works without reaching the edge of the screen.
let pointerX=innerWidth/2,pointerY=innerHeight/2;
const changeFacing=(dx,dy)=>{
  aimYaw-=Math.max(-120,Math.min(120,dx))*.0042;
  aimPitch=THREE.MathUtils.clamp(aimPitch-Math.max(-100,Math.min(100,dy))*.0033,-.62,.77);
};
renderer.domElement.addEventListener('pointerdown',e=>{
  if(!joined||phase!=='battle')return;
  if(e.button===0){
    try{renderer.domElement.requestPointerLock?.()?.catch?.(()=>{});}catch{}
  }
});
document.addEventListener('mousemove',e=>{
  if(!joined||phase!=='battle')return;
  if(document.pointerLockElement===renderer.domElement)changeFacing(e.movementX||0,e.movementY||0);
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(!joined||phase!=='battle'||e.pointerType==='touch')return;
  if(document.pointerLockElement!==renderer.domElement)changeFacing(e.movementX||0,e.movementY||0);
});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('wheel',e=>{camDistance=Math.max(11,Math.min(22,camDistance+Math.sign(e.deltaY)*.65));e.preventDefault();},{passive:false});
const joystick=$('joystick'),stick=$('stick');let stickId=null;
function moveStick(e){
  const rect=joystick.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  let dx=(e.clientX-cx),dy=(e.clientY-cy);const radius=rect.width*.32,mag=Math.hypot(dx,dy);
  if(mag>radius){dx*=radius/mag;dy*=radius/mag;}
  stick.style.transform=`translate(${dx}px,${dy}px)`;
  touch.w=dy<-radius*.2;touch.s=dy>radius*.2;touch.a=dx<-radius*.2;touch.d=dx>radius*.2;
  touch.jump=dy<-radius*.82;
}
joystick.addEventListener('pointerdown',e=>{e.preventDefault();stickId=e.pointerId;joystick.setPointerCapture(e.pointerId);moveStick(e);});
joystick.addEventListener('pointermove',e=>{if(e.pointerId===stickId)moveStick(e);});
function stopStick(e){if(e.pointerId!==stickId)return;stickId=null;stick.style.transform='translate(0px,0px)';for(const k of ['w','s','a','d','jump'])touch[k]=false;}
joystick.addEventListener('pointerup',stopStick);joystick.addEventListener('pointercancel',stopStick);
for(const b of document.querySelectorAll('[data-touch]')){
  const k=b.dataset.touch;
  b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);touch[k]=true;b.classList.add('pressed');});
  const stop=()=>{touch[k]=false;b.classList.remove('pressed');};
  b.addEventListener('pointerup',stop);b.addEventListener('pointercancel',stop);
}
setInterval(()=>{
  if(!joined||phase!=='battle'||socket?.readyState!==WebSocket.OPEN)return;
  const k={};for(const key of Object.keys(keys))k[key]=keys[key]||touch[key];
  if(smallDevice){
    const sx=Number(!!touch.d)-Number(!!touch.a),sz=Number(!!touch.w)-Number(!!touch.s);
    if(sx<0)aimYaw+=.075;else if(sx>0)aimYaw-=.075;
    // On touch screens the horizontal stick steers the whole fighter and camera.
    if(sx!==0&&!touch.s)k.w=true;
    k.a=false;k.d=false;
  }
  socket.send(JSON.stringify({t:'input',k,yaw:aimYaw,pitch:smallDevice?0:aimPitch}));
},50);

function animate(dt){
  elapsed+=dt;
  abilityHud.render();
  for(const f of fireflies){
    f.t+=dt;
    f.mesh.position.y+=Math.sin(elapsed*1.2+f.seed)*.004;
    f.mesh.material.opacity=.36+.23*Math.sin(elapsed*1.8+f.seed*2.1);
  }
  animatePreview(elapsed);
  const meModel=playerModels.get(selfId);
  if(meModel&&phase==='battle'){
    const p=meModel.display;
    const f=new THREE.Vector3(p.x,p.y+1.2,p.z);
    const orbitPitch=THREE.MathUtils.clamp(FOLLOW_CAM_PITCH-aimPitch*.42,.30,.96);
    const orbitRadius=camDistance*Math.cos(orbitPitch);
    const viewYaw=aimYaw;
    const toCam=new THREE.Vector3(p.x-Math.sin(viewYaw)*orbitRadius,p.y+2.3+Math.sin(orbitPitch)*camDistance,p.z-Math.cos(viewYaw)*orbitRadius);
    targetLook.lerp(f,1-Math.exp(-dt*15));
    targetCamera.set(targetLook.x-Math.sin(viewYaw)*orbitRadius,targetLook.y+1.1+Math.sin(orbitPitch)*camDistance,targetLook.z-Math.cos(viewYaw)*orbitRadius);
  }else{
    targetCamera.lerp(new THREE.Vector3(15,15,-19),Math.min(1,dt*1.7));
    targetLook.lerp(new THREE.Vector3(0,1,0),Math.min(1,dt*2));
  }
  camera.position.copy(targetCamera);camera.lookAt(targetLook);
  for(const m of playerModels.values()){
    const p=m.target,d=m.display;
    const t=Math.min(1,dt*12);
    d.x=THREE.MathUtils.lerp(d.x,p.x,t);d.z=THREE.MathUtils.lerp(d.z,p.z,t);d.y=THREE.MathUtils.lerp(d.y,p.y,t);
    d.pitch=THREE.MathUtils.lerp(d.pitch||0,p.pitch||0,t);d.hs=p.hs||0;
    const diff=Math.atan2(Math.sin(p.f-d.f),Math.cos(p.f-d.f));d.f+=diff*t;
    if(p.id===selfId)d.f=aimYaw;
    m.root.position.set(d.x,d.y,d.z);
    // Exact shared heading; never decouple body, weapon and camera yaw.
    m.bodyYaw=d.f;m.root.rotation.y=d.f;m.rightArm.rotation.y=0;
    m.root.visible=true;
    const speed=p.dead?0:p.m;
    m.walkPhase+=dt*(5+speed*8);
    const swingWalk=Math.sin(m.walkPhase)*speed*.64;
    const hitLean=(p.stun||0)*Math.sin(elapsed*13+Number(p.id)*2);
    const flail=(p.spin||0)*Math.sin(elapsed*17+Number(p.id));
    const air=!p.ground&&!p.dead;
    m.leftLeg.rotation.x=swingWalk+hitLean*.52+(air?-.28:0);m.rightLeg.rotation.x=-swingWalk-hitLean*.38+(air?.34:0);
    m.leftLeg.rotation.z=-flail*.28;m.rightLeg.rotation.z=flail*.28;
    m.leftArm.rotation.x=-swingWalk*.65-.14+hitLean*.65+Math.sin(elapsed*5+Number(p.id))*.06;
    m.rightArm.rotation.set(0,0,0);
    m.root.rotation.z=p.dead?Math.min(1.15,m.root.rotation.z+dt*5):THREE.MathUtils.lerp(m.root.rotation.z,hitLean*.46+flail*.20,dt*11);
    if(p.dead)m.root.position.y-=.15;
    if(air)m.root.position.y+=Math.sin(elapsed*8+Number(p.id))*.025;
    const tilt=p.dash>0?-.22:(hitLean*.31+flail*.43);
    m.root.rotation.x=THREE.MathUtils.lerp(m.root.rotation.x,tilt,dt*8);
    m.ring.visible=false;
    m.nameSprite.visible=!p.dead;
    m.headMat.color.set(p.hit>.20?'#f4feff':p.c);m.headMat.emissiveIntensity=p.hit>.20?.72:.06;
    if(p.inv>0&&p.inv<1.2)m.root.visible=Math.floor(elapsed*14)%2===0;
    m.root.updateMatrixWorld(true);
    const held=setWeaponPose(m,p,dt,d);poseHoldingArm(m,held);
    const tip=m.weaponHead||m.weaponGroup.position;
    const heel=new THREE.Vector3(0,0,p.w==='katana'?1.25:.72);m.weaponGroup.localToWorld(heel);
    const bodyAt=new THREE.Vector3(d.x,d.y,d.z);
    const weaponMotion=m.lastWeaponHead?tip.clone().sub(m.lastWeaponHead):new THREE.Vector3();
    if(held&&m.lastBodyAt)weaponMotion.sub(bodyAt.clone().sub(m.lastBodyAt));
    const moved=weaponMotion.length()/Math.max(.001,dt);m.lastBodyAt=bodyAt;
    updateRibbon(m.weaponTrail,heel,tip,elapsed,!p.dead&&['blade','katana','hammer','axe'].includes(p.w)&&moved>3.2,.13);
    m.lastWeaponHead=tip.clone();
    const left=new THREE.Vector3(-.23,1.05,-.10),right=new THREE.Vector3(.23,1.05,-.10);
    m.root.localToWorld(left);m.root.localToWorld(right);
    updateRibbon(m.bodyTrail,left,right,elapsed,!p.dead&&(p.dash>.01||p.shock>.01),.22);
  }
  animateAxeWorld(dt);
  const me=playerModels.get(selfId);
  // The reference has no aim line or target reticle.
  aimGuide.visible=false;
  // No artificial timed electric hazard; the arena is a forest duel ground.
  animateEffects(dt);
  renderer.render(scene,camera);
}
function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);animate(dt);}frame();
addEventListener('resize',()=>{const w=innerWidth,h=innerHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});
connect();

