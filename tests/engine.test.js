import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, battle, place, advance } from './engine-harness.js';

test('creates a five-character invite, joins two clients, and starts a match',()=>{
  const {api,room,a,b,p1,p2}=setup();
  assert.match(room.code,/^[A-Z2-9]{5}$/);
  assert.equal(room.players.size,2);assert.equal(room.host,p1.id);
  assert.ok(a.messages.some(m=>m.t==='joined'));assert.ok(b.messages.some(m=>m.t==='joined'));
  api.start(room);
  assert.equal(room.phase,'battle');assert.equal(room.timer,180);
  assert.equal(api.packState(room).players.length,2);
  assert.equal(p1.hp,100);assert.equal(p2.hp,100);
});

test('movement, not an attack command, causes physical blade contact',()=>{
  const {api,room,p1,p2}=battle({weapon:'blade'},{x:.3,z:2.7});
  api.attack(room,p1);advance(api,room,.2);
  assert.equal(p2.hp,100,'legacy attack command does not swing a melee weapon');
  p1.input={w:true};advance(api,room,.4);
  assert.ok(p2.hp<100,'moving the actual blade into the target damages it');
  place(api,p1,{weapon:'blade',input:{w:true}});place(api,p2,{x:0,z:-2});
  advance(api,room,.4);
  assert.equal(p2.hp,100,'the weapon does not damage a target behind it');
});

test('blaster projectiles cause authoritative damage on arrival',()=>{
  const {api,room,p1,p2}=battle({weapon:'blaster'},{x:.3,z:4.5});
  api.attack(room,p1);assert.equal(room.projectiles.length,1);assert.equal(p2.hp,100);
  advance(api,room,.6);
  assert.ok(p2.hp<100);
});

test('KO, respawn and match expiry retain kill credit and restore health',()=>{
  const {api,room,p1,p2}=battle({}, {x:5,z:5,hp:25});
  api.damage(room,p2,p1,35,5);
  assert.equal(p2.dead,true);assert.equal(p1.kills,1);
  advance(api,room,3);
  assert.equal(p2.dead,false);assert.equal(p2.hp,100);
  room.timer=.005;api.tick(room,1/30);
  assert.equal(room.phase,'finished');
});

test('room state preserves nickname, weapon, and the shared body heading',()=>{
  const {api,room,p1,p2}=battle({weapon:'hammer',facing:1.25});
  const state=api.packState(room),one=state.players.find(p=>p.id===p1.id);
  assert.equal(one.w,'hammer');assert.equal(one.bf,one.f);assert.equal(one.f,1.25);
  assert.equal(state.players.find(p=>p.id===p2.id).n,'B');
});

test('six selectable weapons are approved and unknown values safely fall back',()=>{
  const {api}=setup();
  assert.deepEqual(Object.keys(api.WPN).sort(),['axe','blade','blaster','bomb','hammer','katana'].sort());
  for(const weapon of ['katana','bomb','axe'])assert.equal(api.safeWeapon(weapon),weapon);
  assert.equal(api.safeWeapon('anything-else'),'blade');
});

test('katana and axe retain different shapes and damage, driven by contact',()=>{
  const {api,room,p1,p2}=battle({weapon:'katana',input:{w:true}},{x:.3,z:3.1});
  assert.ok(api.WPN.axe.damage>api.WPN.katana.damage);
  assert.ok(api.WPN.axe.cd>api.WPN.katana.cd);
  advance(api,room,.35);assert.ok(p2.hp<100);
  place(api,p1,{weapon:'axe',input:{w:true}});place(api,p2,{x:.3,z:2.2});
  advance(api,room,.4);assert.ok(p2.hp<100);
});

test('bombs travel away from the holder, keep a fuse, and then explode',()=>{
  const {api,room,p1}=battle({weapon:'bomb'});
  api.attack(room,p1);
  assert.equal(room.bombs.length,1);assert.equal(api.packState(room).bombs.length,1);
  const z=room.bombs[0].z;api.tick(room,1/30);
  assert.ok(room.bombs[0].z>z);
  advance(api,room,1.8);
  assert.equal(room.bombs.length,0);assert.ok(room.events.some(e=>e.type==='explode'));
});

test('bomb explosions credit the owner and spare distant bystanders and the owner',()=>{
  const {api,room,p1,p2}=battle({x:-3,z:-3},{x:1.2,z:0,hp:42});
  const away=api.makePlayer('Far','');place(api,away,{x:9,z:9});room.players.set(away.id,away);
  api.detonate(room,{owner:p1.id,x:0,y:.35,z:0});
  assert.equal(p2.dead,true);assert.equal(p1.kills,1);
  assert.equal(away.hp,100);assert.equal(p1.hp,100);
});

