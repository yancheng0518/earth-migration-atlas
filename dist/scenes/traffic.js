import * as THREE from 'three';
import { paintwork } from './station.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0),
  NOSE = V(0, 0, 1),
  TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const smooth = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
// Six plate faces, twelve polished edges and eight rounded corners share their
// UV atlas. The bevel is fixed in model space and needs no shader or post-effect.
function armourPlate() {
  const geometry = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);
  const { position, normal, uv } = geometry.attributes;
  const point = V(),
    inner = V(),
    edge = V();
  function spread(n) {
    return Math.sign(n) * (Math.abs(n) > 0.4 ? 0.5 : 0.431);
  }
  for (let i = 0; i < position.count; i++) {
    point.set(spread(position.getX(i)), spread(position.getY(i)), spread(position.getZ(i)));
    inner.copy(point).clampScalar(-0.431, 0.431);
    edge.copy(point).sub(inner).normalize();
    point.copy(inner).addScaledVector(edge, 0.069);
    position.setXYZ(i, point.x, point.y, point.z);
    normal.setXYZ(i, edge.x, edge.y, edge.z);
    uv.setXY(i, spread(uv.getX(i) - 0.5) + 0.5, spread(uv.getY(i) - 0.5) + 0.5);
  }
  return geometry;
}
const geometries = {
  box: armourPlate(),
  tube: new THREE.CylinderGeometry(1, 1, 1, 12),
  sphere: new THREE.SphereGeometry(1, 16, 10),
  bell: new THREE.CylinderGeometry(0.67, 1, 1, 12),
};
const steel = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.36, roughness: 0.61 });
const alloy = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .77, roughness: .44 });
const blanket = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .08, roughness: .91 });
const glass = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, metalness: .05, roughness: .2, clearcoat: .67, clearcoatRoughness: .21,
});
const light = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5) });
const ivory = 0xc4c4b9,
  steelBlue = 0x758493,
  orange = 0xa6643d,
  paint = 0x9f9071,
  graphite = 0x394653,
  black = 0x202e39;
const engineBlue = 0x8fe7ff;
const q = new THREE.Quaternion(),
  tmpMatrix = new THREE.Object3D(),
  col = new THREE.Color();
const bodyAlign = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2);
const distantHulls = new Map(),
  distantSteel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 });
const simpleBox = new THREE.BoxGeometry();
function distantHull(kind, batches) {
  if (!distantHulls.has(kind)) {
    const positions = [],
      normals = [],
      colors = [];
    const p = V(),
      n = V(),
      normalMatrix = new THREE.Matrix3();
    for (const { form, items } of batches.values()) {
      const geo = form === 'box' ? simpleBox : geometries[form];
      const pos = geo.attributes.position,
        normal = geo.attributes.normal,
        index = geo.index;
      for (const { matrix, color, width } of items) {
        if (width < (kind === 'tug' ? 0.105 : 0.185)) continue;
        col.setHex(color);
        normalMatrix.getNormalMatrix(matrix);
        for (let i = 0; i < index.count; i++) {
          const vertex = index.getX(i);
          p.fromBufferAttribute(pos, vertex).applyMatrix4(matrix);
          n.fromBufferAttribute(normal, vertex).applyNormalMatrix(normalMatrix);
          positions.push(p.x, p.y, p.z);
          normals.push(n.x, n.y, n.z);
          colors.push(col.r, col.g, col.b);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    for (const [name, data] of [
      ['position', positions],
      ['normal', normals],
      ['color', colors],
    ])
      geo.setAttribute(name, new THREE.Float32BufferAttribute(data, 3));
    geo.computeBoundingSphere();
    distantHulls.set(kind, geo);
  }
  return new THREE.Mesh(distantHulls.get(kind), distantSteel);
}
function registry(ship) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#bebeb1';
  ctx.fillRect(0, 0, 384, 96);
  ctx.fillStyle = '#596067';
  ctx.fillRect(2, 2, 380, 3);
  ctx.fillStyle = '#303b41';
  ctx.font = 'bold 48px Arial';
  ctx.fillText('HY–07', 26, 56);
  ctx.font = 'bold 14px Arial';
  ctx.fillText('UEG   ORBITAL  FREIGHT', 29, 80);
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(236 + i * 25, 64);
    ctx.lineTo(252 + i * 25, 64);
    ctx.lineTo(226 + i * 25, 89);
    ctx.lineTo(210 + i * 25, 89);
    ctx.fill();
  }
  ctx.fillStyle = '#8c602d';
  ctx.fillRect(204, 15, 151, 4);
  ctx.font = 'bold 16px Arial';
  ctx.fillText('LIFT ACCESS  /  02', 207, 46);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.69, metalness: 0.18 });
  const geo = new THREE.PlaneGeometry(1, 1),
    labels = [];
  for (const sign of [-1, 1]) {
    const face = new THREE.Mesh(geo, mat);
    face.position.set(sign * 0.4058, 0.021, 1.01);
    face.scale.set(0.395, 0.102, 1);
    face.rotation.y = (sign * Math.PI) / 2;
    ship.add(face);
    labels.push(face);
  }
  const top = new THREE.Mesh(geo, mat);
  top.position.set(0, 0.262, 1.007);
  top.rotation.x = -Math.PI / 2;
  top.scale.set(0.56, 0.141, 1);
  ship.add(top);
  labels.push(top);
  return labels;
}

