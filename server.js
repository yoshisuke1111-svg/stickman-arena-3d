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
  p.facing=Math.atan2(-p.x,-p.z); p.swing=0; p.dashTime=0; p.hazardNext=0;
}
function makePlayer(name,ws,isBot=false) {
  return {
    id: String(++playerCounter), name: cleanName(name), ws, isBot, color:COLORS[(playerCounter-1)%COLORS.length],
    weapon:'blade', x:0,y:0,z:0,vy:0,kvx:0,kvz:0, facing:0, hp:100,
    input:{}, moveAmount:0, grounded:true, dead:false, respawnIn:0, invuln:0,
    attackCd:0, skillCd:0, superCd:0, swing:0, dashTime:0, dashHits:new Set(), hit:0,
    hazardNext:0, kills:0, deaths:0, score:0, botDecision:0, botTarget:null
  };
}
function createRoom() {
  if(rooms.size >= MAX_ROOMS) return null;
  const code=makeCode(); if(!code) return null;
  const room = {code, players:new Map(), host:null, phase:'lobby', timer:180, elapsed:0, events:[], projectiles:[], bombs:[], hazardActive:false, lastActivity:nowMs(), snapAt:0};
  rooms.set(code,room); return room;
}
function packPlayer(p) {
  return {id:p.id,n:p.name,c:p.color,w:p.weapon,x:+p.x.toFixed(2),y:+p.y.toFixed(2),z:+p.z.toFixed(2),f:+p.facing.toFixed(3),
    hp:Math.ceil(p.hp),dead:p.dead,k:p.kills,d:p.deaths,s:p.score,bot:p.isBot,a:+p.swing.toFixed(2),hit:+p.hit.toFixed(2),
    m:+p.moveAmount.toFixed(2),ground:p.grounded,inv:+p.invuln.toFixed(2),cd:[+p.attackCd.toFixed(1),+p.skillCd.toFixed(1),+p.superCd.toFixed(1)],dash:+p.dashTime.toFixed(2)};
}
function packState(room) {
  return {t:'state',room:room.code,phase:room.phase,host:room.host,time:Math.max(0,Math.ceil(room.timer)),
    players:[...room.players.values()].map(packPlayer),shots:room.projectiles.map(b=>({id:b.id,x:+b.x.toFixed(2),y:+b.y.toFixed(2),z:+b.z.toFixed(2),color:b.color})),
    bombs:room.bombs.map(b=>({id:b.id,x:+b.x.toFixed(2),y:+b.y.toFixed(2),z:+b.z.toFixed(2),fuse:+b.fuse.toFixed(2),color:b.color})),
    hazard:room.hazardActive, events:room.events.splice(0)};
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
  room.phase='battle'; room.timer=180; room.elapsed=0; room.events=[]; room.projectiles=[]; room.bombs=[];
  for(const p of room.players.values()) {p.kills=0;p.deaths=0;p.score=0;p.attackCd=0;p.skillCd=0;p.superCd=0;spawnPoint(room,p);}
  event(room,'start'); broadcastState(room);
}
function die(room,p,killer) {
  if(p.dead) return;
  p.hp=0; p.dead=true; p.respawnIn=2.7; p.deaths++;
  p.dashTime=0;
  if(killer && killer.id!==p.id){killer.kills++;killer.score+=100;}
  event(room,'ko',{name:p.name,by:killer?.id!==p.id?killer?.name:null,x:p.x,z:p.z});
}
function damage(room,target,from,dmg,push=5,origin=from) {
  if(target.dead || target.invuln>0 || room.phase!=='battle' || (from && from.id===target.id)) return false;
  target.hp-=dmg;target.hit=.2;
  let dx=origin ? target.x-origin.x : target.x;
  let dz=origin ? target.z-origin.z : target.z;
  let mag=Math.hypot(dx,dz);
  if(mag<.01){ dx=Math.sin(from?.facing||0); dz=Math.cos(from?.facing||0);mag=1;}
  target.kvx+=dx/mag*push; target.kvz+=dz/mag*push;target.vy=Math.max(target.vy,3.5+push*.08);
  event(room,'hit',{x:target.x,y:target.y+1.2,z:target.z,color:target.color,dmg});
  if(target.hp<=0) die(room,target,from);
  return true;
}
function attack(room,p) {
  if(p.attackCd>0 || p.dead || p.invuln>.85 || room.phase!=='battle') return;
  const w=WPN[p.weapon]; p.attackCd=w.cd; p.swing=.32;
  event(room,'attack',{id:p.id,weapon:p.weapon});
  if(p.weapon==='bomb') {
    if(room.bombs.length>=50)room.bombs.shift();
    const f=p.facing;
    room.bombs.push({id:crypto.randomUUID().slice(0,8),owner:p.id,
      x:p.x+Math.sin(f)*.8,y:p.y+1.45,z:p.z+Math.cos(f)*.8,
      vx:Math.sin(f)*10,vy:8.4,vz:Math.cos(f)*10, fuse:BOMB_FUSE,color:p.color});
  } else if(p.weapon==='blaster') {
    if(room.projectiles.length>100)room.projectiles.shift();
    const f=p.facing;
    room.projectiles.push({id:crypto.randomUUID().slice(0,8),owner:p.id,x:p.x+Math.sin(f)*.9,y:p.y+1.28,z:p.z+Math.cos(f)*.9,
      dx:Math.sin(f),dz:Math.cos(f),life:1.3,color:p.color});
  } else {
    for(const q of room.players.values()) {
      if(q.id===p.id || q.dead || Math.abs(p.y-q.y)>2)continue;
      const d=dist(p,q);
      if(d>w.range)continue;
      const a=Math.atan2(q.x-p.x,q.z-p.z);
      const diff=Math.atan2(Math.sin(a-p.facing),Math.cos(a-p.facing));
      if(Math.abs(diff)<=w.arc/2 && !isBlocked(p,q)) damage(room,q,p,w.damage,w.push);
    }
  }
}
function isBlocked(a,b) {
  for(let t=.15;t<1;t+=.16){const x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
    if(BLOCKS.some(o=>Math.abs(x-o.x)<o.w/2+.1&&Math.abs(z-o.z)<o.d/2+.1 && a.y<o.h-.3 && b.y<o.h-.3))return true;
  }
  return false;
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
    if(Math.abs(b.x)>BOUNDS||Math.abs(b.z)>BOUNDS)surface=-1e6;
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
function skill(room,p) {
  if(p.skillCd>0 || p.dead || room.phase!=='battle') return;
  p.skillCd=5.5; p.dashTime=.32;p.dashHits=new Set();p.invuln=Math.max(p.invuln,.28);
  event(room,'dash',{id:p.id});
}
function superAttack(room,p) {
  if(p.superCd>0 || p.dead || room.phase!=='battle') return;
  p.superCd=15;p.swing=.48;
  event(room,'super',{id:p.id,x:p.x,y:p.y,z:p.z,color:p.color});
  for(const q of room.players.values()) if(q.id!==p.id&&!q.dead&&Math.abs(p.y-q.y)<3&&dist(p,q)<5.1&&!isBlocked(p,q)) damage(room,q,p,31,12);
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
function simulateBot(room,p,dt) {
  if(p.dead)return;
  const enemies=[...room.players.values()].filter(q=>q.id!==p.id&&!q.dead);
  if(!enemies.length){p.input={};return;}
  const target=enemies.sort((a,b)=>dist(a,p)-dist(b,p))[0];
  const dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);
  const angle=Math.atan2(dx,dz);
  p.facing=angle;
  const strafe=Math.sin(room.elapsed*1.8+Number(p.id)*2)*.45;
  p.input={w:d>(['blaster','bomb'].includes(p.weapon)?8:2.5),s:d<(['blaster','bomb'].includes(p.weapon)?4:1.1),a:strafe<-.25,d:strafe>.25,
    jump:Math.random()<.008,attack:d<(['blaster','bomb'].includes(p.weapon)?11:3.2),skill:d>3&&d<7&&Math.random()<.015,
    super:d<4.9&&Math.random()<.02};
  // Bots already choose a camera-relative movement vector, where W is toward their target.
}
function tick(room,dt) {
  if(room.phase!=='battle') return;
  room.elapsed+=dt;room.timer-=dt;
  if(room.timer<=0){room.timer=0;room.phase='finished'; event(room,'end');broadcastState(room);return;}
  const cycle=(room.elapsed%11);
  room.hazardActive=(cycle>=7.5 && cycle<9);
  for(const p of room.players.values()) {
    p.attackCd=Math.max(0,p.attackCd-dt); p.skillCd=Math.max(0,p.skillCd-dt);p.superCd=Math.max(0,p.superCd-dt);
    p.swing=Math.max(0,p.swing-dt);p.hit=Math.max(0,p.hit-dt);p.invuln=Math.max(0,p.invuln-dt);
    if(p.dead){p.respawnIn-=dt;if(p.respawnIn<=0)spawnPoint(room,p);continue;}
    if(p.isBot) simulateBot(room,p,dt);
    const k=p.input||{};
    let vx=(Number(!!k.d)-Number(!!k.a)),vz=(Number(!!k.w)-Number(!!k.s));
    const length=Math.hypot(vx,vz)||1;vx/=length;vz/=length;
    const sin=Math.sin(p.facing),cos=Math.cos(p.facing);
    // Screen-relative lateral movement: camera faces (sin(facing), 0, cos(facing)).
    // Camera-right is (-cos(facing), 0, sin(facing)), not the reverse.
    let dx=-vx*cos+vz*sin,dz=vz*cos+vx*sin;
    p.moveAmount=(Number(!!k.w)+Number(!!k.s)+Number(!!k.a)+Number(!!k.d))?1:0;
    if(p.dashTime>0){
      p.dashTime=Math.max(0,p.dashTime-dt);dx=Math.sin(p.facing);dz=Math.cos(p.facing);
      for(const q of room.players.values()) if(q.id!==p.id&&!p.dashHits.has(q.id)&&!q.dead&&dist(p,q)<1.5 && Math.abs(p.y-q.y)<2) {
        if(damage(room,q,p,22,10))p.dashHits.add(q.id);
      }
    }
    const speed=p.dashTime>0?19:5.8;
    p.x+=(dx*speed+p.kvx)*dt; p.z+=(dz*speed+p.kvz)*dt;
    p.kvx*=Math.exp(-5*dt);p.kvz*=Math.exp(-5*dt);
    resolveBlocks(p);
    const overFloor = Math.abs(p.x)<=BOUNDS && Math.abs(p.z)<=BOUNDS;
    if(k.jump&&p.grounded){p.vy=8.5;p.grounded=false;}
    p.vy-=22*dt;p.y+=p.vy*dt;
    if(overFloor&&p.y<=0){p.y=0;p.vy=0;p.grounded=true;}else p.grounded=false;
    if(p.y<-9){die(room,p,null);continue;}
    if(k.attack)attack(room,p);
    if(k.skill)skill(room,p);
    if(k.super)superAttack(room,p);
    if(room.hazardActive && p.y<1.5 && Math.hypot(p.x,p.z)<2.6 && p.hazardNext<=room.elapsed){
      p.hazardNext=room.elapsed+.75;damage(room,p,null,12,5);
    }
    if(p.dashTime===0)p.dashHits.clear();
  }
  for(let i=room.projectiles.length-1;i>=0;i--){
    const b=room.projectiles[i];b.x+=b.dx*19*dt;b.z+=b.dz*19*dt;b.life-=dt;
    let remove=b.life<=0||Math.abs(b.x)>BOUNDS+2||Math.abs(b.z)>BOUNDS+2||hitBlock(b.x,b.z,b.y);
    if(!remove){
      const owner=room.players.get(b.owner);
      for(const p of room.players.values()) if(p.id!==b.owner&&!p.dead&&Math.hypot(b.x-p.x,b.z-p.z)<.65&&Math.abs(b.y-(p.y+1.25))<1.4) {
        if(damage(room,p,owner,17,5))remove=true;
        if(remove)break;
      }
    }
    if(remove)room.projectiles.splice(i,1);
  }
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
  safeSend(ws,{t:'hello',version:'0.2.0'});
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
        if(Number.isFinite(m.yaw))p.facing=Math.atan2(Math.sin(m.yaw),Math.cos(m.yaw));
      } else if(m.t==='weapon')p.weapon=safeWeapon(m.weapon);
      else if(m.t==='start'&&room.host===p.id){start(room);}
      else if(m.t==='bot'&&room.host===p.id && room.players.size<MAX_PLAYERS){
        const bot=makePlayer('CPU '+(room.players.size),'',true);bot.weapon=Object.keys(WPN)[Math.floor(Math.random()*Object.keys(WPN).length)];
        room.players.set(bot.id,bot);spawnPoint(room,bot);event(room,'join',{name:bot.name});broadcastState(room);
      } else if(m.t==='removeBots'&&room.host===p.id){
        for(const q of room.players.values())if(q.isBot)room.players.delete(q.id);
        broadcastState(room);
      } else if(m.t==='lobby'&&room.host===p.id){room.phase='lobby';room.projectiles=[];room.bombs=[];broadcastState(room);}
      room.lastActivity=nowMs();
    }
  });
  ws.on('close',()=>removePlayer(ws));ws.on('error',()=>{});
});
const tickTimer=setInterval(()=>{
  for(const room of rooms.values()){
    tick(room,STEP);
    room.snapAt++;
    if(room.snapAt>=2){room.snapAt=0;broadcastState(room);}
    if(nowMs()-room.lastActivity>60*60*1000)rooms.delete(room.code);
  }
},1000/30);
const pingTimer=setInterval(()=>{
  for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}
},30000);
server.listen(PORT,'0.0.0.0',()=>console.log(`Stick Arena 3D listening on http://localhost:${PORT}`));
for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{clearInterval(tickTimer);clearInterval(pingTimer);wss.close();server.close(()=>process.exit(0));});
