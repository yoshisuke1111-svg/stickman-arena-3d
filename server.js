import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const BASE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 8;
const MAX_ROOMS = 300;
const BOUNDS = 12;
const STEP = 1 / 30;
// Body heading is the shared movement and camera basis for humans and CPU.
const WALK_SPEED = 6.0;
const JUMP_VELOCITY = 12.8;
const GRAVITY = 12.4;
const WALL_INNER = BOUNDS - .55;
const WALL_HEIGHT = 8;

const COLORS = ['#49e2ed','#ff6e9d','#facb57','#ab8bff','#84ef9d','#ff9a53','#ffe77b','#6ea9ff'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BLOCKS = [
  { x: -4.4, z: -1.6, w: 2.7, d: 2.7, h: 2.15 },
  { x: 4.4, z: 1.6, w: 2.7, d: 2.7, h: 2.15 },
  { x: -1.6, z: 5.5, w: 2.2, d: 1.9, h: 1.25 },
  { x: 1.6, z: -5.5, w: 2.2, d: 1.9, h: 1.25 }
];
// Individual cooldowns keep each weapon's combat role distinct.
const WPN = {
  blade:   { damage: 25, range: 2.65, arc: 1.70, cd: .53, push: 5.6 },
  hammer:  { damage: 38, range: 2.90, arc: 1.95, cd: 1.06, push: 9.0 },
  blaster: { damage: 17, cd: .42, push: 4.5 },
  katana:  { damage: 22, range: 3.35, arc: 1.55, cd: .31, push: 3.6 },
  axe:     { damage: 49, range: 2.95, arc: 1.48, cd: 1.27, push: 12.0 },
  bomb:    { damage: 55, range: 3.6, cd: 1.7, push: 15.0 }
};
const BOMB_FUSE=1.45, BOMB_RADIUS=3.6;
// The footage shows momentum-led contact, heavy knockbacks and separate Skill/Super
// attacks. These are original, approximate mechanics, not extracted game values.
const SKILL_COOLDOWN={blade:5,hammer:7.5,blaster:5.5,katana:6,axe:4.5,bomb:7};
const SUPER_COOLDOWN={blade:18,hammer:20,blaster:17,katana:19,axe:19,bomb:18};
const AXE_SKILLS=['bubbleTunnel','axeThrow','shockBurst'];
const SWORD_DASH_DURATION=.90;
const SHOCK_WINDUP=.44, SHOCK_DURATION=.23;
// Geometry is the same +Z-aligned blade/head used by the client.
const WEAPON_SHAPES={
  blade:{from:.38,to:1.79,radius:.13},
  katana:{from:.88,to:2.79,radius:.11},
  axe:{head:1.47,halfWidth:.46,radius:.31},
  hammer:{head:1.35,halfWidth:.45,radius:.25}
};
const rooms = new Map();
const random = (a,b) => Math.random()*(b-a)+a;
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const dist = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const cleanName = (str) => String(str ?? '').replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,14) || '名無し';
const safeSend = (ws, obj) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
const nowMs = () => Date.now();
const safeWeapon = (w) => WPN[w] ? w : 'blade';
let playerCounter = 0;
function makeCode() {
  for (let tries=0;tries<1000;tries++) {
    const code = Array.from(crypto.randomBytes(5), b => ALPHABET[b % ALPHABET.length]).join('');
    if (!rooms.has(code)) return code;
  }
  return null;
}
function roomMsg(room, obj) { for (const p of room.players.values()) safeSend(p.ws, obj); }
function event(room, type, payload={}) { room.events.push({type,...payload}); if(room.events.length>80) room.events.shift(); }
function spawnPoint(room,p) {
  const humans = [...room.players.values()].filter(q=>q.id!==p.id && !q.dead);
  const candidates = [[-8,-8],[8,8],[-8,8],[8,-8],[0,9],[0,-9],[-9,0],[9,0],[6,-6],[-6,6]];
  let chosen=candidates[0], score=-Infinity;
  for (const c of candidates) {
    const value = (humans.length ? Math.min(...humans.map(q=>Math.hypot(q.x-c[0],q.z-c[1]))) : 10) + random(-1,1);
    if(value>score) { score=value; chosen=c; }
  }
  p.x=chosen[0]+random(-.45,.45); p.z=chosen[1]+random(-.45,.45); p.y=0;
  p.vy=0; p.kvx=0; p.kvz=0; p.hp=100; p.dead=false; p.respawnIn=0; p.invuln=1.25;
  p.facing=Math.atan2(-p.x,-p.z);p.moveFacing=p.facing;p.axeBag=[];p.chargeProgress=0;p.jumpLatch=false; p.pitch=0; p.grounded=true; p.driveX=0; p.driveZ=0; p.aimMotion=0; p.hammerSpin=0; p.hammerPulse=0; p.swing=0; p.dashTime=0; p.hazardNext=0; p.stagger=0; p.spin=0; p.shockDrive=0; p.shockAge=0; p.strikeSide=1; p.motionVX=0; p.motionVY=0; p.motionVZ=0; p.wp=null; resetWeaponPose(p);
}
function makePlayer(name,ws,isBot=false) {
  return {
    id: String(++playerCounter), name: cleanName(name), ws, isBot, color:COLORS[(playerCounter-1)%COLORS.length],
    weapon:'blade', x:0,y:0,z:0,vy:0,kvx:0,kvz:0,driveX:0,driveZ:0, facing:0,pitch:0,aimMotion:0,hp:100,
    input:{}, moveAmount:0, grounded:true, jumpLatch:false, moveFacing:0, dead:false, respawnIn:0, invuln:0,
    attackCd:0, skillCd:0, superCd:0, swing:0, dashTime:0, dashHits:new Set(), hit:0, stagger:0, spin:0,hammerSpin:0,hammerPulse:0,
    hazardNext:0, kills:0, deaths:0, score:0, botDecision:0, botTarget:null,axeBag:[],chargeProgress:0,botMode:0,botJumpTimer:0,
    wp:null,shockDrive:0,shockAge:0,strikeSide:1,motionVX:0,motionVY:0,motionVZ:0
  };
}
function createRoom() {
  if(rooms.size >= MAX_ROOMS) return null;
  const code=makeCode(); if(!code) return null;
  const room = {code, players:new Map(), host:null, phase:'lobby', timer:180, elapsed:0, events:[], projectiles:[], bombs:[], axeTunnels:[], axePulses:[], hazardActive:false, lastActivity:nowMs(), snapAt:0};
  rooms.set(code,room); return room;
}
function packPlayer(p) {
  const wp=ensureWeaponPose(p);
  return {id:p.id,n:p.name,c:p.color,w:p.weapon,x:+p.x.toFixed(2),y:+p.y.toFixed(2),z:+p.z.toFixed(2),f:+p.facing.toFixed(3),bf:+p.facing.toFixed(3),pitch:+p.pitch.toFixed(3),hs:+p.hammerSpin.toFixed(2),
    hp:Math.ceil(p.hp),dead:p.dead,k:p.kills,d:p.deaths,s:p.score,bot:p.isBot,a:+p.swing.toFixed(2),hit:+p.hit.toFixed(2),
    m:+p.moveAmount.toFixed(2),ground:p.grounded,inv:+p.invuln.toFixed(2),stun:+p.stagger.toFixed(2),spin:+p.spin.toFixed(2),cd:[+p.attackCd.toFixed(1),+p.skillCd.toFixed(1),+p.superCd.toFixed(1)],dash:+p.dashTime.toFixed(2),shock:+p.shockDrive.toFixed(2),
    wp:{mode:wp.mode,x:+wp.x.toFixed(3),y:+wp.y.toFixed(3),z:+wp.z.toFixed(3),yaw:+wp.yaw.toFixed(4),pitch:+wp.pitch.toFixed(4),roll:+wp.roll.toFixed(4),vx:+wp.vx.toFixed(3),vy:+wp.vy.toFixed(3),vz:+wp.vz.toFixed(3)}};
}
function packState(room) {
  return {t:'state',room:room.code,phase:room.phase,host:room.host,time:Math.max(0,Math.ceil(room.timer)),
    players:[...room.players.values()].map(packPlayer),shots:room.projectiles.map(b=>({id:b.id,x:+b.x.toFixed(2),y:+b.y.toFixed(2),z:+b.z.toFixed(2),color:b.color,kind:b.kind||'blaster',owner:b.owner,sx:b.sx??b.x,sy:b.sy??b.y,sz:b.sz??b.z,age:+(b.age||0).toFixed(3),travel:+(b.travel||0).toFixed(3),radius:b.radius??.65,f:+Math.atan2(b.dx,b.dz).toFixed(2),pitch:+Math.asin(clamp(b.dy||0,-1,1)).toFixed(2)})),
    bombs:room.bombs.map(b=>({id:b.id,x:+b.x.toFixed(2),y:+b.y.toFixed(2),z:+b.z.toFixed(2),fuse:+b.fuse.toFixed(2),color:b.color})),
    tunnels:room.axeTunnels.map(t=>({id:t.id,owner:t.owner,x:+t.x.toFixed(2),y:+t.y.toFixed(2),z:+t.z.toFixed(2),f:+t.f.toFixed(3),pitch:+t.pitch.toFixed(3),dx:+t.dx.toFixed(4),dy:+t.dy.toFixed(4),dz:+t.dz.toFixed(4),radius:t.radius,length:+t.length.toFixed(2),age:+t.age.toFixed(2),life:+(t.duration-t.age).toFixed(2)})),
    pulses:room.axePulses.map(t=>({id:t.id,owner:t.owner,x:+t.x.toFixed(3),y:+t.y.toFixed(3),z:+t.z.toFixed(3),dx:t.dx,dy:t.dy,dz:t.dz,phase:t.phase,age:+t.age.toFixed(3),burstAge:+t.burstAge.toFixed(3),radius:+t.radius.toFixed(3),maxRadius:t.maxRadius})),
    hazard:false, events:room.events.splice(0)};
}
function broadcastState(room) { roomMsg(room,packState(room)); }
function joinRoom(ws,room,name) {
  if(room.players.size>=MAX_PLAYERS) return safeSend(ws,{t:'error',message:'この部屋は満員です（最大8人）'});
  const p=makePlayer(name,ws);
  ws.player=p; ws.room=room;
  room.players.set(p.id,p);
  if(!room.host) room.host=p.id;
  spawnPoint(room,p);
  if(room.phase==='finished') room.phase='lobby';
  safeSend(ws,{t:'joined',id:p.id,code:room.code});
  event(room,'join',{name:p.name});
  room.lastActivity=nowMs();
  broadcastState(room);
}
function removePlayer(ws) {
  const room=ws.room, p=ws.player;
  if(!room || !p) return;
  room.players.delete(p.id);
  if(room.host===p.id) room.host=[...room.players.values()].find(q=>!q.isBot)?.id || null;
  ws.room=null; ws.player=null;
  if(room.players.size===0 || ![...room.players.values()].some(q=>!q.isBot)) rooms.delete(room.code);
  else { event(room,'leave',{name:p.name});broadcastState(room); }
}
function start(room) {
  room.phase='battle'; room.timer=180; room.elapsed=0; room.events=[]; room.projectiles=[]; room.bombs=[]; room.axeTunnels=[];room.axePulses=[];
  for(const p of room.players.values()) {p.kills=0;p.deaths=0;p.score=0;p.attackCd=0;p.skillCd=0;p.superCd=0;spawnPoint(room,p);}
  event(room,'start'); broadcastState(room);
}
function die(room,p,killer) {
  if(p.dead) return;
  p.hp=0; p.dead=true; p.respawnIn=2.7; p.deaths++;
  p.dashTime=0; p.shockDrive=0; p.hammerSpin=0;
  if(killer && killer.id!==p.id){killer.kills++;killer.score+=100;}
  event(room,'ko',{name:p.name,by:killer?.id!==p.id?killer?.name:null,x:p.x,z:p.z});
}
function damage(room,target,from,dmg,push=5,origin=from,contact=null) {
  if(target.dead || target.invuln>0 || room.phase!=='battle' || (from && from.id===target.id)) return false;
  target.hp-=dmg;target.hit=.38;
  target.stagger=Math.max(target.stagger, Math.min(.9,.16+push*.035));
  target.spin=Math.max(target.spin,Math.min(1.6,push*.064));
  let dx=origin ? target.x-origin.x : target.x;
  let dz=origin ? target.z-origin.z : target.z;
  if(contact && Math.hypot(contact.vx,contact.vz)>.25){dx=contact.vx;dz=contact.vz;}
  let mag=Math.hypot(dx,dz);
  if(mag<.01){ dx=Math.sin(from?.facing||0); dz=Math.cos(from?.facing||0);mag=1;}
  target.kvx+=dx/mag*push; target.kvz+=dz/mag*push;target.vy=Math.max(target.vy,3.5+push*.08);
  if(contact)target.vy+=clamp(contact.vy*.12,-.4,2.5);
  target.grounded=false;
  if(target.wp?.mode==='held'){target.wp.yawVel+=clamp(dx/mag*push*.14,-2.2,2.2);target.wp.pitchVel+=push*.11;}
  event(room,'hit',{x:contact?.x??target.x,y:contact?.y??target.y+1.2,z:contact?.z??target.z,color:target.color,dmg,weapon:contact?.weapon,force:push});
  if(target.hp<=0) die(room,target,from);
  return true;
}
function attack(room,p) {
  if(p.attackCd>0 || p.dead || p.invuln>.85 || room.phase!=='battle') return;
  const pose=ensureWeaponPose(p);
  if(pose.mode!=='held')return;
  const w=WPN[p.weapon]; p.attackCd=w.cd; p.swing=.38;
  event(room,'attack',{id:p.id,weapon:p.weapon,f:p.facing,pitch:p.pitch,x:pose.x,y:pose.y,z:pose.z});
  if(p.weapon==='bomb') {
    if(room.bombs.length>=50)room.bombs.shift();
    const f=p.facing;
    room.bombs.push({id:crypto.randomUUID().slice(0,8),owner:p.id,
      x:pose.x,y:pose.y,z:pose.z,
      vx:Math.sin(f)*10,vy:8.4,vz:Math.cos(f)*10, fuse:BOMB_FUSE,color:p.color});
  } else if(p.weapon==='blaster') {
    if(room.projectiles.length>100)room.projectiles.shift();
    const dir=aimDirection(p.facing,p.pitch);
    room.projectiles.push({id:crypto.randomUUID().slice(0,8),owner:p.id,x:pose.x+dir.x*.9,y:pose.y+dir.y*.9,z:pose.z+dir.z*.9,
      dx:dir.x,dy:dir.y,dz:dir.z,life:1.3,color:p.color});
  } else {
    // A command applies torque. Damage only happens later when this same
    // blade/head crosses an opponent; a button press itself cannot hit.
    p.strikeSide=-(p.strikeSide||1);
    pose.yawVel+=p.strikeSide*(p.weapon==='katana'?11.5:p.weapon==='blade'?10:8.8);
    pose.pitchVel+=2.0;
  }
}

