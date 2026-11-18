import * as THREE from 'three';

const TAU = 2 * Math.PI;
const UP = new THREE.Vector3(0, 1, 0);
const tints = new Map();
const steel = '#73818a',
  edge = '#a0a9a7',
  black = '#202a31',
  gunmetal = '#4e5d65';
const bronze = '#9c704a',
  ceramic = '#b0a696',
  graphite = '#343d42';
const polar = (r, y, a) => [r * Math.sin(a), y, r * Math.cos(a)];

// Solid faces share one draw per assembly. A separate vertex normal on each
// fold keeps the chamfers, pressed steel and overlapping ceramic leaves readable.
class Plates {
  positions = [];
  colors = [];
  uvs = [];
  indices = [];

  face(corners, tint, cell) {
    const first = this.positions.length / 3;
    if (!tints.has(tint)) tints.set(tint, new THREE.Color(tint));
    const c = tints.get(tint);
    for (let i = 0; i < corners.length; i++) {
      this.positions.push(...corners[i]);
      this.colors.push(c.r, c.g, c.b);
      const u = i === 1 || i === 2 ? 1 : 0,
        v = i > 1 ? 1 : 0;
      if (cell !== undefined)
        this.uvs.push(((cell % 2) + 0.01 + 0.98 * u) / 2, 1 - (Math.floor(cell / 2) + 0.99 - 0.98 * v) / 4);
      else if (this.usesLivery) this.uvs.push(0.985, 0.015);
      else this.uvs.push(u, v);
    }
    for (let i = 2; i < corners.length; i++) this.indices.push(first, first + i - 1, first + i);
  }

  box(x, y, z, w, h, d, tint) {
    const corners = [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
    ].map(([a, b, c]) => [x + a * w * 0.5, y + b * h * 0.5, z + c * d * 0.5]);
    for (const face of [
      [0, 1, 2, 3],
      [5, 4, 7, 6],
      [1, 5, 6, 2],
      [4, 0, 3, 7],
      [3, 2, 6, 7],
      [4, 5, 1, 0],
    ])
      this.face(
        face.map((i) => corners[i]),
        tint,
      );
  }

