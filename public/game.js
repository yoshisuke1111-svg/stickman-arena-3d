import * as THREE from '/vendor/three.module.js';

const $ = id => document.getElementById(id);
const host = $('world');
const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
const smallDevice=matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,smallDevice?1.25:1.7));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.28;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#080e1a');
scene.fog = new THREE.FogExp2('#081323',.018);
const camera = new THREE.PerspectiveCamera(63,innerWidth/innerHeight,.1,250);
const clock=new THREE.Clock();
let camYaw=-.45,camPitch=.43,camDistance=7,elapsed=0;
let aimYaw=-.45,aimPitch=0;
const targetLook = new THREE.Vector3(0,1.2,0);
const targetCamera = new THREE.Vector3(13,11,16);
camera.position.copy(targetCamera);

const mat=(color,metal=.1,rough=.7,em=0)=>new THREE.MeshStandardMaterial({color,metalness:metal,roughness:rough,emissive:color,emissiveIntensity:em});
const baseMat=mat('#132339',.55,.52),sideMat=mat('#102034',.72,.4),topMat=mat('#1b3547',.6,.55);
const tealMat=new THREE.MeshBasicMaterial({color:'#49edda'}), pinkMat=new THREE.MeshBasicMaterial({color:'#ff7896'}), goldMat=new THREE.MeshBasicMaterial({color:'#ffbf68'});
function box(w,h,d,m,x=0,y=0,z=0,shadow=true) {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);
  mesh.position.set(x,y,z);mesh.castShadow=shadow;mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
scene.add(new THREE.HemisphereLight('#bceeff','#11253b',1.7));
const sun=new THREE.DirectionalLight('#d6edff',3.1);sun.position.set(-15,27,18);sun.castShadow=true;sun.shadow.mapSize.set(smallDevice?1024:2048,smallDevice?1024:2048);
sun.shadow.camera.left=-24;sun.shadow.camera.right=24;sun.shadow.camera.top=24;sun.shadow.camera.bottom=-24;
sun.shadow.bias=-.00015;sun.shadow.normalBias=.025;scene.add(sun);
const blueLight=new THREE.PointLight('#42b9ec',45,45,2);blueLight.position.set(-10,4,3);scene.add(blueLight);
const amberLight=new THREE.PointLight('#ff9b53',35,35,2);amberLight.position.set(10,4,-6);scene.add(amberLight);

