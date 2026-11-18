import * as THREE from 'three';
import {
  assembly,
  projectedDetails,
  earthHorizon,
  paintwork,
  solarSurface,
  navigationBeacon,
  dockingPort,
} from './station.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const up = V(0, 1, 0);
const pointOnRing = (angle, radius, height) => V(Math.sin(angle) * radius, height, Math.cos(angle) * radius);

function steel(color, roughness = 0.58, metalness = 0.45) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function label(text, subtext) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 192;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#d9d8ca';
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = '#d07935';
  ctx.fillRect(0, 0, 15, 192);
  ctx.fillStyle = '#24303b';
  ctx.font = 'bold 73px Arial';
  ctx.fillText(text, 33, 102);
  ctx.font = 'bold 22px monospace';
  ctx.fillText(subtext, 36, 153);
  ctx.fillRect(33, 120, 441, 3);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0.06 });
  return material;
}

// Each of the three load-bearing cables has four counterwound steel wires.
// The shader retains the highlight of the helical wire beyond normal mesh LOD.
function suspensionCables(bottom = -75, top = 75) {
  const positions = [],
    normals = [],
    details = [],
    index = [];
  const columns = 3,
    strands = 4,
    facets = 6,
    steps = Math.ceil((top - bottom) * 5.2);
  for (let c = 0; c < columns; c++) {
    const base = pointOnRing((c * TAU) / 3 + 0.16, 0.52, 0);
    for (let strand = 0; strand < strands; strand++) {
      const first = positions.length / 3;
      for (let j = 0; j <= steps; j++) {
        const y = bottom + ((top - bottom) * j) / steps;
        const twist = (c % 2 ? -0.88 : 1) * y * 2.35 + (strand * TAU) / strands;
        const x = base.x + 0.046 * Math.cos(twist),
          z = base.z + 0.046 * Math.sin(twist);
        for (let k = 0; k < facets; k++) {
          const a = (k * TAU) / facets + twist,
            nx = Math.cos(a),
            nz = Math.sin(a);
          positions.push(x + 0.036 * nx, y, z + 0.036 * nz);
          normals.push(nx, -0.07 * Math.sin(twist - a), nz);
          details.push(y, c + strand * 0.21);
          if (j < steps) {
            const v = first + j * facets + k,
              n = first + j * facets + ((k + 1) % facets);
            index.push(v, v + facets, n, n, v + facets, n + facets);
          }
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('wire', new THREE.Float32BufferAttribute(details, 2));
  geo.setIndex(index);
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    side: THREE.DoubleSide,
    vertexShader: [
      'attribute vec2 wire; varying vec2 knot; varying vec3 n,pos;',
      'void main(){knot=wire; n=normalize(mat3(modelMatrix)*normal);',
      'pos=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(pos,1.);}',
    ].join('\n'),
    fragmentShader: [
      'uniform float time;varying vec2 knot;varying vec3 n,pos;',
      'void main(){vec3 normal=normalize(n),eye=normalize(cameraPosition-pos),sun=normalize(vec3(-.45,.65,.60));',
      'vec3 col=vec3(.051,.082,.108)+vec3(.50,.51,.51)*max(0.,dot(normal,sun));',
      'float glint=pow(max(0.,dot(normal,normalize(eye+sun))),12.);',
      'float sweep=pow(.5+.5*cos(knot.x*.80-time*1.38+knot.y*2.40),10.);',
      'col+=vec3(.76,.93,1.24)*glint*(.6+sweep*3.0)+vec3(.50,.64,.89)*sweep*.36;',
      'gl_FragColor=vec4(col,1.);',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  return new THREE.Mesh(geo, material);
}

function atmosphere(planet) {
  const radius = 19 * planet.scale.x;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { center: { value: planet.position }, radius: { value: radius } },
    vertexShader:
      'varying vec3 p;void main(){p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
    fragmentShader: [
      'varying vec3 p;uniform vec3 center;uniform float radius;',
      'void main(){vec3 ray=normalize(p-cameraPosition);vec3 offset=center-cameraPosition;',
      'vec3 edge=ray*dot(ray,offset)-offset;float altitude=(length(edge)-radius)/radius;',
      'float light=.35+.65*max(0.,dot(normalize(edge),normalize(vec3(-.64,.78,.21))));',
      'float f=(.68*exp(-max(altitude,0.)*258.)+.20*exp(-max(altitude,0.)*76.))*light;',
      'gl_FragColor=vec4(vec3(.18,.52,1.13),f*(1.-smoothstep(.036,.051,altitude)));',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const rim = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.052, 112, 64), mat);
  rim.position.copy(planet.position);
  return rim;
}

export function createElevator({ shared = false } = {}) {
  const group = new THREE.Group(),
    installation = new THREE.Group(),
    climber = new THREE.Group();
  installation.name = 'Equatorial tether · transfer terminal and ascent vehicle';
  const deckY = 2.65;
  const terminalHeight = 32;
  const counterweightHeight = 35;
  if (shared) installation.position.y = terminalHeight - deckY;
  else installation.rotation.set(-0.08, -0.22, -0.36, 'ZXY');
  const bottom = shared ? -installation.position.y : -75;
  const top = shared ? counterweightHeight - installation.position.y : 75;
  const detail = shared ? projectedDetails(group, counterweightHeight) : null;
  group.add(installation);
  installation.add(climber);
  const cables = suspensionCables(bottom, top);
  installation.add(cables);
  detail?.part(cables, 0.18);
  const coating = paintwork(),
    array = solarSurface();
  const white = steel(0xc1cbd0, 0.63, 0.32),
    steelBlue = steel(0x72859a),
    ivory = steel(0xd5c9a4),
    graphite = steel(0x344554, 0.55, 0.44),
    black = steel(0x18222f, 0.7, 0.24),
    bronze = steel(0xb38245, 0.49, 0.4);
  for (const material of [white, steelBlue, ivory, bronze]) material.map = coating;
  const blueLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.34, 1.02, 1.65) });
  const warmLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.45, 0.77, 0.28) });
  const navBlue = steel(0x1a4359, 0.26, 0.51);
  navBlue.emissive.setHex(0x092736);
  const box = new THREE.BoxGeometry();
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 32);
  const rod = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const plate = new THREE.PlaneGeometry();
  const capsule = new THREE.SphereGeometry(1, 20, 12);
  const terminal = assembly(installation, detail),
    vehicle = assembly(climber, detail);
  const boxAt = (batch, m, x, y, z, w, h, d, angle = 0) => batch.put(box, m, V(x, y, z), V(w, h, d), [0, angle, 0]);
  const cylinderAt = (batch, m, x, y, z, r, h, rot = [0, 0, 0]) => batch.put(cylinder, m, V(x, y, z), V(r, h, r), rot);
  function brace(batch, m, a, b, r) {
    const direction = b.clone().sub(a);
    batch.put(
      rod,
      m,
      a.clone().lerp(b, 0.5),
      V(r, direction.length(), r),
      new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()),
    );
  }
  function hoop(parent, r, tube, y, m, seg = 80) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, seg), m);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = y;
    parent.add(mesh);
    detail?.part(mesh, tube * 2);
  }
  function clipDeck(batch, height, radius, material, faceCount = 12) {
    const span = TAU / faceCount;
    for (let i = 0; i < faceCount; i++) {
      const a = i * span,
        pos = pointOnRing(a, radius, height);
      boxAt(batch, material, pos.x, pos.y, pos.z, 2 * radius * Math.tan(span / 2) * 0.94, 0.16, 0.34, a);
    }
  }

  // Cable guides and separator saddles repeat toward the two vanishing points.
  for (let i = -12; i <= 12; i++) {
    const y = i * 5.8 + 0.35;
    if (y < bottom + 0.1 || y > top - 0.1) continue;
    for (let c = 0; c < 3; c++) {
      const a = 0.16 + (c * TAU) / 3,
        p = pointOnRing(a, 0.52, y),
        q = pointOnRing(a + TAU / 3, 0.52, y);
      cylinderAt(terminal, bronze, p.x, y, p.z, 0.107, 0.19);
      brace(terminal, steelBlue, p, q, 0.026);
    }
  }
  // The upper terminal is an open ring: a vehicle can travel between the guide bogies.
  for (const d of [-0.45, 0.04, 0.43]) {
    hoop(installation, 1.39, 0.075, deckY + d, graphite);
    hoop(installation, 1.6, 0.035, deckY + d, ivory);
  }
  clipDeck(terminal, deckY + 0.06, 1.5, white);
  for (let i = 0; i < 18; i++) {
    const a = (i * TAU) / 18,
      next = a + TAU / 18;
    brace(
      terminal,
      i % 3 ? steelBlue : bronze,
      pointOnRing(a, 1.41, deckY - 0.44),
      pointOnRing(next, 1.58, deckY + 0.42),
      0.042,
    );
    brace(terminal, graphite, pointOnRing(a, 1.58, deckY + 0.42), pointOnRing(next, 1.41, deckY - 0.44), 0.033);
    const p = pointOnRing(a, 1.58, deckY + 0.13);
    boxAt(terminal, i % 3 ? blueLight : warmLight, p.x, p.y, p.z, 0.18, 0.046, 0.038, a);
    if (i % 3 === 0) {
      const q = pointOnRing(a, 1.14, deckY);
      boxAt(terminal, white, q.x, q.y, q.z, 0.34, 0.82, 0.44, a);
      brace(terminal, bronze, pointOnRing(a, 0.68, deckY - 0.43), pointOnRing(a, 1.43, deckY + 0.4), 0.075);
    }
  }

  // White pressure cans, docking collars and a two-level solar spar cross the tether.
  for (const sign of [-1, 1]) {
    const z = -0.16,
      extents = sign > 0 ? 4.05 : 3.28;
    for (const level of [-0.16, 0.16]) {
      for (const depth of [-0.15, 0.15]) {
        brace(
          terminal,
          steelBlue,
          V(sign * 1.34, deckY + level, z + depth),
          V(sign * extents, deckY + level, z + depth),
          0.045,
        );
      }
    }
    for (let j = 0; j < 9; j++) {
      const x = 1.37 + (j * (extents - 1.37)) / 9,
        x2 = x + (extents - 1.37) / 9;
      for (const side of [-1, 1])
        brace(
          terminal,
          side > 0 ? bronze : graphite,
          V(sign * x, deckY - 0.16, z + side * 0.15),
          V(sign * x2, deckY + 0.16, z + side * 0.15),
          0.029,
        );
    }
    cylinderAt(terminal, white, sign * 2.07, deckY + 0.27, 0.17, 0.38, 1.58, [0, 0, Math.PI / 2]);
    for (const off of [-0.69, -0.39, 0.34, 0.71])
      cylinderAt(
        terminal,
        Math.abs(off) > 0.5 ? bronze : graphite,
        sign * (2.06 + off),
        deckY + 0.27,
        0.17,
        0.397,
        0.065,
        [0, 0, Math.PI / 2],
      );
    for (let j = 0; j < 4; j++)
      boxAt(terminal, j === 2 ? blueLight : navBlue, sign * (1.58 + j * 0.31), deckY + 0.34, 0.536, 0.2, 0.12, 0.045);
    for (let j = 0; j < 3; j++) {
      const x = sign * (2.68 + j * 0.62);
      for (const side of [-1, 1]) {
        const dz = side * 0.89;
        // Photovoltaic wings unfold in planes angled towards the rising sun.
        const pivot = V(x, deckY + 0.07 + side * 0.43, dz - 0.28),
          rotation = [0.83, 0, 0];
        terminal.put(plate, array, pivot, V(0.55, 1.52, 1), rotation);
        const euler = new THREE.Euler(...rotation),
          rX = V(1, 0, 0).applyEuler(euler),
          rY = V(0, 1, 0).applyEuler(euler);
        for (const k of [-1, 1]) {
          const base = pivot.clone().addScaledVector(rX, k * 0.282);
          brace(
            terminal,
            bronze,
            base.clone().addScaledVector(rY, -0.77),
            base.clone().addScaledVector(rY, 0.77),
            0.016,
          );
          const tip = pivot.clone().addScaledVector(rY, k * 0.77);
          brace(
            terminal,
            steelBlue,
            tip.clone().addScaledVector(rX, -0.283),
            tip.clone().addScaledVector(rX, 0.283),
            0.014,
          );
        }
      }
    }
  }

  // An independently moving passenger and cargo climber surrounds the axial cables.
  for (const y of [-0.86, 0.77]) {
    hoop(climber, 0.78, 0.081, y, bronze, 48);
    hoop(climber, 0.65, 0.09, y + 0.1, graphite, 48);
    for (let i = 0; i < 3; i++) {
      const a = 0.16 + (i * TAU) / 3,
        p = pointOnRing(a, 0.62, y + 0.025);
      vehicle.put(capsule, steelBlue, p, V(0.18, 0.23, 0.18));
    }
  }
  for (let n = 0; n < 6; n++) {
    const a = (n * TAU) / 6,
      p = pointOnRing(a, 0.85, 0);
    boxAt(vehicle, n % 2 ? white : bronze, p.x, -0.04, p.z, 0.66, 1.24, 0.43, a);
    const outward = (r, y) => pointOnRing(a, r, y);
    const brow = outward(1.085, 0.31);
    boxAt(vehicle, graphite, brow.x, brow.y, brow.z, 0.69, 0.38, 0.06, a);
    for (let i = -1; i <= 1; i++) {
      const glass = outward(1.125, 0.34),
        dx = i * 0.184;
      boxAt(vehicle, navBlue, glass.x + Math.cos(a) * dx, glass.y, glass.z - Math.sin(a) * dx, 0.157, 0.17, 0.026, a);
    }
    for (const offset of [-0.3, 0.3]) {
      const x = p.x + Math.cos(a) * offset,
        z = p.z - Math.sin(a) * offset;
      brace(vehicle, ivory, V(x, -0.68, z), V(x, 0.63, z), 0.043);
    }
    if (n % 2 === 0) {
      for (let j = 0; j < 4; j++) {
        const q = outward(1.088, -0.46 + j * 0.103);
        boxAt(vehicle, graphite, q.x, q.y, q.z, 0.42, 0.049, 0.038, a);
      }
      const q = outward(0.97, 0.67);
      boxAt(vehicle, warmLight, q.x, q.y, q.z, 0.33, 0.045, 0.045, a);
    }
  }
  const identity = new THREE.Mesh(plate, label('ASC–04', 'UEG EQUATORIAL LIFT'));
  identity.position.set(0, -0.19, 1.11);
  identity.scale.set(0.57, 0.22, 1);
  climber.add(identity);
  detail?.part(identity, 0.22);
  const plateOnDock = new THREE.Mesh(plate, label('PORT 01', 'ORBITAL TRANSFER'));
  plateOnDock.position.set(0, deckY + 0.17, 1.76);
  plateOnDock.scale.set(0.73, 0.272, 1);
  installation.add(plateOnDock);
  detail?.part(plateOnDock, 0.272);

  // An independent return car gives a second scale cue and moves on its own guide.
  const returnCar = new THREE.Group();
  returnCar.position.x = -2.0;
  installation.add(returnCar);
  const returnBottom = shared ? bottom + 0.1 : -45;
  const returnTop = shared ? top - 0.7 : 52;
  brace(terminal, steelBlue, V(-2, returnBottom, -0.36), V(-2, returnTop, -0.36), 0.039);
  if (shared) {
    // Three continuous support cables run from the real ground anchor to the
    // counterweight. A pixel-wide far-field highlight preserves their silhouette
    // before the braided strands and brackets become large enough to resolve.
    const points = [];
    for (let c = 0; c < 3; c++) {
      const a = (c * TAU) / 3 + 0.16;
      points.push(pointOnRing(a, 0.52, bottom), pointOnRing(a, 0.52, top));
    }
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `varying float dist;void main(){vec4 p=modelViewMatrix*vec4(position,1.);dist=length(p.xyz);gl_Position=projectionMatrix*p;}`,
        fragmentShader: `varying float dist;void main(){
        gl_FragColor=vec4(.66,.78,.85,.86*smoothstep(.26,1.10,dist));
        #include <colorspace_fragment>
      }`,
      }),
    );
    installation.add(lines);
    cylinderAt(terminal, graphite, 0, bottom + 0.12, 0, 1.75, 0.24);
    cylinderAt(terminal, ivory, 0, bottom + 0.52, 0, 1.12, 0.24);
    cylinderAt(terminal, bronze, 0, bottom + 0.72, 0, 0.74, 0.16);
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      brace(terminal, steelBlue, pointOnRing(a, 1.56, bottom + 0.2), pointOnRing(a, 0.56, bottom + 1.5), 0.12);
    }
    for (const a of [0.16, TAU / 3 + 0.16, (TAU * 2) / 3 + 0.16]) {
      const foot = pointOnRing(a, 0.52, top - 0.43);
      brace(terminal, bronze, foot, V(0, top - 0.16, 0), 0.098);
      cylinderAt(terminal, steelBlue, foot.x, top - 0.36, foot.z, 0.21, 0.54);
    }
    cylinderAt(terminal, graphite, 0, top - 0.16, 0, 0.61, 0.31);
    cylinderAt(terminal, ivory, 0, top - 0.02, 0, 0.53, 0.26);
    brace(terminal, steelBlue, V(0, top - 0.24, 0), V(-2, top - 0.7, -0.36), 0.048);
    for (const sign of [-1, 1]) {
      boxAt(terminal, bronze, sign * 0.67, top - 0.2, 0, 0.37, 0.63, 0.43);
      boxAt(terminal, blueLight, sign * 0.67, top - 0.14, 0.23, 0.13, 0.06, 0.025);
    }
  }
  for (const h of [-0.33, 0.25]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.23, 0.52, 10), h < 0 ? bronze : white);
    pod.position.set(0, h, -0.38);
    returnCar.add(pod);
  }
  // Two axial transfer galleries clear the cableway and the transverse solar arrays.
  const ports = {};
  for (const side of [-1, 1]) {
    const length = side > 0 ? 3.81 : 3.38,
      height = deckY + 0.14;
    for (const x of [-0.27, 0.27]) {
      for (const dy of [-0.24, 0.24])
        brace(terminal, steelBlue, V(x, height + dy, 1.38 * side), V(x, height + dy, (length - 0.23) * side), 0.055);
      for (let i = 0; i < 5; i++) {
        const z = 1.39 + ((length - 1.64) * i) / 5,
          end = 1.39 + ((length - 1.64) * (i + 1)) / 5;
        brace(
          terminal,
          ivory,
          V(x, height + (i % 2 ? 0.24 : -0.24), z * side),
          V(x, height + (i % 2 ? -0.24 : 0.24), end * side),
          0.033,
        );
        const lamp = i === 4 ? warmLight : blueLight;
        boxAt(terminal, lamp, x, height + 0.27, z * side, 0.11, 0.046, 0.13);
      }
    }
    cylinderAt(terminal, graphite, 0, height, (side * (length + 1.35)) / 2, 0.22, length - 1.35, [Math.PI / 2, 0, 0]);
    for (let j = 0; j < 8; j++)
      cylinderAt(terminal, j % 3 ? white : bronze, 0, height, side * (1.45 + ((length - 1.75) * j) / 7), 0.25, 0.065, [
        Math.PI / 2,
        0,
        0,
      ]);
    ports[side > 0 ? 'primary' : 'service'] = dockingPort(
      installation,
      V(0, height, side * length),
      side < 0,
      0.4,
      detail,
    );
  }
  terminal.finish();
  vehicle.finish();
  const lamps = [
    navigationBeacon(climber, V(0.5, 0.78, 0.51), 0xffb468, 0.36, 0),
    navigationBeacon(climber, V(-0.44, -0.66, 0.63), 0x95eeff, 0.27, 2.2),
    navigationBeacon(installation, V(4.16, deckY + 0.31, -0.17), 0xff7163, 0.34, 2.1),
    navigationBeacon(installation, V(-3.92, deckY + 0.25, -0.2), 0xa1fde0, 0.32, 0.3),
  ];

  if (!shared) {
    const planet = earthHorizon();
    planet.scale.setScalar(2.02);
    planet.position.set(-8, -38.6, -32.0);
    planet.rotation.set(0.38, 3.55, -0.28);
    group.add(planet, atmosphere(planet), new THREE.HemisphereLight(0xd0deed, 0x334d77, 0.92));
    const sunrise = new THREE.DirectionalLight(0xffe0ac, 3.35);
    sunrise.position.set(-4, 6, 6);
    const blue = new THREE.DirectionalLight(0x81bbff, 1.4);
    blue.position.set(4, -5, -1.5);
    const rim = new THREE.DirectionalLight(0xd5e8ff, 1.4);
    rim.position.set(-1, 3, -5);
    group.add(sunrise, blue, rim);
  }

  let climbFraction = 0,
    ascending = true;
  function update(elapsed, dt, progress) {
    const automatic = 0.5 + 0.5 * Math.sin(elapsed * (shared ? 0.17 : 0.126) + (shared ? 1.05 : 0.05));
    const ascent = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : automatic;
    if (Math.abs(ascent - climbFraction) > 1e-7) ascending = ascent > climbFraction;
    climbFraction = ascent;
    climber.position.y = THREE.MathUtils.lerp(shared ? bottom + 1.63 : -5.35, shared ? deckY - 0.89 : 1.02, ascent);
    returnCar.position.y = THREE.MathUtils.lerp(
      shared ? returnTop - 0.83 : 4.7,
      shared ? returnBottom + 0.93 : -5.7,
      ascent,
    );
    cables.material.uniforms.time.value = elapsed;
    for (const blink of lamps) blink(elapsed);
  }
  update(0, 0);
  return {
    group,
    ports,
    climber,
    get ascent() {
      return climbFraction;
    },
    get ascending() {
      return ascending;
    },
    sharedScale: 0.02,
    updateLOD: detail?.update,
    camera: shared ? [10.6, 26.6, 5.3] : [4.35, 1.65, 14.0],
    target: shared ? [0, 30.65, 0] : [0, 0.05, 0],
    fov: 44,
    minDistance: 4,
    maxDistance: 24,
    minPolarAngle: 0.16,
    maxPolarAngle: 2.87,
    pickables: [{ id: 'elevator', object: installation }],
    update,
  };
}
