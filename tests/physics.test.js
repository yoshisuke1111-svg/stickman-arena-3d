import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, place, advance } from './engine-harness.js';

const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const targetHits=(room,p)=>room.events.filter(e=>e.type==='hit'&&e.color===p.color);

// These tests check observable outcomes (contact, displacement, return failure,
// and lifecycle), using the authoritative 30 Hz tick rather than copied formulas.
test('proximity alone does not damage a target outside the stationary blade',()=>{
  const {api,room,p2}=battle({weapon:'blade'},{x:1.5,z:1.4});
  advance(api,room,.8);
  assert.equal(p2.hp,100);assert.equal(targetHits(room,p2).length,0);
});

test('resting contact alone cannot repeatedly drain health',()=>{
  const {api,room,p2}=battle({weapon:'blade'},{x:.3,z:1.7});
  advance(api,room,.6);
  assert.equal(p2.hp,100);assert.equal(targetHits(room,p2).length,0);
});

test('a fast blade crossing is caught between snapshots and the hit removes angular momentum',()=>{
  const run=target=>{
    const state=battle({weapon:'katana'},target?{x:.3,z:2.9}:{});
    const {api,room,p1}=state;
    Object.assign(p1.wp,{yaw:-.24,pitch:0,yawVel:15});p1.swing=.3;
    const before=api.weaponSegment(p1);api.advanceWeapons(room,1/30);
    return {...state,before,after:api.weaponSegment(p1)};
  };
  const clear=run(false),hit=run(true);
  assert.ok(clear.before.b.x<-.2&&clear.after.b.x>.85,
    'without contact, the tip crosses both sides of the target between 30 Hz snapshots');
  assert.ok(hit.p2.hp<100,'continuous motion intersects the target during that crossing');
  assert.ok(Math.abs(hit.p1.wp.yawVel)<Math.abs(clear.p1.wp.yawVel),'the physical hit also slows the weapon');
});

test('one moving blade cannot damage the same target on every substep',()=>{
  const {api,room,p1,p2}=battle({weapon:'blade',input:{w:true}},{x:.3,z:2.4,hp:1000});
  for(let i=0;i<10;i++){
    Object.assign(p2,{x:.3,y:0,z:2.4,vy:0,kvx:0,kvz:0});
    api.tick(room,1/30);
  }
  assert.equal(targetHits(room,p2).length,1);
  assert.ok(p2.hp<1000&&p2.hp>950,'contact has a meaningful hit, not repeated frame damage');
  assert.equal(p1.attackCd,0,'no scripted melee attack cooldown');
});

test('weapon orientation lags a turn, carries momentum past it, and settles',()=>{
  const {api,room,p1}=battle({weapon:'axe'});
  const target=Math.PI/2;p1.facing=target;api.tick(room,1/30);
  assert.ok(Math.abs(p1.wp.yaw-target)>.8,'the weapon is not rigidly snapped to the new aim');
  let largest=p1.wp.yaw;
  for(let i=0;i<70;i++){api.tick(room,1/30);largest=Math.max(largest,p1.wp.yaw);}
  assert.ok(largest>target+.04,'angular momentum produces a visible overshoot');
  assert.ok(Math.abs(p1.wp.yaw-target)<.12,'the spring eventually settles toward the aimed direction');
});

test('throw releases the held axe, reports that same pose, and disables empty-hand swings',()=>{
  const {api,room,p1}=battle({weapon:'axe',x:-8,z:-8});
  const original=p1.wp;
  assert.equal(api.throwAxe(room,p1),true);assert.equal(p1.wp,original);
  assert.equal(p1.wp.mode,'outbound');
  assert.equal(api.throwAxe(room,p1),false,'a detached axe cannot be duplicated');
  const packet=api.packState(room).players.find(p=>p.id===p1.id);
  assert.equal(packet.wp.mode,'outbound');assert.equal(packet.wp.x,+original.x.toFixed(3));
  assert.equal(room.projectiles.filter(q=>q.kind==='axeThrown').length,0);
  const count=room.events.length;api.attack(room,p1);
  assert.equal(p1.attackCd,0);assert.equal(room.events.length,count);
});