// Arena - floating steel platform, cover blocks, illuminated perimeter and a pulsing hazard.
box(25.1,1,25.1,sideMat,0,-1.0,0);
box(24.1,.5,24.1,topMat,0,-.4,0);
const grid=new THREE.GridHelper(24,24,'#426776','#263e50');grid.position.y=-.132;
for(const m of (Array.isArray(grid.material)?grid.material:[grid.material])){m.transparent=true;m.opacity=.36;}scene.add(grid);
const stripeMat=mat('#35bcba',.3,.25,.85);
for(const i of [-1,1]){
  box(24.6,.16,.10,stripeMat,0,-.06,12.18*i,false);
  box(.1,.16,24.6,stripeMat,12.18*i,-.06,0,false);
}
for(let x=-12;x<=12;x+=3) for(let z of [-12,12]) {
  const m=new THREE.Mesh(new THREE.BoxGeometry(.17,.035,.31),goldMat);m.position.set(x,-.08,z);scene.add(m);
}
for(let z=-12;z<=12;z+=3) for(let x of [-12,12]){
  const m=new THREE.Mesh(new THREE.BoxGeometry(.31,.035,.17),goldMat);m.position.set(x,-.08,z);scene.add(m);
}
const coverMat=mat('#315166',.55,.43),coverAccent=mat('#59b9ca',.48,.28,.5);
const blocks=[[-4.4,-1.6,2.7,2.7,2.15],[4.4,1.6,2.7,2.7,2.15],[-1.6,5.5,2.2,1.9,1.25],[1.6,-5.5,2.2,1.9,1.25]];
for(const [x,z,w,d,h] of blocks){
  box(w,h,d,coverMat,x,h/2,z);
  box(w+.035,.07,d+.035,coverAccent,x,h-.04,z,false);
  for(const side of [-1,1]){box(.085,h*.66,.075,coverAccent,x+side*(w/2-.16),h*.46,z+d/2+.01,false);}
}
for(const [x,z] of [[-11,-11],[11,11],[-11,11],[11,-11]]){
  box(.8,2,.8,sideMat,x,1,z);box(.93,.14,.93,stripeMat,x,2.06,z,false);
  const glow=new THREE.PointLight('#2ed7dc',6,5);glow.position.set(x,2.35,z);scene.add(glow);
}
const hazardCircle=new THREE.Mesh(new THREE.CircleGeometry(2.65,64),new THREE.MeshBasicMaterial({color:'#fd5a76',transparent:true,opacity:.09,side:THREE.DoubleSide,depthWrite:false}));
hazardCircle.rotation.x=-Math.PI/2;hazardCircle.position.y=-.105;scene.add(hazardCircle);
const hazardRing=new THREE.Mesh(new THREE.TorusGeometry(2.65,.07,8,80),new THREE.MeshBasicMaterial({color:'#ff6a79',transparent:true,opacity:.42}));
hazardRing.rotation.x=Math.PI/2;hazardRing.position.y=.005;scene.add(hazardRing);
const crossMat=new THREE.MeshBasicMaterial({color:'#ff6a79',transparent:true,opacity:.2});
for(let a=0;a<4;a++){
  const b=new THREE.Mesh(new THREE.BoxGeometry(4.55,.012,.14),crossMat);
  b.rotation.y=a*Math.PI/4;b.position.y=-.097;scene.add(b);
}
// Distant atmospheric geometry that does not collide with the arena.
const scenery=new THREE.Group();scene.add(scenery);
for(let i=0;i<70;i++){
  const angle=(i/70)*Math.PI*2, r=34+Math.sin(i*15.3)*13;
  const h=2+(i*19%8),w=1.3+(i*7%4);
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),mat(i%4?'#12253b':'#19334a',.55,.75));
  m.position.set(Math.cos(angle)*r,-h/2-3,Math.sin(angle)*r);scenery.add(m);
}
for(let i=0;i<95;i++){
  const a=(i*2.399963),r=16+Math.sqrt(i)*4,y=1+((i*11)%24);
  const m=new THREE.Mesh(new THREE.OctahedronGeometry(.04+(i%5)*.018),new THREE.MeshBasicMaterial({color:i%3?'#4e9eb8':'#d7a77d',transparent:true,opacity:.44+(i%4)*.12}));
  m.position.set(Math.sin(a)*r,y,Math.cos(a)*r);scenery.add(m);
}

