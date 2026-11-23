import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

// Smoke-test game rules in a sandbox. No dependencies or actual sockets are required.
function engine() {
  let code=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  code=code.replace(/^import .*;\n/gm,'').replace('const BASE = path.dirname(fileURLToPath(import.meta.url));',"const BASE = '/unused';");
  code=code.replace(/^server.listen\(PORT,.*\);\n/m,'');
  code+='\n globalThis.__test = { createRoom, makePlayer, joinRoom, start, tick, attack, damage, die, spawnPoint, packState, rooms, WPN, safeWeapon, detonate, advanceBombs, skill, superAttack, wave };';
  const context={
    http:{createServer:()=>({listen(){},close(callback){callback?.();}})},fs,path,crypto,
    WebSocketServer:class {on(){} close(){}},WebSocket:{OPEN:1},
    process:{env:{PORT:'0'},once(){}},
    setInterval:()=>0,clearInterval:()=>{},
    console,Date,Math,JSON,Number,Object,String,Set,Map,Array,
  };
  vm.runInNewContext(code,context,{filename:'server-test.js'});
  return context.__test;
}
function fakeSocket(){return {readyState:1,messages:[],send(data){this.messages.push(JSON.parse(data));}};}
function setup(){const api=engine();const room=api.createRoom();const a=fakeSocket(),b=fakeSocket();api.joinRoom(a,room,'A');api.joinRoom(b,room,'B');return {api,room,a,b,p1:a.player,p2:b.player};}

test('creates 5 character invite code, joins players and starts battle',()=>{
  const {api,room,a,b,p1,p2}=setup();
  assert.match(room.code,/^[A-Z2-9]{5}$/);
  assert.equal(room.players.size,2);
  assert.equal(room.host,p1.id);
  assert.ok(a.messages.some(m=>m.t==='joined'));
  assert.ok(b.messages.some(m=>m.t==='joined'));
  api.start(room);
  assert.equal(room.phase,'battle');
  assert.equal(room.timer,180);
  assert.equal(api.packState(room).players.length,2);
  assert.equal(p1.hp,100);assert.equal(p2.hp,100);
});

test('blade hits nearby targets within frontal arc, not targets behind',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=0;p1.z=0;p1.y=0;p1.facing=0;p1.invuln=0;
  p2.x=0;p2.z=1.5;p2.y=0;p2.invuln=0;p2.hp=100;
  api.attack(room,p1);assert.equal(p2.hp,75);
  p1.attackCd=0;p2.hp=100;p2.z=-1.5;p2.kvx=0;p2.kvz=0;
  api.attack(room,p1);assert.equal(p2.hp,100);
});

test('blaster projectiles cause authoritative hit damage',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.weapon='blaster';p1.x=0;p1.z=0;p1.y=0;p1.facing=0;p1.invuln=0;
  p2.x=0;p2.z=4.5;p2.y=0;p2.invuln=0;p2.hp=100;p2.input={};p1.input={};
  api.attack(room,p1);assert.equal(room.projectiles.length,1);
  for(let i=0;i<12;i++)api.tick(room,1/30);
  assert.ok(p2.hp<100);
});

test('KO, respawn and match expiry work',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p2.invuln=0;p2.x=5;p2.z=5;p2.hp=25;
  api.damage(room,p2,p1,35,5);
  assert.equal(p2.dead,true);assert.equal(p1.kills,1);
  for(let i=0;i<90;i++)api.tick(room,1/30);
  assert.equal(p2.dead,false);assert.equal(p2.hp,100);
  room.timer=.005;api.tick(room,1/30);
  assert.equal(room.phase,'finished');
});

test('room state keeps nickname and weapon for all participants',()=>{
  const {api,room,p1,p2}=setup();api.start(room);p1.weapon='hammer';
  const state=api.packState(room);
  assert.equal(state.players.find(p=>p.id===p1.id).w,'hammer');
  assert.equal(state.players.find(p=>p.id===p2.id).n,'B');
});


test('six selectable weapons are server-approved, unknown values fall back safely',()=>{
  const {api}=setup();
  assert.deepEqual(Object.keys(api.WPN).sort(),['axe','blade','blaster','bomb','hammer','katana'].sort());
  assert.equal(api.safeWeapon('katana'),'katana');
  assert.equal(api.safeWeapon('bomb'),'bomb');
  assert.equal(api.safeWeapon('axe'),'axe');
  assert.equal(api.safeWeapon('anything-else'),'blade');
});

