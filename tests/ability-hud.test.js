import test from 'node:test';
import assert from 'node:assert/strict';
import { cooldownView } from '../public/ability-hud.js';
import { battle, advance } from './engine-harness.js';

test('the HUD uses each weapon cooldown from the actual server snapshot', () => {
  for (const weapon of ['blade','hammer','katana','axe','blaster','bomb']) {
    const {api,room,p1}=battle({weapon});
    api.skill(room,p1);
    api.superAttack(room,p1);
    const initial=api.packState(room).players.find(p=>p.id===p1.id);
    for (const index of [1,2]) {
      assert.ok(initial.cdMax[index]>0,weapon);
      assert.equal(initial.cd[index],initial.cdMax[index],weapon);
      assert.equal(cooldownView(initial.cd[index],initial.cdMax[index]).fraction,1);
    }
    advance(api,room,1);
    const next=api.packState(room).players.find(p=>p.id===p1.id);
    for (const index of [1,2]) {
      const view=cooldownView(next.cd[index],next.cdMax[index]);
      assert.ok(view.fraction>0 && view.fraction<1,weapon);
      assert.ok(Math.abs(view.fraction-(1-1/initial.cdMax[index]))<.001,weapon);
      assert.equal(view.ready,false);
    }
  }
});

test('a late snapshot never turns the ready ring on before server confirmation', () => {
  assert.deepEqual(cooldownView(5,5,1.25),{ready:false,fraction:.75,remaining:3.75});
  assert.deepEqual(cooldownView(.1,5,2),{ready:false,fraction:0,remaining:0});
  assert.deepEqual(cooldownView(0,5,2),{ready:true,fraction:0,remaining:0});
  // Recasting restores a full dark disk even after a long previous cooldown.
  assert.deepEqual(cooldownView(5,5,0),{ready:false,fraction:1,remaining:5});
});

test('missing server timing cannot display a misleading ready ring', () => {
  for (const [remaining,duration] of [[undefined,undefined],[0,0],[NaN,5],[1,Infinity]]) {
    assert.deepEqual(cooldownView(remaining,duration),{ready:false,fraction:1,remaining:null});
  }
});