  armourBox(x, y, z, w, h, d, bevel, tint) {
    const corners = [
      [-1, -1, 1, 0],
      [1, -1, -1, 0],
      [1, -1, 0, 1],
      [1, 1, 0, -1],
      [1, 1, -1, 0],
      [-1, 1, 1, 0],
      [-1, 1, 0, -1],
      [-1, -1, 0, 1],
    ];
    const rows = [
      [-h / 2, bevel * 0.65],
      [-h / 2 + bevel, 0],
      [h / 2 - bevel, 0],
      [h / 2, bevel * 0.65],
    ].map(([yy, inset]) =>
      corners.map(([sx, sz, dx, dz]) => [
        x + sx * (w / 2 - inset) + dx * bevel,
        y + yy,
        z + sz * (d / 2 - inset) + dz * bevel,
      ]),
    );
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 8; i++) {
        const next = (i + 1) % 8;
        this.face([rows[j][next], rows[j][i], rows[j + 1][i], rows[j + 1][next]], tint);
      }
    this.face(rows[0], tint);
    this.face(rows[3].toReversed(), tint);
  }

  tube(start, end, r, tint, sides = 8) {
    const bottom = new THREE.Vector3(...start),
      top = new THREE.Vector3(...end);
    const axis = top.clone().sub(bottom).normalize();
    const tangent = new THREE.Vector3()
      .crossVectors(axis, Math.abs(axis.y) > 0.93 ? new THREE.Vector3(1, 0, 0) : UP)
      .normalize();
    const bitangent = new THREE.Vector3().crossVectors(axis, tangent);
    const lo = [],
      hi = [];
    for (let i = 0; i < sides; i++) {
      const delta = tangent
        .clone()
        .multiplyScalar(r * Math.cos((i * TAU) / sides))
        .addScaledVector(bitangent, r * Math.sin((i * TAU) / sides));
      lo.push(delta.clone().add(bottom).toArray());
      hi.push(delta.add(top).toArray());
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.face([lo[i], lo[j], hi[j], hi[i]], tint);
    }
    this.face(hi, tint);
    this.face(lo.reverse(), tint);
  }

  // Shared vertices around each ring keep the normal continuous along the
  // tyre wall, wheel flange and dished tank head. Rows can use separate finishes.
  turned(center, axis, profile, segments) {
    const lathe = new THREE.LatheGeometry(
      profile.map(([offset, r]) => new THREE.Vector2(r, offset)),
      segments,
    );
    const rotate = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(...axis));
    const base = new THREE.Vector3(...center),
      p = new THREE.Vector3(),
      first = this.positions.length / 3;
    const vertices = lathe.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      p.fromBufferAttribute(vertices, i).applyQuaternion(rotate).add(base);
      this.positions.push(p.x, p.y, p.z);
      const tint = profile[i % profile.length][2];
      if (!tints.has(tint)) tints.set(tint, new THREE.Color(tint));
      const c = tints.get(tint);
      this.colors.push(c.r, c.g, c.b);
      this.uvs.push(0.985, 0.015);
    }
    for (const i of lathe.index.array) this.indices.push(first + i);
    lathe.dispose();
  }

  // Each row is a height, outside radius, and independent left/right angles.
  // Thickness is real, including the slotted gap between adjacent leaves.
  leaf(rows, thickness, tint, sides = graphite) {
    const layer = (row, offset) => [polar(row[1] + offset, row[0], row[2]), polar(row[1] + offset, row[0], row[3])];
    for (let i = 0; i < rows.length - 1; i++) {
      const [a, b] = layer(rows[i], 0),
        [c, d] = layer(rows[i + 1], 0);
      const [e, f] = layer(rows[i], -thickness),
        [g, h] = layer(rows[i + 1], -thickness);
      this.face([a, b, d, c], Array.isArray(tint) ? tint[i] : tint);
      this.face([e, a, c, g], sides);
      this.face([b, f, h, d], sides);
      if (i === 0) this.face([e, f, b, a], sides);
      if (i === rows.length - 2) this.face([c, d, h, g], edge);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function makeCrown(detailed) {
  const skin = new Plates(),
    heat = new Plates();
  const count = detailed ? 32 : 20;
  for (let i = 0; i < count; i++) {
    const a = (i * TAU) / count,
      half = (TAU / count) * 0.46;
    const row = (y, r, width, shift = 0) => [y, r, a + shift - half * width, a + shift + half * width];
    const tint = [steel, '#82909a', '#6c7a87', '#637380'][i % 4];
    // The exhaust lip is built from individual overlapping sacrificial leaves,
    // with a narrower actuator below and replaceable ceramic blocks on its tip.
    skin.leaf(
      [
        row(24.95, 4.83, 0.45),
        row(25.57, 5.29, 0.74),
        row(27.84, 6.9, 0.98),
        row(29.18, 7.12, 0.89),
        row(29.75, 6.88, 0.69),
      ],
      0.26,
      [gunmetal, tint, tint, ceramic],
    );
    skin.leaf([row(26.0, 5.8, 0.3), row(28.23, 7.11, 0.36), row(29.04, 7.18, 0.26)], 0.12, [gunmetal, edge]);
    skin.leaf([row(29.14, 7.03, 0.65), row(29.23, 7.08, 0.65)], 0.04, graphite);
    if (detailed) {
      // Titanium stiffeners carry the load while the dark slots admit cooling
      // air. A second, staggered row overlaps the fixed outer jacket.
      skin.leaf([row(25.12, 4.96, 0.23, 0.05), row(26.18, 5.89, 0.43, 0.05), row(26.67, 6.04, 0.49, 0.05)], 0.12, [
        bronze,
        '#a9a9a2',
      ]);
      skin.leaf([row(27.08, 6.29, 0.69), row(27.19, 6.39, 0.71)], 0.08, graphite);
      skin.leaf([row(28.3, 7.12, 0.74), row(28.37, 7.13, 0.74)], 0.03, '#b4ad98');
    }
    // Dark throat, segmented hot ceramics, then the bright inner aperture.
    skin.leaf([row(29.69, 6.88, 0.67), row(29.88, 6.72, 0.63), row(29.94, 6.19, 0.66), row(29.61, 5.75, 0.59)], 0.11, [
      edge,
      ceramic,
      graphite,
    ]);
    if (i % 2 === 0) heat.leaf([row(27.62, 6.79, 0.56), row(27.7, 6.83, 0.56)], 0.02, '#c2a16f');
    for (const [y, r] of [
      [12.07, 6.56],
      [17.72, 6.05],
      [24.52, 4.84],
    ]) {
      skin.leaf([row(y - 0.16, r, 0.96), row(y, r + 0.19, 0.97), row(y + 0.18, r + 0.19, 0.88)], 0.19, [
        gunmetal,
        tint,
      ]);
    }
    if (i % 2 === 0) {
      skin.leaf([row(20.75, 4.9, 0.47), row(21.35, 5.16, 0.63), row(24.31, 5.01, 0.68)], 0.4, [gunmetal, black]);
      for (let j = 0; j < 8; j++) {
        const y = 21.46 + j * 0.327,
          r = 5.18 - j * 0.014;
        skin.leaf([row(y, r, 0.58), row(y + 0.14, r + 0.13, 0.59), row(y + 0.17, r - 0.08, 0.59)], 0.08, [tint, black]);
        if (j % 2 === 0) heat.leaf([row(y + 0.19, r - 0.01, 0.51), row(y + 0.225, r - 0.01, 0.51)], 0.02, '#c37a45');
      }
    }
    if (detailed && i % 4 === 0) {
      const plate = (y, r, left, right) => [y, r, a + left, a + right];
      // A pressure bay between the mid-deck ribs. Keep the forward name plate
      // clear while making the open side bays readable in the low-angle shot.
      skin.leaf(
        [
          plate(12.48, 6.15, -0.13, 0.13),
          plate(13.08, 6.39, -0.16, 0.16),
          plate(16.86, 5.94, -0.15, 0.15),
          plate(17.15, 5.85, -0.1, 0.1),
        ],
        0.29,
        [steel, '#303b41', steel],
      );
      for (let k = 0; k < 5; k++) {
        const y = 13.24 + k * 0.61,
          r = 6.44 - k * 0.074;
        skin.leaf(
          [plate(y, r, -0.155, 0.151), plate(y + 0.087, r + 0.04, -0.153, 0.151)],
          0.05,
          k % 2 ? gunmetal : '#84867f',
        );
      }
      for (const delta of [-0.095, -0.037, 0.047]) {
        const lo = polar(6.42, 13.18, a + delta),
          hi = polar(5.99, 16.78, a + delta);
        skin.tube(lo, hi, delta < -0.07 ? 0.114 : 0.084, delta > 0 ? '#ac9475' : steel, 8);
        for (const fraction of [0.12, 0.77]) {
          const y = 13.18 + fraction * 3.6,
            r = 6.42 - fraction * 0.43;
          skin.tube(polar(r, y, a + delta), polar(r - 0.018, y + 0.13, a + delta), 0.142, graphite, 8);
        }
      }
      // The valve wheels and hub housings sit under the lower maintenance deck.
      const low = polar(8.43, 7.14, a + 0.12),
        high = polar(8.45, 7.14, a + 0.17);
      skin.tube(low, high, 0.42, bronze, 12);
      for (let k = 0; k < 4; k++) {
        const y = 1.68 + k * 1.25,
          r = 10.2 - k * 0.43;
        skin.leaf(
          [plate(y, r, -0.27, -0.14), plate(y + 0.16, r + 0.14, -0.26, -0.15), plate(y + 0.6, r + 0.04, -0.26, -0.15)],
          0.22,
          [edge, gunmetal],
        );
      }
    }
  }
  return { skin: skin.geometry(), heat: heat.geometry() };
}

export function buildEngineWorkshop(group, batch, materials, shared, placeOnSurface, uniforms, adjacentSites) {
  const { steel: structural, trim, pale, bronze: oxide, dark, amber, white, metal } = materials;
  const hardware = metal('#ffffff', 0.61, 0.46);
  hardware.vertexColors = true;
  const heat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  heat.onBeforeCompile = (shader) => {
    shader.uniforms.workshopPower = uniforms.ignition;
    shader.vertexShader =
      'varying float workshopDelay;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nworkshopDelay=.105+.54*clamp(length(instanceMatrix[3].xz)/150.,0.,1.);',
      );
    shader.fragmentShader =
      'uniform float workshopPower;varying float workshopDelay;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\ngl_FragColor.rgb*=.035+1.32*smoothstep(workshopDelay,workshopDelay+.33,workshopPower);',
      );
  };
  const crownMeshes = [];
  const matrix = new THREE.Matrix4(),
    pos = new THREE.Vector3(),
    quat = new THREE.Quaternion(),
    normal = new THREE.Vector3(),
    scale = new THREE.Vector3();
  const installations = [[[0, 0, 1]], adjacentSites];
  for (const [tier, sites] of installations.entries()) {
    const crown = makeCrown(tier === 0);
    for (const [geo, mat] of [
      [crown.skin, hardware],
      [crown.heat, heat],
    ]) {
      const mesh = new THREE.InstancedMesh(geo, mat, sites.length);
      for (const [i, [x, z, s]] of sites.entries()) {
        placeOnSurface(pos.set(x, 0, z), normal, shared);
        quat.setFromUnitVectors(UP, normal);
        mesh.setMatrixAt(i, matrix.compose(pos, quat, scale.setScalar(s)));
      }
      mesh.computeBoundingSphere();
      mesh.name = 'Segmented exhaust crown';
      group.add(mesh);
      crownMeshes.push(mesh);
    }
  }
  batch.detail(2);
  // Outboard A-frames and their hydraulic cylinders take the thrust into wide
  // footings. The open space between the frames preserves the lower silhouette.
  for (let i = 0; i < 8; i++) {
    const a = (i * TAU) / 8 + 0.16;
    const leg = (r, y, angle, rr, yy, b, w, m) => batch.spar(polar(r, y, angle), polar(rr, yy, b), w, m, 6);
    for (const side of [-1, 1]) {
      const aa = a + side * 0.084;
      leg(13.1, 0.98, aa, 9.35, 6.85, a, 0.34, structural);
      leg(9.35, 6.85, a, 7.38, 10.42, a, 0.31, pale);
      leg(12.35, 1.14, aa, 10.15, 5.21, aa, 0.32, oxide);
      leg(10.15, 5.21, aa, 8.49, 8.38, aa, 0.16, trim);
      leg(13.14, 1.35, aa, 9.48, 4.01, a - side * 0.08, 0.15, structural);
      batch.box(...polar(12.73, 0.49, aa), 1.39, 0.87, 2.0, dark, aa);
      batch.box(...polar(12.79, 1.0, aa), 1.47, 0.2, 2.15, pale, aa);
    }
    batch.box(...polar(9.35, 6.38, a), 1.1, 1.22, 0.94, oxide, a);
    batch.box(...polar(9.8, 6.42, a), 0.84, 0.44, 0.24, trim, a);
  }
  // Three polygonal balconies and a switchback maintenance stair share the
  // existing steel batches. Railings are sized against the truck cabins below.
  for (const [y, r] of [
    [8.84, 8.32],
    [12.02, 7.35],
    [19.96, 5.89],
  ]) {
    for (let i = 0; i < 24; i++) {
      const a = (i * TAU) / 24,
        b = ((i + 1) * TAU) / 24,
        m = (a + b) * 0.5;
      batch.box(...polar(r - 0.32, y, m), 2 * r * Math.sin(Math.PI / 24) + 0.04, 0.2, 0.89, structural, m);
      batch.spar(polar(r, y, a), polar(r, y + 0.58, a), 0.055, trim, 4);
      batch.spar(polar(r, y + 0.58, a), polar(r, y + 0.58, b), 0.061, trim, 4);
      batch.spar(polar(r, y + 0.31, a), polar(r, y + 0.31, b), 0.038, oxide, 4);
      if (i % 3 === 0) batch.box(...polar(r - 0.08, y - 0.15, m), 0.54, 0.12, 0.14, amber, m);
    }
  }
  for (let flight = 0; flight < 3; flight++) {
    const start = flight % 2 === 0 ? 0.71 : 1.2,
      dir = flight % 2 === 0 ? 1 : -1,
      r = 8.47 - flight * 0.32;
    const h = 8.94 + flight * 1.01;
    for (let j = 0; j < 10; j++) {
      const a = start + dir * j * 0.049,
        y = h + j * 0.101;
      batch.box(...polar(r, y, a), 0.54, 0.12, 0.8, pale, a);
    }
    const end = start + dir * 0.49;
    for (const radius of [r - 0.43, r + 0.43]) {
      batch.spar(polar(radius, h - 0.11, start), polar(radius, h + 0.9, end), 0.076, structural, 5);
      batch.spar(polar(radius, h + 0.52, start), polar(radius, h + 1.53, end), 0.053, trim, 5);
      for (const j of [0, 5, 10])
        batch.spar(
          polar(radius, h + j * 0.101, start + dir * j * 0.049),
          polar(radius, h + j * 0.101 + 0.54, start + dir * j * 0.049),
          0.045,
          trim,
          4,
        );
    }
    batch.box(...polar(r, h + 1, end), 0.98, 0.16, 1.01, structural, end);
  }
  for (const [a, r, h] of [
    [-0.72, 7.38, 18.18],
    [1.85, 6.72, 17.28],
    [-2.31, 6.28, 16.54],
  ]) {
    batch.box(...polar(r, h, a), 2.45, 1.89, 1.31, pale, a);
    batch.box(...polar(r + 0.69, h + 0.13, a), 1.86, 0.6, 0.11, dark, a);
    batch.box(...polar(r + 0.75, h + 0.18, a), 1.53, 0.27, 0.04, white, a);
    batch.box(...polar(r, h + 1.04, a), 2.87, 0.18, 1.76, structural, a);
  }
  return {
    setProximity(value) {
      for (const mesh of crownMeshes) mesh.visible = value > 0.16;
    },
  };
}