const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const aimDirection=(yaw,pitch)=>({x:Math.sin(yaw)*Math.cos(pitch),y:Math.sin(pitch),z:Math.cos(yaw)*Math.cos(pitch)});
const vecAdd=(a,b,t=1)=>({x:a.x+b.x*t,y:a.y+b.y*t,z:a.z+b.z*t});
const vecSub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const vecDot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const vecLength=v=>Math.hypot(v.x,v.y,v.z);
const vecLerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
function weaponGripPoint(p){
  return {x:p.x+Math.cos(p.facing)*.30+Math.sin(p.facing)*.28,
    y:p.y+1.13,z:p.z-Math.sin(p.facing)*.30+Math.cos(p.facing)*.28};
}
function resetWeaponPose(p){
  const grip=weaponGripPoint(p);
  p.wp={...grip,type:p.weapon,mode:'held',yaw:p.facing,pitch:p.pitch-.22,roll:0,
    vx:0,vy:0,vz:0,yawVel:0,pitchVel:0,travel:0,hitTimes:new Map(),
    previousVX:0,previousVY:0,previousVZ:0};
  return p.wp;
}
function ensureWeaponPose(p){return !p.wp||p.wp.type!==p.weapon?resetWeaponPose(p):p.wp;}
function weaponSegment(p,pose=p.wp){
  const shape=WEAPON_SHAPES[p.weapon];
  const d=aimDirection(pose.yaw,pose.pitch);
  if(!shape)return {a:{...pose},b:vecAdd(pose,d,.7),radius:.12};
  if(shape.head){
    const c=vecAdd(pose,d,shape.head),cy=Math.cos(pose.yaw),sy=Math.sin(pose.yaw),sp=Math.sin(pose.pitch),cp=Math.cos(pose.pitch),cr=Math.cos(pose.roll),sr=Math.sin(pose.roll);
    const side={x:cy*cr-sy*sp*sr,y:cp*sr,z:-sy*cr-cy*sp*sr};
    return {a:vecAdd(c,side,-shape.halfWidth),b:vecAdd(c,side,shape.halfWidth),radius:shape.radius};
  }
  return {a:vecAdd(pose,d,shape.from),b:vecAdd(pose,d,shape.to),radius:shape.radius};
}
function axeHeadPoint(p){const pose=ensureWeaponPose(p);return vecAdd(pose,aimDirection(pose.yaw,pose.pitch),1.47);}
// Slab intersection in all three axes. The same solid boxes occlude damage,
// stop flow volumes, and reflect detached weapons.
function segmentBoxHit(a,b,box,pad=0){
  const lo={x:box.x-box.w/2-pad,y:-.12-pad,z:box.z-box.d/2-pad};
  const hi={x:box.x+box.w/2+pad,y:box.h+pad,z:box.z+box.d/2+pad};
  if(['x','y','z'].every(axis=>a[axis]>=lo[axis]&&a[axis]<=hi[axis])){
    let distance=Infinity,normal={x:0,y:1,z:0};
    for(const axis of ['x','y','z'])for(const side of [-1,1]){
      const gap=side<0?a[axis]-lo[axis]:hi[axis]-a[axis];
      if(gap<distance){distance=gap;normal={x:0,y:0,z:0};normal[axis]=side;}
    }
    return {t:0,normal};
  }
  let enter=0,exit=1,normal={x:0,y:1,z:0};
  for(const axis of ['x','y','z']){
    const delta=b[axis]-a[axis];
    if(Math.abs(delta)<1e-8){if(a[axis]<lo[axis]||a[axis]>hi[axis])return null;continue;}
    let n=-Math.sign(delta),t0=(lo[axis]-a[axis])/delta,t1=(hi[axis]-a[axis])/delta;
    if(t0>t1)[t0,t1]=[t1,t0];
    if(t0>enter){enter=t0;normal={x:0,y:0,z:0};normal[axis]=n;}
    exit=Math.min(exit,t1);if(enter>exit)return null;
  }
  return enter>=0&&enter<=1?{t:enter,normal}:null;
}
function solidAlong(a,b,radius=0){
  let nearest=null;
  for(const box of BLOCKS){const hit=segmentBoxHit(a,b,box,radius);if(hit&&(!nearest||hit.t<nearest.t))nearest=hit;}
  const margin=WALL_INNER-radius;
  for(const axis of ['x','z']){
    if(Math.abs(b[axis])<=margin)continue;
    const side=Math.sign(b[axis]),delta=b[axis]-a[axis];
    const t=Math.abs(delta)>1e-8?clamp((side*margin-a[axis])/delta,0,1):0;
    const normal={x:0,y:0,z:0};normal[axis]=-side;
    if(!nearest||t<nearest.t)nearest={t,normal};
  }
  if(b.y<radius){
    const t=a.y>b.y?clamp((a.y-radius)/(a.y-b.y),0,1):0;
    if(!nearest||t<nearest.t)nearest={t,normal:{x:0,y:1,z:0}};
  }
  return nearest;
}
function isBlocked(a,b) {
  const from={x:a.x,y:a.y+.10,z:a.z},to={x:b.x,y:b.y+.10,z:b.z};
  return BLOCKS.some(box=>segmentBoxHit(from,to,box,.025));
}
// Closest pair on finite segments; the defender is a vertical body capsule.
function segmentClosest(a,b,c,d){
  const u=vecSub(b,a),v=vecSub(d,c),w=vecSub(a,c);
  const A=vecDot(u,u),B=vecDot(u,v),C=vecDot(v,v),D=vecDot(u,w),E=vecDot(v,w);
  const den=A*C-B*B;
  let s=den>1e-10?clamp((B*E-C*D)/den,0,1):0;
  let t=C>1e-10?(B*s+E)/C:0;
  if(t<0){t=0;s=A>1e-10?clamp(-D/A,0,1):0;}
  else if(t>1){t=1;s=A>1e-10?clamp((B-D)/A,0,1):0;}
  const first=vecAdd(a,u,s),second=vecAdd(c,v,t);
  return {distance:vecLength(vecSub(first,second)),first,second,s,t};
}
function heldWeaponBlocked(p,oldPose,oldSegment){
  const pose=p.wp,newSegment=weaponSegment(p,pose);
  let hit=solidAlong(pose,newSegment.a,newSegment.radius)||solidAlong(pose,newSegment.b,newSegment.radius);
  hit ||= solidAlong(oldSegment.a,newSegment.a,newSegment.radius)||solidAlong(oldSegment.b,newSegment.b,newSegment.radius);
  if(!hit)return;
  pose.yaw=oldPose.yaw;pose.pitch=oldPose.pitch;pose.roll=oldPose.roll;
  pose.yawVel*=-.22;pose.pitchVel*=-.22;
  // If the body has moved into the resting blade, let the wrist slide along the
  // solid face. Do not leave a head sticking through a wall while it is held.
  let segment=weaponSegment(p,pose);
  if(solidAlong(pose,segment.a,segment.radius)||solidAlong(pose,segment.b,segment.radius)){
    const original={yaw:pose.yaw,pitch:pose.pitch};
    const candidates=[];
    for(const step of [.24,.48,.76,1.05,1.35,1.65]){
      candidates.push({yaw:original.yaw+step,pitch:original.pitch},{yaw:original.yaw-step,pitch:original.pitch},{yaw:original.yaw,pitch:Math.min(1.45,original.pitch+step)});
    }
    for(const candidate of candidates){
      pose.yaw=candidate.yaw;pose.pitch=candidate.pitch;segment=weaponSegment(p,pose);
      if(!solidAlong(pose,segment.a,segment.radius)&&!solidAlong(pose,segment.b,segment.radius))return;
    }
    pose.yaw=original.yaw;pose.pitch=original.pitch;
  }
}
function testWeaponContact(room,p,before,after,dt,stepFraction){
  const pose=p.wp;if(!WEAPON_SHAPES[p.weapon]||p.dead||p.invuln>.85)return;
  const va=vecSub(after.a,before.a),vb=vecSub(after.b,before.b);
  const swept=Math.max(vecLength(va),vecLength(vb));
  const samples=Math.max(1,Math.ceil(swept/.12));
  for(const q of room.players.values()){
    if(q.id===p.id||q.dead||q.invuln>0||(pose.hitTimes.get(q.id)||0)>room.elapsed)continue;
    const center=q.previousPos?vecLerp(q.previousPos,q,stepFraction):{x:q.x,y:q.y,z:q.z};
    // Body movement contributes relative speed too: walking through a stationary
    // blade is contact, but resting two unmoving weapons together is not damage.
    const velocity={x:(va.x+vb.x)/(.00001+2*dt)-(q.motionVX||0),y:(va.y+vb.y)/(.00001+2*dt)-(q.motionVY||0),z:(va.z+vb.z)/(.00001+2*dt)-(q.motionVZ||0)};
    const speed=vecLength(velocity);if(speed<2.3)continue;
    for(let j=0;j<=samples;j++){
      const t=j/samples,a=vecLerp(before.a,after.a,t),b=vecLerp(before.b,after.b,t);
      const closest=segmentClosest(a,b,{x:center.x,y:center.y+.35,z:center.z},{x:center.x,y:center.y+1.88,z:center.z});
      if(closest.distance>after.radius+.32)continue;
      const bodyPoint=closest.second;
      // No hit through cover even when a fast sweep crosses a corner.
      if(BLOCKS.some(block=>segmentBoxHit(closest.first,bodyPoint,block,.025)))continue;
      if(pose.mode==='held'&&BLOCKS.some(block=>segmentBoxHit(pose,closest.first,block,.025)))continue;
      const active=p.swing>0||p.hammerSpin>0||p.dashTime>0||p.shockDrive>0;
      const impact=clamp(speed/10,active?.65:.28,1.26);
      const w=WPN[p.weapon],amount=Math.round(w.damage*impact),push=w.push*clamp(speed/12,.42,1.35);
      if(damage(room,q,p,amount,push,{x:closest.first.x,y:closest.first.y,z:closest.first.z},{...closest.first,vx:velocity.x,vy:velocity.y,vz:velocity.z,weapon:p.weapon})){
        pose.hitTimes.set(q.id,room.elapsed+(pose.mode==='held'?Math.max(.42,w.cd*.8):.65));
        // Contact takes energy out of the weapon instead of playing an unrelated
        // flash at the attacker's origin. Keep enough momentum to follow through.
        if(pose.mode==='held'){pose.yawVel*=.60;pose.pitchVel*=.65;}
        else {pose.vx*=.83;pose.vy*=.83;pose.vz*=.83;}
      }
      break;
    }
  }
}
function throwAxe(room,p){
  const pose=ensureWeaponPose(p);if(p.weapon!=='axe'||pose.mode!=='held')return false;
  const dir=aimDirection(p.facing,p.pitch);
  pose.mode='outbound';pose.travel=0;pose.flightAge=0;pose.hitTimes.clear();
  pose.vx=dir.x*14+(p.motionVX||0)*.35;
  pose.vy=dir.y*14+(p.motionVY||0)*.15+.8;
  pose.vz=dir.z*14+(p.motionVZ||0)*.35;
  pose.yawVel*=.2;pose.pitchVel*=.2;
  event(room,'weaponRelease',{id:p.id,x:pose.x,y:pose.y,z:pose.z});
  return true;
}
function moveThrownWeapon(room,p,dt){
  const pose=p.wp,grip=weaponGripPoint(p);pose.flightAge=(pose.flightAge||0)+dt;
  if(pose.mode==='outbound'&&pose.travel>=7.8){pose.mode='returning';}
  if(pose.mode==='returning'){
    const delta=vecSub(grip,pose),distance=Math.max(.001,vecLength(delta));
    const rv={x:pose.vx-(p.motionVX||0),y:pose.vy-(p.motionVY||0),z:pose.vz-(p.motionVZ||0)};
    // Bounded attraction preserves velocity. Moving the hand sideways bends the
    // path and can make the axe miss or orbit; no lifetime teleports it home.
    let ax=delta.x/distance*27-rv.x*.66,ay=delta.y/distance*27-rv.y*.66,az=delta.z/distance*27-rv.z*.66;
    const aLength=Math.hypot(ax,ay,az),limit=Math.min(1,34/Math.max(1,aLength));
    pose.vx+=ax*limit*dt;pose.vy+=ay*limit*dt;pose.vz+=az*limit*dt;
  }else pose.vy-=1.7*dt;
  const speed=Math.hypot(pose.vx,pose.vy,pose.vz);
  if(speed>25){const f=25/speed;pose.vx*=f;pose.vy*=f;pose.vz*=f;}
  const previous={x:pose.x,y:pose.y,z:pose.z};
  const next={x:pose.x+pose.vx*dt,y:pose.y+pose.vy*dt,z:pose.z+pose.vz*dt};
  // Move the same rigid axe by a swept volume; a bounce keeps ownership and
  // velocity, it does not delete a projectile and conjure a fresh held copy.
  const oldHead=axeHeadPoint(p),headOffset=vecSub(oldHead,pose);
  const nextHead=vecAdd(next,headOffset);
  const hit=solidAlong(previous,next,.20)||solidAlong(oldHead,nextHead,.43);
  const into=hit?pose.vx*hit.normal.x+pose.vy*hit.normal.y+pose.vz*hit.normal.z:0;
  if(hit&&!(hit.t===0&&into>=0)){
    const position=vecLerp(previous,next,Math.max(0,hit.t-.012));
    pose.x=position.x+hit.normal.x*.02;pose.y=Math.max(.22,position.y+hit.normal.y*.02);pose.z=position.z+hit.normal.z*.02;
    const dot=pose.vx*hit.normal.x+pose.vy*hit.normal.y+pose.vz*hit.normal.z;
    if(dot<0){pose.vx-=1.5*dot*hit.normal.x;pose.vy-=1.5*dot*hit.normal.y;pose.vz-=1.5*dot*hit.normal.z;}
    pose.mode='returning';pose.yawVel*=.6;pose.pitchVel*=.6;
    event(room,'bounce',{kind:'axe',x:oldHead.x,y:oldHead.y,z:oldHead.z});
  }else {pose.x=next.x;pose.y=next.y;pose.z=next.z;}
  pose.travel+=vecLength(vecSub(pose,previous));
  // The footage rotates the axe slowly with its path; it is not a spinning saw.
  const yaw=Math.atan2(pose.vx,pose.vz),pitch=Math.atan2(pose.vy,Math.hypot(pose.vx,pose.vz));
  pose.yawVel+=clamp(angleDelta(yaw,pose.yaw)*5-pose.yawVel*2.8,-8,8)*dt;
  pose.pitchVel+=clamp(angleDelta(pitch,pose.pitch)*4-pose.pitchVel*2.5,-7,7)*dt;
  pose.yawVel=clamp(pose.yawVel,-1.9,1.9);pose.pitchVel=clamp(pose.pitchVel,-1.6,1.6);
  pose.yaw+=pose.yawVel*dt;pose.pitch+=pose.pitchVel*dt;pose.roll+=(clamp(-pose.yawVel*.2,-.35,.35)-pose.roll)*dt*3;
  if(pose.mode==='returning'){
    const distance=vecLength(vecSub(grip,pose));
    const relative=Math.hypot(pose.vx-(p.motionVX||0),pose.vy-(p.motionVY||0),pose.vz-(p.motionVZ||0));
    if(pose.flightAge>.15&&distance<.66&&relative<18){
      pose.mode='held';pose.x=grip.x;pose.y=grip.y;pose.z=grip.z;
      pose.yawVel=clamp(pose.yawVel,-2,2);pose.pitchVel=clamp(pose.pitchVel,-2,2);
      pose.vx=p.motionVX||0;pose.vy=p.motionVY||0;pose.vz=p.motionVZ||0;
      event(room,'weaponCatch',{id:p.id,x:grip.x,y:grip.y,z:grip.z});
      return true;
    }
  }
  return false;
}
function advanceWeapons(room,dt){
  for(const p of room.players.values()){
    const pose=ensureWeaponPose(p);if(p.dead)continue;
    const steps=Math.max(1,Math.ceil(dt/(1/120))),h=dt/steps;
    const start={x:pose.x,y:pose.y,z:pose.z},grip=weaponGripPoint(p);
    if(pose.mode==='held'){
      const dvx=(p.motionVX||0)-pose.previousVX,dvy=(p.motionVY||0)-pose.previousVY,dvz=(p.motionVZ||0)-pose.previousVZ;
      const side=dvx*Math.cos(p.facing)-dvz*Math.sin(p.facing),front=dvx*Math.sin(p.facing)+dvz*Math.cos(p.facing);
      pose.yawVel-=clamp(side*.085,-1.8,1.8);pose.pitchVel+=clamp(front*.07-dvy*.075,-1.6,1.6);
    }
    pose.previousVX=p.motionVX||0;pose.previousVY=p.motionVY||0;pose.previousVZ=p.motionVZ||0;
    for(let step=0;step<steps;step++){
      const oldPose={x:pose.x,y:pose.y,z:pose.z,yaw:pose.yaw,pitch:pose.pitch,roll:pose.roll},before=weaponSegment(p,pose);
      let caught=false;
      if(pose.mode==='held'){
        const next=vecLerp(start,grip,(step+1)/steps);pose.vx=(next.x-pose.x)/h;pose.vy=(next.y-pose.y)/h;pose.vz=(next.z-pose.z)/h;
        pose.x=next.x;pose.y=next.y;pose.z=next.z;
        if(WEAPON_SHAPES[p.weapon]){
          const heavy=p.weapon==='axe'||p.weapon==='hammer';
          const aiming=p.shockDrive>0||p.dashTime>0||room.axePulses.some(t=>t.owner===p.id&&t.phase==='burst');
          if(p.hammerSpin>0)pose.yawVel+=(13-pose.yawVel)*h*7;
          else pose.yawVel+=(angleDelta(p.facing,pose.yaw)*(aiming?46:heavy?14:19)-pose.yawVel*(aiming?6.5:3.4))*h;
          pose.pitchVel+=((p.pitch+(aiming?.08:.025)-pose.pitch)*(aiming?46:19)-pose.pitchVel*(aiming?6.5:3.2)-4.5*Math.cos(pose.pitch))*h;
          pose.yawVel=clamp(pose.yawVel,-15,15);pose.pitchVel=clamp(pose.pitchVel,-9,9);
          pose.yaw+=pose.yawVel*h;pose.pitch=clamp(pose.pitch+pose.pitchVel*h,-1.35,1.4);
          pose.roll+=(clamp(-pose.yawVel*.035,-.36,.36)-pose.roll)*h*7;
          heldWeaponBlocked(p,oldPose,before);
        }else {pose.yaw=p.facing;pose.pitch=p.pitch;pose.roll=0;}
      }else caught=moveThrownWeapon(room,p,h);
      if(caught){start.x=grip.x;start.y=grip.y;start.z=grip.z;}
      const after=weaponSegment(p,pose);
      if(!caught)testWeaponContact(room,p,before,after,h,(step+1)/steps);
    }
    for(const [id,until] of pose.hitTimes)if(until<room.elapsed-2||!room.players.has(id))pose.hitTimes.delete(id);
  }
}