const cyl=new THREE.CylinderGeometry(1,1,1,9),ballGeo=new THREE.SphereGeometry(1,14,10),boxGeo=new THREE.BoxGeometry(1,1,1);
function bodyPiece(parent,geo,material,pos,scale){const m=new THREE.Mesh(geo,material);m.position.set(...pos);m.scale.set(...scale);m.castShadow=true;parent.add(m);return m;}
function buildFighter(p){
  const root=new THREE.Group();scene.add(root);
  const dark=mat('#061524',.3,.7),colorMat=mat(p.c||'#43e7db',.27,.4,.6),glow=mat(p.c||'#43e7db',.2,.35,1.2);
  bodyPiece(root,ballGeo,colorMat,[0,1.95,0],[.29,.29,.29]);
  bodyPiece(root,ballGeo,dark,[ -.095,1.985,.263],[.037,.05,.034]);
  bodyPiece(root,ballGeo,dark,[.095,1.985,.263],[.037,.05,.034]);
  bodyPiece(root,cyl,colorMat,[0,1.23,0],[.15,.86,.15]);
  bodyPiece(root,ballGeo,colorMat,[0,.8,0],[.19,.15,.18]);
  bodyPiece(root,ballGeo,glow,[0,1.6,0],[.17,.1,.17]);
  const leftArm=new THREE.Group(),rightArm=new THREE.Group(),leftLeg=new THREE.Group(),rightLeg=new THREE.Group();
  leftArm.position.set(-.26,1.54,0);rightArm.position.set(.26,1.54,0);
  leftLeg.position.set(-.15,.79,0);rightLeg.position.set(.15,.79,0);
  root.add(leftArm,rightArm,leftLeg,rightLeg);
  for(const limb of [leftArm,rightArm]){bodyPiece(limb,cyl,colorMat,[0,-.37,0],[.09,.69,.09]);bodyPiece(limb,ballGeo,colorMat,[0,-.71,0],[.11,.11,.11]);}
  for(const limb of [leftLeg,rightLeg]){bodyPiece(limb,cyl,colorMat,[0,-.37,0],[.1,.75,.1]);bodyPiece(limb,ballGeo,dark,[0,-.76,.12],[.14,.11,.24]);}
  const weaponGroup=new THREE.Group();weaponGroup.position.set(0,-.73,0);rightArm.add(weaponGroup);
  const nameSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(document.createElement('canvas')),depthTest:false,transparent:true}));
  nameSprite.position.set(0,2.68,0);nameSprite.scale.set(2.7,.7,1);root.add(nameSprite);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.48,.56,40),new THREE.MeshBasicMaterial({color:p.c||'#49edda',transparent:true,opacity:.6,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.04;root.add(ring);
  const model={root,leftArm,rightArm,leftLeg,rightLeg,weaponGroup,nameSprite,ring,headMat:colorMat,glow,lastWeapon:'',lastLabel:'',target:p,display:{x:p.x,y:p.y,z:p.z,f:p.f,pitch:p.pitch||0,hs:p.hs||0},bodyYaw:p.f,walkPhase:Math.random()*6.28};
  replaceWeapon(model,p.w);labelSprite(model,p);
  return model;
}
function addPart(g,geo,m,x,y,z,sx=1,sy=1,sz=1){const v=new THREE.Mesh(geo,m);v.position.set(x,y,z);v.scale.set(sx,sy,sz);v.castShadow=true;g.add(v);return v;}
function replaceWeapon(model,w){
  if(model.lastWeapon===w)return;
  const group=model.weaponGroup;
  while(group.children.length){const m=group.children[0];group.remove(m);if(m.geometry!==boxGeo&&m.geometry!==cyl&&m.geometry!==ballGeo)m.geometry?.dispose();}
  const steel=mat('#bbcbd4',.7,.25),black=mat('#1a2939',.8,.3),edge=mat(model.target.c||'#57e7ee',.35,.25,1.2);
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
    addPart(group,cyl,black,0,0,.64,.12,1.5,.12).rotation.x=Math.PI/2;
    addPart(group,boxGeo,steel,0,0,1.47,.92,.15,.72);
    addPart(group,boxGeo,edge,-.47,0,1.47,.12,.18,.73);
    addPart(group,boxGeo,steel,.35,0,1.53,.28,.19,.36);
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
  ctx.fillStyle='rgba(5,17,30,.78)';ctx.beginPath();ctx.roundRect(10,6,300,76,15);ctx.fill();
  ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.fillStyle=p.c;ctx.fillText(p.n.slice(0,14),160,38,285);
  ctx.fillStyle='#314457';ctx.fillRect(26,56,268,11);
  ctx.fillStyle=p.dead?'#a84b5c':p.c;ctx.fillRect(26,56,268*Math.max(0,p.hp)/100,11);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  if(m.nameSprite.material.map)m.nameSprite.material.map.dispose();
  m.nameSprite.material.map=texture;m.nameSprite.material.needsUpdate=true;
}
function destroyModel(m){scene.remove(m.root);m.nameSprite.material.map?.dispose();m.nameSprite.material.dispose();}
const playerModels=new Map();
const bullets=new Map();
const thrownBombs=new Map();
const effects=[];
// An independent 3D guide shows the weapon direction, even when the view orbits.
const aimGuide=new THREE.Group();scene.add(aimGuide);
const guideGeometry=new THREE.BufferGeometry();guideGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
const aimLine=new THREE.Line(guideGeometry,new THREE.LineBasicMaterial({color:'#72ecff',transparent:true,opacity:.62,depthTest:false}));
const aimDot=new THREE.Mesh(new THREE.OctahedronGeometry(.17),new THREE.MeshBasicMaterial({color:'#95f7ff',transparent:true,opacity:.90,depthTest:false}));
aimLine.renderOrder=5;aimDot.renderOrder=6;aimGuide.add(aimLine,aimDot);
let lastPlayers=[];
function syncWorld(players,shots,bombStates=[]){
  const idSet=new Set();
  for(const p of players){
    idSet.add(p.id);
    let model=playerModels.get(p.id);
    if(!model){model=buildFighter(p);playerModels.set(p.id,model);}
    model.target=p;
    if(model.lastWeapon!==p.w)replaceWeapon(model,p.w);
    labelSprite(model,p);
    if(model.headMat.color.getStyle()!==p.c){model.headMat.color.set(p.c);model.glow.color.set(p.c);model.ring.material.color.set(p.c);}
    model.ring.material.opacity=p.id===selfId?.95:.15;
  }
  for(const [id,m] of playerModels)if(!idSet.has(id)){destroyModel(m);playerModels.delete(id);}
  const bulletIds=new Set();
  for(const p of shots){
    bulletIds.add(p.id);
    let b=bullets.get(p.id);
    if(!b){
      const group=new THREE.Group();
      const color=p.kind==='dragon'?'#64f3ff':p.kind==='axeWave'?'#4bf3db':p.kind==='slash'?'#9ceeff':p.color;
      const glowMaterial=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.87,side:THREE.DoubleSide,depthWrite:false});
      if(p.kind==='dragon'){
        // Curved original cyan dragon-energy ribbon, with a head and two horns.
        const points=[];
        for(let i=0;i<=12;i++){const t=i/12;points.push(new THREE.Vector3(Math.sin(t*12)*(.2+t*.26),Math.cos(t*10)*.22,1-t*3.4));}
        const tube=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),28,.12,6,false),glowMaterial);
        group.add(tube);
        const head=new THREE.Mesh(new THREE.ConeGeometry(.38,.75,7),glowMaterial);head.rotation.x=Math.PI/2;head.position.z=1.34;group.add(head);
        for(const side of [-1,1]){
          const horn=new THREE.Mesh(new THREE.ConeGeometry(.095,.55,5),glowMaterial);
          horn.rotation.z=side*.62;horn.position.set(side*.26,.33,1.17);group.add(horn);
        }
      }else if(p.kind==='slash'||p.kind==='axeWave'){
        const crescent=new THREE.Mesh(new THREE.TorusGeometry(p.kind==='axeWave'?1.0:.85,.10,7,36,Math.PI*1.25),glowMaterial);
        crescent.rotation.set(0,0,-.75);group.add(crescent);
        const inner=new THREE.Mesh(new THREE.TorusGeometry(.70,.028,5,28,Math.PI*1.2),glowMaterial);
        inner.rotation.z=-.7;group.add(inner);
      }else{
        const core=new THREE.Mesh(new THREE.SphereGeometry(.2,12,8),new THREE.MeshBasicMaterial({color:p.color}));
        group.add(core);
      }
      const light=new THREE.PointLight(color,3.1,5);group.add(light);scene.add(group);
      b={group,kind:p.kind};bullets.set(p.id,b);
    }
    b.group.position.set(p.x,p.y,p.z);
    b.group.rotation.y=p.f;b.group.rotation.x=-(p.pitch||0);
    b.group.rotation.z=p.kind==='dragon'?Math.sin(elapsed*16)*.08:0;
    if(p.kind==='dragon')b.group.scale.setScalar(1+Math.sin(elapsed*13)*.07);
  }
  for(const [id,b] of bullets)if(!bulletIds.has(id)){
    scene.remove(b.group);
    b.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
    bullets.delete(id);
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
function burst(type,x,y,z,color){
  const group=new THREE.Group();group.position.set(x,y,z);scene.add(group);
  const count=type==='explode'?44:type==='super'?25:type==='ko'?28:12;
  const bits=[];
  for(let i=0;i<count;i++){
    const mesh=new THREE.Mesh(new THREE.OctahedronGeometry(type==='super'?.10:.075),new THREE.MeshBasicMaterial({color:i%4===0?'#ffffff':color,transparent:true,opacity:1}));
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
    if(e.extra)for(const m of e.extra){m.material.opacity=Math.max(0,life*.87);m.scale.setScalar(1+e.t*(e.heavy?3.5:1.5));m.rotation.z+=dt*(e.heavy?1:3);}
    if(e.t>=e.max){scene.remove(e.group);e.group.traverse(obj=>{if(obj.isMesh){obj.geometry.dispose();obj.material.dispose();}});effects.splice(i,1);}
  }
}
// Weapon-specific arcs, ground shock rings, and dramatic impact flashes.
function castEffect(e){
  const model=playerModels.get(e.id);
  const x=Number.isFinite(e.x)?e.x:(model?.display.x??0);
  const y=Number.isFinite(e.y)?e.y:((model?.display.y??0)+1.2);
  const z=Number.isFinite(e.z)?e.z:(model?.display.z??0);
  const kind=e.variant||e.kind||e.weapon||'blade';
  const heavy=/hammer|quake|bang|whirl|cyclone|Shock/i.test(kind);
  const color=/dragon/i.test(kind)?'#69f0ff':/bigBang/i.test(kind)?'#ffba5a':e.color||'#58e9f3';
  const group=new THREE.Group();group.position.set(x,heavy?.15:y,z);scene.add(group);
  const meshes=[];
  const glowing=(size,thickness,angle)=>{
    const mesh=new THREE.Mesh(new THREE.TorusGeometry(size,thickness,8,48,Math.PI*(heavy?1.9:1.32)),
      new THREE.MeshBasicMaterial({color,transparent:true,opacity:.88,side:THREE.DoubleSide,depthWrite:false}));
    mesh.rotation.z=angle;mesh.rotation.y=e.f||model?.display.f||0;
    group.add(mesh);meshes.push(mesh);return mesh;
  };
  if(heavy){
    for(let i=0;i<2;i++){
      const ring=glowing(.8+i*.38,.07+i*.025,0);ring.rotation.x=-Math.PI/2;
    }
  }else{
    const arc=glowing(kind==='swordArc'?1.9:kind==='axeWave'?2.35:1.55,.12,-.3);
    arc.rotation.y=e.f||model?.display.f||0;
    const second=glowing(kind==='swordArc'?1.7:1.35,.045,-.3);second.rotation.y=arc.rotation.y;
  }
  effects.push({group,bits:[],ring:null,extra:meshes,t:0,max:heavy?.85:.45,heavy});
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
let keys={w:false,s:false,a:false,d:false,jump:false,attack:false,thrust:false,skill:false,super:false};
const viewKeys={w:false,s:false,a:false,d:false};
const touch={w:false,s:false,a:false,d:false,jump:false,attack:false,thrust:false,skill:false,super:false};
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
      previousHp=me?.hp??100;
      syncWorld(m.players,m.shots,m.bombs||[]);
      handleEvents(m.events);
      updateScreen();updateStats(m,me);
    } else if(m.t==='error'){
      toast(m.message);$('entryError').textContent=m.message;$('entryError').classList.remove('hidden');
      if(joined){joined=false;selfId=null;roomCode='';latestState=null;phase='home';syncWorld([],[],[]);history.replaceState(null,'',location.pathname);updateScreen();}
    }
  };
  socket.onclose=()=>{
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
  $('matchClock').textContent=`${String(Math.floor(m.time/60)).padStart(2,'0')}:${String(m.time%60).padStart(2,'0')}`;
  if(me){
    $('myName').textContent=me.n;$('hpText').textContent=me.dead?'KO':`${me.hp} HP`;
    $('hpFill').style.width=`${Math.max(0,me.hp)}%`;
    $('hpFill').style.background=me.hp<25?'linear-gradient(90deg,#eb5f66,#f6a26a)':'linear-gradient(90deg,#32c4bb,#7affd1)';
    $('weaponName').textContent=weaponNames[me.w]||me.w;
    $('dashCd').textContent=me.cd[1]>0?me.cd[1].toFixed(1)+'s':'READY';
    $('superCd').textContent=me.cd[2]>0?me.cd[2].toFixed(1)+'s':'READY';
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
      if(['blade','katana','axe','hammer'].includes(e.weapon))castEffect({...e,variant:e.weapon});
      playSound(e.weapon==='hammer'?180:360,.12,'triangle');
    }
    else if(e.type==='skillcast'){castEffect(e);playSound(e.weapon==='katana'?760:265,.22,'sawtooth');}
    else if(e.type==='impact'){castEffect(e);burst('super',e.x,e.y,e.z,e.color);}
    else if(e.type==='super'){castEffect(e);burst('super',e.x,e.y,e.z,e.color);playSound(140,.36,'sawtooth');}
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
const keyMap={Space:'jump',KeyE:'skill',KeyQ:'super'};
const orbitMap={KeyW:'w',KeyS:'s',KeyA:'a',KeyD:'d',ArrowUp:'w',ArrowDown:'s',ArrowLeft:'a',ArrowRight:'d'};
window.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLInputElement||!joined||phase!=='battle')return;
  const view=orbitMap[e.code];if(view){viewKeys[view]=true;e.preventDefault();}
  const action=keyMap[e.code];if(action){keys[action]=true;e.preventDefault();}
  if(e.code==='KeyR'){aimYaw=camYaw;aimPitch=0;toast('武器の向きを視点に合わせた');}
  if(/^Digit[1-6]$/.test(e.code))chooseWeapon(weaponHotkeys[Number(e.code.slice(-1))-1]);
});
window.addEventListener('keyup',e=>{
  const view=orbitMap[e.code];if(view)viewKeys[view]=false;
  const action=keyMap[e.code];if(action)keys[action]=false;
});
window.addEventListener('blur',()=>{
  for(const k in keys)keys[k]=false;
  for(const k in viewKeys)viewKeys[k]=false;
  for(const k in touch)touch[k]=false;
});
const updateAim=(mx,my)=>{
  aimYaw-=mx*.0043;
  aimPitch=THREE.MathUtils.clamp(aimPitch-my*.0043,-1.10,1.20);
};
renderer.domElement.addEventListener('pointerdown',e=>{
  if(!joined||phase!=='battle')return;
  if(e.pointerType==='mouse'&&e.button===0){
    keys.thrust=true;
    try{renderer.domElement.requestPointerLock?.()?.catch?.(()=>{});}catch{}
  }
});
renderer.domElement.addEventListener('pointermove',e=>{
  if(joined&&phase==='battle'&&document.pointerLockElement!==renderer.domElement)
    updateAim(e.movementX||0,e.movementY||0);
});
renderer.domElement.addEventListener('pointerup',e=>{if(e.button===0)keys.thrust=false;});
renderer.domElement.addEventListener('pointercancel',()=>keys.thrust=false);
window.addEventListener('mouseup',e=>{if(e.button===0)keys.thrust=false;});
document.addEventListener('mousemove',e=>{
  if(document.pointerLockElement===renderer.domElement&&joined&&phase==='battle')
    updateAim(e.movementX,e.movementY);
});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('wheel',e=>{camDistance=Math.max(4.3,Math.min(11,camDistance+Math.sign(e.deltaY)*.48));e.preventDefault();},{passive:false});
const joystick=$('joystick'),stick=$('stick');let stickId=null;
function moveStick(e){
  const rect=joystick.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  let dx=(e.clientX-cx),dy=(e.clientY-cy);const radius=rect.width*.32,mag=Math.hypot(dx,dy);
  if(mag>radius){dx*=radius/mag;dy*=radius/mag;}
  stick.style.transform=`translate(${dx}px,${dy}px)`;
  touch.w=dy<-radius*.2;touch.s=dy>radius*.2;touch.a=dx<-radius*.2;touch.d=dx>radius*.2;
}
joystick.addEventListener('pointerdown',e=>{e.preventDefault();stickId=e.pointerId;joystick.setPointerCapture(e.pointerId);moveStick(e);});
joystick.addEventListener('pointermove',e=>{if(e.pointerId===stickId)moveStick(e);});
function stopStick(e){if(e.pointerId!==stickId)return;stickId=null;stick.style.transform='translate(0px,0px)';for(const k of ['w','s','a','d'])touch[k]=false;}
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
  k.thrust=keys.thrust||touch.attack;
  socket.send(JSON.stringify({t:'input',k,yaw:smallDevice?camYaw:aimYaw,pitch:smallDevice?0:aimPitch}));
},50);