// Convoy traffic follows a rounded rectangle around CN-07. The same centreline
// is marked in the terrain shader and is kept free of generated buildings.
export function onRescueRoad(x, z, margin = 0) {
  const dx = Math.abs(x) - 24,
    dz = Math.abs(z + 7) - 16;
  const distance = Math.hypot(Math.max(0, dx), Math.max(0, dz)) + Math.min(Math.max(dx, dz), 0) - 8;
  return Math.abs(distance) < 2.7 + margin;
}

function fleetLivery() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const c = canvas.getContext('2d');
  c.fillStyle = 'white';
  c.fillRect(0, 0, 1024, 512);
  let seed = 44015;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const palette = ['#ab8154', '#b5b0a1', '#919995', '#aaa99e', '#b0834f', '#263c49', '#737e7d'];
  for (let i = 0; i < palette.length; i++) {
    c.save();
    c.translate((i % 2) * 512, Math.floor(i / 2) * 128);
    c.beginPath();
    c.rect(0, 0, 512, 128);
    c.clip();
    c.fillStyle = palette[i];
    c.fillRect(0, 0, 512, 128);
    const shade = c.createLinearGradient(0, 0, 0, 128);
    shade.addColorStop(0, 'rgba(231,235,222,.15)');
    shade.addColorStop(0.6, 'rgba(25,29,30,0)');
    shade.addColorStop(1, 'rgba(32,29,25,.43)');
    c.fillStyle = shade;
    c.fillRect(0, 0, 512, 128);
    const text = (word, x, y, size, color = '#dddccb') => {
      c.fillStyle = color;
      c.font = 'bold ' + size + 'px "Microsoft YaHei",sans-serif';
      c.fillText(word, x, y);
    };
    if (i === 0) {
      c.strokeStyle = '#57584e';
      c.lineWidth = 3;
      c.strokeRect(7, 5, 495, 116);
      text('UEG', 28, 65, 46);
      text('地 面 保 障', 168, 59, 25);
      text('SURFACE OPERATIONS', 33, 94, 15);
      c.fillStyle = '#343a37';
      c.fillRect(418, 37, 53, 11);
    } else if (i === 1) {
      c.fillStyle = '#9f6e3c';
      c.fillRect(0, 67, 512, 37);
      for (const x of [22, 129, 236]) {
        c.fillStyle = '#445357';
        c.fillRect(x, 10, 89, 49);
        c.fillStyle = '#1d3037';
        c.fillRect(x + 3, 12, 82, 43);
        c.fillStyle = '#697276';
        c.fillRect(x + 82, 13, 2, 41);
      }
      text('联合救援', 331, 56, 38, '#323c3e');
      text('RESCUE / R-07', 334, 91, 20, '#f3e1ba');
      c.fillStyle = '#d9b466';
      for (let x = 10; x < 500; x += 64) c.fillRect(x, 112, 36, 5);
    } else if (i === 2 || i === 6) {
      text(i === 2 ? '低温介质 / C-16' : '16 K', 23, 72, 47, '#323f42');
      text('CRYOGENIC SERVICE', 26, 105, 20, '#e8dec2');
      c.fillStyle = '#bd994f';
      c.fillRect(378, 20, 100, 82);
      text('◇', 389, 84, 58, '#363d3b');
    } else {
      text(i === 3 ? '联合救援' : '抢修保障', 24, 63, 43, '#324042');
      text(i === 3 ? 'EMERGENCY SERVICE / 07' : 'FIELD MAINTENANCE', 28, 93, 18);
      c.fillStyle = '#bd9759';
      c.fillRect(0, 107, 512, 13);
      c.fillStyle = '#384041';
      for (let x = 4; x < 512; x += 30) c.fillRect(x, 107, 14, 13);
      c.fillStyle = '#4a5150';
      c.fillRect(357, 9, 3, 91);
    }
    for (let j = 0; j < 2200; j++) {
      const x = random() * 512,
        y = random() * 128;
      c.fillStyle = random() > 0.57 ? 'rgba(225,222,208,.18)' : 'rgba(29,34,35,.13)';
      c.fillRect(x, y, random() > 0.96 ? 8 : 1, 1 + random() ** 5 * 18);
    }
    c.restore();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

function truckGeometry(kind) {
  const p = new Plates(),
    lamps = new Plates();
  p.usesLivery = true;
  const ivory = '#c2b8a1',
    paint = ['#b7834a', '#b8aba1', '#be8150'][kind];
  p.box(0, 0.62, 0, 1.66, 0.33, 4.24, graphite);
  p.box(0, 0.77, 0, 1.91, 0.16, 4.29, gunmetal);
  // The cab front rakes back above the bumper. Separate slanted windshields,
  // door glazing, mirrors, step irons and marker lights can be seen in profile.
  p.armourBox(0, 1.11, 1.38, 1.74, 0.7, 1.46, 0.115, paint);
  p.armourBox(0, 1.58, 1.28, 1.65, 0.28, 1.1, 0.078, ivory);
  p.face(
    [
      [-0.77, 1.44, 2.125],
      [0.77, 1.44, 2.125],
      [0.73, 1.84, 1.78],
      [-0.73, 1.84, 1.78],
    ],
    '#243d4b',
  );
  p.box(0, 1.85, 1.38, 1.73, 0.1, 0.95, ivory);
  p.box(0, 0.83, 2.17, 1.85, 0.17, 0.17, black);
  p.box(0, 1.14, 2.13, 0.87, 0.32, 0.04, graphite);
  for (let bar = 0; bar < 4; bar++) p.box(0, 1.02 + bar * 0.069, 2.161, 0.81, 0.034, 0.035, steel);
  p.tube([-0.09, 1.44, 2.14], [-0.09, 1.82, 1.8], 0.021, graphite, 4);
  p.tube([0.19, 1.47, 2.126], [0.64, 1.52, 2.073], 0.018, black, 4);
  p.tube([-0.29, 0.76, 2.26], [0.29, 0.76, 2.26], 0.075, steel, 8);
  for (const side of [-1, 1]) {
    const sidemark = (x, y0, y1, z0, z1, cell) => {
      const l = side > 0 ? z1 : z0,
        r = side > 0 ? z0 : z1;
      p.face(
        [
          [side * x, y0, l],
          [side * x, y0, r],
          [side * x, y1, r],
          [side * x, y1, l],
        ],
        '#ffffff',
        cell,
      );
    };
    sidemark(0.875, 0.94, 1.43, 0.8, 1.83, 0);
    p.box(side * 0.849, 1.54, 1.43, 0.034, 0.31, 0.68, '#263f4a');
    p.box(side * 0.86, 1.23, 1.02, 0.046, 0.059, 0.2, graphite);
    p.box(side * 0.91, 0.7, 1.21, 0.24, 0.1, 0.95, steel);
    p.box(side * 0.94, 1.59, 1.87, 0.18, 0.2, 0.12, black);
    p.box(side * 0.89, 0.82, -0.9, 0.19, 0.13, 1.8, gunmetal);
    p.box(side * 0.74, 0.8, 2.26, 0.17, 0.1, 0.11, bronze);
    lamps.box(side * 0.63, 1.03, 2.128, 0.34, 0.16, 0.046, '#ffe0a4');
    lamps.box(side * 0.7, 0.78, -2.185, 0.21, 0.12, 0.044, '#c33222');
    for (const z of [1.38, -0.86, -1.59]) {
      p.turned(
        [0, 0.48, z],
        [side, 0, 0],
        [
          [0.73, 0.265, black],
          [0.745, 0.375, '#283035'],
          [0.792, 0.424, '#292f32'],
          [0.919, 0.434, '#252b2e'],
          [0.958, 0.423, '#32383a'],
          [0.984, 0.385, '#34393a'],
          [0.996, 0.307, black],
          [0.982, 0.24, graphite],
        ],
        28,
      );
      p.turned(
        [0, 0.48, z],
        [side, 0, 0],
        [
          [0.979, 0.253, graphite],
          [0.997, 0.261, '#879199'],
          [1.009, 0.235, steel],
          [0.988, 0.199, gunmetal],
          [0.986, 0.145, '#414d54'],
          [1.026, 0.109, steel],
          [1.038, 0.084, gunmetal],
          [1.039, 0, graphite],
        ],
        24,
      );
      for (let j = 0; j < 6; j++) {
        const a = (j * TAU) / 6;
        p.box(side * 0.999, 0.48 + 0.159 * Math.sin(a), z + 0.159 * Math.cos(a), 0.021, 0.042, 0.042, edge);
      }
    }
    if (kind === 0) sidemark(0.948, 0.897, 1.975, -2.012, 0.436, 1);
    if (kind === 1) sidemark(0.68, 1.3, 1.57, -1.57, -0.26, 2);
    if (kind === 2) sidemark(0.902, 0.904, 1.177, -1.95, -0.25, 4);
  }
  if (kind === 0) {
    p.armourBox(0, 1.41, -0.78, 1.77, 1.2, 2.56, 0.102, ivory);
    p.armourBox(0, 2.08, -0.78, 1.81, 0.15, 2.65, 0.058, gunmetal);
    p.box(0, 2.21, -1.17, 0.88, 0.17, 1.04, steel);
    p.face(
      [
        [0.84, 1.0, -2.071],
        [-0.84, 1.0, -2.071],
        [-0.84, 1.88, -2.071],
        [0.84, 1.88, -2.071],
      ],
      '#ffffff',
      3,
    );
    for (const side of [-1, 1]) {
      p.box(side * 0.891, 1.37, -0.75, 0.035, 0.24, 2.52, '#b77a3e');
      for (const z of [-1.51, -0.82, -0.12]) p.box(side * 0.91, 1.73, z, 0.035, 0.31, 0.48, '#304955');
      p.box(side * 0.925, 1.4, -1.62, 0.05, 0.48, 0.16, ivory);
      p.box(side * 0.925, 1.4, -1.62, 0.05, 0.15, 0.49, ivory);
    }
  } else if (kind === 1) {
    p.turned(
      [0, 1.4, 0],
      [0, 0, 1],
      [
        [-2.13, 0, '#a3aaa7'],
        [-2.1, 0.24, '#9aa4a4'],
        [-2.03, 0.45, '#9aa4a4'],
        [-1.94, 0.58, '#9ba4a0'],
        [-1.84, 0.653, '#9aa39f'],
        [-1.75, 0.683, '#929c99'],
        [0.21, 0.683, '#929c99'],
        [0.32, 0.644, '#959e9b'],
        [0.43, 0.55, '#9aa4a0'],
        [0.51, 0.33, '#87928f'],
        [0.55, 0, steel],
      ],
      36,
    );
    for (const z of [-1.72, -0.69, 0.1])
      p.turned(
        [0, 1.4, z],
        [0, 0, 1],
        [
          [0, 0.678, graphite],
          [0.013, 0.699, steel],
          [0.083, 0.699, '#687781'],
          [0.102, 0.678, graphite],
        ],
        32,
      );
    p.turned(
      [0, 1.4, -2.08],
      [0, 0, -1],
      [
        [0, 0.37, gunmetal],
        [0.052, 0.34, steel],
        [0.074, 0.28, steel],
        [0.087, 0.25, '#778783'],
        [0.084, 0, gunmetal],
      ],
      28,
    );
    p.face(
      [
        [0.18, 1.33, -2.171],
        [-0.18, 1.33, -2.171],
        [-0.18, 1.48, -2.171],
        [0.18, 1.48, -2.171],
      ],
      '#ffffff',
      6,
    );
    for (const x of [-0.42, -0.15]) p.tube([x, 0.99, -2.1], [x, 1.97, -1.93], 0.028, edge, 8);
    for (let i = 0; i < 5; i++) {
      const y = 1.1 + i * 0.17,
        z = -2.082 + i * 0.029;
      p.tube([-0.42, y, z], [-0.15, y, z], 0.025, steel, 8);
    }
    p.box(0, 2.13, -0.62, 0.62, 0.14, 0.78, bronze);
    for (const side of [-1, 1]) {
      p.tube([side * 0.53, 1.86, -1.93], [side * 0.53, 1.86, 0.2], 0.045, steel, 6);
      for (const z of [-1.39, -0.34]) p.tube([side * 0.53, 1.65, z], [side * 0.53, 1.86, z], 0.046, gunmetal, 5);
    }
  } else {
    p.box(0, 1.01, -0.71, 1.78, 0.4, 2.7, paint);
    p.box(-0.49, 1.37, -1.3, 0.69, 0.48, 1.08, gunmetal);
    p.tube([0.29, 1.32, -1.51], [0.29, 2.22, -0.39], 0.19, paint, 6);
    p.tube([0.29, 2.22, -0.39], [0.29, 2.1, 0.65], 0.12, steel, 6);
    p.tube([0.29, 2.1, 0.65], [0.29, 1.68, 0.65], 0.035, black, 5);
  }
  for (const x of [-0.48, 0.48]) {
    p.tube([x, 1.9, 1.32], [x, 1.95, 1.32], 0.11, graphite, 16);
    lamps.tube([x, 1.951, 1.32], [x, 2.042, 1.32], 0.083, '#e99e38', 16);
  }
  return { body: p.geometry(), lamps: lamps.geometry() };
}

function vehicleGlass(count) {
  const panes = new Plates();
  panes.face(
    [
      [-0.752, 1.466, 2.13],
      [0.752, 1.466, 2.13],
      [0.704, 1.827, 1.81],
      [-0.704, 1.827, 1.81],
    ],
    '#ffffff',
  );
  for (const side of [-1, 1]) {
    const corners = [
      [side * 0.849, 1.487, 0.797],
      [side * 0.869, 1.487, 2.016],
      [side * 0.821, 1.805, 1.739],
      [side * 0.816, 1.805, 0.86],
    ];
    panes.face(side > 0 ? corners.toReversed() : corners, '#ffffff');
  }
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x28434e,
    roughness: 0.15,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    ior: 1.5,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'varying vec3 cabUp;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\ncabUp=normalize(mat3(modelViewMatrix*instanceMatrix)*vec3(0.,1.,0.));',
      );
    shader.fragmentShader =
      'varying vec3 cabUp;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\nvec3 reflected=reflect(-normalize(vViewPosition),normal);float horizon=dot(reflected,normalize(cabUp));float fres=pow(1.-abs(dot(normalize(vViewPosition),normal)),3.);vec3 sky=mix(vec3(.021,.040,.052),vec3(.29,.34,.37),exp(-4.*abs(horizon-.12)));gl_FragColor.rgb+=sky*(.38+.82*fres);',
      );
  };
  const mesh = new THREE.InstancedMesh(panes.geometry(), m, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.renderOrder = 2;
  return mesh;
}