test('katana has quick attacks while axe delivers a slower, stronger hit',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=0;p1.z=0;p1.y=0;p1.facing=0;p1.invuln=0;
  p2.x=0;p2.z=2.5;p2.y=0;p2.invuln=0;p2.hp=100;
  p1.weapon='katana';api.attack(room,p1);
  assert.equal(p2.hp,78);assert.equal(p1.attackCd,.31);
  p1.weapon='axe';p1.attackCd=0;p2.hp=100;p2.invuln=0;p2.x=0;p2.z=2.4;
  api.attack(room,p1);
  assert.equal(p2.hp,51);assert.equal(p1.attackCd,1.27);
});

test('bombs are throwable, travel, and explode after a fuse',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=0;p1.z=0;p1.y=0;p1.facing=0;p1.invuln=0;p1.weapon='bomb';p1.input={};
  p2.x=10;p2.z=10;p2.input={};p2.invuln=0;
  api.attack(room,p1);
  assert.equal(room.bombs.length,1);
  assert.equal(api.packState(room).bombs.length,1);
  const startZ=room.bombs[0].z;
  api.tick(room,1/30);
  assert.ok(room.bombs[0].z>startZ,'the bomb moves away from the attacker');
  for(let i=0;i<55;i++)api.tick(room,1/30);
  assert.equal(room.bombs.length,0);
  assert.ok(room.events.some(e=>e.type==='explode'));
});

test('bomb explosion deals area damage, gives credit to owner, and spares bystanders',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=-3;p1.z=-3;p1.invuln=0;
  p2.x=1.2;p2.z=0;p2.y=0;p2.hp=42;p2.invuln=0;
  const away={...api.makePlayer('Far','')};away.x=9;away.z=9;away.y=0;away.invuln=0;away.hp=100;room.players.set(away.id,away);
  api.detonate(room,{owner:p1.id,x:0,y:.35,z:0});
  assert.equal(p2.dead,true);assert.equal(p1.kills,1);
  assert.equal(away.hp,100);assert.equal(p1.hp,100);
});


test('WASD follows facing: the weapon, torso and camera turn together',()=>{
 const {api,room,p1,p2}=setup();api.start(room);
 p1.x=0;p1.z=0;p1.facing=0;p1.input={w:true};p2.x=9;p2.z=9;p2.input={};
 api.tick(room,1/30);
 assert.ok(p1.z>.17&&Math.abs(p1.x)<.01);
 assert.equal(p1.moveFacing,p1.facing);
 p1.x=0;p1.z=0;p1.facing=Math.PI/2;
 api.tick(room,1/30);
 assert.ok(p1.x>.17&&Math.abs(p1.z)<.01);
 assert.equal(p1.moveFacing,p1.facing);
});

test('katana skill emits a dragon-shaped travelling hitbox',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.weapon='katana';p1.x=0;p1.z=0;p1.y=0;p1.facing=0;p1.invuln=0;p1.input={};
  p2.x=0;p2.z=6;p2.y=0;p2.invuln=0;p2.input={};
  api.skill(room,p1);
  assert.ok(room.projectiles.some(w=>w.kind==='dragon'));
  assert.equal(p1.skillCd,6);
  assert.equal(room.events.find(e=>e.type==='skillcast')?.variant,'dragon');
  for(let i=0;i<18;i++)api.tick(room,1/30);
  assert.ok(p2.hp<100,'dragon projectile deals damage on contact');
});

test('hammer skill spins weapon over time and hits targets within reach',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.weapon='hammer';p1.x=0;p1.z=0;p1.y=0;p1.invuln=0;
  p2.x=0;p2.z=2.8;p2.y=0;p2.hp=100;p2.invuln=0;
  api.skill(room,p1);
  assert.ok(p1.hammerSpin>1);
  api.tick(room,1/30);
  assert.ok(p2.hp<100,'hammer spin contacts nearby enemy');
  assert.ok(p2.kvz>0,'hammer contact knocks back');
  assert.ok(room.events.some(e=>e.type==='skillcast'&&e.variant==='hammerSpin'));
});

