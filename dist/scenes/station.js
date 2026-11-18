import * as THREE from 'three';

const TAU = Math.PI * 2;
const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const up = vec(0, 1, 0);
const circle = (a, radius, z = 0) => vec(Math.cos(a) * radius, Math.sin(a) * radius, z);
const metal = (color, roughness = 0.67, metalness = 0.24) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
const glow = (color, power = 1) =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(power),
    toneMapped: true,
  });

// A single batch can contain all the repeated windows, truss rods, or armor plates.
function assembly(parent, detail) {
  const batches = new Map();
  const transform = new THREE.Object3D();
  const sizes = new Map(),
    dim = vec(0, 0, 0);
  return {
    put(geometry, material, position, scale, rotation) {
      if (!batches.has(geometry)) batches.set(geometry, new Map());
      const materials = batches.get(geometry);
      if (!materials.has(material)) materials.set(material, []);
      transform.position.copy(position);
      transform.scale.copy(scale);
      if (rotation?.isQuaternion) transform.quaternion.copy(rotation);
      else transform.rotation.set(...(rotation || [0, 0, 0]));
      transform.updateMatrix();
      let width = 0;
      if (detail) {
        if (!sizes.has(geometry)) {
          geometry.computeBoundingBox();
          sizes.set(geometry, geometry.boundingBox.getSize(vec(0, 0, 0)));
        }
        dim.copy(sizes.get(geometry)).multiply(scale);
        // For panels the shorter face dimension is the visible feature.
        // For rods and wires this gives the diameter rather than the length.
        width = dim.x + dim.y + dim.z - Math.min(dim.x, dim.y, dim.z) - Math.max(dim.x, dim.y, dim.z);
      }
      materials.get(material).push({ matrix: transform.matrix.clone(), width });
    },
    finish() {
      for (const [geometry, materials] of batches) {
        for (const [material, instances] of materials) {
          if (detail) instances.sort((a, b) => b.width - a.width);
          const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
          instances.forEach((instance, index) => mesh.setMatrixAt(index, instance.matrix));
          mesh.computeBoundingSphere();
          parent.add(mesh);
          if (detail)
            detail.batch(
              mesh,
              Float32Array.from(instances, (i) => i.width),
            );
        }
      }
    },
  };
}

// Geometry remains attached to the same rotating frame or moving carrier. Only
// the subpixel tail of each instance buffer is excluded from its draw call.
function projectedDetails(group, axialHeight = 0) {
  const batches = [],
    parts = [];
  const eye = vec(0, 0, 0),
    base = vec(0, 0, 0),
    axis = vec(0, 0, 0),
    near = vec(0, 0, 0),
    scale = vec(0, 0, 0);
  let lastBand = NaN;
  return {
    batch(mesh, widths) {
      batches.push({ mesh, widths });
    },
    part(mesh, width) {
      parts.push({ mesh, width });
    },
    update(camera, viewportHeight) {
      if (!camera || !viewportHeight) return;
      group.updateWorldMatrix(true, false);
      camera.getWorldPosition(eye);
      base.setFromMatrixPosition(group.matrixWorld);
      axis.set(0, 1, 0).transformDirection(group.matrixWorld);
      group.getWorldScale(scale);
      const axialDistance = THREE.MathUtils.clamp(near.copy(eye).sub(base).dot(axis), 0, axialHeight * scale.y);
      near.copy(base).addScaledVector(axis, axialDistance);
      const px =
        (viewportHeight * camera.zoom * scale.x) /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * Math.max(0.0001, eye.distanceTo(near)));
      const band = Math.floor(4 * Math.log2(Math.max(0.0001, px)));
      if (band === lastBand) return;
      lastBand = band;
      const cutoff = 0.72 / 2 ** (band / 4);
      for (const { mesh, widths } of batches) {
        let lo = 0,
          hi = widths.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (widths[mid] >= cutoff) lo = mid + 1;
          else hi = mid;
        }
        mesh.count = lo;
        mesh.visible = lo > 0;
      }
      for (const { mesh, width } of parts) mesh.visible = width >= cutoff;
    },
  };
}