function animate(dt){
  elapsed+=dt;
  if(joined&&phase==='battle'){
    const yawSpeed=1.50,pitchSpeed=.86;
    if(viewKeys.a)camYaw+=dt*yawSpeed;
    if(viewKeys.d)camYaw-=dt*yawSpeed;
    if(viewKeys.w)camPitch=Math.min(1.14,camPitch+dt*pitchSpeed);
    if(viewKeys.s)camPitch=Math.max(.10,camPitch-dt*pitchSpeed);
  }
  animatePreview(elapsed);
  const meModel=playerModels.get(selfId);
  if(meModel&&phase==='battle'){
    const p=meModel.display;
    const f=new THREE.Vector3(p.x,p.y+1.2,p.z);
    const orbitRadius=camDistance*Math.cos(camPitch);
    const toCam=new THREE.Vector3(p.x-Math.sin(camYaw)*orbitRadius,p.y+1.3+Math.sin(camPitch)*camDistance,p.z-Math.cos(camYaw)*orbitRadius);
    targetCamera.lerp(toCam,Math.min(1,dt*6));targetLook.lerp(f,Math.min(1,dt*8));
  }else{
    const a=elapsed*.095-.35;
    targetCamera.lerp(new THREE.Vector3(Math.sin(a)*21,12,Math.cos(a)*21),Math.min(1,dt*2.4));
    targetLook.lerp(new THREE.Vector3(0,1,0),Math.min(1,dt*2));
  }
  camera.position.copy(targetCamera);camera.lookAt(targetLook);
  for(const m of playerModels.values()){
    const p=m.target,d=m.display;
    const t=Math.min(1,dt*12);
    d.x=THREE.MathUtils.lerp(d.x,p.x,t);d.z=THREE.MathUtils.lerp(d.z,p.z,t);d.y=THREE.MathUtils.lerp(d.y,p.y,t);
    d.pitch=THREE.MathUtils.lerp(d.pitch||0,p.pitch||0,t);d.hs=p.hs||0;
    const diff=Math.atan2(Math.sin(p.f-d.f),Math.cos(p.f-d.f));d.f+=diff*t;
    m.root.position.set(d.x,d.y,d.z);
    const bodyTurn=Math.atan2(Math.sin(d.f-m.bodyYaw),Math.cos(d.f-m.bodyYaw));
    m.bodyYaw+=bodyTurn*Math.min(1,dt*4.3);m.root.rotation.y=m.bodyYaw;
    const armTurn=Math.atan2(Math.sin(d.f-m.bodyYaw),Math.cos(d.f-m.bodyYaw));
    m.rightArm.rotation.y=THREE.MathUtils.clamp(armTurn,-1.4,1.4);
    m.root.visible=true;
    const speed=p.dead?0:p.m;
    m.walkPhase+=dt*(5+speed*8);
    const swingWalk=Math.sin(m.walkPhase)*speed*.64;
    const hitLean=(p.stun||0)*Math.sin(elapsed*13+Number(p.id)*2);
    const flail=(p.spin||0)*Math.sin(elapsed*17+Number(p.id));
    m.leftLeg.rotation.x=swingWalk+hitLean*.52;m.rightLeg.rotation.x=-swingWalk-hitLean*.38;
    m.leftLeg.rotation.z=-flail*.28;m.rightLeg.rotation.z=flail*.28;
    m.leftArm.rotation.x=-swingWalk*.65-.14+hitLean*.65;
    const strike=p.a>0?Math.sin((.78-p.a)*10)*1.10:0;
    m.rightArm.rotation.x=-(d.pitch||0)-strike*.40-flail*.25+(d.hs>0?Math.sin(elapsed*21)*1.4:0);
    m.rightArm.rotation.z=(d.hs>0?Math.cos(elapsed*21)*1.30:0)+Math.sin(elapsed*12+Number(p.id))*Math.min(1,p.a*.6)+hitLean*.28;
    m.root.rotation.z=p.dead?Math.min(1.15,m.root.rotation.z+dt*5):THREE.MathUtils.lerp(m.root.rotation.z,hitLean*.46+flail*.20,dt*11);
    if(p.dead)m.root.position.y-=.15;
    const tilt=p.dash>0?-.23:(hitLean*.25+flail*.35);
    m.root.rotation.x=THREE.MathUtils.lerp(m.root.rotation.x,tilt,dt*8);
    m.ring.visible=!p.dead;
    m.nameSprite.visible=!p.dead;
    m.root.traverse(obj=>{if(obj.isMesh && obj.material?.emissive && obj!==m.ring){obj.material.emissiveIntensity=p.hit>0?1.7:.45;}});
    if(p.inv>0&&p.inv<1.2)m.root.visible=Math.floor(elapsed*14)%2===0;
  }
  const me=playerModels.get(selfId);
  aimGuide.visible=!!me&&joined&&phase==='battle';
  if(aimGuide.visible){
    const d=me.display,dir=new THREE.Vector3(Math.sin(d.f)*Math.cos(d.pitch||0),Math.sin(d.pitch||0),Math.cos(d.f)*Math.cos(d.pitch||0));
    const from=new THREE.Vector3(d.x,d.y+1.35,d.z);
    const to=from.clone().addScaledVector(dir,3.4);
    const v=aimLine.geometry.attributes.position;v.setXYZ(0,from.x,from.y,from.z);v.setXYZ(1,to.x,to.y,to.z);v.needsUpdate=true;
    aimDot.position.copy(to);aimDot.scale.setScalar(keys.thrust?1.48:1);
  }
  hazardCircle.material.opacity=latestState?.hazard ? .27 : .035;
  hazardRing.material.opacity=latestState?.hazard ? .95 : .35;
  hazardRing.material.color.set(latestState?.hazard?'#ff3862':'#ff966f');
  hazardRing.rotation.z+=dt*.17;
  const scale=1+Math.sin(elapsed*3)*.018;hazardRing.scale.setScalar(scale);
  animateEffects(dt);
  renderer.render(scene,camera);
}
function frame(){requestAnimationFrame(frame);const dt=Math.min(clock.getDelta(),.05);animate(dt);}frame();
addEventListener('resize',()=>{const w=innerWidth,h=innerHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});
connect();