function detonate(room,b) {
  event(room,'explode',{x:b.x,y:Math.max(.1,b.y),z:b.z,radius:BOMB_RADIUS,color:'#ffab54'});
  const owner=room.players.get(b.owner);
  for(const q of room.players.values()) {
    if(q.dead || q.id===b.owner || Math.abs(q.y-b.y)>3.3)continue;
    const d=Math.hypot(q.x-b.x,q.z-b.z);
    if(d>BOMB_RADIUS)continue;
    if(isBlocked({x:b.x,z:b.z,y:b.y},{x:q.x,z:q.z,y:q.y}))continue;
    const factor=1-d/BOMB_RADIUS;
    const damageAmount=Math.round(16+WPN.bomb.damage*factor);
    const force=5+WPN.bomb.push*factor;
    damage(room,q,owner,damageAmount,force,{x:b.x,z:b.z});
  }
}
function advanceBombs(room,dt) {
  for(let i=room.bombs.length-1;i>=0;i--) {
    const b=room.bombs[i];b.fuse-=dt;
    const oldY=b.y;
    b.x+=b.vx*dt;b.z+=b.vz*dt;b.vy-=21*dt;b.y+=b.vy*dt;
    // Floor and crate tops reflect the thrown bombs instead of stopping them instantly.
    let surface=0;
    if(Math.abs(b.x)>WALL_INNER){b.x=clamp(b.x,-WALL_INNER,WALL_INNER);b.vx*=-.55;}
    if(Math.abs(b.z)>WALL_INNER){b.z=clamp(b.z,-WALL_INNER,WALL_INNER);b.vz*=-.55;}
    for(const block of BLOCKS)if(Math.abs(b.x-block.x)<block.w/2+.12 && Math.abs(b.z-block.z)<block.d/2+.12 && oldY>=block.h-.2){
      surface=Math.max(surface,block.h);
    }
    if(b.y<surface+.24 && oldY>=surface-.2 && surface>-1000) {
      b.y=surface+.24;b.vy=Math.abs(b.vy)*.42;
      if(b.vy<1.35)b.vy=0;
      b.vx*=.77;b.vz*=.77;
    }
    if(b.fuse<=0 || b.y<-8){detonate(room,b);room.bombs.splice(i,1);}
  }
}
// Emit a real, server-authoritative moving strike. The client only renders it.
function wave(room,p,kind,offset=0,opts={}) {
  if(room.projectiles.length>=110)room.projectiles.shift();
  const angle=p.facing+offset;
  const speed=opts.speed??(kind==='dragon'?8.3:kind==='axeWave'?8.1:8.8);
  room.projectiles.push({id:crypto.randomUUID().slice(0,8),owner:p.id,kind,
    x:p.x+Math.sin(angle)*1.05,y:p.y+(opts.height??1.35),z:p.z+Math.cos(angle)*1.05,
    dx:Math.sin(angle)*Math.cos(clamp(p.pitch+(opts.pitchOffset??0),-1.1,1.1)),
    dy:Math.sin(clamp(p.pitch+(opts.pitchOffset??0),-1.1,1.1)),
    dz:Math.cos(angle)*Math.cos(clamp(p.pitch+(opts.pitchOffset??0),-1.1,1.1)),
    sx:p.x+Math.sin(angle)*1.05,sy:p.y+(opts.height??1.35),sz:p.z+Math.cos(angle)*1.05,age:0,travel:0,
    speed,life:opts.life??1.2,
    radius:opts.radius??.95,damage:opts.damage??24,push:opts.push??11,
    pierce:opts.pierce??false,hitIds:new Set(),bounces:opts.bounces??0,color:opts.color||p.color});
}
function areaImpact(room,p,radius,amount,push,kind) {
  event(room,'impact',{id:p.id,kind,weapon:p.weapon,x:p.x,y:p.y+1,z:p.z,color:p.color,radius});
  for(const q of room.players.values()){
    if(q.id===p.id||q.dead||Math.abs(p.y-q.y)>3||dist(p,q)>radius||isBlocked(p,q))continue;
    const falloff=Math.max(.52,1-dist(p,q)/(radius*1.9));
    damage(room,q,p,Math.round(amount*falloff),push*falloff);
  }
}
// The blue tube is a persistent directional current, including propulsion of
// its owner. Its position/direction stay fixed after placement.
function placeAxeTunnel(room,p) {
  if(room.axeTunnels.length>=16)room.axeTunnels.shift();
  const f=p.facing,pitch=clamp(p.pitch,-1.1,1.2),dir=aimDirection(f,pitch);
  const source={x:p.x-dir.x*.65,y:p.y+1.13-dir.y*.65,z:p.z-dir.z*.65};
  const maxLength=24,target=vecAdd(source,dir,maxLength);
  const stop=solidAlong(source,target,.10);
  const length=Math.max(.2,(stop?stop.t:1)*maxLength);
  room.axeTunnels.push({id:crypto.randomUUID().slice(0,8),owner:p.id,...source,f,pitch,
    dx:dir.x,dy:dir.y,dz:dir.z,length,radius:1.45,age:0,duration:3.4});
}
function beginShockBurst(room,p){
  p.shockDrive=SHOCK_WINDUP;p.shockAge=0;
  const dir=aimDirection(p.facing,p.pitch),head=axeHeadPoint(p);
  p.shockDirection={x:Math.sin(p.facing),z:Math.cos(p.facing)};
  const pose=ensureWeaponPose(p);
  pose.yawVel+=angleDelta(p.facing,pose.yaw)*4;pose.pitchVel+=(p.pitch-pose.pitch)*4;
  room.axePulses.push({id:crypto.randomUUID().slice(0,8),owner:p.id,...head,
    dx:dir.x,dy:dir.y,dz:dir.z,phase:'windup',age:0,burstAge:0,radius:0,maxRadius:2.2,hitIds:new Set()});
}
function insideCurrent(t,at){
  const v={x:at.x-t.x,y:at.y-t.y,z:at.z-t.z};
  const along=v.x*t.dx+v.y*t.dy+v.z*t.dz;
  const radial=Math.max(0,vecDot(v,v)-along*along);
  return along>=-.35&&along<t.length&&radial<t.radius*t.radius;
}
function applyCurrent(pose,t,dt,body=false){
  const vx=body?pose.kvx:pose.vx,vy=pose.vy,vz=body?pose.kvz:pose.vz;
  const along=vx*t.dx+vy*t.dy+vz*t.dz;
  const fade=clamp(t.age/.12,0,1)*clamp((t.duration-t.age)/.25,0,1);
  // Constant acceleration with a soft terminal speed: motion is accumulated,
  // not a one-off radial explosion. Vertical current can lift against gravity.
  const amount=Math.max(0,1-along/18)*58*fade*dt;
  if(body){pose.kvx+=t.dx*amount;pose.kvz+=t.dz*amount;}
  else {pose.vx+=t.dx*amount;pose.vz+=t.dz*amount;}
  if(body&&t.dy>.08){
    // An ascending stream supplies lift against gravity and drag in the vertical
    // axis as well. Without it a shallow tube looked angled but pushed only along
    // the floor. The player remains free to leave the volume in any direction.
    pose.vy*=Math.exp(-5*dt);pose.vy+=GRAVITY*dt*fade;
  }
  pose.vy+=t.dy*amount;
  if(body&&t.dy*amount>.025)pose.grounded=false;
}
function advanceAxeEffects(room,dt){
  for(let i=room.axeTunnels.length-1;i>=0;i--){
    const t=room.axeTunnels[i];t.age+=dt;
    if(t.age>=t.duration){room.axeTunnels.splice(i,1);continue;}
    for(const q of room.players.values()){
      if(q.dead)continue;
      const center={x:q.x,y:q.y+1.1,z:q.z};
      if(insideCurrent(t,center)&&!isBlocked(t,center))applyCurrent(q,t,dt,true);
      if(q.wp?.mode!=='held'&&q.wp&&insideCurrent(t,q.wp)&&!isBlocked(t,q.wp))applyCurrent(q.wp,t,dt,false);
    }
  }
  for(let i=room.axePulses.length-1;i>=0;i--){
    const pulse=room.axePulses[i],owner=room.players.get(pulse.owner);
    if(!owner||owner.dead||owner.weapon!=='axe'||owner.wp?.mode!=='held'){room.axePulses.splice(i,1);continue;}
    // Windup follows the body's elapsed drive, including skills issued at the
    // end of a tick. The shell cannot start one network frame before the motion.
    pulse.age=pulse.phase==='windup'?owner.shockAge:pulse.age+dt;
    // There is no separate bullet: the small shell blooms around the actual
    // axe head after the owner's short forward motion, then travels with it.
    const center=axeHeadPoint(owner);pulse.x=center.x;pulse.y=center.y;pulse.z=center.z;
    if(pulse.phase==='windup'&&pulse.age>=SHOCK_WINDUP){
      pulse.phase='burst';pulse.burstAge=0;pulse.radius=.12;
      event(room,'shockBloom',{id:pulse.id,owner:owner.id,x:pulse.x,y:pulse.y,z:pulse.z,radius:pulse.maxRadius});
    }
    if(pulse.phase==='burst'){
      const oldRadius=pulse.radius;
      pulse.burstAge+=dt;
      pulse.radius=.12+(pulse.maxRadius-.12)*clamp(pulse.burstAge/SHOCK_DURATION,0,1);
      for(const q of room.players.values()){
        if(q.id===owner.id||q.dead||pulse.hitIds.has(q.id))continue;
        const bodyPoint={x:q.x,y:clamp(pulse.y,q.y+.35,q.y+1.88),z:q.z};
        const distance=vecLength(vecSub(bodyPoint,pulse));
        if(distance>pulse.radius+.32||distance<oldRadius-.32||isBlocked(pulse,bodyPoint))continue;
        if(damage(room,q,owner,31,13,pulse))pulse.hitIds.add(q.id);
      }
      if(pulse.burstAge>=SHOCK_DURATION)room.axePulses.splice(i,1);
    }
  }
}