// Sweep an eight-sided pressure hull around the axis; clear seams divide the modules.
function hullSection(radius, width, depth, span) {
  const w = width * 0.5,
    h = depth * 0.5;
  const bevel = Math.min(w, h) * 0.34;
  const profile = [
    [-w + bevel, h],
    [w - bevel, h],
    [w, h - bevel],
    [w, -h + bevel],
    [w - bevel, -h],
    [-w + bevel, -h],
    [-w, -h + bevel],
    [-w, h - bevel],
  ];
  const pos = [],
    idx = [];
  const divisions = Math.max(3, Math.ceil(span * 18));
  for (let i = 0; i <= divisions; i++) {
    const angle = span * (i / divisions - 0.5);
    for (const [r, z] of profile) {
      pos.push((radius + r) * Math.cos(angle), (radius + r) * Math.sin(angle), z);
    }
  }
  for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < 8; j++) {
      const a = i * 8 + j,
        b = i * 8 + ((j + 1) % 8);
      idx.push(a, b, a + 8, b, b + 8, a + 8);
    }
  }
  for (let j = 1; j < 7; j++) {
    const end = divisions * 8;
    idx.push(0, j + 1, j, end, end + j, end + j + 1);
  }
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shape.setIndex(idx);
  const flat = shape.toNonIndexed();
  const textureCoords = [];
  for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < 8; j++) {
      const u = i / divisions,
        next = (i + 1) / divisions;
      textureCoords.push(u, 0, u, 1, next, 0, u, 1, next, 1, next, 0);
    }
  }
  for (let i = 1; i < 7; i++) textureCoords.push(0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0);
  flat.setAttribute('uv', new THREE.Float32BufferAttribute(textureCoords, 2));
  flat.computeVertexNormals();
  shape.dispose();
  return flat;
}

// Ribbed thermal cladding, access hatches and stamped screw heads are visible at close range.
function paintwork() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e4e5e5';
  ctx.fillRect(0, 0, 256, 128);
  for (const [x, y, w, h] of [
    [3, 4, 126, 74],
    [132, 4, 120, 74],
    [3, 81, 57, 44],
    [63, 81, 104, 44],
    [170, 81, 82, 44],
  ]) {
    ctx.fillStyle = x % 2 ? '#eeece8' : '#d6d8d8';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#929ba0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#848b8d';
    for (const bx of [x + 3, x + w - 4]) for (const by of [y + 3, y + h - 4]) ctx.fillRect(bx, by, 1.5, 1.5);
  }
  ctx.fillStyle = '#a9adb0';
  for (let i = 0; i < 11; i++) ctx.fillRect(151, 24 + i * 2.4, 30, 1);
  ctx.fillStyle = '#babfc0';
  ctx.fillRect(18, 25, 24, 27);
  ctx.strokeStyle = '#979b9b';
  ctx.strokeRect(20, 27, 20, 23);
  ctx.fillStyle = '#919b9c';
  ctx.fillRect(197, 97, 19, 1.5);
  ctx.fillRect(197, 100, 12, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function solarSurface() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#838894';
  ctx.fillRect(0, 0, 256, 512);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      const c = Math.floor(8 + 11 * (0.5 + 0.5 * Math.sin(x * 5.74 + y * 8.24)));
      const left = x * 32 + 1,
        top = y * 32 + 1;
      ctx.fillStyle = 'rgb(' + (10 + c) + ',' + (25 + c) + ',' + (64 + 2 * c) + ')';
      ctx.beginPath();
      ctx.moveTo(left + 3, top);
      ctx.lineTo(left + 27, top);
      ctx.lineTo(left + 30, top + 3);
      ctx.lineTo(left + 30, top + 27);
      ctx.lineTo(left + 27, top + 30);
      ctx.lineTo(left + 3, top + 30);
      ctx.lineTo(left, top + 27);
      ctx.lineTo(left, top + 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(167,180,192,0.25)';
      for (let k = 2; k < 30; k += 3) ctx.fillRect(left + 1, top + k, 28, 0.6);
      ctx.fillStyle = '#8b8373';
      ctx.fillRect(left + 14.7, top, 0.9, 29);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.46,
    metalness: 0.22,
    emissive: 0x35446c,
    emissiveMap: tex,
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
  });
}

