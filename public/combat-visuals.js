import * as THREE from '/vendor/three.module.js';

// Visuals consume authoritative poses. They never decide whether an attack hit.
const forward = new THREE.Vector3(0, 0, 1);
const up = new THREE.Vector3(0, 1, 0);
const point = new THREE.Vector3();
const orientation = new THREE.Quaternion();
const poseEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export function disposeVisual(group) {
  group.removeFromParent();
  const geometries = new Set(), materials = new Set();
  group.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

// Taper both ends of the slash instead of drawing a thick, open torus.
export function slashGeometry(radius = 1, angleWidth = Math.PI * 1.25) {
  const vertices = [], colors = [], segments = 40;
  for (let i = 0; i < segments; i++) {
    const cross = t => {
      const a = -angleWidth / 2 + angleWidth * t;
      const thickness = Math.pow(Math.sin(Math.PI * t), .8) * radius * .36;
      return [[Math.sin(a) * radius, Math.cos(a) * radius, 0],
        [Math.sin(a) * (radius - thickness), Math.cos(a) * (radius - thickness), 0]];
    };
    const a = cross(i / segments), b = cross((i + 1) / segments);
    vertices.push(...a[0], ...a[1], ...b[0], ...a[1], ...b[1], ...b[0]);
    for (let j = 0; j < 6; j++) colors.push(j === 1 || j === 3 || j === 4 ? .28 : .8, .95, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function shellMaterial(color, alpha) {
  return new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(color) }, alpha: { value: alpha } },
    vertexShader: `varying vec3 surfaceNormal; varying vec3 viewDirection;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.0);
        surfaceNormal=normalize(normalMatrix*normal);viewDirection=normalize(-p.xyz);
        gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform vec3 tint; uniform float alpha;
      varying vec3 surfaceNormal; varying vec3 viewDirection;
      void main(){float edge=pow(1.0-abs(dot(normalize(surfaceNormal),normalize(viewDirection))),2.4);
        gl_FragColor=vec4(tint,alpha*(0.06+edge*0.86));}`,
    side: THREE.DoubleSide, transparent: true, depthWrite: false
  });
}

export function createFlowTube(t) {
  const group = new THREE.Group();
  const radius = t.radius || 1.45;
  const material = shellMaterial('#54c7f3', .58);
  const surface = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, t.length, 36, 1, true), material);
  surface.rotation.x = Math.PI / 2;
  surface.position.z = t.length / 2;
  group.add(surface);
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(radius * .97, radius * .97, t.length, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: '#4daee3', transparent: true, opacity: .055, side: THREE.DoubleSide, depthWrite: false }));
  fill.rotation.x = Math.PI / 2; fill.position.z = t.length / 2; group.add(fill);
  const caps = [];
  for (const z of [0, t.length]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(radius, 32),
      new THREE.MeshBasicMaterial({ color: '#79d7ff', opacity: .065, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    cap.position.z = z; group.add(cap); caps.push(cap);
  }
  const bubbles = [], bubbleGeo = new THREE.SphereGeometry(1, 10, 7);
  const bubbleMat = new THREE.MeshBasicMaterial({ color: '#e5fcff', transparent: true, opacity: .82, depthWrite: false });
  for (let i = 0; i < Math.max(28, Math.ceil(t.length * 2.7)); i++) {
    const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
    const size = .035 + ((i * 13) % 11) * .009;
    bubble.scale.setScalar(size); group.add(bubble); bubbles.push(bubble);
  }
  const visual = { group, material, fill, caps, bubbles, radius, length: t.length, state: t, age: t.age, received: performance.now() };
  updateFlowTube(visual, t);
  return visual;
}

export function updateFlowTube(v, t) {
  v.state = t; v.age = t.age; v.received = performance.now();
  v.group.position.set(t.x, t.y, t.z);
  point.set(t.dx ?? Math.sin(t.f) * Math.cos(t.pitch), t.dy ?? Math.sin(t.pitch), t.dz ?? Math.cos(t.f) * Math.cos(t.pitch)).normalize();
  v.group.quaternion.setFromUnitVectors(forward, point);
}

export function animateFlowTube(v, now) {
  const since = Math.min(.1, (now - v.received) / 1000);
  const age = v.age + since, fade = Math.min(1, Math.max(0, (v.state.life - since) / .42));
  v.material.uniforms.alpha.value = .58 * fade;
  v.fill.material.opacity = .055 * fade;
  for (const cap of v.caps) cap.material.opacity = .065 * fade;
  for (const [i, b] of v.bubbles.entries()) {
    const angle = i * 2.399963 + age * .15;
    const r = Math.sqrt(((i * 37) % 101) / 101) * v.radius * .83;
    const z = ((i * 1.731 + age * (9.6 + (i % 3) * .55)) % v.length);
    b.position.set(Math.cos(angle) * r, Math.sin(angle) * r, z);
    b.material.opacity = .82 * fade;
  }
}

export function createShockShell(p) {
  const group = new THREE.Group();
  const material = shellMaterial('#72f5ec', .96);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), material);
  group.add(sphere);
  // A faint interior volume makes this a bubble around the axe head, not a floor ring.
  const interior = new THREE.Mesh(new THREE.SphereGeometry(.98, 20, 12),
    new THREE.MeshBasicMaterial({ color: '#4cd4ef', transparent: true, opacity: .05, depthWrite: false }));
  group.add(interior);
  const visual = { group, material, interior, state: p, received: performance.now() };
  updateShockShell(visual, p);
  return visual;
}