test('axe Skill includes bubble tube, thrown axe, shock, and spin',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.weapon='axe';p1.x=0;p1.z=0;p1.invuln=0;
  p2.x=10;p2.z=10;p2.invuln=0;
  const seen=new Set();
  for(let i=0;i<45;i++){
    p1.skillCd=0;api.skill(room,p1);
    for(const e of room.events)if(e.type==='skillcast')seen.add(e.variant);
    room.events.length=0;
  }
  assert.ok(seen.size>=2,'the axe can actually roll more than one ability');
  for(const k of seen)assert.ok(['bubbleTunnel','axeThrow','shockBurst','whirl'].includes(k));
  assert.deepEqual([...seen].sort(),['bubbleTunnel','axeThrow','shockBurst','whirl'].sort());
});

test('fighter moving into melee range automatically swings without a click',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.weapon='blade';p1.x=0;p1.z=0;p1.y=0;p1.invuln=0;p1.facing=0;p1.input={w:true};
  p2.x=0;p2.z=2;p2.y=0;p2.invuln=0;p2.input={};
  api.tick(room,1/30);
  assert.ok(p2.hp<100);
  assert.ok(room.events.some(e=>e.type==='attack'));
});

test('platform top catches falling fighters instead of letting them sink in',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=-4.4;p1.z=-1.6;p1.y=3;p1.vy=-2;p1.grounded=false;p1.input={};
  p2.x=10;p2.z=10;p2.input={};
  for(let i=0;i<20;i++)api.tick(room,1/30);
  assert.ok(Math.abs(p1.y-2.15)<.02);
  assert.equal(p1.grounded,true);
});

test('fast knockback cannot tunnel into solid cover',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=-7;p1.z=-1.6;p1.y=0;p1.grounded=true;p1.kvx=28;p1.kvz=0;p1.input={};
  p2.x=10;p2.z=10;p2.input={};
  for(let i=0;i<40;i++)api.tick(room,1/30);
  assert.ok(p1.x<=-5.75-.43,`stayed outside the wall, x=${p1.x}`);
});


test('holding W makes the human move and clicking alone does not accelerate',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=0;p1.z=0;p1.input={attack:true,thrust:true};p2.x=9;p2.z=9;p2.input={};
  for(let i=0;i<16;i++)api.tick(room,1/30);
  assert.ok(Math.hypot(p1.x,p1.z)<.01,'legacy click thrust is ignored');
  p1.input={w:true};
  for(let i=0;i<16;i++)api.tick(room,1/30);
  assert.ok(Math.hypot(p1.x,p1.z)>2.5,'WASD now drives the fighter');
});
test('space jumps once per press and does not auto-bounce while held',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=0;p1.z=0;p1.input={jump:true};p2.x=10;p2.z=10;p2.input={};
  for(let i=0;i<86;i++)api.tick(room,1/30);
  assert.ok(p1.grounded);assert.equal(p1.y,0);
  p1.input={};api.tick(room,1/30);
  p1.input={jump:true};api.tick(room,1/30);
  assert.ok(p1.y>0,'second press triggers next jump');
});
test('CPU and human use identical movement speed without bot-only thrust',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=0;p1.z=0;p1.input={w:true};p1.facing=0;
  p2.isBot=true;p2.x=8;p2.z=-6;p2.facing=0;
  const before=[p2.x,p2.z];
  api.tick(room,1/30);
  assert.equal(p2.moveAmount,1,'CPU should actually walk toward the target');
  assert.equal(p2.input.thrust,undefined);
  const humanSpeed=Math.hypot(p1.x,p1.z)*30;
  const cpuSpeed=Math.hypot(p2.x-before[0],p2.z-before[1])*30;
  assert.ok(Math.abs(cpuSpeed-humanSpeed)<.01,`CPU ${cpuSpeed} vs human ${humanSpeed}`);
});
test('sword skill charges instead of spawning a slash projectile',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.weapon='blade';p1.x=0;p1.z=0;p1.facing=0;p1.input={};p2.input={};
  const count=room.projectiles.length;api.skill(room,p1);
  assert.ok(p1.dashTime>0);assert.equal(room.projectiles.length,count);
  assert.equal(room.events.find(e=>e.type==='skillcast')?.variant,'swordCharge');
});

test('four supplied weapons launch five angled slashes on Super',()=>{
  for(const weapon of ['blade','katana','hammer','axe']){
    const {api,room,p1,p2}=setup();api.start(room);
    p1.weapon=weapon;p1.facing=0;p1.pitch=.25;p1.x=0;p1.z=0;
    p2.x=10;p2.z=10;p2.input={};
    api.superAttack(room,p1);
    assert.equal(room.projectiles.length,5,`${weapon} uses five 3D slashes`);
    assert.ok(new Set(room.projectiles.map(p=>p.dx.toFixed(3))).size>=5);
    assert.ok(new Set(room.projectiles.map(p=>p.dy.toFixed(3))).size>=2);
    assert.equal(room.events.find(e=>e.type==='super')?.variant,'fanSlashes');
  }
});