// A model's +Z axis passes through the centre of its active docking collar.
// Subpixel details are trimmed in the instance buffer, leaving its original hull throughout.
function vessel(kind, scale, callsign) {
  const ship = new THREE.Group();
  ship.name = callsign;
  ship.scale.setScalar(scale);
  const batches = new Map(),
    draws = [],
    engines = [];
  if (!steel.map) steel.map = paintwork();
  let decals = [];
  const visualRadius = kind === 'tug' ? 0.74 : 1.53;
  function part(form, color, x, y, z, w, h, d, rotation, material = steel) {
    const key = `${form}:${material.id}`;
    if (!batches.has(key)) batches.set(key, { form, material, items: [] });
    tmpMatrix.position.set(x, y, z);
    tmpMatrix.scale.set(w, h, d);
    if (rotation?.isQuaternion) tmpMatrix.quaternion.copy(rotation);
    else tmpMatrix.rotation.set(...(rotation || [0, 0, 0]));
    tmpMatrix.updateMatrix();
    batches.get(key).items.push({ matrix: tmpMatrix.matrix.clone(), color, width: [w, h, d].sort((a, b) => a - b)[1] });
  }
  const box = (c, x, y, z, w, h, d, r, m) => part('box', c, x, y, z, w, h, d, r, m);
  const tube = (c, x, y, z, r, length, m) => part('tube', c, x, y, z, r, length, r, bodyAlign, m);
  const ball = (c, x, y, z, w, h, d) => part('sphere', c, x, y, z, w, h, d);
  const lamp = (c, x, y, z, w, h, d) => part('box', c, x, y, z, w, h, d, null, light);
  function rod(c, a, b, r) {
    const d = b.clone().sub(a),
      mid = a.clone().lerp(b, 0.5);
    part('tube', c, mid.x, mid.y, mid.z, r, d.length(), r, q.setFromUnitVectors(UP, d.normalize()));
  }
  function engine(x, y, z, r) {
    tube(graphite, x, y, z + 0.18, r * 1.08, 0.32);
    tube(orange, x, y, z + 0.075, r * 1.16, 0.051);
    part('bell', steelBlue, x, y, z - 0.064, r, 0.19, r, bodyAlign, alloy);
    part('tube', engineBlue, x, y, z - 0.158, r * 0.78, 0.015, r * 0.78, bodyAlign, light);
    engines.push([x, y, z - 0.16, r]);
  }
  let nose;
  if (kind === 'freighter') {
    nose = 1.45;
    box(ivory, 0, 0, 1.005, 0.81, 0.51, 0.51);
    box(graphite, 0, 0.125, 1.26, 0.63, 0.14, 0.05);
    for (let j = 0; j < 4; j++) {
      const x = (j - 1.5) * .13;
      box(0x334e5d, x, .155, 1.294, .089, .059, .026, null, glass);
      if (j > 1) lamp(0x5c9db5, x, .169, 1.308, .052, .009, .009);
    }
    box(steelBlue, 0, -0.25, 0.91, 0.72, 0.15, 0.45);
    box(graphite, 0, 0.045, -0.18, 0.52, 0.43, 2.26);
    for (const side of [-1, 1]) {
      tube(steelBlue, side * 0.164, 0.292, -0.023, 0.069, 0.94, alloy);
      for (let j = 0; j < 6; j++) tube(j % 3 ? graphite : paint, side * 0.164, 0.292, 0.42 - j * 0.168, 0.076, 0.034);
      box(ivory, side * 0.29, 0.065, 0.682, 0.143, 0.26, 0.28, [0, side * 0.1, 0]);
      for (let j = 0; j < 3; j++) box(black, side * 0.406, 0.119, 1.15 - j * 0.104, 0.022, 0.099, 0.075);
      for (let j = 0; j < 3; j++) lamp(0x9ce3fb, side * 0.421, 0.123, 1.14 - j * 0.104, 0.011, 0.044, 0.048);
      for (let j = 0; j < 5; j++)
        rod(paint, V(side * 0.24, -0.247, 0.65 - j * 0.29), V(side * 0.08, -0.327, 0.4 - j * 0.29), 0.024);
      tube(ivory, side * 0.24, 0.282, -0.775, 0.12, 0.37);
      tube(graphite, side * 0.24, 0.282, -0.755, 0.123, 0.045);
    }
    for (let j = 0; j < 3; j++)
      for (const side of [-1, 1]) {
        const z = 0.36 - j * 0.57,
          x = side * 0.49;
        box(j === 1 ? paint : ivory, x, 0, z, 0.37, 0.51, 0.51, null, j === 1 ? blanket : steel);
        for (const dz of [-0.205, 0.205]) {
          box(graphite, x, 0, z + dz, 0.389, 0.544, 0.055);
          box(orange, x, 0.274, z + dz, 0.33, 0.04, 0.071);
        }
        for (let k = 0; k < 5; k++)
          box(j === 1 ? graphite : steelBlue, x + side * 0.187, -0.024, z + (k - 2) * 0.066, 0.021, 0.27, 0.019);
        box(black, x, .259, z, .282, .026, .26, null, blanket);
        box(steelBlue, x, .275, z, .26, .020, .24, null, alloy);
        for (const offset of [-.101, .101]) box(ivory, x + offset, .288, z, .02, .009, .14);
        box(orange, x + side * 0.19, 0.156, z + 0.06, 0.025, 0.05, 0.13);
      }
    for (const side of [-1, 1]) {
      box(graphite, side * 0.63, -0.11, -0.24, 0.08, 0.11, 2.02);
      for (let i = 0; i < 4; i++)
        rod(steelBlue, V(side * 0.63, -0.14, 0.73 - i * 0.49), V(side * 0.48, -0.38, 0.33 - i * 0.49), 0.039);
      box(steelBlue, side * 0.44, 0, -0.98, 0.49, 0.48, 0.42);
      engine(side * 0.45, 0, -1.1, 0.246);
      for (const z of [-0.89, -0.57]) {
        rod(paint, V(side * 0.5, 0.07, z), V(side * 0.95, 0.3, z), 0.031);
        rod(graphite, V(side * 0.53, -0.14, z), V(side * 0.88, 0.26, z), 0.023);
      }
      box(steelBlue, side * 0.932, 0.299, -0.728, 0.539, 0.057, 0.535, [0, 0, side * 0.26]);
      for (let k = 0; k < 8; k++)
        box(black, side * (0.713 + 0.061 * k), 0.275 + 0.016 * k, -0.728, 0.046, 0.048, 0.493, [0, 0, side * 0.26]);
      lamp(side > 0 ? 0xff5748 : 0x85f7cd, side * 1.185, 0.38, -0.875, 0.044, 0.043, 0.1);
      lamp(side > 0 ? 0xff6651 : 0x6afcc8, side * 0.694, 0.065, 0.72, 0.046, 0.058, 0.128);
    }
    box(ivory, 0, 0.34, -0.7, 0.33, 0.18, 0.45);
    rod(steelBlue, V(0, 0.4, -0.64), V(0, 0.63, -0.73), 0.03);
    rod(orange, V(-0.18, 0.64, -0.73), V(0.18, 0.64, -0.73), 0.022);
    ball(ivory, 0.132, 0.549, -0.483, 0.15, 0.045, 0.13);
    rod(graphite, V(0.13, 0.409, -0.52), V(0.13, 0.551, -0.48), 0.027);
    decals = registry(ship);
  } else if (kind === 'tanker') {
    nose = 1.39;
    tube(steelBlue, 0, 0, -0.03, 0.205, 2.42);
    for (let j = 0; j < 3; j++) {
      const z = 0.53 - j * 0.62;
      ball(j === 1 ? orange : ivory, 0, 0.05, z, 0.45, 0.454, 0.36);
      tube(steelBlue, 0, 0.05, z, 0.459, 0.083);
      for (const side of [-1, 1]) {
        rod(paint, V(side * 0.4, -0.16, z - 0.33), V(side * 0.4, -0.16, z + 0.33), 0.057);
        rod(graphite, V(side * 0.4, -0.16, z - 0.25), V(side * 0.21, -0.37, z), 0.044);
      }
    }
    box(steelBlue, 0, 0, 1.03, 0.45, 0.39, 0.38);
    for (const side of [-1, 1]) {
      engine(side * 0.34, -0.04, -1.04, 0.18);
      box(graphite, side * 0.32, -0.02, -0.91, 0.32, 0.31, 0.29);
      lamp(side > 0 ? 0xff765c : 0x8afac8, side * 0.4, -0.08, 0.72, 0.045, 0.055, 0.095);
    }
  } else {
    nose = 0.69;
    box(orange, 0, 0, -0.02, 0.7, 0.44, 0.78);
    box(ivory, 0, 0.2, 0.15, 0.56, 0.26, 0.42);
    lamp(0x8be5ff, 0, 0.24, 0.364, 0.42, 0.079, 0.018);
    for (const side of [-1, 1]) {
      box(steelBlue, side * 0.4, -0.09, -0.01, 0.16, 0.15, 0.87);
      box(paint, side * 0.4, -0.09, 0.39, 0.22, 0.2, 0.14);
      engine(side * 0.3, -0.045, -0.38, 0.144);
      lamp(side > 0 ? 0xff765b : 0x8df8d1, side * 0.491, 0.012, -0.018, 0.032, 0.038, 0.078);
    }
  }
  tube(graphite, 0, 0, nose - 0.17, 0.229, 0.236);
  tube(ivory, 0, 0, nose - 0.074, 0.218, 0.07);
  tube(paint, 0, 0, nose - 0.018, 0.187, 0.036);
  for (let i = 0; i < 6; i++)
    lamp(
      i % 2 ? 0xffc178 : 0xb0ecfd,
      Math.cos((TAU * i) / 6) * 0.191,
      Math.sin((TAU * i) / 6) * 0.191,
      nose - 0.043,
      0.029,
      0.029,
      0.052,
    );
  for (const { form, material, items } of batches.values()) {
    items.sort((a, b) => b.width - a.width);
    const mesh = new THREE.InstancedMesh(geometries[form], material, items.length);
    for (let i = 0; i < items.length; i++) {
      mesh.setMatrixAt(i, items[i].matrix);
      mesh.setColorAt(i, col.setHex(items[i].color));
    }
    mesh.computeBoundingSphere();
    ship.add(mesh);
    draws.push({ mesh, items });
  }

  const silhouette = distantHull(kind, batches);
  ship.add(silhouette);
  silhouette.visible = false;
  const jetMaterials = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; varying vec3 n,v;
      void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.);v=-p.xyz;n=normalMatrix*normal;
      gl_Position=projectionMatrix*p;}`,
    fragmentShader: `varying vec2 vUv; varying vec3 n,v; uniform float power,time;
      void main(){
        float axial=pow(1.0-vUv.y,1.78);
        float column=pow(abs(dot(normalize(n),normalize(v))),1.65);
        float flow=42.*vUv.y-11.*time;
        float cells=.67+.33*cos(flow+sin(flow*.53+vUv.x*14.)*1.9);
        vec3 tint=mix(vec3(.13,.24,.86),vec3(.55,.82,1.22),axial);
        gl_FragColor=vec4(tint,axial*column*cells*power*.76);
        #include <colorspace_fragment>
      }`,
    uniforms: { power: { value: 1 }, time: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const jets = new THREE.Group();
  const flameGeometry = new THREE.ConeGeometry(1, 1, 12, 1, true);
  // In local +Y the cone tip is forward; the tip of a nozzle plume points aft.
  for (const [x, y, z, r] of engines) {
    const nozzle = new THREE.Group(),
      jet = new THREE.Mesh(flameGeometry, jetMaterials);
    nozzle.position.set(x, y, z);
    nozzle.rotation.x = -Math.PI / 2;
    jet.position.y = 0.5;
    jet.scale.set(r * 0.77, 1, r * 0.77);
    nozzle.add(jet);
    jets.add(nozzle);
  }
  ship.add(jets);
  let lastBand = null;
  function appearance(power, seconds, camera, height) {
    const drive = 0.2 + power * (0.85 + 0.075 * Math.sin(seconds * 12.1));
    for (const nozzle of jets.children) nozzle.scale.y = 0.13 + drive * 0.7;
    jetMaterials.uniforms.power.value = 0.3 + power * 0.7;
    jetMaterials.uniforms.time.value = seconds;
    if (!camera || !height) return;
    const pixels =
      (height * camera.zoom * scale) /
      (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(0.00001, ship.position.distanceTo(camera.position)));
    const band = Math.floor(3 * Math.log2(Math.max(0.0001, pixels)));
    if (band === lastBand) return;
    lastBand = band;
    ship.visible = pixels * visualRadius > 0.37;
    const cutoff = 0.56 / 2 ** (band / 3);
    const distant = pixels < 6.6;
    silhouette.visible = distant;
    for (const { mesh, items } of draws) {
      let count = 0;
      while (count < items.length && items[count].width >= cutoff) count++;
      mesh.count = count;
      mesh.visible = !distant && count > 0;
    }
    for (const decal of decals) decal.visible = pixels > 8;
    jets.visible = pixels > 2.5;
  }
  return { ship, nose: nose * scale, appearance };
}

function endpoints() {
  return { point: V(), normal: V(), right: V(), up: V(), clear: V() };
}
function readPort(port, out, clearance) {
  port.updateWorldMatrix(true, false);
  out.point.setFromMatrixPosition(port.matrixWorld);
  out.normal.copy(NOSE).transformDirection(port.matrixWorld);
  out.right.set(1, 0, 0).transformDirection(port.matrixWorld);
  out.up.copy(UP).transformDirection(port.matrixWorld);
  out.clear.copy(out.point).addScaledVector(out.normal, clearance);
}
const va = V(),
  vb = V(),
  axis = V(),
  outside = V();
function arc(a, b, t, altitude, out) {
  const ra = a.length(),
    rb = b.length();
  va.copy(a).multiplyScalar(1 / ra);
  vb.copy(b).multiplyScalar(1 / rb);
  axis.crossVectors(va, vb);
  const sin = axis.length(),
    angle = Math.atan2(sin, clamp(va.dot(vb), -1, 1));
  if (sin < 0.00001) {
    axis.crossVectors(va, Math.abs(va.y) < 0.85 ? UP : NOSE).normalize();
  } else axis.multiplyScalar(1 / sin);
  return out
    .copy(va)
    .applyAxisAngle(axis, t * angle)
    .multiplyScalar(THREE.MathUtils.lerp(ra, rb, t) + Math.sin(Math.PI * t) * altitude);
}
function route(a, b, f, nose, height, out) {
  if (f <= 0.18) {
    outside.copy(a.point).addScaledVector(a.normal, nose);
    return out.copy(outside).lerp(a.clear, smooth(f / 0.18));
  }
  if (f >= 0.82) {
    outside.copy(b.point).addScaledVector(b.normal, nose);
    return out.copy(b.clear).lerp(outside, smooth((f - 0.82) / 0.18));
  }
  return arc(a.clear, b.clear, smooth((f - 0.18) / 0.64), height, out);
}
const before = V(),
  after = V(),
  forward = V(),
  radial = V(),
  right = V(),
  vertical = V(),
  mat = new THREE.Matrix4();
function orbitalAttitude(position, direction, quaternion) {
  radial.copy(position).normalize();
  right.crossVectors(radial, direction);
  if (right.lengthSq() < 0.000001) right.crossVectors(Math.abs(direction.y) < 0.8 ? UP : NOSE, direction);
  right.normalize();
  vertical.crossVectors(direction, right).normalize();
  mat.makeBasis(right, vertical, direction);
  return quaternion.setFromRotationMatrix(mat);
}
function orient(object, direction) {
  orbitalAttitude(object.position, direction, object.quaternion);
}
const turnMid = new THREE.Quaternion(),
  dockFrame = new THREE.Quaternion(),
  turnPoint = V(),
  turnDirection = V();
// Docking roll is locked to the berth's axis. Elsewhere the ship keeps its deck radial.
function attitude(craft, a, b, f, direction, altitude) {
  orient(craft.ship, direction);
  const source = f < 0.5 ? a : b,
    docking = f < 0.5 ? 1 - smooth((f - 0.057) / 0.24) : smooth((f - 0.67) / 0.2);
  if (!docking) return;
  before.copy(source.normal).negate();
  after.crossVectors(source.up, before).normalize();
  vertical.crossVectors(before, after).normalize();
  mat.makeBasis(after, vertical, before);
  dockFrame.setFromRotationMatrix(mat);
  if (docking >= 1) {
    craft.ship.quaternion.copy(dockFrame);
    return;
  }
  const u = f < 0.5 ? 0.08 : 0.92;
  arc(a.clear, b.clear, u - 0.002, altitude, before);
  arc(a.clear, b.clear, u + 0.002, altitude, after);
  turnDirection.subVectors(after, before).normalize();
  turnPoint.copy(before).lerp(after, 0.5);
  orbitalAttitude(turnPoint, turnDirection, turnMid).slerp(dockFrame, 0.5);
  if (docking < 0.5) craft.ship.quaternion.slerp(turnMid, docking * 2);
  else craft.ship.quaternion.copy(turnMid).slerp(dockFrame, (docking - 0.5) * 2);
}
function timetable(t) {
  const s = THREE.MathUtils.euclideanModulo(t, 32);
  if (s < 3.2) return [true, 0, 'berthed'];
  if (s < 15.2) return [true, (s - 3.2) / 12, 'transferring'];
  if (s < 18.6) return [true, 1, 'berthed'];
  if (s < 30.6) return [false, (s - 18.6) / 12, 'transferring'];
  return [false, 1, 'berthed'];
}

export function createTraffic({ earth, elevator, station }) {
  const group = new THREE.Group();
  group.name = 'UEG scheduled orbital freight';
  const main = vessel('freighter', 0.047, 'HAIYUN 07 · modular container carrier');
  const fuel = vessel('tanker', 0.036, 'KUNPENG 12 · cryogenic tanker');
  const escorts = [
    vessel('tug', 0.028, 'Mooring tender 03'),
    vessel('tug', 0.025, 'Mooring tender 04'),
    vessel('tug', 0.031, 'Orbital inspection tender 09'),
    vessel('tug', 0.027, 'KUNPENG escort'),
    vessel('tug', 0.032, 'Linxi 01 · route surveyor'),
    vessel('tug', 0.029, 'Linxi 02 · berth pilot'),
  ];
  const vessels = [main, fuel, ...escorts];
  group.add(...vessels.map((v) => v.ship));
  const ports = {};
  for (const id of ['elevator', 'station'])
    for (const berth of ['primary', 'service']) {
      ports[id + berth] = endpoints();
    }
  const heroDir = V(),
    tankerDir = V(),
    lane = V(),
    tugNext = V();
  const state = { phase: 'berthed', from: 'elevator', to: 'station', progress: 0 };
  function transfer(craft, berth, time, flightDirection, altitude) {
    const [outbound, f, status] = timetable(time);
    const from = outbound ? 'elevator' : 'station',
      to = outbound ? 'station' : 'elevator';
    const a = ports[from + berth],
      b = ports[to + berth];
    route(a, b, f, craft.nose, altitude, craft.ship.position);
    route(a, b, clamp(f - 0.002, 0, 1), craft.nose, altitude, before);
    route(a, b, clamp(f + 0.002, 0, 1), craft.nose, altitude, after);
    flightDirection.subVectors(after, before);
    if (flightDirection.lengthSq() < 1e-14)
      flightDirection.copy(f < 0.5 ? a.normal : b.normal).multiplyScalar(f < 0.5 ? 1 : -1);
    flightDirection.normalize();
    // A ship can back out without a 180° flip. Interpolate the approach attitude
    // against the tangent of the free-flight leg, including at zero linear speed.
    const cruise = clamp((f - 0.18) / 0.64, 0.002, 0.998);
    arc(a.clear, b.clear, cruise - 0.001, altitude, before);
    arc(a.clear, b.clear, cruise + 0.001, altitude, after);
    forward.subVectors(after, before).normalize();
    attitude(craft, a, b, f, forward, altitude);
    craft.power = status === 'berthed' ? 0 : 0.1 + 0.88 * smooth((f - 0.13) / 0.12) * (1 - smooth((f - 0.69) / 0.17));
    craft.appearanceTime = time;
    function engage(model, which, amount) {
      model.ports[which].userData.setEngagement(amount);
    }
    const fromModel = outbound ? elevator : station,
      toModel = outbound ? station : elevator;
    engage(fromModel, berth, 1 - smooth(f / 0.035));
    engage(toModel, berth, smooth((f - 0.965) / 0.035));
    if (craft === main) {
      const phase = status === 'berthed' ? status : f < 0.18 ? 'departing' : f > 0.82 ? 'docking' : 'transferring';
      Object.assign(state, { phase, from, to, progress: f });
    }
    return f;
  }
  function holdingPosition(a, time, index, out) {
    const angle = time * (index === 2 ? 0.21 : 0.3) + (index === 1 ? 3.25 : 0.5);
    return out
      .copy(a.clear)
      .addScaledVector(a.right, Math.cos(angle) * (0.106 + index * 0.029))
      .addScaledVector(a.up, Math.sin(angle) * (0.075 + index * 0.024))
      .addScaledVector(a.normal, 0.066 * Math.sin(angle * 0.84 + index));
  }
  const parked = V(),
    formation = V(),
    track = V(),
    deck = V(),
    lateral = V(),
    bearing = V(),
    separation = V();
  function escortPosition(index, t, f, mainSource, destination) {
    const tug = escorts[index + 4],
      side = index === 0 ? 1 : -1;
    const terminal = f < 0.5 ? mainSource : destination;
    parked
      .copy(terminal.clear)
      .addScaledVector(terminal.right, side * (0.215 + 0.017 * Math.sin(t * 0.22 + index)))
      .addScaledVector(terminal.up, 0.1 * Math.cos(t * 0.17 + index * 3))
      .addScaledVector(terminal.normal, index === 0 ? 0.096 : -0.025);
    const cruise = clamp((f - 0.18) / 0.64, 0.003, 0.997);
    arc(mainSource.clear, destination.clear, cruise - 0.002, 0.47, before);
    arc(mainSource.clear, destination.clear, cruise + 0.002, 0.47, after);
    track.subVectors(after, before).normalize();
    deck.copy(main.ship.position).normalize();
    lateral.crossVectors(deck, track).normalize();
    // The surveyor leads and clears the track; the berth pilot flies aft and
    // starboard, separating onto its own side before the carrier begins docking.
    formation
      .copy(main.ship.position)
      .addScaledVector(lateral, side * (index === 0 ? 0.075 : 0.093))
      .addScaledVector(track, index === 0 ? 0.086 : -0.091)
      .addScaledVector(deck, index === 0 ? -0.034 : -0.059);
    const join = smooth((f - 0.12) / 0.14) * (1 - smooth((f - 0.72) / 0.16));
    tug.ship.position.copy(parked).lerp(formation, join);
    separation.subVectors(tug.ship.position, main.ship.position);
    if (separation.lengthSq() < 0.09 ** 2)
      tug.ship.position.copy(main.ship.position).addScaledVector(separation.normalize(), 0.09);
    bearing.copy(terminal.normal).lerp(track, join).normalize();
    orient(tug.ship, bearing);
    return join;
  }
  function update(time) {
    for (const [id, facility] of [
      ['elevator', elevator],
      ['station', station],
    ]) {
      for (const berth of ['primary', 'service'])
        readPort(facility.ports[berth], ports[id + berth], id === 'station' ? 0.346 : 0.282);
    }
    const mainProgress = transfer(main, 'primary', time, heroDir, 0.47);
    const f = transfer(fuel, 'service', time + 10.3, tankerDir, 0.69);
    for (let i = 0; i < 3; i++) {
      const tug = escorts[i],
        p = [ports.stationprimary, ports.stationservice, ports.elevatorprimary][i];
      holdingPosition(p, time, i, tug.ship.position);
      holdingPosition(p, time + 0.06, i, tugNext);
      orient(tug.ship, tugNext.sub(tug.ship.position).normalize());
      tug.power = 0.23;
      tug.appearanceTime = time + i;
    }
    const wing = escorts[3],
      source = ports[(timetable(time + 10.3)[0] ? 'elevator' : 'station') + 'service'];
    const destination = ports[(timetable(time + 10.3)[0] ? 'station' : 'elevator') + 'service'];
    const p = f < 0.5 ? source : destination;
    holdingPosition(p, time, 1, wing.ship.position);
    wing.ship.position.addScaledVector(p.up, -0.224);
    const join = smooth((f - 0.13) / 0.14) * (1 - smooth((f - 0.74) / 0.14));
    lane.crossVectors(fuel.ship.position, tankerDir).normalize();
    after.copy(fuel.ship.position).addScaledVector(lane, 0.081).addScaledVector(tankerDir, -0.15);
    wing.ship.position.lerp(after, join);
    orient(wing.ship, tankerDir);
    wing.power = 0.23 + join * 0.39;
    wing.appearanceTime = time + 4;
    const mainSource = ports[state.from + 'primary'],
      mainDestination = ports[state.to + 'primary'];
    for (let i = 0; i < 2; i++) {
      const joining = escortPosition(i, time, mainProgress, mainSource, mainDestination);
      escorts[i + 4].power = 0.2 + 0.53 * joining;
      escorts[i + 4].appearanceTime = time + i * 2.5;
    }
    // Tenders have lower right-of-way than docked and transferring tonnage.
    // Preserve a positive hull clearance even when moving port frames cross a holding lane.
    for (let i = 2; i < vessels.length; i++) {
      const tug = vessels[i].ship;
      for (let pass = 0; pass < 3; pass++)
        for (let j = 0; j < i; j++) {
          const other = vessels[j].ship;
          const separationRadius = tug.scale.x * 0.89 + other.scale.x * (j < 2 ? 1.56 : 0.89) + 0.006;
          separation.subVectors(tug.position, other.position);
          if (separation.lengthSq() < separationRadius * separationRadius) {
            if (separation.lengthSq() < 1e-12) separation.copy(radial);
            tug.position.copy(other.position).addScaledVector(separation.normalize(), separationRadius);
          }
        }
    }
  }
  // Ship positions can guide the shot. Choose LOD only once that shot's
  // camera is in place, so the prior frame cannot affect a paused seek.
  function updateAppearance(camera, height) {
    for (const vessel of vessels) vessel.appearance(vessel.power, vessel.appearanceTime, camera, height);
  }
  update(0);
  return {
    group,
    hero: main.ship,
    vessels: vessels.map((v) => v.ship),
    state,
    update,
    updateAppearance,
    getHeroPose(position, direction) {
      position.copy(main.ship.position);
      direction.copy(heroDir);
      return state;
    },
  };
}