function coatFleet(material) {
  material.map = fleetLivery();
  const base = material.onBeforeCompile;
  material.onBeforeCompile = (shader, ...args) => {
    base.call(material, shader, ...args);
    shader.vertexShader =
      'varying vec3 bodyPanel,bodyDirection;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nbodyPanel=position;bodyDirection=normal;',
      );
    shader.fragmentShader = [
      'varying vec3 bodyPanel,bodyDirection;',
      'float plateHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.54);}',
      'float plateNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(plateHash(i),plateHash(i+vec2(1.,0.)),f.x),mix(plateHash(i+vec2(0.,1.)),plateHash(i+vec2(1.)),f.x),f.y);}',
      shader.fragmentShader
        .replace(
          '#include <color_fragment>',
          [
            '#include <color_fragment>',
            'vec3 cp=bodyPanel;vec2 panel=abs(bodyDirection.x)>.55?cp.zy:(abs(bodyDirection.z)>.55?cp.xy:cp.xz);',
            'float darkRubber=1.-smoothstep(.022,.079,max(max(vColor.r,vColor.g),vColor.b));',
            'float grit=plateNoise(panel*vec2(33.,9.));float broad=plateNoise(panel*4.4);',
            'float dirt=(1.-smoothstep(.19,1.28,cp.y))*(.24+.67*broad);',
            'diffuseColor.rgb*=.85+.17*broad+.10*grit;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.115,.10,.077),dirt*(.45-.29*darkRubber));',
            'float scores=smoothstep(.79,.93,plateNoise(panel*vec2(77.,2.6)));diffuseColor.rgb+=scores*.036*(1.-darkRubber);',
          ].join('\n'),
        )
        .replace(
          '#include <roughnessmap_fragment>',
          [
            '#include <roughnessmap_fragment>',
            'float chroma=max(max(vColor.r,vColor.g),vColor.b)-min(min(vColor.r,vColor.g),vColor.b);',
            'float bare=(1.-smoothstep(.023,.12,chroma))*(1.-darkRubber);',
            'roughnessFactor=clamp(.60-.28*bare+.27*darkRubber+.13*(grit-.35)+dirt*.14,.20,.96);',
          ].join('\n'),
        ),
    ].join('\n');
  };
}

