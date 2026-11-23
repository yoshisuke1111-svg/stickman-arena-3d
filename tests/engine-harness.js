import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

// Run the actual authoritative engine with inert network/timer boundaries.
// The tests exercise the normal tick; no physics rule is duplicated here.
export function engine() {
  let code=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
  code=code.replace(/^import .*;\n/gm,'').replace('const BASE = path.dirname(fileURLToPath(import.meta.url));',"const BASE = '/unused';");
  code=code.replace(/^server.listen\(PORT,.*\);\n/m,'');
  code+='\n globalThis.__test = { createRoom, makePlayer, joinRoom, start, tick, attack, damage, die, spawnPoint, packState, rooms, WPN, safeWeapon, detonate, advanceBombs, skill, superAttack, wave, resetWeaponPose, ensureWeaponPose, weaponGripPoint, weaponSegment, throwAxe, advanceWeapons, placeAxeTunnel, advanceAxeEffects, beginShockBurst };';
  let connectionHandler;
  const context={
    http:{createServer:()=>({listen(){},close(callback){callback?.();}})},fs,path,crypto,
    WebSocketServer:class {on(name,handler){if(name==='connection')connectionHandler=handler;}close(){}},
    WebSocket:{OPEN:1},process:{env:{PORT:'0'},once(){}},setInterval:()=>0,clearInterval:()=>{},
    console,Date,Math,JSON,Number,Object,String,Set,Map,Array,
  };
  vm.runInNewContext(code,context,{filename:'server-test.js'});
  return {...context.__test,connectSocket:ws=>connectionHandler(ws)};
}
export function fakeSocket(){
  const handlers={};
  return {readyState:1,messages:[],send(data){this.messages.push(JSON.parse(data));},
    on(event,handler){handlers[event]=handler;},receive(message){handlers.message?.(Buffer.from(JSON.stringify(message)));},
    close(){handlers.close?.();},ping(){},terminate(){this.readyState=3;}};
}
export function setup(){
  const api=engine(),room=api.createRoom(),a=fakeSocket(),b=fakeSocket();
  api.connectSocket(a);api.connectSocket(b);
  api.joinRoom(a,room,'A');api.joinRoom(b,room,'B');
  return {api,room,a,b,p1:a.player,p2:b.player};
}
export function place(api,p,values={}){
  Object.assign(p,{x:0,y:0,z:0,vy:0,kvx:0,kvz:0,facing:0,pitch:0,invuln:0,hp:100,dead:false,
    grounded:true,input:{},moveAmount:0,aimMotion:0,attackCd:0,skillCd:0,superCd:0,
    swing:0,hammerSpin:0,dashTime:0,shockDrive:0,shockAge:0,stagger:0,spin:0,hit:0,
    motionVX:0,motionVY:0,motionVZ:0,jumpLatch:false},values);
  api.resetWeaponPose(p);
  return p;
}
export function battle(first={},second={}){
  const state=setup();state.api.start(state.room);
  place(state.api,state.p1,first);
  place(state.api,state.p2,{x:9,z:9,...second});
  return state;
}
export function advance(api,room,seconds,dt=1/30){
  for(let time=0;time<seconds-1e-9;time+=dt)api.tick(room,Math.min(dt,seconds-time));
}