test('return begins after outward travel and brakes over time instead of reversing instantly',()=>{
  const {api,room,p1}=battle({weapon:'axe',x:-8,z:-8});
  api.throwAxe(room,p1);const launch={x:p1.wp.x,y:p1.wp.y,z:p1.wp.z};
  advance(api,room,.25);assert.equal(p1.wp.mode,'outbound');
  for(let i=0;i<40&&p1.wp.mode==='outbound';i++)api.tick(room,1/30);
  assert.equal(p1.wp.mode,'returning');assert.ok(gap(p1.wp,launch)>5);
  assert.ok(p1.wp.vz>5,'returning is an attraction state, not a velocity reversal');
  const previous={vx:p1.wp.vx,vy:p1.wp.vy,vz:p1.wp.vz};api.tick(room,1/30);
  const delta=Math.hypot(p1.wp.vx-previous.vx,p1.wp.vy-previous.vy,p1.wp.vz-previous.vz);
  assert.ok(delta<1.6,`steering acceleration stays finite: delta-v=${delta}`);
});

test('an axe can overshoot its stationary hand before later being caught',()=>{
  const {api,room,p1}=battle({weapon:'axe',x:-8,z:-8});api.throwAxe(room,p1);
  let passedNear=false,overshot=false,caught=false;
  for(let i=0;i<150;i++){
    api.tick(room,1/30);const w=p1.wp,g=api.weaponGripPoint(p1),distance=gap(w,g);
    if(w.mode==='returning'&&distance<.7)passedNear=true;
    if(passedNear&&w.mode==='returning'&&distance>1)overshot=true;
    if(w.mode==='held'){caught=true;assert.ok(gap(w,g)<.01);break;}
  }
  assert.ok(passedNear&&overshot,'high return speed can carry the axe through the hand');
  assert.ok(caught,'continued attraction can recover the same axe after overshoot');
  assert.ok(Math.hypot(p1.wp.vx,p1.wp.vy,p1.wp.vz)<.1,'catch does not synthesize a damaging velocity spike');
});

test('a moving owner can make the return miss and the axe is not teleported home by a timer',()=>{
  const {api,room,p1}=battle({weapon:'axe',x:-8,z:-8});api.throwAxe(room,p1);
  for(let i=0;i<100;i++){
    if(p1.wp.mode==='returning')p1.input={d:true};
    api.tick(room,1/30);
  }
  assert.equal(p1.wp.mode,'returning');
  assert.ok(gap(p1.wp,api.weaponGripPoint(p1))>1);
  assert.equal(room.projectiles.length,0);
  assert.ok(Number.isFinite(p1.wp.x+p1.wp.y+p1.wp.z));
});

test('a thrown axe bounces off the outer wall without disappearing or crossing it',()=>{
  const {api,room,p1}=battle({weapon:'axe',x:8,z:-8,facing:Math.PI/2},{x:-8,z:8});
  api.throwAxe(room,p1);const same=p1.wp;
  let bounced=false;
  for(let i=0;i<24;i++){
    api.tick(room,1/30);
    assert.equal(p1.wp,same);assert.ok(p1.wp.x<=11.46);
    if(room.events.some(e=>e.type==='bounce'&&e.kind==='axe'))bounced=true;
  }
  assert.ok(bounced);assert.notEqual(p1.wp.mode,'outbound');
});

test('cover stops a thrown axe and shields the fighter on its far side',()=>{
  const {api,room,p1,p2}=battle({weapon:'axe',x:-8,z:-1.6,facing:Math.PI/2},{x:-2.5,z:-1.6});
  api.throwAxe(room,p1);advance(api,room,1.0);
  assert.equal(p2.hp,100);assert.ok(room.events.some(e=>e.type==='bounce'&&e.kind==='axe'));
  assert.ok(p1.wp.x<-5.75,'the axe cannot emerge through the back of the cover');
});

