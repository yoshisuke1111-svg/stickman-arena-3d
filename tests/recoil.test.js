import test from 'node:test';
import assert from 'node:assert/strict';
import {battle,advance,place} from './engine-harness.js';

const clashes=room=>room.events.filter(e=>e.type==='weaponClash');
const length=r=>Math.hypot(r.x,r.y,r.z);
function facingPair(weaponA='blade',weaponB='blade'){
  const state=battle({weapon:weaponA,x:0,z:-2.2,input:{w:true}},{weapon:weaponB,x:0,z:2.2,facing:Math.PI,input:{w:true}});
  return state;
}
test('approaching opposing weapons exchange physical impulses before either body is reached',()=>{
  const {api,room,p1,p2}=facingPair();
  let event;
  for(let i=0;i<20&&!event;i++){api.tick(room,1/30);event=clashes(room)[0];}
  assert.ok(event,'the moving blades actually meet');
  assert.equal(p1.hp,100);assert.equal(p2.hp,100);
  assert.ok(p1.wp.recoil.vz<0,'first grip receives backward recoil');
  assert.ok(p2.wp.recoil.vz>0,'second grip receives opposite recoil');
  assert.ok(p1.kvz<0&&p2.kvz>0,'a portion of the impulse reaches each wielder');
  assert.ok(Number.isFinite(event.force)&&event.force>0);
});
test('resting and separating weapons do not repeatedly produce clash sparks',()=>{
  const {api,room,p1,p2}=facingPair();
  p1.input={};p2.input={};
  advance(api,room,.5);
  assert.equal(clashes(room).length,0);
  assert.equal(p1.hp,100);assert.equal(p2.hp,100);
  p1.input={s:true};p2.input={s:true};advance(api,room,.3);
  assert.equal(clashes(room).length,0);
});
test('body contact bends the actual grip, then the damped wrist returns when the fighter is alone',()=>{
  const {api,room,p1,p2}=battle({weapon:'blade',input:{w:true}},{x:.3,z:2.7});
  let hit=false;
  for(let i=0;i<20&&!hit;i++){api.tick(room,1/30);hit=p2.hp<100;}
  assert.ok(hit);
  assert.ok(length(p1.wp.recoil)>.001||Math.hypot(p1.wp.recoil.vx,p1.wp.recoil.vy,p1.wp.recoil.vz)>.1);
  p1.input={};place(api,p2,{x:9,z:9});advance(api,room,1.3);
  assert.ok(length(p1.wp.recoil)<.01,'spring returns to its resting position');
  const grip=api.weaponGripPoint(p1);
  assert.ok(Math.hypot(p1.wp.x-grip.x,p1.wp.y-grip.y,p1.wp.z-grip.z)<.012);
});
test('a hit on a blade and on a hammer uses different inertia and wrist mass',()=>{
  const run=weapon=>{
    const {api,room,p1,p2}=battle({weapon,input:{w:true}},{x:.3,z:weapon==='hammer'?2.25:2.7,hp:1000});
    for(let i=0;i<25;i++){api.tick(room,1/30);if(p2.hp<1000)return {speed:Math.hypot(p1.wp.recoil.vx,p1.wp.recoil.vy,p1.wp.recoil.vz),p:p1};}
    assert.fail('expected a real contact for '+weapon);
  };
  const blade=run('blade'),hammer=run('hammer');
  assert.ok(blade.speed>0&&hammer.speed>0);
  assert.ok(Math.abs(blade.speed-hammer.speed)>.02);
});
test('restarting resets wrist motion and pair contact history',()=>{
  const {api,room,p1,p2}=facingPair();
  advance(api,room,.3);api.start(room);
  for(const p of [p1,p2]){
    assert.equal(length(p.wp.recoil),0);assert.equal(p.wp.recoil.vx,0);assert.equal(p.wp.clashTimes.size,0);
  }
});
