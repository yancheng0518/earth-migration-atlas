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

// Small-scale milling and abrasion live in a shared repeat texture. The doors,
// panel breaks and bolted flanges use separately modelled silhouette geometry.
function rolledFinish() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  let seed = 108799;
  for (let y = 0; y < canvas.height; y++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = 9 * Math.sin(y * 0.31) + 16 * (seed / 2 ** 32 - 0.5);
    for (let x = 0; x < canvas.width; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const pin = seed / 2 ** 32;
      const spec = 146 + grain * (0.4 + 0.6 * Math.cos(x * 0.018) ** 2) + 22 * (pin - 0.5);
      const i = (y * canvas.width + x) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = spec;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.globalAlpha = .42;
  for (let i = 0; i < 32; i++) {
    const x = (34 + i * 139) % 256, y = (19 + i * 47) % 128;
    ctx.fillStyle = i % 3 ? '#d6d6d6' : '#454545';
    ctx.fillRect(x, y, 3 + (i * 11) % 29, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

function chamferedPlate() {
  const frame = new THREE.Shape();
  frame.moveTo(-0.38, -0.46);
  frame.lineTo(0.38, -0.46);
  frame.lineTo(0.46, -0.34);
  frame.lineTo(0.46, 0.34);
  frame.lineTo(0.38, 0.46);
  frame.lineTo(-0.38, 0.46);
  frame.lineTo(-0.46, 0.34);
  frame.lineTo(-0.46, -0.34);
  frame.closePath();
  const geometry = new THREE.ExtrudeGeometry(frame, {
    depth: .92, bevelThickness: .04, bevelSize: .04, bevelSegments: 1, steps: 1,
  });
  geometry.translate(0, 0, -.46);
  // ExtrudeGeometry's default UVs assume world coordinates extending from
  // zero. Map the centred profile across the whole abrasion sheet instead.
  const vertices = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < vertices.count; i++) {
    const axle = Math.abs(normals.getZ(i)) >= .5;
    const right = Math.abs(normals.getX(i)) >= Math.abs(normals.getY(i));
    const u = axle || !right ? vertices.getX(i) : vertices.getZ(i);
    const v = axle || right ? vertices.getY(i) : vertices.getZ(i);
    uv.setXY(i, .5 + u, .5 + v);
  }
  return geometry;
}

function label(text, subtext) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 192;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c0bdb1';
  ctx.font = 'bold 88px monospace';
  ctx.fillText(text, 42, 112);
  ctx.font = '26px monospace';
  ctx.fillText(subtext, 45, 158);
  ctx.fillRect(45, 126, 402, 3);
  ctx.fillStyle = '#a37a41';
  ctx.fillRect(7, 25, 16, 130);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map, roughness: .86, alphaTest: .15, metalness: .08 });
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
    side: THREE.DoubleSide,
    vertexShader: [
      'attribute vec2 wire; varying vec2 knot; varying vec3 n,pos;',
      'void main(){knot=wire; n=normalize(mat3(modelMatrix)*normal);',
      'pos=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(pos,1.);}',
    ].join('\n'),
    fragmentShader: [
      'varying vec2 knot;varying vec3 n,pos;',
      'void main(){vec3 normal=normalize(n),eye=normalize(cameraPosition-pos),sun=normalize(vec3(.92,.56,-.10));',
      'float fine=.83+.17*cos(knot.x*83.+knot.y*7.1);',
      'vec3 col=(vec3(.026,.039,.054)+vec3(.20,.17,.14)*max(0.,dot(normal,sun)))*fine;',
      'float glint=pow(max(0.,dot(normal,normalize(eye+sun))),42.);',
      'vec3 earth=normalize(vec3(-.63,-.60,.35));',
      'float bounce=pow(max(0.,dot(normal,normalize(eye+earth))),13.);',
      'col+=vec3(.92,.82,.70)*glint*.68+vec3(.15,.30,.49)*bounce;',
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
    array = solarSurface(),
    mill = rolledFinish();
  const white = steel(0xa7afb0, .81, .36),
    steelBlue = steel(0x657786, .76, .71),
    ivory = steel(0x9a9990, .78, .54),
    graphite = steel(0x45515a, .72, .6),
    black = steel(0x131e25, .88, .31),
    bronze = steel(0x887354, .79, .68),
    coatingGray = steel(0x7f898f, .82, .41),
    hazard = steel(0x9b6941, .74, .38);
  for (const material of [white, steelBlue, ivory, bronze, coatingGray, graphite, hazard]) {
    material.roughnessMap = mill;
    material.bumpMap = mill;
    material.bumpScale = .000068;
  }
  white.map = coating;
  const blueLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, .59, .88) });
  const warmLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.16, .68, .31) });
  const navBlue = steel(0x162933, .28, .62);
  navBlue.emissive.setHex(0x102a31);
  navBlue.emissiveIntensity = .52;
  const box = new THREE.BoxGeometry();
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 32);
  const rod = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const plate = new THREE.PlaneGeometry();
  const capsule = new THREE.SphereGeometry(1, 20, 12);
  const armor = chamferedPlate();
  const hex = new THREE.CylinderGeometry(1, 1, 1, 6);
  const equipmentShell = new THREE.CylinderGeometry(1, .94, 1, 16);
  const terminal = assembly(installation, detail),
    vehicle = assembly(climber, detail);
  const boxAt = (batch, m, x, y, z, w, h, d, angle = 0) => batch.put(box, m, V(x, y, z), V(w, h, d), [0, angle, 0]);
  const cylinderAt = (batch, m, x, y, z, r, h, rot = [0, 0, 0]) => batch.put(cylinder, m, V(x, y, z), V(r, h, r), rot);
  function face(batch, geometry, material, angle, radius, height, tangent, w, h, d) {
    const p = pointOnRing(angle, radius, height);
    p.x += Math.cos(angle) * tangent;
    p.z -= Math.sin(angle) * tangent;
    batch.put(geometry, material, p, V(w, h, d), [0, angle, 0]);
  }
  function bolts(batch, angle, radius, height, separation, r = .027) {
    for (const tangent of [-separation, separation]) {
      const p = pointOnRing(angle, radius, height);
      p.x += Math.cos(angle) * tangent;
      p.z -= Math.sin(angle) * tangent;
      const turn = new THREE.Quaternion().setFromUnitVectors(up, pointOnRing(angle, 1, 0));
      batch.put(hex, steelBlue, p, V(r, .019, r), turn);
    }
  }
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
      cylinderAt(terminal, graphite, p.x, y, p.z, 0.104, 0.21);
      for (const offset of [-.115, .115]) cylinderAt(terminal, ivory, p.x, y + offset, p.z, .109, .035);
      brace(terminal, steelBlue, p, q, 0.033);
      const tip = q.clone().addScaledVector(up, 0.34);
      brace(terminal, graphite, p.clone().addScaledVector(up, -.25), tip, .025);
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
      face(terminal, armor, graphite, a, 1.64, deckY - .24, 0, .38, .29, .17);
      for (const off of [-.091, -.025, .041, .107]) {
        face(terminal, box, black, a, 1.733, deckY - .25 + off, 0, .28, .031, .025);
      }
      bolts(terminal, a, 1.74, deckY - .357, .132);
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
    // Service lines run underneath the gallery rather than floating on its skin.
    for (const [height, zOffset, material] of [
      [-.27, .26, graphite],
      [-.34, .25, steelBlue],
      [-.29, -.24, bronze],
    ]) {
      const zs = z + zOffset;
      brace(terminal, material, V(sign * 1.40, deckY + height, zs), V(sign * 2.55, deckY + height, zs), .037);
      brace(terminal, material, V(sign * 2.55, deckY + height, zs), V(sign * 2.71, deckY - .14, zs + .11), .037);
      for (const x of [1.59, 1.94, 2.28, 2.56]) {
        cylinderAt(terminal, coatingGray, sign * x, deckY + height, zs, .053, .045, [0, 0, Math.PI / 2]);
      }
    }
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

  // The bogies clamp around three separate cable guides. Paired structural
  // collars take their loads into a faceted pressure shell at either end.
  for (const y of [-0.80, .74]) {
    hoop(climber, .72, .061, y, graphite, 48);
    hoop(climber, .81, .034, y + .038, ivory, 48);
    hoop(climber, .65, .047, y + .068, black, 48);
    for (let i = 0; i < 3; i++) {
      const a = .16 + (i * TAU) / 3,
        p = pointOnRing(a, .59, y + .045);
      vehicle.put(armor, graphite, p, V(.31, .25, .36), [0, a, 0]);
      const rollerLeft = pointOnRing(a - .16, .55, y + .169),
        rollerRight = pointOnRing(a + .16, .55, y + .169);
      for (const roller of [rollerLeft, rollerRight]) {
        cylinderAt(vehicle, steelBlue, roller.x, roller.y, roller.z, .071, .08, [0, a, Math.PI / 2]);
      }
      face(vehicle, armor, coatingGray, a, .758, y - .025, 0, .22, .115, .15);
    }
  }
  for (let n = 0; n < 6; n++) {
    const a = n * TAU / 6;
    face(vehicle, armor, graphite, a, .755, -.035, 0, .79, 1.41, .51);
    // Hold the original cabin envelope. Its cream thermal blanket now reads
    // as alternating removable panels over a recessed structural core.
    for (const sign of [-1, 1]) {
      face(vehicle, armor, steelBlue, a, .949, .007, sign * .329, .114, 1.15, .19);
      face(vehicle, armor, white, a, 1.004, -.187, sign * .136, .246, .58, .12);
      face(vehicle, armor, ivory, a, .961, -.581, sign * .109, .187, .131, .20);
      const railBottom = pointOnRing(a + sign * .36, .916, -.73);
      const railTop = pointOnRing(a + sign * .36, .916, .68);
      brace(vehicle, steelBlue, railBottom, railTop, .043);
    }
    face(vehicle, armor, black, a, 1.031, .313, 0, .565, .292, .12);
    face(vehicle, armor, coatingGray, a, 1.053, .488, 0, .567, .099, .126);
    for (const offset of [-.174, 0, .174]) {
      face(vehicle, armor, navBlue, a, 1.095, .313, offset, .137, .177, .023);
      face(vehicle, box, n % 3 === 1 && offset === 0 ? warmLight : steelBlue,
        a, 1.111, .342, offset, .117, .028, .016);
      // Indirect light catches an unlit central mullion. Only a few cabin
      // windows show light; the glazing keeps dark recesses close to the lens.
      if ((n + (offset ? 3 : 0)) % 3 === 1) {
        face(vehicle, box, warmLight, a, 1.109, .293, offset - .022, .076, .009, .013);
        face(vehicle, box, black, a, 1.117, .313, offset + .019, .019, .173, .018);
      }
    }
    face(vehicle, armor, black, a, 1.057, -.437, 0, .477, .204, .053);
    for (let j = 0; j < 5; j++) {
      face(vehicle, box, coatingGray, a, 1.092, -.507 + j * .036, 0, .411, .012, .036);
    }
    bolts(vehicle, a, 1.092, -.308, .223);
    bolts(vehicle, a, 1.123, .494, .23, .019);
    face(vehicle, armor, n % 2 ? steelBlue : hazard, a, .962, .638, 0, .51, .096, .143);
    for (const offset of [-.144, .144]) {
      face(vehicle, box, n % 2 ? warmLight : blueLight, a, 1.039, .657, offset, .048, .027, .031);
    }
    for (let i = 0; i < 4; i++) {
      face(vehicle, box, i % 2 ? black : hazard, a, 1.116, -.59, -.18 + i * .12, .081, .036, .026);
    }
    if (n % 2 === 0) {
      // Tucked into the bevel is a shock-isolated auxiliary pneumatic bottle.
      // Its shoulders, separate bands and plumbing stay readable as a silhouette.
      const bottleAngle = a + .47;
      const foot = pointOnRing(bottleAngle, .937, -.518);
      const neck = pointOnRing(bottleAngle, .937, .319);
      const center = foot.clone().lerp(neck, .5);
      vehicle.put(equipmentShell, coatingGray, center, V(.094, .62, .094));
      for (const end of [-.30, .30]) {
        const cap = center.clone().addScaledVector(up, end);
        vehicle.put(capsule, steelBlue, cap, V(.092, .074, .092));
      }
      for (const h of [-.36, .19]) {
        cylinderAt(vehicle, graphite, foot.x, h, foot.z, .111, .043);
      }
      cylinderAt(vehicle, bronze, neck.x, .299, neck.z, .058, .069);
      const feed = pointOnRing(bottleAngle, .951, .505);
      brace(vehicle, bronze, neck, feed, .025);
      brace(vehicle, steelBlue, feed, pointOnRing(bottleAngle, .718, .581), .025);
    }
  }
  const identity = new THREE.Mesh(plate, label('ASC–04', 'UEG EQUATORIAL LIFT'));
  identity.position.set(0, -.151, 1.071);
  identity.scale.set(.48, .19, 1);
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
        gl_FragColor=vec4(.49,.64,.73,.72*smoothstep(.26,1.10,dist));
        #include <colorspace_fragment>
      }`,
      }),
    );
    installation.add(lines);
    cylinderAt(terminal, graphite, 0, bottom + .12, 0, 2.08, .24);
    cylinderAt(terminal, black, 0, bottom + .254, 0, 1.9, .08);
    cylinderAt(terminal, ivory, 0, bottom + .38, 0, 1.68, .18);
    cylinderAt(terminal, graphite, 0, bottom + .54, 0, 1.05, .21);
    cylinderAt(terminal, bronze, 0, bottom + .72, 0, .72, .16);
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12,
        foot = pointOnRing(a, 1.78, bottom + .237),
        head = pointOnRing(a, .77, bottom + .91);
      face(terminal, armor, graphite, a, 1.78, bottom + .23, 0, .48, .36, .49);
      face(terminal, box, coatingGray, a, 1.92, bottom + .46, 0, .25, .088, .24);
      brace(terminal, steelBlue, foot, head, .074);
      if (i % 2 === 0) {
        brace(terminal, graphite, head, pointOnRing(a + .14, .56, bottom + 1.4), .066);
      }
      face(terminal, box, i % 3 ? blueLight : warmLight, a, 2.015, bottom + .41, .077, .09, .035, .034);
      bolts(terminal, a, 2.029, bottom + .28, .14, .022);
    }
    for (const a of [0.16, TAU / 3 + 0.16, (TAU * 2) / 3 + 0.16]) {
      const foot = pointOnRing(a, 0.52, top - 0.43);
      brace(terminal, bronze, foot, V(0, top - 0.16, 0), 0.098);
      cylinderAt(terminal, graphite, foot.x, top - .425, foot.z, .164, .39);
      cylinderAt(terminal, steelBlue, foot.x, top - .588, foot.z, .177, .073);
      cylinderAt(terminal, ivory, foot.x, top - .334, foot.z, .177, .073);
    }
    cylinderAt(terminal, graphite, 0, top - .15, 0, .59, .26);
    cylinderAt(terminal, steelBlue, 0, top - .012, 0, .635, .082);
    cylinderAt(terminal, ivory, 0, top + .072, 0, .52, .091);
    const capHeight = top + .142;
    cylinderAt(terminal, coatingGray, 0, capHeight, 0, .335, .082);
    for (let i = 0; i < 10; i++) {
      const a = i * TAU / 10;
      face(terminal, armor, graphite, a, .603, top - .104, 0, .126, .221, .092);
      face(terminal, box, black, a, .657, top - .153, 0, .076, .043, .027);
      bolts(terminal, a, .653, top - .077, .044, .017);
    }
    brace(terminal, steelBlue, V(0, top - 0.24, 0), V(-2, top - 0.7, -0.36), 0.048);
    for (const sign of [-1, 1]) {
      terminal.put(armor, graphite, V(sign * .665, top - .2, 0), V(.365, .59, .40));
      terminal.put(armor, hazard, V(sign * .67, top - .16, .201), V(.254, .393, .076));
      boxAt(terminal, steelBlue, sign * .67, top - .399, .163, .268, .067, .102);
      boxAt(terminal, blueLight, sign * .67, top - .14, .251, .099, .044, .027);
    }
  }
  for (const h of [-0.33, 0.25]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.23, 0.52, 10), h < 0 ? bronze : white);
    pod.position.set(0, h, -0.38);
    returnCar.add(pod);
    for (const off of [-.19, .19]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(.272, .272, .044, 12), graphite);
      band.position.set(0, h + off, -.38);
      returnCar.add(band);
    }
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