test('jump is high and cannot double jump before landing',()=>{
 const {api,room,p1,p2}=setup();api.start(room);
 p1.x=0;p1.z=0;p1.y=0;p1.input={jump:true};p2.input={};p2.x=10;p2.z=10;
 let apex=0,count=0;
 for(let i=0;i<62;i++){
   api.tick(room,1/30);apex=Math.max(apex,p1.y);
   if(i===14){p1.input={};api.tick(room,1/30);p1.input={jump:true};}
 }
 assert.ok(apex>5,`high floaty jump apex=${apex}`);
 assert.ok(apex<9);
});
test('solid boundary blocks movement and knockback even above platforms',()=>{
 const {api,room,p1,p2}=setup();api.start(room);
 p1.x=11.2;p1.z=0;p1.facing=Math.PI/2;p1.input={w:true};p1.kvx=60;
 p2.x=0;p2.z=0;p2.input={};
 for(let i=0;i<50;i++)api.tick(room,1/30);
 assert.ok(p1.x<=11.46,`solid outer wall x=${p1.x}`);
 p1.y=6;p1.x=11.3;p1.kvx=40;api.tick(room,1/30);
 assert.ok(p1.x<=11.46);
});
test('dragon and Super slashes travel slower than before and stop at solid walls',()=>{
 const {api,room,p1,p2}=setup();api.start(room);
 p1.weapon='katana';p1.x=10.5;p1.z=0;p1.facing=Math.PI/2;p1.input={};
 p2.x=0;p2.z=0;p2.input={};api.skill(room,p1);
 assert.ok(room.projectiles[0].speed<=10);
 for(let i=0;i<20;i++)api.tick(room,1/30);
 assert.equal(room.projectiles.length,0,'energy must collide with wall');
 p1.skillCd=0;p1.superCd=0;api.superAttack(room,p1);
 assert.ok(room.projectiles.every(b=>b.speed<=10));
});
test('axe Skill shuffle bag always includes installed bubbling tube and throw',()=>{
 const {api,room,p1,p2}=setup();api.start(room);
 p1.weapon='axe';p1.x=0;p1.z=0;p1.facing=0;p1.pitch=0;p1.input={};
 p2.x=-8;p2.z=-8;p2.input={};
 const found=new Set();
 for(let i=0;i<4;i++){
  p1.skillCd=0;api.skill(room,p1);
  const event=room.events.findLast(e=>e.type==='skillcast');found.add(event.variant);
 }
 assert.equal(found.size,4);
 assert.ok(found.has('bubbleTunnel'));
 assert.ok(found.has('axeThrow'));
 assert.ok(room.axeTunnels.length>=1);
 assert.ok(room.projectiles.some(x=>x.kind==='axeThrown'));
 assert.ok(api.packState(room).tunnels.length>=1);
});
test('axe tube delays its shockwave until after forward travel',()=>{
 const {api,room,p1,p2}=setup();api.start(room);
 p1.weapon='axe';p1.x=0;p1.z=0;p1.facing=0;p1.invuln=0;
 p2.x=0;p2.z=2;p2.invuln=0;p2.input={};p1.input={};
 p1.axeBag=['bubbleTunnel'];api.skill(room,p1);
 assert.equal(room.axeTunnels.length,1);
 const before=p2.hp;
 for(let i=0;i<8;i++)api.tick(room,1/30);
 assert.equal(p2.hp,before);
 for(let i=0;i<6;i++)api.tick(room,1/30);
 assert.ok(room.events.some(e=>e.type==='impact'&&e.kind==='tunnelPulse'));
});
test('sword charge accelerates smoothly rather than instantly teleporting',()=>{
 const {api,room,p1,p2}=setup();api.start(room);
 p1.weapon='blade';p1.x=0;p1.z=0;p1.facing=0;p1.input={};
 p2.x=10;p2.z=10;p2.input={};
 api.skill(room,p1);const step=[];for(let i=0;i<8;i++){
  const old=p1.z;api.tick(room,1/30);step.push(p1.z-old);
 }
 assert.ok(step.every(s=>s<.7));
 assert.ok(step[7]>step[0],`smooth acceleration ${step}`);
});