export function updateShockShell(v, p) {
  v.state = p; v.received = performance.now();
  v.group.position.set(p.x, p.y, p.z);
  v.group.visible = p.phase === 'burst';
}

export function animateShockShell(v, now, ownerHead) {
  const p = v.state;
  if (p.phase !== 'burst') { v.group.visible = false; return; }
  const since = Math.min(.045, (now - v.received) / 1000);
  const duration = p.burstDuration || .23;
  const progress = Math.min(1, ((p.burstAge || 0) + since) / duration);
  const radius = Math.max(.06, p.radius + since * p.maxRadius / duration);
  v.group.visible = progress <= 1;
  v.group.scale.setScalar(Math.min(p.maxRadius, radius));
  if (ownerHead) v.group.position.copy(ownerHead);
  const fade = 1 - Math.pow(progress, 5);
  v.material.uniforms.alpha.value = .96 * fade;
  v.interior.material.opacity = .05 * fade;
}

export function setWeaponPose(model, p, dt, bodyDisplay) {
  const w = p.wp;
  if (!w) { model.weaponGroup.visible = false; return; }
  model.weaponGroup.visible = model.root.visible && !p.dead;
  const held = w.mode === 'held';
  const desired = point.set(w.x, w.y, w.z);
  if (held) desired.add(new THREE.Vector3(bodyDisplay.x - p.x, bodyDisplay.y - p.y, bodyDisplay.z - p.z));
  if (!model.hasWeaponPose || model.lastPoseMode !== w.mode) {
    // State changes retain the same mesh. Only its authoritative attachment changes.
    if (!model.hasWeaponPose) model.weaponGroup.position.copy(desired);
    model.lastPoseMode = w.mode;
  }
  const blend = 1 - Math.exp(-dt * (held ? 27 : 32));
  model.weaponGroup.position.lerp(desired, blend);
  poseEuler.set(-w.pitch, w.yaw, w.roll || 0, 'YXZ');
  orientation.setFromEuler(poseEuler);
  if (!model.hasWeaponPose) model.weaponGroup.quaternion.copy(orientation);
  else model.weaponGroup.quaternion.slerp(orientation, blend);
  model.hasWeaponPose = true;
  model.weaponGroup.updateMatrixWorld();
  model.weaponHead ||= new THREE.Vector3();
  model.weaponHead.set(0, 0, p.w === 'axe' ? 1.47 : p.w === 'hammer' ? 1.35 : p.w === 'katana' ? 2.4 : 1.5);
  model.weaponGroup.localToWorld(model.weaponHead);
  return held;
}

export function poseHoldingArm(model, held) {
  // Elbow and hand follow the same grip as the physics body. No separate attack sine.
  const shoulder = new THREE.Vector3(.26, 1.54, 0);
  const wrist = held ? model.root.worldToLocal(model.weaponGroup.position.clone()) : new THREE.Vector3(.40, .88, .18);
  const delta = wrist.clone().sub(shoulder), length = delta.length();
  const elbow = shoulder.clone().addScaledVector(delta, .5);
  const bend = Math.sqrt(Math.max(.006, .54 * .54 - Math.min(length * .5, .53) ** 2));
  elbow.add(new THREE.Vector3(bend * .85, -.03, -bend * .48));
  const segment = (mesh, a, b) => {
    const d = b.clone().sub(a);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.scale.set(.09, d.length(), .09);
    mesh.quaternion.setFromUnitVectors(up, d.normalize());
  };
  segment(model.armUpper, shoulder, elbow); segment(model.armFore, elbow, wrist);
  model.elbowJoint.position.copy(elbow); model.hand.position.copy(wrist);
}

export function createRibbon(maxPoints = 18, color = '#8defff', opacity = .30) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((maxPoints - 1) * 18), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array((maxPoints - 1) * 18), 3));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  mesh.frustumCulled = false;
  return { mesh, history: [], maxPoints, lastAt: 0 };
}