export function rescueConvoy(group, shared, placeOnSurface, material) {
  const path = new THREE.Path();
  path.moveTo(-24, 17);
  path.lineTo(24, 17);
  path.absarc(24, 9, 8, Math.PI / 2, 0, true);
  path.lineTo(32, -23);
  path.absarc(24, -23, 8, 0, -Math.PI / 2, true);
  path.lineTo(-24, -31);
  path.absarc(-24, -23, 8, -Math.PI / 2, -Math.PI, true);
  path.lineTo(-32, 9);
  path.absarc(-24, 9, 8, Math.PI, Math.PI / 2, true);
  const length = path.getLength(),
    clock = { value: 0 },
    pos = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  const steer = new THREE.Quaternion(),
    matrix = new THREE.Matrix4(),
    unit = new THREE.Vector3(1, 1, 1),
    sample = new THREE.Vector2(),
    next = new THREE.Vector2();
  const fleet = new THREE.Group();
  fleet.name = 'UEG rescue convoy';
  group.add(fleet);
  const lights = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  lights.onBeforeCompile = (shader) => {
    shader.uniforms.convoyClock = clock;
    shader.vertexShader =
      'varying float beacon;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nbeacon=position.y>1.9 ? 1.+float(gl_InstanceID) : 0.;',
      );
    shader.fragmentShader =
      'varying float beacon;uniform float convoyClock;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\nif(beacon>.5){float t=fract(convoyClock*1.13+beacon*.21);gl_FragColor.rgb*=.15+2.1*(1.-smoothstep(.04,.19,min(abs(t-.20),abs(t-.48))));}',
      );
  };
  const offsets = [
    [0, 16.5, 64, 126, 166],
    [8.2, 72.4, 110.5, 134.2],
    [24.7, 81.0, 118.6, 142.9],
  ];
  const meshes = offsets.map((cars, kind) => {
    const geo = truckGeometry(kind),
      body = new THREE.InstancedMesh(geo.body, material, cars.length),
      lamps = new THREE.InstancedMesh(geo.lamps, lights, cars.length);
    body.frustumCulled = lamps.frustumCulled = false;
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fleet.add(body, lamps);
    return [body, lamps];
  });
  coatFleet(material);
  const glazing = vehicleGlass(offsets.flat().length);
  fleet.add(glazing);
  const pools = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader:
      'varying vec2 q;void main(){q=position.xy;vec3 p=vec3(position.x*5.8,.127,position.y*13.+3.);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.);}',
    fragmentShader: `varying vec2 q;void main(){vec2 p=vec2(q.x*5.8,q.y*13.+3.);
      vec2 box=max(abs(p-vec2(.13,-.17))-vec2(.69,1.63),0.);float chassis=1.-smoothstep(.05,1.04,length(box));
      float axle=min(abs(p.y-1.38),min(abs(p.y+.86),abs(p.y+1.59)));
      float contact=exp(-pow((abs(p.x)-.85)/.27,2.)-pow(axle/.42,2.));
      float penumbra=1.-smoothstep(.15,1.,length((p-vec2(.72,-.56))/vec2(1.72,2.80)));
      float shadow=1.-(1.-.82*chassis)*(1.-.91*contact)*(1.-.42*penumbra);
      float d=p.y-1.88;float cone=(1.-smoothstep(.12,.64+max(0.,d)*.18,abs(abs(p.x)-.64)))*exp(-max(0.,d)*.29)*smoothstep(0.,.48,d);
      gl_FragColor=vec4(mix(vec3(.004,.008,.015),vec3(.98,.74,.40),cone),max(shadow,cone*.31));}`,
  });
  const collective = new THREE.InstancedMesh(new THREE.PlaneGeometry(), pools, offsets.flat().length);
  collective.frustumCulled = false;
  collective.renderOrder = 1;
  collective.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fleet.add(collective);
  return {
    setProximity(value) {
      fleet.visible = value > 0.29;
    },
    update(time) {
      if (!fleet.visible) return;
      clock.value = time;
      let index = 0;
      for (let k = 0; k < meshes.length; k++) {
        const [body, lamps] = meshes[k];
        for (let i = 0; i < offsets[k].length; i++) {
          const along = THREE.MathUtils.euclideanModulo(time * 2.0 + offsets[k][i] - 17, length),
            u = along / length;
          path.getPointAt(u, sample);
          path.getPointAt((u + 0.00024) % 1, next);
          const heading = Math.atan2(next.x - sample.x, next.y - sample.y);
          placeOnSurface(pos.set(sample.x, shared ? 0.225 : -0.15, sample.y), normal, shared);
          rotation.setFromUnitVectors(UP, normal).multiply(steer.setFromAxisAngle(UP, heading));
          matrix.compose(pos, rotation, unit);
          body.setMatrixAt(i, matrix);
          lamps.setMatrixAt(i, matrix);
          glazing.setMatrixAt(index, matrix);
          collective.setMatrixAt(index++, matrix);
        }
        body.instanceMatrix.needsUpdate = lamps.instanceMatrix.needsUpdate = true;
      }
      collective.instanceMatrix.needsUpdate = true;
      glazing.instanceMatrix.needsUpdate = true;
    },
  };
}