function skill(room,p) {
  if(p.skillCd>0||p.dead||room.phase!=='battle')return;
  const pose=ensureWeaponPose(p);if(p.weapon==='axe'&&pose.mode!=='held')return;
  p.skillCd=SKILL_COOLDOWN[p.weapon];p.swing=.55;
  let variant='';
  switch(p.weapon){
    case 'blade':
      variant='swordCharge';p.dashTime=SWORD_DASH_DURATION;p.chargeProgress=0;p.dashHits=new Set();p.vy=Math.max(p.vy,Math.max(0,p.pitch)*3);break;
    case 'katana':
      variant='dragon';wave(room,p,'dragon',0,{radius:1.05,damage:33,push:11,life:2.5,speed:8.3,pierce:true,color:'#5ae6ff'});break;
    case 'hammer':
      variant='hammerSpin';p.hammerSpin=1.25;p.hammerPulse=0;pose.yawVel+=7;break;
    case 'axe': {
      // Only the three skills visible in the supplied axe reference are selected.
      if(!p.axeBag?.length){p.axeBag=[...AXE_SKILLS];for(let i=p.axeBag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[p.axeBag[i],p.axeBag[j]]=[p.axeBag[j],p.axeBag[i]];}}
      variant=p.axeBag.pop();
      if(variant==='bubbleTunnel')placeAxeTunnel(room,p);
      else if(variant==='axeThrow')throwAxe(room,p);
      else if(variant==='shockBurst')beginShockBurst(room,p);
      break;
    }
    case 'blaster':
      variant='spread';for(const angle of [-.22,0,.22])wave(room,p,'blaster',angle,{radius:.55,damage:15,push:4.8,life:1.1,speed:23});break;
    case 'bomb':
      variant='cluster';for(const angle of [-.25,0,.25]){
        if(room.bombs.length>=50)room.bombs.shift();
        room.bombs.push({id:crypto.randomUUID().slice(0,8),owner:p.id,x:p.x+Math.sin(p.facing+angle)*.8,y:p.y+1.3,z:p.z+Math.cos(p.facing+angle)*.8,
          vx:Math.sin(p.facing+angle)*9,vy:9,vz:Math.cos(p.facing+angle)*9,fuse:1.05,color:p.color});
      }break;
  }
  event(room,'skillcast',{id:p.id,weapon:p.weapon,variant,x:p.x,y:p.y+1.2,z:p.z,f:p.facing,color:p.color});
}
function superAttack(room,p) {
  if(p.superCd>0||p.dead||room.phase!=='battle')return;
  p.superCd=SUPER_COOLDOWN[p.weapon];p.swing=.78;
  let variant='';
  switch(p.weapon){
    case 'blade':
    case 'katana':
    case 'axe':
    case 'hammer':
      // The supplied four weapons share a forward fan of slashes in the footage.
      // In 3D, five slightly separated aim elevations create a broader fan.
      variant='fanSlashes';
      for(const [i,a] of [-.38,-.19,0,.19,.38].entries())
        wave(room,p,'slash',a,{damage:25,push:10,life:2.8,speed:8.6,radius:.85,pitchOffset:[-.10,.05,0,.05,-.10][i],color:'#a0ecff'});
      break;
    case 'blaster':
      variant='laserFan';for(const a of [-.36,-.18,0,.18,.36])wave(room,p,'blaster',a,{damage:20,push:7,radius:.8,speed:26,life:1.7});break;
    case 'bomb':
      variant='bigBang';areaImpact(room,p,5.4,44,20,'bigBang');break;
  }
  event(room,'super',{id:p.id,weapon:p.weapon,variant,x:p.x,y:p.y+1,z:p.z,color:p.color});
}
function hitBlock(x,z,y) { return BLOCKS.some(o=>Math.abs(x-o.x)<o.w/2+.15 && Math.abs(z-o.z)<o.d/2+.15 && y<o.h); }
function resolveBlocks(p) {
  if(p.y>2.15) return;
  for(const b of BLOCKS){
    if(p.y>b.h-.1)continue;
    const nearestX=clamp(p.x,b.x-b.w/2,b.x+b.w/2);
    const nearestZ=clamp(p.z,b.z-b.d/2,b.z+b.d/2);
    let dx=p.x-nearestX,dz=p.z-nearestZ;const ds=dx*dx+dz*dz;
    if(ds>=.44*.44)continue;
    if(ds>.00001){const distance=Math.sqrt(ds);p.x+=dx/distance*(.44-distance);p.z+=dz/distance*(.44-distance);}
    else {const px=(b.w/2+.44)-Math.abs(p.x-b.x);const pz=(b.d/2+.44)-Math.abs(p.z-b.z);
      if(px<pz)p.x+=Math.sign(p.x-b.x||1)*px;else p.z+=Math.sign(p.z-b.z||1)*pz;}
  }
}
function simulateBot(room,p,dt){
  if(p.dead)return;
  const enemies=[...room.players.values()].filter(q=>q.id!==p.id&&!q.dead);
  if(!enemies.length){p.input={};return;}
  const target=enemies.sort((a,b)=>dist(a,p)-dist(b,p))[0];
  const dx=target.x-p.x,dz=target.z-p.z,d=Math.max(.01,Math.hypot(dx,dz));
  p.facing=Math.atan2(dx,dz);
  p.pitch=clamp(Math.atan2(target.y-p.y,d),-.5,.6);
  p.botDecision-=dt;
  if(p.botDecision<=0){
    p.botDecision=random(.65,1.8);
    p.botMode=Math.floor(random(0,4));
  }
  const ranged=p.weapon==='blaster'||p.weapon==='bomb';
  // Ranged bots sometimes close for a brawl: never retreat endlessly.
  const desired=ranged?(p.botMode===0?3.2:p.botMode===1?5.2:2.8):(p.botMode===2?2.9:1.7);
  let forward=0;
  if(d>desired+.55)forward=1;
  else if(d<desired-.75)forward= p.botMode===3?-.65:.2;
  else forward=p.botMode===0?.3:0;
  let ax=dx/d*forward,az=dz/d*forward;
  const strafe=(p.botMode%2===0?1:-1)*(d<8?.48:.18);
  ax+=dz/d*strafe;az-=dx/d*strafe;
  // Avoid walls instead of pressing against the boundary.
  if(Math.abs(p.x)>WALL_INNER-2)ax+=-Math.sign(p.x)*.95;
  if(Math.abs(p.z)>WALL_INNER-2)az+=-Math.sign(p.z)*.95;
  // Dodge visible incoming shots.
  for(const shot of room.projectiles){
    if(shot.owner===p.id)continue;
    const to=dist(shot,p);if(to>2.8)continue;
    const vx=p.x-shot.x,vz=p.z-shot.z;
    if(vx*shot.dx+vz*shot.dz>0){ax+=shot.dz*.95;az-=shot.dx*.95;break;}
  }
  const length=Math.hypot(ax,az);if(length>.1){ax/=length;az/=length;}
  // Direction is body and camera facing for both human and CPU.
  const sin=Math.sin(p.facing),cos=Math.cos(p.facing);
  const front=ax*sin+az*cos,right=-ax*cos+az*sin;
  const blocked=isBlocked(p,target);
  const jump=(blocked&&p.grounded&&Math.random()<.18)||
    (p.botMode===1&&p.grounded&&Math.random()<.009);
  p.input={w:front>.25,s:front<-.25,d:right>.25,a:right<-.25,jump,
    attack:d<(ranged?9.2:3.3)&&!blocked,
    skill:d<7.5&&Math.random()<.026,super:d<8&&Math.random()<.013};
}