test('the long current accelerates its owner and another occupant, but not an outsider',()=>{
  const {api,room,p1,p2}=battle({weapon:'axe',x:-8,z:-9},{x:-8,z:0});
  const outside=api.makePlayer('Outside','');place(api,outside,{x:-10.5,z:0});room.players.set(outside.id,outside);
  api.placeAxeTunnel(room,p1);assert.ok(room.axeTunnels[0].length>16,'an unobstructed lane gives a long tube');
  advance(api,room,.3);
  assert.ok(p1.z>-8.7&&p1.kvz>2,'the caster receives real propulsion');
  assert.ok(p2.z>.3&&p2.kvz>2,'other bodies in the flow receive propulsion');
  assert.equal(outside.z,0);assert.equal(outside.kvz,0);
  assert.equal(p2.hp,100,'flow alone is not an unrelated explosion');
});

test('a tilted current lifts an occupant along the aimed direction without a jump input',()=>{
  const {api,room,p1}=battle({weapon:'axe',x:-8,z:-8,pitch:Math.PI/4});
  api.placeAxeTunnel(room,p1);advance(api,room,.45);
  assert.ok(p1.y>.2&&p1.vy>0,`upward propulsion: y=${p1.y}, vy=${p1.vy}`);
  assert.ok(p1.z>-8);assert.equal(p1.input.jump,undefined);
});

test('flow terminates at cover and cannot push a body or damage a target through it',()=>{
  const {api,room,p1,p2}=battle({weapon:'axe',x:-8,z:-1.6,facing:Math.PI/2},{x:-2.5,z:-1.6});
  api.placeAxeTunnel(room,p1);assert.ok(room.axeTunnels[0].length<4);
  advance(api,room,1.2);
  assert.ok(p1.x<=-6.18,`body remains outside cover: ${p1.x}`);
  assert.equal(p2.x,-2.5);assert.equal(p2.kvx,0);assert.equal(p2.hp,100);
});

test('the current also adds momentum to the detached axe travelling through it',()=>{
  const run=current=>{
    const {api,room,p1}=battle({weapon:'axe',x:-8,z:-9});
    if(current)api.placeAxeTunnel(room,p1);
    api.throwAxe(room,p1);advance(api,room,.25);return p1.wp;
  };
  const plain=run(false),flow=run(true);
  assert.equal(plain.mode,'outbound');assert.equal(flow.mode,'outbound');
  assert.ok(flow.vz>plain.vz+.5);assert.ok(flow.z>plain.z);
});

test('shock first advances the wielder, then expands at the actual axe head and hits on arrival',()=>{
  const {api,room,p1,p2}=battle({weapon:'axe'},{x:2.1,z:5.45,hp:1000});
  p1.axeBag=['shockBurst'];api.skill(room,p1);
  assert.equal(room.projectiles.length,0);assert.equal(room.axePulses[0].phase,'windup');
  assert.equal(room.axePulses[0].radius,0);assert.equal(p2.hp,1000);
  advance(api,room,.4);
  assert.ok(p1.z>2.5,'the fighter itself moves forward before the shell');
  assert.equal(room.axePulses[0].phase,'windup');assert.equal(p2.hp,1000);
  for(let i=0;i<6&&room.axePulses[0]?.phase!=='burst';i++)api.tick(room,1/30);
  const pulse=room.axePulses[0],head=api.weaponSegment(p1);
  const headCenter={x:(head.a.x+head.b.x)/2,y:(head.a.y+head.b.y)/2,z:(head.a.z+head.b.z)/2};
  assert.equal(pulse.phase,'burst');assert.ok(gap(pulse,headCenter)<.02);
  assert.ok(pulse.radius<1);assert.equal(p2.hp,1000,'a remote target waits for the expanding shell');
  advance(api,room,.3);
  assert.equal(p2.hp,969);assert.equal(targetHits(room,p2).length,1);
  assert.equal(room.axePulses.length,0,'the short-lived shell is removed after expanding');
});