test('WASD uses the facing direction for both movement and body heading',()=>{
  const {api,room,p1}=battle({input:{w:true}});
  api.tick(room,1/30);assert.ok(p1.z>.17&&Math.abs(p1.x)<.01);
  assert.equal(p1.moveFacing,p1.facing);
  place(api,p1,{facing:Math.PI/2,input:{w:true}});
  api.tick(room,1/30);assert.ok(p1.x>.17&&Math.abs(p1.z)<.01);
  assert.equal(p1.moveFacing,p1.facing);
});

test('katana skill sends a travelling dragon that hits after flight time',()=>{
  const {api,room,p1,p2}=battle({weapon:'katana'},{x:0,z:6});
  api.skill(room,p1);
  assert.ok(room.projectiles.some(w=>w.kind==='dragon'));assert.equal(p1.skillCd,6);
  assert.equal(room.events.find(e=>e.type==='skillcast')?.variant,'dragon');
  advance(api,room,.2);assert.equal(p2.hp,100);
  advance(api,room,.65);assert.ok(p2.hp<100);
});

test('hammer skill drives a sustained physical spin with contact knockback',()=>{
  const {api,room,p1,p2}=battle({weapon:'hammer'},{x:.3,z:1.8});
  api.skill(room,p1);assert.ok(p1.hammerSpin>1);
  assert.equal(p2.hp,100,'spin activation is not a radial hit');
  advance(api,room,1.0);
  assert.ok(p2.hp<100,'the hammer head must actually sweep through the target');
  assert.ok(Math.hypot(p2.x-.3,p2.z-1.8)>.1,'the struck fighter is displaced');
  assert.ok(room.events.some(e=>e.type==='skillcast'&&e.variant==='hammerSpin'));
});

test('axe shuffle bag contains exactly the three observed skills in one cycle',()=>{
  const {api,room,p1}=battle({weapon:'axe'});
  const seen=new Set();
  for(let i=0;i<3;i++){
    p1.skillCd=0;api.resetWeaponPose(p1);api.skill(room,p1);
    seen.add(room.events.findLast(e=>e.type==='skillcast')?.variant);
  }
  assert.deepEqual([...seen].sort(),['bubbleTunnel','axeThrow','shockBurst'].sort());
});

test('walking causes a contact hit without starting a scripted melee attack',()=>{
  const {api,room,p1,p2}=battle({weapon:'blade',input:{w:true}},{x:.3,z:2.5});
  advance(api,room,.4);
  assert.ok(p2.hp<100);
  assert.ok(!room.events.some(e=>e.type==='attack'&&e.id===p1.id),'no automatic attack animation');
});

test('platform tops catch falling fighters without letting them sink in',()=>{
  const {api,room,p1}=battle({x:-4.4,z:-1.6,y:3,vy:-2,grounded:false});
  advance(api,room,.8);
  assert.ok(Math.abs(p1.y-2.15)<.02);assert.equal(p1.grounded,true);
});

test('fast knockback cannot tunnel into solid cover',()=>{
  const {api,room,p1}=battle({x:-7,z:-1.6,kvx:28});
  advance(api,room,1.4);
  assert.ok(p1.x<=-5.75-.43,`stayed outside cover: x=${p1.x}`);
});

test('clicking alone cannot propel a fighter, while W moves at walking speed',()=>{
  const {api,room,p1}=battle({input:{attack:true,thrust:true}});
  advance(api,room,.55);
  assert.ok(Math.hypot(p1.x,p1.z)<.01,'legacy click thrust is ignored');
  p1.input={w:true};advance(api,room,.55);
  assert.ok(Math.hypot(p1.x,p1.z)>2.5);
});

test('holding jump does not auto-bounce; another press after landing can jump',()=>{
  const {api,room,p1}=battle({input:{jump:true}});
  advance(api,room,2.9);
  assert.ok(p1.grounded);assert.equal(p1.y,0);
  p1.input={};api.tick(room,1/30);p1.input={jump:true};api.tick(room,1/30);
  assert.ok(p1.y>0);
});