function tick(room,dt) {
  if(room.phase!=='battle') return;
  room.elapsed+=dt;room.timer-=dt;
  if(room.timer<=0){room.timer=0;room.phase='finished'; event(room,'end');broadcastState(room);return;}
  room.hazardActive=false; // Original footage has no artificial periodic arena damage.
  for(const p of room.players.values()){ensureWeaponPose(p);p.previousPos={x:p.x,y:p.y,z:p.z};}
  for(const p of room.players.values()) {
    p.attackCd=Math.max(0,p.attackCd-dt); p.skillCd=Math.max(0,p.skillCd-dt);p.superCd=Math.max(0,p.superCd-dt);
    p.swing=Math.max(0,p.swing-dt);p.hit=Math.max(0,p.hit-dt);p.stagger=Math.max(0,p.stagger-dt);p.spin=Math.max(0,p.spin-dt*1.9);p.invuln=Math.max(0,p.invuln-dt);p.aimMotion=Math.max(0,p.aimMotion-dt*1.1);
    p.hammerSpin=Math.max(0,p.hammerSpin-dt);
    if(p.dead){p.respawnIn-=dt;if(p.respawnIn<=0)spawnPoint(room,p);continue;}
    if(p.isBot) simulateBot(room,p,dt);
    const k=p.input||{};
    let vx=(Number(!!k.d)-Number(!!k.a)),vz=(Number(!!k.w)-Number(!!k.s));
    const length=Math.hypot(vx,vz)||1;vx/=length;vz/=length;
    // Body, camera and intended weapon direction share this movement basis.
    const sin=Math.sin(p.facing),cos=Math.cos(p.facing);
    let dx=-vx*cos+vz*sin,dz=vz*cos+vx*sin;
    p.moveAmount=(!!k.w||!!k.a||!!k.s||!!k.d)?1:0;
    p.moveFacing=p.facing; // weapon, torso and camera share this yaw
    // Clear legacy B-mode momentum so returning players and bots are equal.
    p.driveX=0;p.driveZ=0;
    let speed=WALK_SPEED;
    if(p.dashTime>0){
      p.dashTime=Math.max(0,p.dashTime-dt);
      p.chargeProgress=Math.min(1,p.chargeProgress+dt/SWORD_DASH_DURATION);
      dx=Math.sin(p.facing);dz=Math.cos(p.facing);
      speed=WALK_SPEED+5.8*Math.sin(Math.PI*p.chargeProgress);
    }
    if(p.shockDrive>0){
      const progress=clamp((p.shockAge+dt*.5)/SHOCK_WINDUP,0,1);
      dx=p.shockDirection?.x??Math.sin(p.facing);dz=p.shockDirection?.z??Math.cos(p.facing);
      speed=14*Math.sin(Math.PI*progress);
      p.shockAge+=dt;p.shockDrive=Math.max(0,SHOCK_WINDUP-p.shockAge);
    }
    // Substepping prevents high-speed knockback/dashes from tunnelling into cover.
    const moveX=(dx*speed+p.kvx)*dt,moveZ=(dz*speed+p.kvz)*dt;
    const subdivisions=Math.max(1,Math.ceil(Math.hypot(moveX,moveZ)/.22));
    for(let i=0;i<subdivisions;i++){
      p.x+=moveX/subdivisions;p.z+=moveZ/subdivisions;resolveBlocks(p);
      if(Math.abs(p.x)>WALL_INNER){p.x=clamp(p.x,-WALL_INNER,WALL_INNER);p.kvx=0;}
      if(Math.abs(p.z)>WALL_INNER){p.z=clamp(p.z,-WALL_INNER,WALL_INNER);p.kvz=0;}
    }
    p.kvx*=Math.exp(-5*dt);p.kvz*=Math.exp(-5*dt);
    const overFloor = Math.abs(p.x)<=BOUNDS && Math.abs(p.z)<=BOUNDS;
    if(k.jump&&p.grounded&&!p.jumpLatch){p.vy=JUMP_VELOCITY;p.grounded=false;}
    p.jumpLatch=!!k.jump;
    const oldY=p.y;
    p.vy-=GRAVITY*dt;p.y+=p.vy*dt;
    // Tops are real collision surfaces; a fighter must not sink into a platform.
    let floor=overFloor?0:-Infinity;
    if(p.vy<=0)for(const b of BLOCKS){
      if(Math.abs(p.x-b.x)<b.w/2-.08 && Math.abs(p.z-b.z)<b.d/2-.08 && oldY>=b.h-.18)
        floor=Math.max(floor,b.h);
    }
    if(p.y<=floor && oldY>=floor-.18){p.y=floor;p.vy=0;p.grounded=true;}
    else p.grounded=false;
    p.motionVX=(p.x-p.previousPos.x)/dt;p.motionVY=(p.y-p.previousPos.y)/dt;p.motionVZ=(p.z-p.previousPos.z)/dt;
    if(p.y<-9){die(room,p,null);continue;}
    // Ordinary swing follows movement, as in the supplied footage. Click remains
    // an optional deliberate swing for precise PC combat.
    const melee= !['blaster','bomb'].includes(p.weapon);
    const near=melee&&[...room.players.values()].some(q=>q.id!==p.id&&!q.dead&&dist(p,q)<WPN[p.weapon].range+.5);
    if((!melee&&k.attack)||(melee&&(k.attack||(near&&(p.moveAmount>.2||p.aimMotion>.15||p.dashTime>0)))))attack(room,p);
    if(k.skill)skill(room,p);
    if(k.super)superAttack(room,p);

    if(p.dashTime===0)p.dashHits.clear();
  }
  advanceWeapons(room,dt);
  for(let i=room.projectiles.length-1;i>=0;i--){
    const b=room.projectiles[i];b.life-=dt;b.age=(b.age||0)+dt;
    const speed=b.speed??(b.kind==='blaster'?16:8.8),travel=speed*dt;
    const steps=Math.max(1,Math.ceil(travel/.19));
    let remove=b.life<=0;
    for(let step=0;step<steps&&!remove;step++){
      const oldX=b.x,oldZ=b.z,oldY=b.y;
      b.x+=b.dx*travel/steps;b.y+=(b.dy||0)*travel/steps;b.z+=b.dz*travel/steps;b.travel=(b.travel||0)+travel/steps;
      const collisionRadius=b.kind==='dragon'?.44:b.kind==='slash'?.25:.15;
      const oldPoint={x:oldX,y:oldY,z:oldZ};
      const collision=solidAlong(oldPoint,b,collisionRadius);
      if(collision){
        const contact=vecLerp(oldPoint,b,collision.t);
        b.x=contact.x;b.y=contact.y;b.z=contact.z;
        event(room,'projectileBreak',{kind:b.kind,x:b.x,y:b.y,z:b.z});remove=true;
        break;
      }
      const radius=b.radius??.65;
      const owner=room.players.get(b.owner);
      for(const q of room.players.values()){
        if(q.id===b.owner||q.dead||b.hitIds?.has(q.id))continue;
        if(Math.hypot(b.x-q.x,b.z-q.z)<radius+.32&&Math.abs(b.y-(q.y+1.2))<1.55){
          if(isBlocked(b,{x:q.x,y:q.y+1.2,z:q.z}))continue;
          if(damage(room,q,owner,b.damage??17,b.push??5)){
            if(!b.hitIds)b.hitIds=new Set();b.hitIds.add(q.id);
            if(!b.pierce){remove=true;break;}
          }
        }
      }
    }
    if(remove)room.projectiles.splice(i,1);
  }
  advanceAxeEffects(room,dt);
  advanceBombs(room,dt);
}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size}));}
  let filename;
  if(/^\/vendor\/three\.(?:module|core|tsl|webgpu|webgpu\.nodes)(?:\.min)?\.js$/.test(pathname))filename=path.join(BASE,'node_modules/three/build',path.basename(pathname));
  else if(pathname==='/'||pathname==='/index.html')filename=path.join(BASE,'public/index.html');
  else filename=path.resolve(BASE,'public','.'+pathname);
  const publicRoot=path.resolve(BASE,'public');
  if(!(filename.startsWith(publicRoot+path.sep)||filename===path.join(BASE,'public/index.html')||(/^\/vendor\/three\.(?:module|core|tsl|webgpu|webgpu\.nodes)(?:\.min)?\.js$/.test(pathname)))){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(filename,(err,buf)=>{if(err){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'content-type':MIME[path.extname(filename)]||'application/octet-stream','cache-control':'no-store'});res.end(buf);});
});
const wss=new WebSocketServer({server,path:'/ws',maxPayload:2048});
wss.on('connection',ws=>{
  ws.isAlive=true;
  ws.on('pong',()=>{ws.isAlive=true;});
  safeSend(ws,{t:'hello',version:'0.4.0'});
  ws.on('message',(data)=>{
    let m;
    try {m=JSON.parse(data.toString());} catch {return;}
    if(!m || typeof m!=='object' || typeof m.t!=='string')return;
    if(m.t==='create'&&!ws.room){
      const room=createRoom(); if(!room)return safeSend(ws,{t:'error',message:'現在部屋を作れません'});
      joinRoom(ws,room,m.name);
    } else if(m.t==='join'&&!ws.room){
      const code=String(m.code||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,5);
      const room=rooms.get(code);if(!room)return safeSend(ws,{t:'error',message:'部屋が見つかりません。コードを確認してください'});
      joinRoom(ws,room,m.name);
    } else if(ws.room && ws.player){
      const room=ws.room,p=ws.player;
      if(m.t==='input'){
        const k=m.k;
        if(!k||typeof k!=='object'||Array.isArray(k))return;
        p.input={};for(const key of ['w','s','a','d','jump','attack','skill','super'])p.input[key]=k[key]===true;
        if(Number.isFinite(m.yaw)){
          const aimed=Math.atan2(Math.sin(m.yaw),Math.cos(m.yaw));
          p.aimMotion=Math.min(1.3,p.aimMotion+Math.abs(Math.atan2(Math.sin(aimed-p.facing),Math.cos(aimed-p.facing)))*2.5);
          p.facing=aimed;
        }
        if(Number.isFinite(m.pitch)){const v=clamp(m.pitch,-1.10,1.20);p.aimMotion=Math.min(1.3,p.aimMotion+Math.abs(v-p.pitch));p.pitch=v;}
      } else if(m.t==='weapon'){
        const nextWeapon=safeWeapon(m.weapon);
        if(ensureWeaponPose(p).mode==='held'&&nextWeapon!==p.weapon){
          p.weapon=nextWeapon;p.shockDrive=0;p.shockAge=0;p.hammerSpin=0;p.hammerPulse=0;p.dashTime=0;p.chargeProgress=0;p.swing=0;p.dashHits.clear();
          room.axePulses=room.axePulses.filter(effect=>effect.owner!==p.id);
          resetWeaponPose(p);
        }
      }
      else if(m.t==='start'&&room.host===p.id){start(room);}
      else if(m.t==='bot'&&room.host===p.id && room.players.size<MAX_PLAYERS){
        const bot=makePlayer('CPU '+(room.players.size),'',true);bot.weapon=['blade','katana','hammer','axe','blaster','bomb'][(room.players.size-1)%6];
        room.players.set(bot.id,bot);spawnPoint(room,bot);event(room,'join',{name:bot.name});broadcastState(room);
      } else if(m.t==='removeBots'&&room.host===p.id){
        for(const q of room.players.values())if(q.isBot)room.players.delete(q.id);
        broadcastState(room);
      } else if(m.t==='lobby'&&room.host===p.id){room.phase='lobby';room.projectiles=[];room.bombs=[];room.axeTunnels=[];room.axePulses=[];for(const q of room.players.values()){q.hammerSpin=0;q.shockDrive=0;resetWeaponPose(q);}broadcastState(room);}
      room.lastActivity=nowMs();
    }
  });
  ws.on('close',()=>removePlayer(ws));ws.on('error',()=>{});
});
const tickTimer=setInterval(()=>{
  for(const room of rooms.values()){
    tick(room,STEP);
    // 30 snapshots/s preserve short contact impulses and the 0.23 s shell.
    broadcastState(room);
    if(nowMs()-room.lastActivity>60*60*1000)rooms.delete(room.code);
  }
},1000/30);
const pingTimer=setInterval(()=>{
  for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}
},30000);
server.listen(PORT,'0.0.0.0',()=>console.log(`Stick Arena 3D listening on http://localhost:${PORT}`));
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{clearInterval(tickTimer);clearInterval(pingTimer);wss.close();server.close(()=>process.exit(0));});
