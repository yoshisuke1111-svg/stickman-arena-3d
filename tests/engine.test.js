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
  code+='\n globalThis.__test = { createRoom, makePlayer, joinRoom, start, tick, attack, damage, die, spawnPoint, packState, rooms, WPN, safeWeapon, detonate, advanceBombs };';
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


test('WASD lateral movement follows the camera: A left and D right on screen',()=>{
  const {api,room,p1,p2}=setup();api.start(room);
  p1.x=0;p1.z=0;p1.y=0;p1.facing=0;p1.input={d:true};p2.input={};p2.x=9;p2.z=9;
  api.tick(room,1/30);
  assert.ok(p1.x<0,'looking toward +Z, screen-right points toward -X');
  assert.ok(Math.abs(p1.z)<.1);
  p1.x=0;p1.z=0;p1.input={a:true};
  api.tick(room,1/30);
  assert.ok(p1.x>0,'looking toward +Z, screen-left points toward +X');
  p1.x=0;p1.z=0;p1.facing=Math.PI/2;p1.input={d:true};
  api.tick(room,1/30);
  assert.ok(p1.z>0,'when looking toward +X, screen-right points toward +Z');
  p1.x=0;p1.z=0;p1.input={a:true};
  api.tick(room,1/30);
  assert.ok(p1.z<0,'when looking toward +X, screen-left points toward -Z');
});