test('an expanding shock shell is occluded by solid cover',()=>{
  const run=(offset)=>{
    const {api,room,p1,p2}=battle({weapon:'axe',x:2.3+offset,z:0},{x:3.8+offset,z:3.4});
    api.beginShockBurst(room,p1);p1.shockAge=1;p1.shockDrive=0;
    // The forward motion has finished. Isolate shell propagation at a fixed head position, keeping the real
    // geometry and real collision function; body motion is tested above.
    for(let i=0;i<25;i++)api.advanceAxeEffects(room,1/30);
    return p2.hp;
  };
  assert.equal(run(0),100,'the diagonal from head to target crosses a cover corner');
  assert.ok(run(-4)<100,'the same spacing in open air is within shell reach');
});

test('weapon switching is only available outside battle',()=>{
  const {api,room,a,p1}=battle({weapon:'axe',x:-8,z:-8});
  api.throwAxe(room,p1);const released=p1.wp;
  a.receive({t:'weapon',weapon:'hammer'});
  assert.equal(p1.weapon,'axe');assert.equal(p1.wp,released);
  api.start(room);a.receive({t:'weapon',weapon:'hammer'});
  assert.equal(p1.weapon,'axe','even a held weapon cannot be changed mid-match');
  a.receive({t:'lobby'});a.receive({t:'weapon',weapon:'hammer'});
  assert.equal(p1.weapon,'hammer');assert.equal(p1.wp.type,'hammer');assert.equal(p1.wp.mode,'held');
});

test('changing a held weapon cancels its pending shock movement and shell',()=>{
  const {api,room,a,p1}=battle({weapon:'axe'});
  api.beginShockBurst(room,p1);a.receive({t:'lobby'});a.receive({t:'weapon',weapon:'blade'});
  assert.equal(p1.wp.type,'blade');assert.equal(p1.shockDrive,0);
  assert.equal(room.axePulses.length,0);
});

test('a dead owner cannot deal detached-weapon damage and respawn resets the held weapon',()=>{
  const {api,room,p1,p2}=battle({weapon:'axe',x:-8,z:-8},{x:-8,z:-4});
  api.throwAxe(room,p1);api.die(room,p1,p2);advance(api,room,1.2);
  assert.equal(p2.hp,100);assert.equal(p1.dead,true);
  advance(api,room,1.7);
  assert.equal(p1.dead,false);assert.equal(p1.wp.mode,'held');
  assert.ok(gap(p1.wp,api.weaponGripPoint(p1))<.02);assert.equal(p1.wp.hitTimes.size,0);
});

test('returning to lobby and restarting remove transient effects and stale weapon motion',()=>{
  const {api,room,a,p1}=battle({weapon:'axe'});
  api.placeAxeTunnel(room,p1);api.beginShockBurst(room,p1);api.throwAxe(room,p1);
  a.receive({t:'lobby'});
  assert.equal(room.phase,'lobby');assert.equal(room.axeTunnels.length,0);assert.equal(room.axePulses.length,0);
  assert.equal(p1.wp.mode,'held');assert.equal(p1.shockDrive,0);
  api.start(room);
  assert.equal(p1.wp.mode,'held');assert.equal(p1.wp.travel,0);
  assert.equal(p1.wp.hitTimes.size,0);assert.equal(p1.wp.yawVel,0);
  assert.equal(room.projectiles.length,0);assert.equal(room.bombs.length,0);
});

test('legacy attack input cannot trigger a melee swing or melee attack event',()=>{
  const {api,room,a,p1,p2}=battle({weapon:'axe'},{x:1.4,z:1.5});
  a.receive({t:'input',k:{attack:true},yaw:0,pitch:0});
  advance(api,room,.8);
  assert.equal(p2.hp,100);
  assert.equal(p1.attackCd,0);
  assert.ok(!room.events.some(e=>e.type==='attack'&&e.id===p1.id));
});
test('holding Skill does not fire again until released and pressed',()=>{
  const {api,room,p1}=battle({weapon:'katana',input:{skill:true}});
  advance(api,room,.1);p1.skillCd=0;room.events.length=0;
  advance(api,room,.3);
  assert.ok(!room.events.some(e=>e.type==='skillcast'&&e.id===p1.id));
  p1.input={};api.tick(room,1/30);
  p1.input={skill:true};api.tick(room,1/30);
  assert.ok(room.events.some(e=>e.type==='skillcast'&&e.id===p1.id));
});