test('CPU and human walking use the same speed without hidden thrust',()=>{
  const {api,room,p1,p2}=battle({input:{w:true}},{isBot:true,x:8,z:-6});
  const before=[p2.x,p2.z];api.tick(room,1/30);
  assert.equal(p2.moveAmount,1);assert.equal(p2.input.thrust,undefined);
  const humanSpeed=Math.hypot(p1.x,p1.z)*30;
  const cpuSpeed=Math.hypot(p2.x-before[0],p2.z-before[1])*30;
  assert.ok(Math.abs(cpuSpeed-humanSpeed)<.01,`CPU ${cpuSpeed}, human ${humanSpeed}`);
});

test('sword skill moves the fighter without creating a separate slash projectile',()=>{
  const {api,room,p1}=battle({weapon:'blade'});
  api.skill(room,p1);
  assert.ok(p1.dashTime>0);assert.equal(room.projectiles.length,0);
  assert.equal(room.events.find(e=>e.type==='skillcast')?.variant,'swordCharge');
  advance(api,room,.5);assert.ok(p1.z>1);
});

test('four supplied melee weapons launch five angled Super slashes',()=>{
  for(const weapon of ['blade','katana','hammer','axe']){
    const {api,room,p1}=battle({weapon,pitch:.25});api.superAttack(room,p1);
    assert.equal(room.projectiles.length,5,weapon);
    assert.ok(new Set(room.projectiles.map(p=>p.dx.toFixed(3))).size>=5);
    assert.ok(new Set(room.projectiles.map(p=>p.dy.toFixed(3))).size>=2);
    assert.equal(room.events.find(e=>e.type==='super')?.variant,'fanSlashes');
  }
});

test('high jump cannot gain a second upward impulse before landing',()=>{
  const {api,room,p1}=battle({input:{jump:true}});
  let apex=0;api.tick(room,1/30);
  for(let i=0;i<15;i++){api.tick(room,1/30);apex=Math.max(apex,p1.y);}
  p1.input={};api.tick(room,1/30);const upwardBefore=p1.vy;
  p1.input={jump:true};api.tick(room,1/30);
  assert.ok(p1.vy<upwardBefore,'re-pressing in the air cannot add upward velocity');
  for(let i=0;i<60;i++){api.tick(room,1/30);apex=Math.max(apex,p1.y);}
  assert.ok(apex>5&&apex<9,`high, floaty apex: ${apex}`);
  assert.equal(p1.grounded,true);
});

test('outer walls stop movement and knockback at floor and platform heights',()=>{
  const {api,room,p1}=battle({x:11.2,facing:Math.PI/2,input:{w:true},kvx:60});
  advance(api,room,1.6);assert.ok(p1.x<=11.46);
  place(api,p1,{x:11.3,y:6,kvx:40,grounded:false});api.tick(room,1/30);
  assert.ok(p1.x<=11.46);
});

test('dragon and Super slashes cross the outer wall on their original trajectory until their lifetime ends',()=>{
  const {api,room,p1}=battle({weapon:'katana',x:8.5,facing:Math.PI/2},{x:-8,z:8});
  api.skill(room,p1);api.superAttack(room,p1);
  const originals=room.projectiles.map(b=>({...b}));
  assert.equal(originals.length,6);assert.ok(originals.every(b=>b.speed<=10));
  advance(api,room,.8);
  assert.equal(room.projectiles.length,6,'wall contact must not remove any of the strikes');
  for(const original of originals){
    const b=room.projectiles.find(b=>b.id===original.id);
    assert.ok(b.x>11.45,`${b.kind} crosses the arena edge`);
    for(const axis of ['x','y','z']){
      assert.equal(b['d'+axis],original['d'+axis],'wall contact must not reflect the direction');
      assert.ok(Math.abs(b[axis]-(original[axis]+original['d'+axis]*original.speed*.8))<1e-8);
    }
    assert.ok(Math.abs(b.life-(original.life-.8))<1e-8,'wall contact must not shorten its lifetime');
  }
  assert.ok(!room.events.some(e=>e.type==='projectileBreak'));
  advance(api,room,2.1);
  assert.equal(room.projectiles.length,0,'the existing lifetime still removes expired strikes');
});

test('dragon and slashes cross solid cover without a wall break or change of direction',()=>{
  for(const kind of ['dragon','slash']){
    const {api,room,p1}=battle({x:-8,z:-1.6,facing:Math.PI/2});
    api.wave(room,p1,kind,0,{speed:8.6,life:2.8});
    const b=room.projectiles[0],start=b.x;
    advance(api,room,.8);
    assert.equal(room.projectiles[0],b,kind);
    assert.ok(b.x>-3.05,'strike emerges from the far side of the cover');
    assert.ok(Math.abs(b.x-start-8.6*.8)<1e-8);
    assert.equal(b.dx,1);assert.equal(b.dy,0);
    assert.ok(!room.events.some(e=>e.type==='projectileBreak'));
  }
});