export function updateRibbon(r, a, b, time, active, lifetime = .14) {
  if (active && time - r.lastAt >= .012) {
    r.history.unshift({ a: a.clone(), b: b.clone(), time });
    r.lastAt = time;
  }
  r.history = r.history.filter(h => time - h.time < lifetime).slice(0, r.maxPoints);
  const pos = r.mesh.geometry.attributes.position, color = r.mesh.geometry.attributes.color;
  let k = 0;
  for (let i = 0; i < r.history.length - 1; i++) {
    const a0 = r.history[i], a1 = r.history[i + 1];
    for (const [v, t] of [[a0.a,a0.time],[a0.b,a0.time],[a1.a,a1.time],[a0.b,a0.time],[a1.b,a1.time],[a1.a,a1.time]]) {
      pos.setXYZ(k, v.x, v.y, v.z);
      const fade = Math.max(0, 1 - (time - t) / lifetime);
      color.setXYZ(k, fade * .55, fade, fade); k++;
    }
  }
  r.mesh.geometry.setDrawRange(0, k); pos.needsUpdate = true; color.needsUpdate = true;
  r.mesh.visible = k > 0;
}

export function createDragon() {
  const group = new THREE.Group();
  const glow = new THREE.MeshBasicMaterial({ color: '#39e7ff', side: THREE.DoubleSide });
  // Distinct open jaw, brow, swept horns and a tapered muzzle; original geometry.
  const shape = new THREE.Shape();
  shape.moveTo(-.34, -.40); shape.lineTo(-.60, -.17); shape.lineTo(-.25, .15);
  shape.lineTo(-.46, .67); shape.lineTo(-.12, .48); shape.lineTo(.04, .81);
  shape.lineTo(.24, .40); shape.lineTo(.37, .28); shape.lineTo(.67, -.04);
  shape.lineTo(.25, -.02); shape.lineTo(.45, -.17); shape.lineTo(.18, -.30);
  shape.lineTo(-.34, -.40);
  const head = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .24, bevelEnabled: false }), glow);
  // Shape x is forward in this profile; rotate it into local +Z.
  head.rotation.y = -Math.PI / 2;
  head.position.set(-.12, 0, -.28); group.add(head);
  const skull = new THREE.Mesh(new THREE.ConeGeometry(.32, .95, 5), glow);
  skull.rotation.x = Math.PI / 2; skull.position.z = -.22; skull.scale.y = .9; group.add(skull);
  for (const side of [-1,1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.063, 8, 6), new THREE.MeshBasicMaterial({ color: '#eaffff' }));
    eye.position.set(side * .23, .09, -.05); group.add(eye);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(.085, .62, 5), glow);
    horn.position.set(side * .24, .30, -.57); horn.rotation.x = -.56; horn.rotation.z = -side * .3; group.add(horn);
  }
  const tailGeometry = new THREE.BufferGeometry();
  tailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 18), 3));
  tailGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(24 * 18), 3));
  const tail = new THREE.Mesh(tailGeometry, new THREE.MeshBasicMaterial({ color: '#23cbed', vertexColors: true, transparent: true, opacity: .42, side: THREE.DoubleSide, depthWrite: false }));
  group.add(tail);
  return { group, tail };
}

export function updateDragonTail(b, p) {
  const length = Math.min(14, Math.max(.3, p.travel || Math.hypot(p.x - (p.sx ?? p.x), p.y - (p.sy ?? p.y), p.z - (p.sz ?? p.z))));
  const vertices = b.tail.geometry.attributes.position, colors = b.tail.geometry.attributes.color;
  let k = 0;
  for (let i = 0; i < 24; i++) {
    const section = n => {
      const t = n / 24, width = (.08 + .30 * (1 - t)) * Math.min(1, length / 2);
      const y = Math.sin(t * 4 + (p.age || 0) * 2) * .045 * t;
      return [new THREE.Vector3(-width,y,-.50 - length*t), new THREE.Vector3(width,y,-.50-length*t)];
    };
    const a = section(i), c = section(i + 1);
    for (const [v,t] of [[a[0],i/24],[a[1],i/24],[c[0],(i+1)/24],[a[1],i/24],[c[1],(i+1)/24],[c[0],(i+1)/24]]) {
      vertices.setXYZ(k,v.x,v.y,v.z);
      const alpha = .08 + .92 * (1-t); colors.setXYZ(k,alpha*.3,alpha,alpha); k++;
    }
  }
  vertices.needsUpdate = true; colors.needsUpdate = true;
  b.tail.geometry.computeBoundingSphere();
}