function stationInsignia() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c9ccc5';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#d17e2f';
  ctx.fillRect(0, 0, 19, 128);
  ctx.fillStyle = '#263541';
  ctx.font = 'bold 65px Arial';
  ctx.fillText('AURORA', 42, 74);
  ctx.font = '21px monospace';
  ctx.fillText('UEG   /   ORBITAL HABITAT  07', 45, 108);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72 });
}

function earthHorizon() {
  const map = new THREE.TextureLoader().load(new URL('../assets/earth/blue-marble.jpg', import.meta.url).href);
  const clouds = new THREE.TextureLoader().load(new URL('../assets/earth/cloud-cover.jpg', import.meta.url).href);
  const material = new THREE.ShaderMaterial({
    uniforms: { land: { value: map }, clouds: { value: clouds } },
    vertexShader: `
      varying vec2 tex;
      varying vec3 normalW, posW;
      void main(){
        tex=uv;
        posW=(modelMatrix*vec4(position,1.)).xyz;
        normalW=normalize(mat3(modelMatrix)*normal);
        gl_Position=projectionMatrix*viewMatrix*vec4(posW,1.);
      }`,
    fragmentShader: `
      uniform sampler2D land, clouds;
      varying vec2 tex;
      varying vec3 normalW, posW;
      void main(){
        vec3 n=normalize(normalW);
        vec3 view=normalize(cameraPosition-posW);
        float sun=max(0.,dot(n,normalize(vec3(-0.64,0.78,0.21))));
        float rim=pow(1.-clamp(dot(n,view),0.,1.),3.);
        vec3 earth=texture2D(land,tex).rgb;
        float cloud=smoothstep(0.16,0.86,texture2D(clouds,tex).r);
        vec3 terrain=mix(pow(earth,vec3(2.1))*vec3(.78,.90,1.), vec3(.56,.64,.72),cloud*.74);
        vec3 color=terrain*(.038+.40*sun)+vec3(.035,.18,.39)*rim*(.12+.9*sun);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(19, 112, 72), material);
  planet.position.set(6, -23, -26);
  planet.rotation.set(0.45, 2.65, -0.3);
  return planet;
}

function navigationBeacon(parent, position, tint, extent, phase) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d'),
    radial = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  radial.addColorStop(0, 'rgba(255,255,255,1)');
  radial.addColorStop(0.13, 'rgba(255,255,255,.96)');
  radial.addColorStop(0.33, 'rgba(255,255,255,.37)');
  radial.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, 64, 64);
  const material = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    color: tint,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const lamp = new THREE.Sprite(material);
  lamp.position.copy(position);
  parent.add(lamp);
  return (elapsed) => {
    const pulse = Math.max(0, Math.cos(elapsed * 1.72 + phase)) ** 14;
    material.opacity = 0.2 + 0.8 * pulse;
    lamp.scale.setScalar(extent * (0.56 + 0.44 * pulse));
  };
}

// Shared orbital hardware uses the same materials and photographic horizon in both views.
export { assembly, projectedDetails, paintwork, solarSurface, earthHorizon, navigationBeacon };

// The origin is the mating face, +Z is the unobstructed approach direction.
export function dockingPort(parent, position, reversed, radius, detail) {
  const port = new THREE.Group();
  port.position.copy(position);
  port.rotation.y = reversed ? Math.PI : 0;
  parent.add(port);
  const housing = new THREE.Group();
  housing.scale.setScalar(radius);
  port.add(housing);
  const hull = metal(0xb9c6cc),
    shadow = metal(0x293442),
    brass = metal(0xb68a49),
    graphite = metal(0x596977);
  const signal = glow(0x83d9ff, 1.65),
    marker = glow(0xffa961, 1.6);
  const batch = assembly(housing);
  const box = new THREE.BoxGeometry(),
    cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const disk = (mat, z, r, h) => batch.put(cylinder, mat, vec(0, 0, z), vec(r, h, r), [Math.PI / 2, 0, 0]);
  disk(shadow, -0.46, 1.15, 0.85);
  disk(hull, -0.63, 1.21, 0.16);
  disk(graphite, -0.31, 1.19, 0.11);
  disk(hull, -0.113, 1.08, 0.18);
  disk(shadow, -0.022, 0.76, 0.041);
  disk(graphite, -0.014, 0.54, 0.029);
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    batch.put(box, i % 3 === 0 ? brass : hull, circle(a, 0.98, -0.032), vec(0.23, 0.31, 0.1), [0, 0, a]);
    batch.put(cylinder, shadow, circle(a, 0.96, 0.022), vec(0.041, 0.032, 0.041), [Math.PI / 2, 0, 0]);
    batch.put(box, i % 3 === 0 ? marker : signal, circle(a, 1.14, -0.3), vec(0.04, 0.127, 0.15), [0, 0, a]);
    if (i % 2 === 0) batch.put(box, brass, circle(a, 0.69, -0.002), vec(0.067, 0.18, 0.044), [0, 0, a]);
  }
  batch.finish();
  const jaws = [];
  for (let i = 0; i < 3; i++) {
    const a = (i * TAU) / 3 + 0.38,
      base = new THREE.Group(),
      finger = new THREE.Group();
    base.position.copy(circle(a, 1.17, -0.59));
    base.rotation.z = a;
    housing.add(base);
    base.add(finger);
    const parts = assembly(finger);
    parts.put(box, graphite, vec(0, 0, 0.43), vec(0.17, 0.19, 0.9));
    parts.put(box, brass, vec(-0.06, 0, 0.82), vec(0.28, 0.21, 0.16));
    parts.put(cylinder, hull, vec(0.11, 0, 0.41), vec(0.052, 0.67, 0.052), [Math.PI / 2, 0, 0]);
    parts.put(box, signal, vec(0.08, 0, 0.77), vec(0.08, 0.22, 0.076));
    parts.finish();
    jaws.push(finger);
  }
  detail?.part(housing, 2.4 * radius);
  port.userData.setEngagement = (value) => {
    for (const jaw of jaws) jaw.rotation.y = 0.43 - value * 0.79;
  };
  port.userData.setEngagement(0);
  return port;
}

export function createStation({ shared = false } = {}) {
  const group = new THREE.Group();
  group.name = 'Aurora orbital habitat';
  const frame = new THREE.Group(),
    rotor = new THREE.Group();
  if (shared) frame.rotation.set(-0.66, -0.3, 0.63, 'ZXY');
  else frame.rotation.set(0.88, -0.38, 0.74, 'ZXY');
  group.add(frame);
  frame.add(rotor);
  const fleet = new THREE.Group();
  group.add(fleet);
  const detail = shared ? projectedDetails(group) : null;
  const hull = assembly(rotor, detail),
    bus = assembly(frame, detail),
    ship = assembly(fleet, detail);
  const box = new THREE.BoxGeometry(),
    plate = new THREE.PlaneGeometry();
  const rod = new THREE.CylinderGeometry(1, 1, 1, 6);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 32);
  const capsule = new THREE.SphereGeometry(1, 20, 14);
  const cone = new THREE.ConeGeometry(1, 1, 16);
  const white = metal(0xc5cbc8),
    faded = metal(0x838e98);
  const light = metal(0xd5d0b5),
    gold = metal(0xa48246, 0.58, 0.34);
  const iron = metal(0x464f59),
    dark = metal(0x232e38);
  const coating = paintwork();
  for (const material of [white, faded, light, gold, iron]) material.map = coating;
  const goldLight = glow(0xffc678, 1.95),
    warm = glow(0xffedc7, 1.55);
  const cyan = glow(0x6edfff, 2.25),
    red = glow(0xfa493c, 1.38);
  const array = solarSurface();
  const scale = vec(1, 1, 1),
    origin = vec(0, 0, 0);
  function brace(batch, a, b, radius, material = iron) {
    const dir = b.clone().sub(a),
      length = dir.length();
    batch.put(
      rod,
      material,
      a.clone().lerp(b, 0.5),
      vec(radius, length, radius),
      new THREE.Quaternion().setFromUnitVectors(up, dir.normalize()),
    );
  }
  function block(batch, material, p, size, angle = 0) {
    batch.put(box, material, p, size, [0, 0, angle]);
  }
  function disk(batch, material, z, radius, length, x = 0, y = 0) {
    batch.put(cylinder, material, vec(x, y, z), vec(radius, length, radius), [Math.PI / 2, 0, 0]);
  }
  function torus(parent, radius, tube, z, material, segments = 144) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, segments), material);
    mesh.position.z = z;
    parent.add(mesh);
    detail?.part(mesh, tube * 2);
  }

  const radius = 3.18,
    count = 40,
    span = TAU / count;
  const core = hullSection(radius, 0.48, 0.42, span * 0.966);
  const cap = hullSection(radius, 0.42, 0.066, span * 0.84);
  const outerBelt = hullSection(radius + 0.239, 0.028, 0.13, span * 0.985);
  const edge = hullSection(radius - 0.246, 0.035, 0.074, span * 0.85);
  for (let i = 0; i < count; i++) {
    const a = i * span,
      rot = [0, 0, a];
    hull.put(core, i % 7 === 1 ? light : i % 4 === 0 ? faded : white, origin, scale, rot);
    hull.put(cap, i % 8 === 0 ? gold : faded, vec(0, 0, 0.219), scale, rot);
    hull.put(outerBelt, dark, vec(0, 0, 0.014), scale, rot);
    hull.put(edge, gold, origin, scale, rot);
    const joint = a + span * 0.5;
    for (const z of [-0.16, 0.18]) {
      brace(hull, circle(joint, radius - 0.23, z), circle(joint, radius + 0.24, z), 0.02, gold);
    }
    // Recessed glazing on the curved outer wall; a second strip faces forward.
    for (let j = 0; j < 8; j++) {
      const b = a + ((j - 3.5) * span) / 9.6;
      const window = (i * 11 + j * 7) % 17 < 3 ? iron : j % 3 === 0 ? goldLight : warm;
      block(hull, window, circle(b, radius + 0.256, 0.018), vec(0.018, 0.033, 0.052), b);
      block(hull, j % 5 === 1 ? dark : window, circle(b, radius + 0.18, 0.218), vec(0.033, 0.03, 0.009), b);
    }
    for (let k = 0; k < 3; k++) {
      const b = a + (k - 1) * span * 0.205;
      block(hull, iron, circle(b, radius - 0.053, 0.259), vec(0.163, 0.018, 0.016), b);
    }
    if (i % 5 === 0) {
      block(hull, dark, circle(a, radius + 0.025, 0.287), vec(0.12, 0.17, 0.07), a);
      block(hull, cyan, circle(a, radius + 0.025, 0.328), vec(0.072, 0.102, 0.012), a);
    }
  }
  torus(rotor, radius, 0.112, 0, dark);
  // Separate maintenance rail, tethered to the main rim with an external lattice.
  for (const z of [-0.26, -0.41]) torus(rotor, radius - 0.11, 0.028, z, iron);
  for (let i = 0; i < count * 2; i++) {
    const a = i * span * 0.5,
      next = a + span * 0.5;
    brace(hull, circle(a, radius - 0.11, -0.26), circle(next, radius - 0.11, -0.41), 0.013, faded);
    brace(hull, circle(a, radius - 0.11, -0.41), circle(next, radius - 0.11, -0.26), 0.011, iron);
  }

  // Five pressure corridors share the load with open tetrahedral bridgework.
  for (let i = 0; i < 5; i++) {
    const a = (i * TAU) / 5 + 0.14;
    const along = (r, lateral, z) =>
      vec(Math.cos(a) * r - Math.sin(a) * lateral, Math.sin(a) * r + Math.cos(a) * lateral, z);
    brace(hull, along(0.3, 0, 0), along(radius - 0.2, 0, 0), 0.071, faded);
    for (const side of [-1, 1]) {
      brace(hull, along(0.37, side * 0.17, 0.1), along(radius - 0.18, side * 0.15, 0.1), 0.023, light);
      brace(hull, along(0.37, side * 0.12, -0.12), along(radius - 0.18, side * 0.12, -0.12), 0.026, iron);
      for (let j = 0; j < 11; j++) {
        const r = 0.39 + j * 0.23,
          end = r + 0.23;
        brace(hull, along(r, side * 0.15, 0.1), along(end, side * 0.12, -0.12), 0.014, gold);
        brace(hull, along(r, side * 0.12, -0.12), along(end, side * 0.15, 0.1), 0.011, iron);
      }
    }
    for (let j = 0; j < 6; j++) {
      const p = along(0.47 + j * 0.43, 0, 0.087);
      block(hull, white, p, vec(0.22, 0.18, 0.04), a);
    }
    block(hull, white, along(radius - 0.36, 0, 0.03), vec(0.42, 0.4, 0.25), a);
    block(hull, gold, along(radius - 0.42, 0, 0.17), vec(0.18, 0.29, 0.035), a);
  }

  // Axial docks do not rotate with the habitat ring.
  const hubSegments = [
    [-1.87, 0.26, 0.38, iron],
    [-1.53, 0.34, 0.36, white],
    [-1.2, 0.38, 0.29, gold],
    [-0.82, 0.34, 0.5, faded],
    [-0.42, 0.41, 0.33, white],
    [0, 0.49, 0.51, iron],
    [0.43, 0.43, 0.31, light],
    [0.8, 0.36, 0.4, white],
    [1.15, 0.33, 0.32, gold],
    [1.43, 0.3, 0.23, white],
    [1.63, 0.235, 0.18, dark],
  ];
  for (const [z, r, l, material] of hubSegments) {
    disk(bus, material, z, r, l);
    disk(bus, dark, z - l / 2, r * 1.035, 0.04);
    disk(bus, faded, z + l * 0.43, r * 1.04, 0.039);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i * TAU) / 12;
    block(bus, i % 3 === 0 ? cyan : warm, circle(a, 0.3, 1.45), vec(0.018, 0.046, 0.1), a);
    brace(bus, circle(a, 0.35, 0.56), circle(a, 0.35, 1.01), 0.021, faded);
    brace(bus, circle(a, 0.358, -1.65), circle(a, 0.358, -1.3), 0.028, gold);
    if (i % 2 === 0) {
      const mount = circle(a, 0.38, 0.79);
      block(bus, faded, mount, vec(0.14, 0.13, 0.35), a);
      block(bus, dark, circle(a, 0.455, 0.8), vec(0.034, 0.1, 0.24), a);
      for (let j = 0; j < 4; j++) {
        block(bus, light, circle(a, 0.48, 0.7 + j * 0.056), vec(0.024, 0.094, 0.013), a);
      }
      brace(bus, circle(a + 0.11, 0.44, 0.31), circle(a + 0.11, 0.435, 1.31), 0.012, light);
      brace(bus, circle(a + 0.16, 0.44, 0.31), circle(a + 0.16, 0.435, 1.31), 0.012, gold);
    }
  }
  disk(bus, iron, 1.766, 0.237, 0.067);
  disk(bus, dark, 1.807, 0.138, 0.034);
  torus(frame, 0.176, 0.022, 1.83, gold, 48);
  for (let i = 0; i < 6; i++) {
    const a = (i * TAU) / 6;
    block(bus, i % 2 ? cyan : warm, circle(a, 0.19, 1.85), vec(0.026, 0.046, 0.017), a);
  }

  // Long photovoltaic wings extend from the fixed utility bus, across the silhouette.
  const ribZ = -1.19;
  for (const side of [-1, 1]) {
    for (const y of [-0.105, 0.105])
      for (const z of [ribZ - 0.07, ribZ + 0.07]) {
        brace(bus, vec(0.24 * side, y, z), vec(4.98 * side, y, z), 0.027, faded);
      }
    for (let k = 0; k < 23; k++) {
      const x = 0.25 + k * 0.205;
      brace(bus, vec(x * side, -0.105, ribZ + 0.07), vec((x + 0.205) * side, 0.105, ribZ + 0.07), 0.016, gold);
      brace(bus, vec(x * side, 0.105, ribZ - 0.07), vec((x + 0.205) * side, -0.105, ribZ - 0.07), 0.015, iron);
    }
    for (let k = 0; k < 3; k++) {
      const x = side * (2.86 + 0.85 * k);
      for (const sign of [-1, 1]) {
        const y = sign * (0.76 + (k === 0 ? 0.11 : 0)),
          z = ribZ + 0.02;
        const h = k === 0 ? 1.24 : 1.12,
          w = 0.76;
        bus.put(plate, array, vec(x, y, z), vec(w, h, 1), [0, 0, 0]);
        for (const sx of [-1, 1]) block(bus, gold, vec(x + (sx * w) / 2, y, z), vec(0.023, h + 0.03, 0.038));
        for (const sy of [-1, 1]) block(bus, faded, vec(x, y + (sy * h) / 2, z), vec(w, 0.025, 0.035));
        block(bus, faded, vec(x, y, z - 0.018), vec(0.026, h, 0.05));
        block(bus, dark, vec(x, y * 0.61, z - 0.042), vec(0.06, Math.abs(y) * 0.75, 0.07));
      }
    }
    block(bus, side > 0 ? red : cyan, vec(side * 4.99, 0, ribZ), vec(0.047, 0.11, 0.115));
  }

  for (const side of [-1, 1]) {
    const y = side * 0.47;
    brace(bus, vec(0, y * 0.6, -0.85), vec(0, y * 2.5, -1.16), 0.043, gold);
    bus.put(capsule, white, vec(0, y * 2.48, -1.14), vec(0.34, 0.23, 0.32));
    brace(bus, vec(0, y * 2.52, -1.13), vec(0.15, y * 2.96, -1.4), 0.029, iron);
    bus.put(capsule, gold, vec(0.15, y * 2.96, -1.4), vec(0.22, 0.22, 0.085), [0.65, 0.2, 0]);
  }
  const namePlate = new THREE.Mesh(plate, stationInsignia());
  namePlate.position.set(0, 0.035, 1.837);
  namePlate.scale.set(0.28, 0.07, 1);
  frame.add(namePlate);
  detail?.part(namePlate, 0.07);
  const ports = {
    primary: dockingPort(frame, vec(0, 0, 2.085), false, 0.22, detail),
    service: dockingPort(frame, vec(0, 0, -2.16), true, 0.205, detail),
  };
  // A cargo manipulator stays on the non-rotating hub, outside the axial
  // approach cone. Parallel booms and the visible piston form the lifting linkage.
  const shoulder = vec(0.46, -0.27, 0.61),
    elbow = vec(1.22, -0.43, 0.13),
    wrist = vec(1.36, -0.38, 1.13);
  for (const [joint, radius] of [
    [shoulder, 0.19],
    [elbow, 0.136],
    [wrist, 0.101],
  ]) {
    bus.put(cylinder, dark, joint, vec(radius, 0.21, radius));
    bus.put(cylinder, gold, joint.clone().add(vec(0, 0.117, 0)), vec(radius * 0.79, 0.045, radius * 0.79));
    block(bus, cyan, joint.clone().add(vec(0.025, 0.148, 0)), vec(0.071, 0.018, 0.027));
  }
  for (const side of [-1, 1]) {
    const offset = vec(0, side * 0.078, 0);
    brace(bus, shoulder.clone().add(offset), elbow.clone().add(offset), 0.05, light);
    brace(bus, elbow.clone().add(offset), wrist.clone().add(offset), 0.043, gold);
    brace(bus, wrist, vec(1.36 + side * 0.13, -0.38, 1.28), 0.027, iron);
    brace(bus, vec(1.36 + side * 0.13, -0.38, 1.28), vec(1.36 + side * 0.077, -0.38, 1.37), 0.025, light);
  }
  brace(bus, vec(0.46, -0.3, 0.25), vec(0.83, -0.36, 0.22), 0.065, dark);
  brace(bus, vec(0.78, -0.36, 0.23), elbow, 0.033, white);
  for (let j = 0; j < 6; j++) {
    const h = shoulder.clone().lerp(elbow, 0.16 + j * 0.125);
    bus.put(cylinder, iron, h, vec(0.073, 0.2, 0.073));
  }
  for (let j = 0; j < 3; j++) {
    const x = -0.55 - j * 0.22;
    block(bus, j === 1 ? gold : faded, vec(x, 0.21, 0.55), vec(0.2, 0.29, 0.53));
    for (const z of [0.33, 0.74]) block(bus, dark, vec(x, 0.21, z), vec(0.214, 0.308, 0.042));
    block(bus, warm, vec(x, 0.367, 0.61), vec(0.085, 0.013, 0.035));
    brace(bus, vec(x, 0.09, 0.55), vec(-0.38, -0.12, 0.57), 0.032, iron);
  }

  // An approaching tug gives scale to the habitat without crossing its docking port.
  for (let j = 0; j < 2; j++) {
    block(ship, white, vec(0, 0.014, -0.1 + j * 0.22), vec(0.22, 0.15, 0.2));
    block(ship, j ? gold : faded, vec(0, -0.01, -0.125 + j * 0.22), vec(0.234, 0.12, 0.051));
  }
  ship.put(capsule, dark, vec(0, 0.032, 0.18), vec(0.106, 0.077, 0.089));
  block(ship, cyan, vec(0, 0.065, 0.248), vec(0.08, 0.03, 0.014));
  for (const side of [-1, 1]) {
    brace(ship, vec(0.06 * side, 0, -0.08), vec(0.23 * side, 0, -0.15), 0.024, iron);
    block(ship, faded, vec(0.22 * side, 0, -0.135), vec(0.095, 0.075, 0.235));
    block(ship, gold, vec(0.22 * side, 0, -0.225), vec(0.111, 0.089, 0.056));
    block(ship, cyan, vec(0.22 * side, 0, -0.258), vec(0.068, 0.045, 0.017));
    ship.put(cone, dark, vec(0.183 * side, 0.022, -0.06), vec(0.07, 0.17, 0.055), [Math.PI / 2, 0, 0]);
  }
  if (!shared) ship.finish();
  bus.finish();
  hull.finish();
  fleet.rotation.set(-0.24, 0.5, -0.55);
  const beacons = [
    navigationBeacon(frame, vec(5.0, 0, ribZ + 0.06), 0xff523a, 0.47, 0),
    navigationBeacon(frame, vec(-5.0, 0, ribZ + 0.06), 0x88ffd8, 0.47, 2.9),
    navigationBeacon(rotor, circle(0.7, radius + 0.27, 0.24), 0xffb167, 0.29, 0.65),
    navigationBeacon(rotor, circle(Math.PI + 0.7, radius + 0.27, 0.24), 0xaeeaff, 0.29, 2.3),
  ];
  if (!shared) {
    group.add(earthHorizon(), new THREE.HemisphereLight(0xc2d8f2, 0x293d56, 0.77));
    const sunlight = new THREE.DirectionalLight(0xffe9cc, 3.5);
    sunlight.position.set(-7, 8, 6);
    const earthshine = new THREE.DirectionalLight(0x739ed8, 0.85);
    earthshine.position.set(2, -6, 1);
    const rim = new THREE.DirectionalLight(0xe3edff, 1.3);
    rim.position.set(3, 1, -6);
    group.add(sunlight, earthshine, rim);
  }
  function update(elapsed) {
    for (const blink of beacons) blink(elapsed);
    rotor.rotation.z = 0.11 + elapsed * 0.026;
    fleet.position.set(
      2.35 + 0.24 * Math.sin(elapsed * 0.06),
      -0.89 + 0.1 * Math.sin(elapsed * 0.125),
      2.8 + 0.25 * Math.cos(elapsed * 0.08),
    );
  }
  update(0);
  return {
    group,
    ports,
    pickables: [{ id: 'station', object: frame }],
    sharedScale: 0.065,
    updateLOD: detail?.update,
    camera: shared ? [3.25, 5.4, 4.25] : [0.35, 0.55, 12.35],
    target: shared ? [0.25, -0.12, 0.04] : [0, 0, 0],
    fov: 42,
    minDistance: 3.5,
    maxDistance: 19,
    update,
  };
}