test('dragon and slash contact still damages a fighter behind cover with their original piercing rules',()=>{
  for(const kind of ['dragon','slash']){
    const {api,room,p1,p2}=battle({x:-8,z:-1.6,facing:Math.PI/2},{x:-2.5,z:-1.6});
    api.wave(room,p1,kind,0,{speed:8.6,life:2.8,radius:.6,damage:25,push:5,pierce:kind==='dragon'});
    advance(api,room,.45);
    assert.equal(p2.hp,75,`${kind} must reach the target through cover`);
    assert.equal(room.projectiles.length,kind==='dragon'?1:0,'only the non-piercing slash ends on fighter contact');
    advance(api,room,.5);
    assert.equal(p2.hp,75,'one strike cannot repeatedly damage the same target');
    assert.ok(!room.events.some(e=>e.type==='projectileBreak'));
  }
});

test('blaster rounds still stop at cover and outer walls',()=>{
  for(const scenario of [
    {shooter:{x:-8,z:-1.6},target:{x:-2.5,z:-1.6}},
    {shooter:{x:10.1,z:0},target:{x:-8,z:8}}
  ]){
    const {api,room,p1,p2}=battle({weapon:'blaster',facing:Math.PI/2,...scenario.shooter},scenario.target);
    api.attack(room,p1);assert.equal(room.projectiles.length,1);
    advance(api,room,.5);
    assert.equal(room.projectiles.length,0);
    assert.equal(p2.hp,100);
    assert.ok(room.events.some(e=>e.type==='projectileBreak'));
  }
});

test('bombs retain outer-wall and platform-top bounces',()=>{
  const {api,room,p1}=battle({weapon:'bomb',x:10.5,facing:Math.PI/2});
  api.attack(room,p1);const bomb=room.bombs[0];
  api.advanceBombs(room,.1);
  assert.ok(bomb.x<=11.45);assert.ok(bomb.vx<0,'the wall reflects the thrown bomb');
  assert.ok(room.bombs.includes(bomb));
  Object.assign(bomb,{x:4.4,z:1.6,y:2.9,vx:0,vz:0,vy:-2,fuse:1});
  api.advanceBombs(room,.2);
  assert.ok(Math.abs(bomb.y-2.39)<1e-8);assert.ok(bomb.vy>0,'platform tops still bounce bombs');
  assert.ok(room.bombs.includes(bomb));
});

test('axe tube is installed in state and the axe throw uses the existing weapon',()=>{
  const {api,room,p1}=battle({weapon:'axe'});
  p1.axeBag=['bubbleTunnel'];api.skill(room,p1);
  assert.equal(room.axeTunnels.length,1);assert.equal(api.packState(room).tunnels.length,1);
  p1.skillCd=0;p1.axeBag=['axeThrow'];const sameWeapon=p1.wp;api.skill(room,p1);
  assert.equal(p1.wp,sameWeapon);assert.equal(p1.wp.mode,'outbound');
  assert.equal(room.projectiles.filter(x=>x.kind==='axeThrown').length,0);
});

test('a tube supplies flow without inventing an automatic shockwave or free damage',()=>{
  const {api,room,p1,p2}=battle({weapon:'axe'},{x:0,z:5});
  p1.axeBag=['bubbleTunnel'];api.skill(room,p1);
  advance(api,room,.3);
  assert.ok(p2.kvz>0,'the tube accelerates its occupants along the flow');
  assert.equal(p2.hp,100,'contact-free flow is not a hidden instant attack');
  assert.equal(room.axePulses.length,0,'shock is a separate skill');
});

test('sword charge accelerates across multiple frames and sustains its movement',()=>{
  const {api,room,p1}=battle({weapon:'blade'});api.skill(room,p1);
  const steps=[];
  for(let i=0;i<8;i++){const z=p1.z;api.tick(room,1/30);steps.push(p1.z-z);}
  assert.ok(steps.every(s=>s>0&&s<.7));assert.ok(steps[7]>steps[0]);
  advance(api,room,.4);
  assert.ok(p1.dashTime>0,'forward movement remains active well beyond the first frames');
  assert.ok(p1.z>2);
});

