import * as THREE from 'three';
import { buildEngineWorkshop, onRescueRoad, rescueConvoy } from './engine-workshop.js';

const TAU = Math.PI * 2;
const up = new THREE.Vector3(0, 1, 0);
// In shared coordinates this projected tangent patch sits on the existing 2.2-unit Earth.
const PLANET_RADIUS = 2.2 / 0.0023;
function surfaceHeight(x, z, shared) {
  return shared ? Math.sqrt(Math.max(0, PLANET_RADIUS ** 2 - x * x - z * z)) - PLANET_RADIUS : 0;
}
function placeOnSurface(point, normal, shared) {
  const { x, y, z } = point,
    ground = surfaceHeight(x, z, shared);
  if (!shared) {
    normal.copy(up);
    return point;
  }
  normal.set(x, PLANET_RADIUS + ground, z).normalize();
  return point.set(x, ground, z).addScaledVector(normal, y);
}

function cameraInLocalSpace(mesh, eye) {
  mesh.onBeforeRender = (renderer, scene, camera) => {
    eye.value.setFromMatrixPosition(camera.matrixWorld);
    mesh.worldToLocal(eye.value);
  };
}

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function hullFinish() {
  const size = 512;
  const random = seededRandom(35149);
  function plate() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx, image: ctx.createImageData(size, size) };
  }
  const pigment = plate(), relief = plate(), wear = plate();
  const drips = Array.from({ length: size }, () => random() ** 8);
  const oxidation = new Float32Array(64);
  for (let i = 0; i < oxidation.length; i++) oxidation[i] = random();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Lapped panels, water paths, rough heat staining and tiny pits are
      // independent channels so an oxidized patch does not turn into a dent.
      const row = y >> 6;
      const column = ((x + (row % 2) * 32) & 511) >> 6;
      const seamX = (x + (row % 2) * 32) & 63;
      const seamY = y & 63;
      const edge = seamX < 2 || seamY < 2;
      const overlap = seamX === 2 || seamY === 2;
      const grain = random();
      const runoff = drips[x] * Math.exp(-seamY / 33);
      const patch = oxidation[row * 8 + column];
      const oxide = runoff * (.52 + .48 * patch) + Math.max(0, patch - .78) * 1.3;
      const pit = grain > .984 ? 12 : 0;
      const n = 4 * (y * size + x);
      const value = 191 + 32 * patch + (grain - .5) * 21 - 60 * oxide - 39 * edge + 21 * overlap - pit;
      pigment.image.data.set([value + oxide * 8, value - oxide * 6, value - oxide * 16, 255], n);
      const height = 147 + (grain - .5) * 11 - 40 * edge + 18 * overlap - pit * 1.4;
      relief.image.data.set([height, height, height, 255], n);
      const roughness = 180 + 39 * oxide + 14 * (grain - .5) + 10 * edge - 37 * overlap;
      wear.image.data.set([roughness, roughness, roughness, 255], n);
    }
  }
  function texture(layer) {
    layer.ctx.putImageData(layer.image, 0, 0);
    const map = new THREE.CanvasTexture(layer.canvas);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(2, 1.5);
    map.anisotropy = 4;
    return map;
  }
  const map = texture(pigment);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bumpMap: texture(relief), roughnessMap: texture(wear) };
}

function beveledPanel() {
  const outline = new THREE.Shape();
  outline.moveTo(-.5, -.4);
  for (const [x, y] of [[-.4,-.5],[.4,-.5],[.5,-.4],[.5,.4],[.4,.5],[-.4,.5],[-.5,.4]])
    outline.lineTo(x, y);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: .7, bevelEnabled: true, bevelSize: .065, bevelThickness: .15, bevelSegments: 1, curveSegments: 1,
  });
  return geometry.translate(0, 0, -.35);
}

// Group all fixed machine parts of one shape and finish into an instanced draw.
function fabricator(group, shared) {
  const objects = new Map();
  const geometry = new Map();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const segment = new THREE.Vector3();
  const radial = new THREE.Vector3(),
    bend = new THREE.Quaternion();
  const levels = [];
  let detail = 0,
    activeLevel = -1;
  function add(key, makeGeometry, material, tint) {
    if (shared) {
      placeOnSurface(position, radial, true);
      rotation.premultiply(bend.setFromUnitVectors(up, radial));
    }
    if (!geometry.has(key)) geometry.set(key, makeGeometry());
    const batchKey = key + material.uuid;
    if (!objects.has(batchKey))
      objects.set(batchKey, { geo: geometry.get(key), material, transforms: [], colors: [], detail: [] });
    const batch = objects.get(batchKey);
    batch.transforms.push(new THREE.Matrix4().compose(position, rotation, scale));
    batch.colors.push(tint || '#ffffff');
    batch.detail.push(detail);
  }
  return {
    detail(value) {
      detail = value;
    },
    box(x, y, z, w, h, d, material, angle = 0, tint) {
      position.set(x, y, z);
      rotation.setFromEuler(euler.set(0, angle, 0));
      scale.set(w, h, d);
      add('box', () => new THREE.BoxGeometry(), material, tint);
    },
    panel(x, y, z, w, h, d, material, angle, tilt = 0, tint) {
      position.set(x, y, z);
      rotation.setFromEuler(euler.set(tilt, angle, 0, 'YXZ'));
      scale.set(w, h, d);
      add('panel', beveledPanel, material, tint);
    },
    shell(x, y, z, top, bottom, height, material, sides = 48, tint) {
      const ratio = Math.round((top / bottom) * 1000) / 1000;
      position.set(x, y, z);
      rotation.identity();
      scale.set(bottom, height, bottom);
      add('cone' + sides + '_' + ratio, () => new THREE.CylinderGeometry(ratio, 1, 1, sides), material, tint);
    },
    spar(a, b, r, material, sides = 5) {
      segment.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      position.set((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
      scale.set(r, segment.length(), r);
      rotation.setFromUnitVectors(up, segment.normalize());
      // Structural tubes meet gussets, elbows, brackets or other tubes at their
      // ends. Interior caps would be hidden in most of the several thousand joints.
      add('spar' + sides, () => new THREE.CylinderGeometry(1, 1, 1, sides, 1, true), material);
    },
    flush() {
      for (const batch of objects.values()) {
        const mesh = new THREE.InstancedMesh(batch.geo, batch.material, batch.transforms.length);
        const order = batch.transforms.map((_, i) => i).sort((a, b) => batch.detail[a] - batch.detail[b]);
        const counts = [0, 0, 0];
        order.forEach((j, i) => {
          mesh.setMatrixAt(i, batch.transforms[j]);
          mesh.setColorAt(i, new THREE.Color(batch.colors[j]));
          for (let level = batch.detail[j]; level < 3; level++) counts[level]++;
        });
        mesh.computeBoundingSphere();
        group.add(mesh);
        levels.push({ mesh, counts });
      }
    },
    proximity(value) {
      const next = value < 0.075 ? 0 : value < 0.26 ? 1 : 2;
      if (next === activeLevel) return;
      activeLevel = next;
      for (const { mesh, counts } of levels) {
        mesh.count = counts[next];
        mesh.visible = mesh.count > 0;
      }
    },
  };
}

const noiseGLSL = [
  'float hash21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
  'float noise21(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);',
  ' return mix(mix(hash21(i),hash21(i+vec2(1.,0.)),f.x),mix(hash21(i+vec2(0.,1.)),hash21(i+1.),f.x),f.y); }',
].join('\n');

function atmosphere(group, uniforms, shared) {
  const eye = { value: new THREE.Vector3() };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(438, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      uniforms: { ...uniforms, localEye: eye, sharedSky: { value: shared ? 1 : 0 } },
      transparent: shared,
      vertexShader:
        'uniform vec3 localEye;varying vec3 direction;void main(){direction=position-localEye;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: [
        'varying vec3 direction;uniform float proximity,ignition,sharedSky,weatherTime;',
        noiseGLSL,
        'void main(){vec3 d=normalize(direction);float h=max(d.y,0.);',
        'vec3 sun=normalize(vec3(-.77,.068,-.63));float sd=max(dot(sun,d),0.);',
        'vec3 sky=mix(vec3(.024,.056,.092),vec3(.003,.009,.029),smoothstep(.02,.79,h));',
        'float aerosol=exp(-h*8.0);float fire=pow(sd,6.);',
        'sky+=aerosol*mix(vec3(.10,.123,.15),vec3(.86,.32,.104),.12+.88*fire);',
        'sky+=vec3(1.,.52,.20)*(pow(sd,90.)*.33+pow(sd,780.)*.85);',
        'float disc=smoothstep(.99965,.99987,sd);sky+=vec3(3.8,2.5,1.25)*disc;',
        'vec2 cloudUv=d.xz/max(h+.085,.095)+vec2(weatherTime*.008,weatherTime*.004);',
        'float w=noise21(cloudUv*vec2(1.1,2.4))+noise21(cloudUv*vec2(4.,7.))*.25;',
        'float cloud=smoothstep(.48,.99,w)*smoothstep(.0,.07,h)*(1.-smoothstep(.17,.49,h));',
        'sky=mix(sky,vec3(.18,.195,.22)+vec3(.32,.125,.03)*fire,cloud*.32);',
        'vec2 sp=vec2(atan(d.x,d.z)*310.,asin(d.y)*330.);vec2 sk=floor(sp);',
        'float star=step(.994,hash21(sk))*exp(-dot(fract(sp)-.5,fract(sp)-.5)*30.);',
        'sky+=star*smoothstep(.09,.46,h)*vec3(.24,.32,.43)*(1.-sharedSky);',
        'float exhaust=smoothstep(.12,.90,ignition);sky+=vec3(.018,.033,.074)*exhaust*exp(-h*3.8);',
        'float air=smoothstep(.56,.99,proximity)*mix(.94,.15,smoothstep(.07,.77,h));',
        'gl_FragColor=vec4(sky,mix(1.,air,sharedSky));',
        '#include <tonemapping_fragment>',
        '#include <colorspace_fragment>',
        '}',
      ].join('\n'),
    }),
  );
  sky.renderOrder = -30;
  cameraInLocalSpace(sky, eye);
  group.add(sky);
  return sky;
}

// All static contact and directional shadows share a single ground lookup.
function groundShadows() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.translate(512, 512);
  ctx.scale(1024 / 384, 1024 / 384);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  const contacts = document.createElement('canvas');
  contacts.width = contacts.height = 512;
  const near = contacts.getContext('2d');
  near.translate(256, 256);
  near.scale(512 / 96, 512 / 96);
  const contactMap = new THREE.CanvasTexture(contacts);
  contactMap.flipY = false;
  const spill = document.createElement('canvas');
  spill.width = 512;
  spill.height = 512;
  const blue = spill.getContext('2d');
  blue.translate(256, 256);
  blue.scale(512 / 384, 512 / 384);
  const spillMap = new THREE.CanvasTexture(spill);
  spillMap.flipY = false;
  function oval(x, z, rx, rz, angle, center, edge, paint = ctx) {
    paint.save();
    paint.translate(x, z);
    paint.rotate(angle);
    paint.scale(rx, rz);
    const grad = paint.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, 'rgba(0,0,0,' + center + ')');
    grad.addColorStop(0.67, 'rgba(0,0,0,' + edge + ')');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    paint.fillStyle = grad;
    paint.fillRect(-1, -1, 2, 2);
    paint.restore();
  }
  return {
    texture,
    spillMap,
    contactMap,
    tower(x, z, s) {
      oval(x + 12 * s, z + 8 * s, 35 * s, 11.6 * s, 0.59, 0.54, 0.36);
      oval(x + 2 * s, z + 1.3 * s, 18 * s, 15.2 * s, 0.59, 0.99, 0.84);
      oval(x, z, 41 * s, 37 * s, 0, 0.98, 0.23, blue);
    },
    block(x, z, w, d, h, a) {
      oval(x + h * 0.8, z + h * 0.5, w * 0.75 + h * 0.72, d * 0.73 + h * 0.48, -a, 0.84, 0.57);
    },
    contact(x, z, w, d, a) {
      oval(x, z, w, d, -a, 0.94, 0.60, near);
    },
  };
}

const firingGLSL =
  'float firing(vec2 location,float ignition){float delay=.105+.54*clamp(length(location)/150.,0.,1.);return smoothstep(delay,delay+.33,ignition);}';

function applyHaze(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.proximity = uniforms.proximity;
    shader.uniforms.ignition = uniforms.ignition;
    shader.vertexShader =
      'varying float hazeRange;varying vec3 installationP;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        [
          '#include <project_vertex>',
          'hazeRange=length(mvPosition.xyz)/max(length(modelMatrix[0].xyz),.000001);',
          '#ifdef USE_INSTANCING',
          'installationP=(instanceMatrix*vec4(transformed,1.)).xyz;',
          '#else',
          'installationP=transformed;',
          '#endif',
        ].join('\n'),
      );
    shader.fragmentShader =
      'uniform float proximity,ignition;varying float hazeRange;varying vec3 installationP;\n' +
      firingGLSL +
      '\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        [
          '#include <opaque_fragment>',
          'float air=(1.-exp(-pow(hazeRange*.0062,2.)))*proximity;',
          'float power=firing(installationP.xz,ignition);',
          'float localGlow=exp(-dot(installationP.xz,installationP.xz)*.0013)*smoothstep(1.,24.,installationP.y);',
          'float y=installationP.y;float canopy=max(exp(-pow((y-8.30)/.48,2.)),exp(-pow((y-11.53)/.42,2.)));',
          'canopy=max(canopy,max(exp(-pow((y-17.15)/.42,2.)),exp(-pow((y-19.36)/.46,2.))));',
          'float recess=(1.-smoothstep(6.3,8.96,length(installationP.xz)))*canopy;gl_FragColor.rgb*=1.-.34*recess;',
          'gl_FragColor.rgb+=vec3(.005,.018,.048)*power*localGlow;',
          'gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.105,.121,.147)+power*vec3(.018,.029,.063),air*.62);',
        ].join('\n'),
      );
  };
  return material;
}

function landscape(group, random, groundMaps, uniforms, shared) {
  const ground = new THREE.RingGeometry(0, 350, 96, 32);
  ground.rotateX(-Math.PI / 2);
  const points = ground.attributes.position;
  for (let i = 0; i < points.count; i++) points.setY(i, surfaceHeight(points.getX(i), points.getZ(i), shared));
  points.needsUpdate = true;
  const groundMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      groundOcclusion: { value: groundMaps.texture },
      contactMap: { value: groundMaps.contactMap },
      spillMap: { value: groundMaps.spillMap },
    },
    transparent: shared,
    depthWrite: !shared,
    vertexShader:
      'varying vec3 p;void main(){p=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: [
      'varying vec3 p;uniform sampler2D groundOcclusion,contactMap,spillMap;uniform float ignition,proximity,weatherTime;',
      noiseGLSL,
      firingGLSL,
      'void main(){vec2 g=p.xz;float rocks=noise21(g*.24)+.48*noise21(g*.61)+.15*noise21(g*2.2);',
      'float dune=noise21(vec2(g.x*.055+g.y*.015,g.y*.25));float snow=smoothstep(.57,1.08,rocks*.56+dune*.65);',
      'float apron=smoothstep(17.,29.,length(g));float track=abs(g.x+g.y*.06-14.);',
      'float rib=noise21(vec2(g.x*.55,g.y*2.1))-.5;vec3 iron=mix(vec3(.021,.031,.043),vec3(.074,.093,.103),rocks*.55);',
      'float grain=noise21(g*4.3)*.05+noise21(vec2(g.x*.9+g.y*.16,g.y*4.1))*.035;',
      'vec3 ice=mix(vec3(.075,.104,.123),vec3(.24,.295,.32),snow)+rib*.024+grain;',
      'vec3 col=mix(iron,ice,apron*(.53+.40*smoothstep(1.,4.,track)));',
      'vec2 q=abs(g+vec2(0.,7.))-vec2(24.,16.);float lane=length(max(q,0.))+min(max(q.x,q.y),0.)-8.;',
      'float roadway=1.-smoothstep(2.27,2.74,abs(lane)+.16*noise21(g*2.));',
      'float rubber=1.-smoothstep(.10,.47,abs(abs(lane)-.75));vec3 road=mix(vec3(.043,.061,.074),vec3(.087,.105,.112),rocks*.45);',
      'road*=1.-.22*rubber;float edge=1.-smoothstep(.017,.083,abs(abs(lane)-2.20));',
      'float dash=(1.-smoothstep(.04,.10,abs(lane-1.72)))*step(.51,fract((g.x+g.y)*.22));',
      'road=mix(road,vec3(.41,.34,.20),(edge*.60+dash*.69)*smoothstep(.17,.48,rocks));col=mix(col,road,roadway);',
      'float occlusion=texture2D(groundOcclusion,g/384.+.5).a;',
      'float contact=texture2D(contactMap,g/96.+.5).a; col*=mix(vec3(1.0),vec3(.14,.20,.30),max(occlusion,.96*contact));',
      'float horizon=smoothstep(45.,210.,length(g));col=mix(col,vec3(.155,.175,.193),horizon*.64);',
      'float grooves=(1.-smoothstep(.03,.12,abs(track-2.7)))*(1.-horizon);col*=1.-.26*grooves;',
      'float alpha=(1.-smoothstep(211.,338.,length(g)+(noise21(g*.025)-.5)*36.))*smoothstep(.08,.74,proximity);',
      'if(alpha<.004)discard;float spill=texture2D(spillMap,g/384.+.5).a*firing(g,ignition);',
      'col+=vec3(.017,.054,.146)*spill*(.55+.43*grain)*(1.-.40*occlusion);',
      'float wet=(1.-smoothstep(.22,1.85,track))*smoothstep(.08,.83,rocks);col+=vec3(.012,.026,.052)*wet*spill;',
      'float drift=noise21(vec2(g.x*.055-weatherTime*.10,g.y*.71+g.x*.13));',
      'col+=vec3(.023,.030,.038)*smoothstep(.67,.95,drift)*(1.-roadway*.67)*proximity;',
      'gl_FragColor=vec4(col,alpha);',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const floor = new THREE.Mesh(ground, groundMaterial);
  floor.position.y = shared ? 0.27 : -0.12;
  floor.renderOrder = shared ? -0.5 : 0;
  group.add(floor);
  const ranges = [];
  // Broken chains follow the curvature instead of defining a circular perimeter.
  for (let layer = 0; layer < 3; layer++) {
    const radius = [312, 239, 178][layer],
      segments = 480;
    const positions = [],
      colors = [],
      index = [];
    const ridge = [];
    for (let i = 0; i < segments; i++) {
      const a = (i * TAU) / segments;
      const crest = Math.pow(0.5 + 0.5 * Math.sin(7 * a + layer * 1.9 + 1.4 * Math.sin(3 * a)), 2);
      const tooth = 0.5 + 0.5 * Math.cos(15 * a + 2.1 * Math.cos(a * 6 + layer));
      const fissures =
        Math.abs(Math.sin(24 * a + 2.8 * Math.cos(11 * a))) * 2.4 +
        Math.abs(Math.sin(56 * a + 4 * Math.sin(13 * a))) * 1.6;
      const height = 3.5 + crest * (layer === 2 ? 13 : 26) + tooth * 5 + fissures + random() * 0.91;
      ridge.push(height);
    }
    const rock = new THREE.Color(['#756e72', '#474d5a', '#293746'][layer]);
    const snow = new THREE.Color(['#b1a7a0', '#9e9da4', '#6c7683'][layer]);
    const rows = 12;
    for (let k = 0; k < rows; k++) {
      const p = k / (rows - 1);
      const shape = Math.max(0, 1 - Math.abs(p - 0.68) / 0.68);
      for (let i = 0; i < segments; i++) {
        const a = (i * TAU) / segments;
        const couloir = 0.5 + 0.5 * Math.sin(37 * a + 2.2 * Math.sin(11 * a) + p * 2.4);
        const radial =
          radius -
          21 +
          48 * p +
          2.1 * Math.sin(11 * a + p * 3.2) +
          couloir * 2.5 +
          16 * Math.sin(3 * a + layer * 0.89) +
          8 * Math.sin(7 * a + 0.27 * layer);
        const outcrop = THREE.MathUtils.smoothstep(
          Math.sin(3 * a + 0.5 * layer) + 0.63 * Math.cos(5 * a + layer),
          -1.15,
          0.24,
        );
        const xx = Math.sin(a) * radial,
          zz = Math.cos(a) * radial;
        positions.push(
          xx,
          surfaceHeight(xx, zz, shared) - 1.6 + (ridge[i] * 1.34 + couloir * 1.5) * shape * outcrop + random() * 0.49,
          zz,
        );
        const patch = (0.32 + 0.32 * Math.sin(13 * a + 2 * Math.cos(a * 7) + p * 1.4) + 0.38 * couloir) * shape;
        const c = rock
          .clone()
          .lerp(snow, 0.16 + 0.75 * patch)
          .multiplyScalar(0.93 + 0.12 * random());
        colors.push(c.r, c.g, c.b);
        if (k < rows - 1) {
          const v = k * segments + i,
            n = k * segments + ((i + 1) % segments);
          index.push(v, n, v + segments, n, n + segments, v + segments);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mountain = new THREE.Mesh(
      geo,
      applyHaze(
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          roughness: 1,
          flatShading: true,
          transparent: shared,
          depthWrite: !shared,
        }),
        uniforms,
      ),
    );
    mountain.renderOrder = shared ? -0.25 : 0;
    group.add(mountain);
    ranges.push(mountain);
  }
  return { floor, ranges };
}

function makePlumes(group, vents, uniforms, shared) {
  const positions = [],
    uv = [],
    sizes = [],
    indices = [],
    axes = [],
    delays = [];
  // Strip center positions are repeated. The vertex shader turns each exhaust volume to the viewer.
  for (const v of vents) {
    const start = positions.length / 3;
    const direction = new THREE.Vector3(),
      origin = new THREE.Vector3(v.x, v.y, v.z);
    placeOnSurface(origin, direction, shared);
    for (let y = 0; y <= 40; y++) {
      for (let x = 0; x < 2; x++) {
        positions.push(origin.x, origin.y, origin.z);
        axes.push(direction.x, direction.y, direction.z);
        delays.push(0.105 + 0.54 * Math.min(1, Math.hypot(v.x, v.z) / 150));
        uv.push(x, y / 40);
        sizes.push(v.radius, v.height, v.seed);
      }
      if (y < 40) {
        const i = start + y * 2;
        indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('vent', new THREE.Float32BufferAttribute(sizes, 3));
  geo.setAttribute('axis', new THREE.Float32BufferAttribute(axes, 3));
  geo.setAttribute('delay', new THREE.Float32BufferAttribute(delays, 1));
  geo.setIndex(indices);
  const eye = { value: new THREE.Vector3() };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, time: { value: 0 }, localEye: eye },
    side: THREE.DoubleSide,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    vertexShader: [
      'attribute vec3 vent,axis;attribute float delay;varying vec2 t;varying float phase,power;uniform float time,ignition;uniform vec3 localEye;',
      'void main(){t=uv;phase=vent.z;vec3 base=position;power=smoothstep(delay,delay+.33,ignition);',
      'vec3 right=normalize(cross(axis,localEye-base)+vec3(.000001,0.,.000001));',
      'float h=uv.y;float spread=1.+1.45*h+(.24*sin(h*18.-time*2.+phase)+.19*sin(h*36.-time*3.8))*h;',
      'vec3 p=base+axis*(h*vent.y*mix(.012,1.,pow(power,.63)));',
      'float curl=vent.x*h*h*(.53*sin(h*9.-time*.72+phase)+.25*sin(h*19.-time*2.+phase));',
      'p+=right*((uv.x-.5)*2.*vent.x*spread*mix(.30,1.,power)+curl);',
      'gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
    ].join('\n'),
    fragmentShader: [
      'uniform float time;varying vec2 t;varying float phase,power;',
      noiseGLSL,
      'void main(){',
      '  float x=(t.x-.5)*2., h=t.y;',
      '  float shear=noise21(vec2(x*3.+phase,h*9.-time*2.9));',
      '  float roll=sin(h*18.-time*4.+phase)+.44*sin(h*32.-time*4.9);',
      '  float center=(shear-.5)*(.14+.68*h)+roll*h*.13;',
      '  float radius=max(.095,(.30+.31*h)*(.68+.70*shear));',
      '  float r=(x-center)/radius;',
      '  float flow=noise21(vec2(r*4.1+phase+shear*2.,h*27.-time*6.1));',
      '  float folds=noise21(vec2(r*9.+phase+flow*2.1,h*49.-time*8.7));',
      '  float volume=exp(-r*r*1.4)*(1.-smoothstep(.74,1.,abs(x)));',
      '  float fade=1.-smoothstep(.47+.14*shear,.995,h);',
      '  float wisps=volume*fade*smoothstep(.18,.92,flow*.61+folds*.39);',
      '  float core=exp(-r*r*3.1-h*6.3)*(.5+.5*flow);',
      '  float throat=exp(-r*r*6.-h*30.);',
      '  float cell=.58+.42*cos(h*153.-time*1.4+flow*3.1);',
      '  float diamonds=core*pow(cell,3.)*exp(-h*12.);',
      '  vec3 glow=mix(vec3(.095,.22,.78),vec3(.35,.62,1.48),shear);',
      '  vec3 color=glow*wisps*.88+vec3(.48,1.05,2.21)*core*.8;',
      '  color+=vec3(2.3,2.55,2.4)*throat+vec3(.53,.61,1.04)*diamonds;',
      '  gl_FragColor=vec4(color*power,1.);',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  cameraInLocalSpace(mesh, eye);
  group.add(mesh);
  return mat;
}

function makeLights(group, lights, shared) {
  const geometry = new THREE.BufferGeometry(),
    p = [],
    c = [],
    s = [];
  const lightAt = new THREE.Vector3(),
    normal = new THREE.Vector3();
  for (const item of lights) {
    placeOnSurface(lightAt.set(item[0], item[1], item[2]), normal, shared);
    p.push(lightAt.x, lightAt.y, lightAt.z);
    const color = new THREE.Color(item[3]);
    c.push(color.r, color.g, color.b);
    s.push(item[4]);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  geometry.setAttribute('diameter', new THREE.Float32BufferAttribute(s, 1));
  const mat = new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader:
      'attribute float diameter;varying vec3 tint;void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;float apparent=diameter*795.*length(modelMatrix[0].xyz)/max(.00001,-p.z);gl_PointSize=clamp(apparent,1.,38.);tint=color*smoothstep(.18,1.1,apparent);}',
    fragmentShader: [
      'varying vec3 tint;',
      'void main(){vec2 v=2.*gl_PointCoord-1.;float r=dot(v,v);if(r>1.)discard;',
      'float glow=exp(-r*5.5)*.37+exp(-r*65.)*1.7;',
      'gl_FragColor=vec4(tint*glow,1.);',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Points(geometry, mat);
  mesh.renderOrder = 5;
  group.add(mesh);
}

function exhaustMist(group, vents, uniforms, shared) {
  const p = [],
    t = [],
    data = [],
    axis = [],
    indices = [];
  const base = new THREE.Vector3(),
    normal = new THREE.Vector3();
  for (const v of vents) {
    const first = p.length / 3;
    placeOnSurface(base.set(v.x, v.y * 0.22, v.z), normal, shared);
    for (const corner of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      p.push(base.x, base.y, base.z);
      axis.push(normal.x, normal.y, normal.z);
      t.push(...corner);
      data.push(v.radius, v.seed, 0.105 + 0.54 * Math.min(1, Math.hypot(v.x, v.z) / 150));
    }
    indices.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(t, 2));
  geometry.setAttribute('cloud', new THREE.Float32BufferAttribute(data, 3));
  geometry.setAttribute('axis', new THREE.Float32BufferAttribute(axis, 3));
  const eye = { value: new THREE.Vector3() },
    time = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, localEye: eye, time },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: [
      'attribute vec3 cloud,axis;uniform vec3 localEye;uniform float ignition;varying vec2 q;varying float phase,power;',
      'void main(){q=uv;phase=cloud.y;power=smoothstep(cloud.z,cloud.z+.33,ignition);',
      'vec3 right=normalize(cross(axis,localEye-position)+vec3(.00001,0.,.00001));',
      'vec3 v=position+right*uv.x*cloud.x*6.+axis*uv.y*cloud.x*2.85;gl_Position=projectionMatrix*modelViewMatrix*vec4(v,1.);}',
    ].join('\n'),
    fragmentShader: [
      'varying vec2 q;varying float phase,power;uniform float time,proximity;',
      noiseGLSL,
      'void main(){float d=dot(q,q);float w=noise21(vec2(q.x*2.7-time*.105+phase,q.y*3.4+phase));',
      'float wisps=noise21(vec2(q.x*7.6-time*.22+phase,q.y*9.+1.7*w+phase));',
      'float veil=(1.-smoothstep(.05,1.0,d))*(.10+.85*w)*(.42+.68*wisps)*smoothstep(-.91,-.38,q.y);',
      'gl_FragColor=vec4(mix(vec3(.24,.20,.19),vec3(.29,.46,.79),power),veil*(.043+.13*power)*smoothstep(.46,.94,proximity));',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const vapor = new THREE.Mesh(geometry, material);
  vapor.frustumCulled = false;
  vapor.renderOrder = 4;
  cameraInLocalSpace(vapor, eye);
  group.add(vapor);
  return { vapor, time };
}

function coolingVents(group, uniforms, shared) {
  const vertices = [],
    uvs = [],
    profiles = [],
    indices = [];
  const origin = new THREE.Vector3(),
    radial = new THREE.Vector3();
  const sources = [
    [-13, 10, 2.1, 5.8, 1.05],
    [18, 8.6, 1.75, 4.9, 1.23],
    [-41, -30, 2.8, 8.2, 1.54],
    [34, -45, 1.7, 6.4, 1.17],
  ];
  for (const [x, z, y, w, h] of sources) {
    const i = vertices.length / 3;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      placeOnSurface(origin.set(x, y, z), radial, shared);
      vertices.push(...origin.toArray());
      uvs.push(u, v);
      profiles.push(w, h, x * 0.37);
    }
    indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('profile', new THREE.Float32BufferAttribute(profiles, 3));
  const eye = { value: new THREE.Vector3() };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, localEye: eye },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: [
      'uniform vec3 localEye;attribute vec3 profile;varying vec2 q;varying float seed;',
      'void main(){q=uv;seed=profile.z;vec3 breeze=normalize(vec3(-.88,.025,.48));',
      'vec3 view=normalize(localEye-position);vec3 side=normalize(cross(view,breeze)+vec3(.0001));',
      'vec3 point=position+breeze*uv.x*profile.x+vec3(0.,pow(uv.x,.7)*profile.y,0.)+side*(uv.y-.5)*(.12+uv.x*1.2)*profile.y;',
      'gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.);}',
    ].join('\n'),
    fragmentShader: [
      'uniform float proximity,weatherTime,ignition;varying vec2 q;varying float seed;',
      noiseGLSL,
      'void main(){vec2 drift=vec2(4.2*q.x-weatherTime*.65+seed,q.y*2.4);float n=noise21(drift);',
      'float curls=.58*n+.42*noise21(drift*2.7+n);float crosswind=(q.y-.50+sin(q.x*9.-weatherTime*.48+seed)*.09)*2.;',
      'float edge=1.-smoothstep(.16,1.,abs(crosswind));float fade=smoothstep(.0,.065,q.x)*(1.-smoothstep(.38,1.,q.x));',
      'float a=edge*fade*smoothstep(.10,.76,curls)*smoothstep(.42,.93,proximity);',
      'gl_FragColor=vec4(mix(vec3(.32,.33,.32),vec3(.40,.47,.55),ignition),a*.35);',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  cameraInLocalSpace(mesh, eye);
  group.add(mesh);
  return mesh;
}

function nozzleMaterial(color, uniforms) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.ignition = uniforms.ignition;
    shader.vertexShader =
      'varying vec2 nozzleSite;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nnozzleSite=instanceMatrix[3].xz;',
      );
    shader.fragmentShader =
      'uniform float ignition;varying vec2 nozzleSite;\n' +
      firingGLSL +
      '\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\ngl_FragColor.rgb=mix(vec3(.027,.04,.056),gl_FragColor.rgb,firing(nozzleSite,ignition));',
      );
  };
  return m;
}

function plaque(group) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 192;
  const c = cv.getContext('2d');
  c.fillStyle = '#26323c';
  c.fillRect(0, 0, 512, 192);
  c.fillStyle = '#a2acb1';
  c.fillRect(18, 16, 476, 3);
  c.fillRect(18, 175, 476, 2);
  c.font = 'bold 90px monospace';
  c.fillText('CN-07', 19, 113);
  c.font = 'bold 25px monospace';
  c.fillStyle = '#d6a15f';
  c.fillText('PLANETARY PROPULSION', 22, 151);
  for (let i = 0; i < 6; i++) {
    c.fillStyle = i % 2 ? '#dac18c' : '#17202a';
    c.fillRect(424 + i * 9, 36, 7, 30);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.85, 1.82),
    new THREE.MeshStandardMaterial({ map, roughness: 0.87, metalness: 0.12 }),
  );
  mesh.rotation.y = 0.49;
  mesh.position.set(6.72 * Math.sin(0.49), 15.0, 6.72 * Math.cos(0.49));
  group.add(mesh);
}

function reliefPost(group, batch, ground, glow, materials, shared) {
  const { charcoal, gunmetal, slate, pale, trim, steel, amber, white, dark, oxidized } = materials;
  const x = 20.3,
    z = 7.2;
  // The field command module is raised on piles, with a separate decontamination
  // canopy that faces the incoming column. Ground crews work in this pool of light.
  const part = (dx, y, dz, w, h, d, mat) => batch.box(x + dx, y, z + dz, w, h, d, mat);
  part(0, 0.36, 0, 7.75, 0.52, 3.95, charcoal);
  part(0, 1.47, 0, 7.41, 1.92, 3.64, pale);
  part(0, 2.48, 0, 7.79, 0.18, 3.98, slate);
  part(1.75, 2.76, -0.35, 2.68, 0.42, 1.37, gunmetal);
  for (const dx of [-3.64, -1.77, 0.28, 3.64]) part(dx, 1.45, 1.85, 0.11, 1.96, 0.15, gunmetal);
  part(-1.8, 1.61, 1.86, 3.09, 0.67, 0.08, dark);
  for (const dx of [-3.26, -2.34, -1.43, -0.49]) part(dx, 1.61, 1.94, 0.075, 0.72, 0.08, steel);
  part(2.75, 1.43, 1.85, 0.99, 1.8, 0.13, gunmetal);
  part(2.75, 1.75, 1.94, 0.72, 0.5, 0.04, white);
  part(0, 2.6, 2.7, 8.33, 0.16, 2.05, steel);
  for (const dx of [-3.94, 3.94]) {
    part(dx, 1.4, 3.55, 0.15, 2.36, 0.15, steel);
    part(dx, 0.55, 3.55, 0.23, 0.43, 0.23, oxidized);
    batch.spar([x + dx, 2.01, z + 3.55], [x + dx, 2.53, z + 2.88], 0.08, trim, 5);
    part(dx * 0.78, 2.5, 2.82, 0.65, 0.09, 0.28, white);
    glow(x + dx * 0.78, 2.42, z + 2.82, '#ffe2b3', 0.53);
  }
  ground.block(x, z, 7.79, 3.95, 2.6, 0);
  const cv = document.createElement('canvas');
  cv.width = 768;
  cv.height = 132;
  const c = cv.getContext('2d');
  c.fillStyle = '#3d4444';
  c.fillRect(0, 0, 768, 132);
  c.fillStyle = '#d6ad6f';
  c.fillRect(0, 0, 20, 132);
  c.fillStyle = '#f2e9c8';
  c.font = 'bold 48px "Microsoft YaHei",sans-serif';
  c.fillText('联合救援调度', 34, 62);
  c.font = 'bold 27px monospace';
  c.fillText('RESCUE CONTROL  /  07', 36, 106);
  c.fillStyle = '#d9a35f';
  c.fillRect(617, 31, 112, 68);
  c.fillStyle = '#353a3c';
  c.font = 'bold 44px monospace';
  c.fillText('R-7', 632, 81);
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(6.92, 1.17),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.84, metalness: 0.12 }),
  );
  const normal = new THREE.Vector3();
  placeOnSurface(sign.position.set(x, 3.13, z + 3.57), normal, shared);
  sign.quaternion.setFromUnitVectors(up, normal);
  group.add(sign);
  for (const dx of [-3.16, 3.16]) part(dx, 2.79, 3.51, 0.11, 0.79, 0.11, steel);
  // Fold-out work lamps, spare gas cylinders and weather-sealed supply pallets.
  for (const dx of [-2.58, -1.95, -1.32]) {
    batch.shell(x + dx, 0.91, z + 2.5, 0.23, 0.25, 0.99, oxidized, 8);
    part(dx, 1.43, 2.5, 0.17, 0.17, 0.15, dark);
  }
  part(0.65, 0.65, 2.83, 1.2, 0.48, 0.77, gunmetal);
  part(0.65, 0.95, 2.83, 1.27, 0.1, 0.81, slate);
  part(0.31, 0.72, 3.222, 0.11, 0.24, 0.028, amber);
  return sign;
}

function freightYard(batch, ground, glow, materials) {
  const { steel, slate, trim, bronze, white, amber, black, gunmetal } = materials;
  // Loading bridges with suspended hoists span the approach railway.
  for (const [cx, cz, width] of [
    [17, 21.7, 10.2],
    [-20, -11, 8.1],
    [39, -23, 12.4],
    [-32, 38, 11.5],
  ]) {
    const h = 5.9,
      low = h - 0.85,
      d = 2.35,
      left = cx - width * 0.5,
      right = cx + width * 0.5;
    for (const x of [left, right])
      for (const z of [cz - d / 2, cz + d / 2]) {
        batch.box(x, 0.18, z, 1.02, 0.36, 1.13, slate);
        batch.spar([x, 0.3, z], [x, h, z], 0.14, steel);
        batch.spar([x, 0.38, z], [x, low, 2 * cz - z], 0.072, trim);
        ground.block(x, z, 1.1, 1.18, 3, 0);
      }
    for (const z of [cz - d / 2, cz + d / 2]) {
      for (const y of [low, h]) batch.spar([left, y, z], [right, y, z], 0.13, bronze);
      for (let j = 0; j < 8; j++) {
        const x = left + (width * j) / 8;
        batch.spar([x, j % 2 ? h : low, z], [x + width / 8, j % 2 ? low : h, z], 0.083, trim);
      }
    }
    batch.box(left + 0.81, h - 0.22, cz, 1.51, 0.92, d + 0.42, gunmetal);
    batch.box(left + 0.81, h - 0.09, cz + d * 0.5 + 0.24, 1.06, 0.31, 0.04, white);
    for (const z of [cz - 0.37, cz + 0.37]) batch.spar([cx, h - 0.12, z], [cx, 2.35, z], 0.035, black);
    batch.box(cx, 2.2, cz, 2.5, 0.28, 1.05, bronze);
    glow(right, h + 0.05, cz, '#ff9164', 0.68);
  }
  // Pressurized storage farms, service manifolds and shared access galleries.
  for (const [cx, cz, rot] of [
    [-16.5, 19, 0],
    [24, -11, 0.2],
    [10.5, -28, 0.1],
    [-42, -28, 0.4],
    [56, 22, 0],
    [-21, 50, -0.2],
  ]) {
    for (let j = 0; j < 3; j++) {
      const x = cx + j * 1.68,
        z = cz + j * 0.26,
        h = 2.1 + (j % 2) * 0.48;
      batch.shell(x, h * 0.5, z, 0.7, 0.74, h, gunmetal, 20);
      batch.shell(x, h + 0.1, z, 0.56, 0.73, 0.2, slate, 20);
      for (const y of [0.43, h * 0.72]) batch.shell(x, y, z, 0.774, 0.774, 0.1, trim, 20);
      batch.spar([x, h + 0.2, z], [x, h + 0.68, z], 0.08, bronze);
      batch.spar([x, h + 0.68, z], [x, h + 0.68, z + 1.05], 0.08, bronze);
      ground.block(x, z, 1.6, 1.6, h, rot);
    }
    batch.spar([cx - 0.3, 0.38, cz + 1.12], [cx + 4.4, 0.38, cz + 1.12], 0.11, steel, 8);
  }
  // Compact crawler cabs, trailers and bollards establish the scale of a repair lane.
  for (const [x, z] of [
    [13.2, 23.1],
    [11.4, 19.2],
    [-14.6, 9.8],
    [24.2, -17],
    [-20.3, -23],
    [12.3, 36.8],
  ]) {
    batch.box(x, 0.3, z, 0.92, 0.35, 2.15, black);
    batch.box(x, 0.64, z + 0.65, 0.91, 0.51, 0.62, bronze);
    batch.box(x, 0.7, z + 0.973, 0.68, 0.21, 0.034, black);
    batch.box(x, 0.63, z - 0.38, 0.88, 0.44, 1.13, gunmetal);
    for (const s of [-1, 1]) {
      batch.box(x + 0.3 * s, 0.46, z + 0.995, 0.18, 0.1, 0.05, white);
      batch.box(x + 0.49 * s, 0.19, z, 0.12, 0.31, 1.7, steel);
      ground.contact(x + 0.51 * s, z, .28, 1.04, 0);
    }
    ground.block(x, z, 1.1, 2.3, 0.5, 0);
  }
  for (let i = 0; i < 20; i++) {
    const x = 13.1 + (i % 2) * 0.25,
      z = -4.1 + i * 0.7;
    batch.box(x, 0.21, z, 0.16, 0.42, 0.19, i % 3 === 0 ? amber : bronze);
  }
}

export function createEngine({ shared = false } = {}) {
  const group = new THREE.Group();
  group.name = 'CN-07 · Ground propulsion complex';
  const random = seededRandom(782401),
    vents = [],
    lights = [];
  const ground = groundShadows();
  const uniforms = { proximity: { value: shared ? 0 : 1 }, ignition: { value: 1 }, weatherTime: { value: 0 } };
  const sky = atmosphere(group, uniforms, shared);
  const terrain = landscape(group, random, ground, uniforms, shared);
  const finish = hullFinish();
  const metal = (color, roughness = 0.66, metalness = 0.42, texture = null) =>
    applyHaze(
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        ...texture,
        bumpScale: shared ? 0.00016 : 0.07,
      }),
      uniforms,
    );
  const charcoal = metal('#4b4a47', 0.94, 0.55, finish),
    gunmetal = metal('#676866', 0.78, 0.66, finish);
  const pale = metal('#96938a', 0.91, 0.44, finish),
    trim = metal('#7a7b75', 0.57, 0.72);
  const steel = metal('#646767', 0.64, 0.68),
    dark = metal('#282727', 0.88, 0.42),
    oxidized = metal('#735538', 0.73, 0.65, finish);
  const slate = metal('#61615d', 1, 0.22, finish);
  const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.14, 0.42, 0.105) });
  const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.65, 0.8, 0.93) });
  const arc = nozzleMaterial(new THREE.Color(0.24, 1.52, 3), uniforms);
  const core = nozzleMaterial(new THREE.Color(0.84, 1.12, 1.42), uniforms);
  const batch = fabricator(group, shared);
  const glow = (x, y, z, color, size) => lights.push([x, y, z, color, size]);

  function tower(cx, cz, s, lod) {
    batch.detail(0);
    ground.tower(cx, cz, s);
    const at = (r, h, a) => [cx + s * r * Math.sin(a), s * h, cz + s * r * Math.cos(a)];
    const shell = (h, top, bottom, height, m) =>
      batch.shell(cx, h * s, cz, top * s, bottom * s, height * s, m, lod === 2 ? 24 : 48);
    const cuboid = (r, h, a, w, height, d, m) => {
      const p = at(r, h, a);
      batch.box(...p, w * s, height * s, d * s, m, a);
    };
    const plate = (r, h, a, w, height, d, m, tilt = 0, tint) =>
      batch.panel(...at(r, h, a), w * s, height * s, d * s, m, a, tilt, tint);
    const strut = (r1, h1, a1, r2, h2, a2, r, m) => batch.spar(at(r1, h1, a1), at(r2, h2, a2), r * s, m);
    const bead = (r, h, a, color, size) => glow(...at(r, h, a), color, size * s);
    shell(0.6, 12.5, 13, 1.3, slate);
    shell(2, 9.4, 12.0, 2.2, charcoal);
    shell(5.9, 7.2, 9.2, 6, gunmetal);
    shell(10.3, 6.0, 7.15, 2.8, pale);
    shell(14.5, 5.55, 5.97, 6.0, charcoal);
    shell(19.1, 4.55, 5.54, 3.2, gunmetal);
    shell(22.9, 4.36, 4.55, 4.5, dark);
    shell(26.5, 6.15, 4.36, 2.8, gunmetal);
    shell(28.4, 6.8, 6.15, 1.1, pale);
    shell(29.1, 6.76, 6.76, 0.38, charcoal);
    shell(29.24, 5.24, 5.24, 0.18, dark);
    shell(29.34, 3.8, 3.8, 0.1, arc);
    shell(29.44, 2.68, 2.82, 0.13, core);
    batch.detail(1);
    for (const [height, rad] of [
      [3.3, 9.5],
      [8.8, 7.5],
      [12, 6.34],
      [17.55, 5.9],
      [20.6, 5.1],
      [24.95, 4.8],
      [27.7, 6.37],
      [28.8, 6.94],
    ]) {
      shell(height - .13, rad + .045, rad + .045, 0.073, dark);
      shell(height, rad, rad, 0.22, steel);
    }
    const sections = lod === 2 ? 8 : 16;
    batch.detail(2);
    for (let j = 0; j < sections; j++) {
      const a = (j * TAU) / sections,
        next = a + TAU / sections;
      // Main load ribs are deep webs with raised flanges and foot pads.
      if (lod < 2) {
        const rake = -Math.atan2(3.7, 9);
        plate(8.76, 6.3, a, .90, 9.75, .58, steel, rake);
        for (const side of [-1, 1]) {
          const angle = a + side * .046;
          plate(8.93, 6.34, angle, .23, 9.5, .32, trim, rake);
          plate(10.66, 1.86, angle, .53, .75, .82, gunmetal, rake);
        }
        plate(10.73, 1.48, a, 1.42, .44, 1.72, charcoal, .21);
      } else strut(10.6, 1.8, a, 6.9, 10.8, a, 0.36, steel);
      strut(6.5, 11.5, a, 5.5, 18.4, a, 0.29, trim);
      strut(4.9, 20.7, a, 4.7, 25.0, a, 0.22, trim);
      strut(4.75, 25.1, a, 6.38, 28.4, a, 0.27, steel);
      cuboid(6.32, 11.86, a, 1.28, 0.16, 0.22, j % 4 ? white : amber);
      cuboid(5.86, 17.68, a, 1.15, 0.12, 0.23, amber);
      cuboid(6.69, 28.99, a, 0.88, 0.1, 0.23, white);
      if (lod < 2) {
        strut(11.85, 1.0, a, 7.0, 10.7, a + 0.1, 0.17, trim);
        strut(7.1, 10.35, a, 6.4, 12, next, 0.13, steel);
        strut(5.0, 20.8, a, 4.72, 24.8, next, 0.105, steel);
        plate(6.12, 13.64, a, 1.46, 2.28, .33, charcoal);
        plate(6.3, 13.64, a, 1.30, 2.05, .12, dark);
        for (let z = 0; z < 6; z++) plate(6.37, 12.86 + z * .30, a, 1.25, .13, .16, steel, -.36);
        // Segmented crown tiles overlap the load shell and catch the low sun.
        plate(6.51, 28.05, a, 1.61, 1.92, .31, pale, .48, j % 5 === 2 ? '#c7ae8c' : '#e0e2dd');
        plate(6.76, 28.74, a, 1.59, .28, .52, steel, .28);
        if (lod === 0) {
          const serviceAngle = a + .125;
          // Anchor plates reach past the plinth, with a tight contact at the slab.
          const toe = at(13.27, .42, a);
          plate(12.8, .88, a, .83, .9, 1.12, gunmetal, .45);
          plate(13.26, .34, a, 1.22, .24, 1.07, charcoal);
          ground.contact(toe[0], toe[2], .89 * s, .86 * s, a);
          for (const side of [-1, 1]) plate(13.25, .485, a + .024 * side, .11, .09, .16, trim);
          plate(8.65, 5.2, serviceAngle, 1.56, 2.46, .46, gunmetal, -.29);
          plate(8.94, 5.19, serviceAngle, 1.33, 1.43, .16, dark, -.29);
          for (let vane = 0; vane < 6; vane++) {
            const y = 4.65 + vane * .2;
            plate(8.99 - vane * .055, y, serviceAngle, 1.26, .087, .156, trim, -.29);
          }
          for (const side of [-1, 1]) {
            const angle = serviceAngle + side * .078;
            const foot = at(9.04, 4.07, angle);
            const head = at(8.45, 6.25, angle);
            batch.panel(...foot, .12 * s, .13 * s, .095 * s, pale, angle);
            batch.panel(...head, .12 * s, .13 * s, .095 * s, pale, angle);
            plate(5.83, 17.57, a + side * .105, .14, .32, .19, pale);
          }
          strut(9.1, 3.6, a + 0.044, 8.03, 7.7, a + 0.044, 0.13, oxidized);
          strut(9.1, 3.6, a + 0.081, 8.03, 7.7, a + 0.081, 0.13, trim);
          for (const [deck, radius] of [[8.89, 7.53], [11.90, 6.61], [17.59, 6.17]]) {
            const mid = (a + next) * .5;
            // Two rails with subdivided posts establish human scale on each deck.
            for (const h of [deck + .36, deck + .65]) {
              strut(radius, h, a, radius, h, mid, .039, trim);
              strut(radius, h, mid, radius, h, next, .039, trim);
            }
            for (const angle of [a, mid]) {
              strut(radius, deck, angle, radius, deck + .65, angle, .035, steel);
              plate(radius - .11, deck - .04, angle, .16, .28, .34, dark);
            }
            strut(radius - .16, deck - .05, mid, radius - .97, deck - .52, mid, .069, dark);
          }
        }
      }
      if (j % 2 === 0) bead(6.8, 29.0, a, '#a9dfff', 0.57);
      if (j % 4 === 0) bead(6.42, 11.82, a, '#ffd58d', 0.73);
    }
    if (lod < 2) {
      // Eight separated heat exchangers at the foot, fed by paired diagonal conduits.
      for (let j = 0; j < 8; j++) {
        const a = ((j + 0.5) * TAU) / 8;
        cuboid(9.3, 2.7, a, 2.1, 4.9, 3.15, charcoal);
        cuboid(9.36, 5.05, a, 2.4, 0.36, 3.5, pale);
        for (let b = 0; b < 5; b++) cuboid(10.96, 1.05 + b * 0.77, a, 1.79, 0.16, 0.26, trim);
        for (const offset of [-0.076, 0.076]) {
          strut(11.25, 0.65, a + offset, 7.05, 8.8, a + offset, 0.23, oxidized);
          strut(4.75, 20.8, a + offset, 4.5, 24.7, a + offset, 0.09, oxidized);
        }
      }
    }
    // A gantry lift on CN-07 and different side manifolds on satellite towers
    // break the repeated silhouette while sharing the same structural parts.
    if (lod === 0) {
      const a = -1.0;
      for (const angle of [a - 0.13, a + 0.13]) {
        strut(9.3, 2.0, angle, 7.0, 18.0, angle, 0.15, trim);
        strut(7.0, 18.0, angle, 6.65, 24.4, angle, 0.15, steel);
      }
      for (let k = 0; k < 9; k++) {
        const y = 6.2 + k * 1.93,
          r = Math.max(6.65, 8.92 - (y - 6.2) * 0.133);
        cuboid(r, y, a, 2.04, 0.13, 0.72, steel);
        strut(r, y, a - 0.135, Math.max(6.65, r - 0.26), y + 1.93, a + 0.135, 0.069, trim);
      }
      cuboid(7.28, 18.4, a, 2.04, 2.38, 1.36, gunmetal);
      cuboid(8.015, 18.84, a, 1.65, 0.41, 0.1, white);
      cuboid(7.03, 23.1, a, 2.04, 0.38, 1.2, oxidized);
    } else {
      const n = 1 + (Math.round(Math.abs(cx * 0.17 + cz * 0.12)) % 3);
      const fac = 1.35 + Math.abs(Math.sin(cx * 1.328));
      for (let j = 0; j < n; j++) {
        const a = cx + 0.77 + (j * TAU) / n,
          p = at(7.3, 7.5, a);
        batch.shell(...p, fac * s, fac * s, 9 * s, gunmetal, 12);
        for (const band of [4, 9.4, 12.1]) {
          const q = at(7.3, band, a);
          batch.shell(...q, (fac + 0.17) * s, (fac + 0.17) * s, 0.33 * s, band === 9.4 ? oxidized : trim, 12);
        }
        strut(7.3, 12.0, a, 5.6, 15.8, a, 0.27, trim);
      }
    }
    vents.push({
      x: cx,
      y: 29.41 * s,
      z: cz,
      radius: 5.1 * s,
      height: (lod === 0 ? 87 : 76) * s,
      seed: random() * 11,
    });
  }
  tower(0, 0, 1, 0);
  const sites = [
    [-36, -37, 0.75],
    [34, -59, 0.88],
    [-76, -35, 0.58],
    [-65, -88, 0.76],
    [69, -27, 0.61],
    [-13, -109, 0.69],
    [19, -144, 0.56],
    [104, -76, 0.55],
    [81, 46, 0.54],
    [-99, 34, 0.58],
    [-50, 97, 0.61],
    [37, 107, 0.66],
    [118, 17, 0.46],
    [-123, -63, 0.51],
    [72, -129, 0.48],
    [-47, -22, 1.02],
    [-8, -69, 0.96],
    [65, -7, 0.82],
  ];
  for (let i = 0; i < sites.length; i++) tower(...sites[i], i < 2 || i === 15 ? 1 : 2);
  plaque(group);
  const adjacentSites = [sites[0], sites[1], ...sites.slice(-3)];
  const workshop = buildEngineWorkshop(
    group,
    batch,
    { steel, trim, pale, bronze: oxidized, dark, amber, white, metal },
    shared,
    placeOnSurface,
    uniforms,
    adjacentSites,
  );
  const vehiclePaint = metal('#ffffff', 0.64, 0.27);
  vehiclePaint.vertexColors = true;
  const convoy = rescueConvoy(group, shared, placeOnSurface, vehiclePaint);

  // Low service blocks and parallel transport lines give the installation a human scale.
  for (let i = 0; i < 118; i++) {
    batch.detail(1);
    const x = (random() - 0.5) * 175,
      z = (random() - 0.5) * 150;
    const post = Math.abs(x - 20.3) < 7.8 && Math.abs(z - 7.2) < 7;
    const sightline = z > 21 && z < 40 && x > 8 && x < 28;
    if (
      post ||
      sightline ||
      Math.hypot(x, z) < 16 ||
      onRescueRoad(x, z, 4.4) ||
      sites.some((t) => Math.hypot(t[0] - x, t[1] - z) < t[2] * 13)
    )
      continue;
    const w = 1.35 + random() * 4.6,
      d = 2.5 + random() * 7.7,
      h = 0.65 + random() ** 2 * 2.65;
    const a = random() < 0.68 ? 0 : Math.PI / 2;
    ground.block(x, z, w, d, h, a);
    const piece = (ox, y, oz, ww, hh, dd, m) =>
      batch.box(x + ox * Math.cos(a) + oz * Math.sin(a), y, z - ox * Math.sin(a) + oz * Math.cos(a), ww, hh, dd, m, a);
    piece(0, h * 0.5, 0, w, h, d, gunmetal);
    piece(0, h + 0.06, 0, w + 0.18, 0.15, d + 0.18, slate);
    batch.detail(2);
    piece(0, h + 0.21, -d * 0.19, w * 0.43, 0.23, d * 0.32, steel);
    for (let face of [-1, 1]) {
      for (let bay = 0; bay < 3; bay++)
        piece(
          (bay - 1) * w * 0.255,
          h * 0.65,
          face * (d * 0.5 + 0.025),
          w * 0.155,
          0.12,
          0.05,
          bay === 2 && i % 3 === 0 ? dark : i % 5 ? amber : white,
        );
      for (let bay = 0; bay < 5; bay++)
        piece(face * (w * 0.5 + 0.015), h * 0.45, (bay - 2) * d * 0.2, 0.05, h * 0.86, 0.065, trim);
    }
    piece(w * 0.23, h * 0.24, d * 0.5 + 0.017, w * 0.18, h * 0.5, 0.04, dark);
    if (i % 3 === 0) glow(x, h + 0.17, z, '#f2c58e', 0.35);
    if (i % 4 === 0) batch.shell(x - w * 0.23, h + 0.44, z + d * 0.21, 0.25, 0.28, 0.9, steel, 12);
  }
  for (const side of [-1, 1]) {
    const x = side * 15.0;
    for (let i = -7; i < 7; i++) {
      const z = i * 8;
      // Below-grade pipe trenches leave the rescue convoy's sight line open.
      const crossing = (v) => Math.abs(v - 17) < 5 || Math.abs(v + 31) < 5;
      const portal = (v) => (Math.abs(v - 17) < 11 || Math.abs(v + 31) < 11 ? -1.9 : 0.7);
      const h1 = portal(z),
        h2 = portal(z + 8);
      batch.spar([x, h1, z], [x, h2, z + 8], 0.3, steel, 10);
      batch.spar([x + 0.85, h1 - 0.05, z], [x + 0.85, h2 - 0.05, z + 8], 0.17, oxidized, 8);
      if (!crossing(z)) {
        batch.box(x + 0.34, 0.26, z, 1.75, 0.45, 0.83, charcoal);
        if (h1 < 0) batch.box(x + 0.35, 0.34, z, 1.9, 0.14, 1.09, trim);
      }
      ground.block(x + 0.34, z, 1.75, 0.83, 0.6, 0);
      if (i % 2 === 0) {
        batch.spar([x + 1.7, 0, z], [x + 1.7, 3.6, z], 0.075, steel);
        batch.box(x + 1.6, 3.58, z, 0.7, 0.1, 0.25, white);
        glow(x + 1.6, 3.52, z, '#bce2ff', 0.65);
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = 0.85 + (i * TAU) / 4,
      x = Math.sin(a) * 14.1,
      z = Math.cos(a) * 14.1;
    const rung = (ox, oz, y) => [x + ox, y, z + oz];
    for (const [ox, oz] of [
      [-0.73, -0.73],
      [0.73, -0.73],
      [0.73, 0.73],
      [-0.73, 0.73],
    ]) {
      batch.spar(rung(ox, oz, 0), rung(ox * 0.48, oz * 0.48, 13), 0.085, steel);
    }
    for (let h = 0; h < 6; h++) {
      const r1 = 0.73 - h * 0.058,
        r2 = r1 - 0.058,
        y = h * 2.1;
      for (let face = 0; face < 4; face++) {
        const q = (face * Math.PI) / 2,
          k = ((face + 1) * Math.PI) / 2;
        const ax = Math.sin(q + 0.785) * r1 * 1.4,
          az = Math.cos(q + 0.785) * r1 * 1.4;
        const bx = Math.sin(k + 0.785) * r2 * 1.4,
          bz = Math.cos(k + 0.785) * r2 * 1.4;
        batch.spar(rung(ax, az, y), rung(bx, bz, y + 2.1), 0.047, trim);
      }
    }
    batch.box(x, 13, z, 1.35, 0.22, 1.35, pale);
    batch.spar(rung(0, 0, 13), rung(0, 0, 16.7), 0.06, trim);
    glow(x, 16.55, z, '#ff6244', 0.95);
  }
  freightYard(batch, ground, glow, { steel, slate, trim, bronze: oxidized, white, amber, black: dark, gunmetal });
  const rescueSign = reliefPost(
    group,
    batch,
    ground,
    glow,
    { charcoal, gunmetal, slate, pale, trim, steel, amber, white, dark, oxidized },
    shared,
  );
  // A floodlit field repair post, with crews and portable cylinders beside the
  // convoy route. The orange jackets and reflective shoulder bands give scale.
  for (const [x, z, angle] of [
    [-19, 10, 0.32],
    [-20.0, 9.65, -0.6],
    [19.7, 11.4, -0.28],
    [20.6, 10.7, 0.74],
    [-12.3, 22.5, 1.33],
    [22.3, 11.77, -0.4],
  ]) {
    const leg = (a, b, r, mat) => batch.spar(a, b, r, mat, 5);
    for (const side of [-1, 1]) {
      leg([x + side * 0.11, 0.37, z], [x + side * 0.075, 0.83, z + 0.04], 0.084, dark);
      leg([x + side * 0.14, 1.06, z], [x + side * 0.24, 0.82, z + 0.09 * side], 0.066, oxidized);
    }
    batch.box(x, 0.99, z, 0.34, 0.37, 0.23, oxidized, angle);
    batch.box(x, 1.04, z, 0.355, 0.065, 0.244, pale, angle);
    batch.shell(x, 1.31, z, 0.14, 0.13, 0.2, pale, 8);
    batch.box(x, 0.7, z - 0.105, 0.23, 0.21, 0.13, steel, angle);
  }
  ground.texture.needsUpdate = true;
  ground.contactMap.needsUpdate = true;
  ground.spillMap.needsUpdate = true;
  batch.flush();
  const plume = makePlumes(group, vents, uniforms, shared);
  const mist = exhaustMist(group, vents, uniforms, shared);
  const steam = coolingVents(group, uniforms, shared);
  makeLights(group, lights, shared);
  const ambient = new THREE.HemisphereLight(0xe0e7ef, 0x79716b, .92);
  const localLights = new THREE.Group();
  localLights.name = 'Ground proximity lighting';
  group.add(localLights);
  localLights.add(ambient);
  const sun = new THREE.DirectionalLight(0xffd6ad, 2.35);
  sun.position.set(-60, 31, -40);
  localLights.add(sun, sun.target);
  const key = new THREE.DirectionalLight(0xdceaff, 1.18);
  key.position.set(52, 47, 40);
  localLights.add(key, key.target);
  const exhaustLight = new THREE.PointLight(0x6699ff, 300, 35, 2);
  exhaustLight.position.set(0, 32.8, 0);
  localLights.add(exhaustLight);
  // The rendered tower is instanced together with its siblings. The pick volume
  // follows its silhouette and excludes industrial buildings on the plain.
  const outline = new THREE.LatheGeometry(
    [
      new THREE.Vector2(13, 0),
      new THREE.Vector2(7.2, 8.9),
      new THREE.Vector2(5.6, 17.7),
      new THREE.Vector2(4.5, 25),
      new THREE.Vector2(6.8, 29.5),
      new THREE.Vector2(0, 29.5),
    ],
    32,
  );
  const towerPick = new THREE.Mesh(outline, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  towerPick.name = 'Central propulsion unit CN-07';
  group.add(towerPick);
  const selection = new THREE.Group();
  const edgeLight = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader:
      'varying vec3 n,p;void main(){p=(modelMatrix*vec4(position,1.)).xyz;n=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
    fragmentShader:
      'varying vec3 n,p;void main(){float fresnel=pow(1.-max(0.,dot(normalize(n),normalize(cameraPosition-p))),3.);gl_FragColor=vec4(.20,.85,.72,.043+fresnel*.51);}',
  });
  const contour = new THREE.Mesh(outline, edgeLight);
  contour.scale.set(1.04, 1.009, 1.04);
  selection.add(contour);
  const lineMaterial = new THREE.LineDashedMaterial({
    color: 0x8ef9db,
    dashSize: 0.95,
    gapSize: 0.39,
    transparent: true,
    opacity: 0.79,
    depthWrite: false,
  });
  for (const [height, radius] of [
    [0.52, 13.65],
    [29.47, 7.11],
  ]) {
    const points = Array.from(
      { length: 133 },
      (_, i) => new THREE.Vector3(Math.sin((i / 132) * TAU) * radius, height, Math.cos((i / 132) * TAU) * radius),
    );
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
    ring.computeLineDistances();
    selection.add(ring);
  }
  selection.visible = false;
  group.add(selection);
  function setHighlight(id) {
    selection.visible = id === 'engine';
  }
  const sceneScale = new THREE.Vector3();
  let power = 1,
    lightMix = shared ? 0 : 1,
    elapsedNow = 0;
  function syncLighting() {
    ambient.intensity = lightMix * (0.62 + power * 0.28);
    sun.intensity = lightMix * 3.12;
    key.intensity = lightMix * (0.61 + power * 0.28);
    const scale = shared ? group.getWorldScale(sceneScale).x : 1;
    exhaustLight.distance = 43 * scale;
    exhaustLight.intensity = lightMix * scale * scale * power * (510 + Math.sin(elapsedNow * 2.9) * 18);
  }
  function setIgnition(value) {
    if (!Number.isFinite(value)) return;
    uniforms.ignition.value = THREE.MathUtils.clamp(value, 0, 1);
    power = THREE.MathUtils.smoothstep(uniforms.ignition.value, 0.105, 0.435);
    syncLighting();
  }
  function setProximity(value) {
    if (!Number.isFinite(value)) return;
    const near = shared ? THREE.MathUtils.clamp(value, 0, 1) : 1;
    uniforms.proximity.value = near;
    batch.proximity(near);
    workshop.setProximity(near);
    convoy.setProximity(near);
    rescueSign.visible = near > 0.26;
    lightMix = THREE.MathUtils.smoothstep(near, 0.32, 0.94);
    sky.visible = !shared || near > 0.56;
    mist.vapor.visible = !shared || near > 0.46;
    steam.visible = !shared || near > 0.42;
    terrain.floor.visible = !shared || near > 0.08;
    const alpha = THREE.MathUtils.smoothstep(near, 0.35, 0.88);
    for (const range of terrain.ranges) {
      range.visible = alpha > 0.001;
      range.material.opacity = alpha;
    }
    syncLighting();
  }
  setProximity(shared ? 0 : 1);
  return {
    group,
    setIgnition,
    setHighlight,
    setProximity,
    localLights,
    pickables: [{ id: 'engine', object: towerPick }],
    camera: [24, 4.25, 43],
    target: [0, 16.6, 0],
    fov: 49,
    minDistance: 19,
    maxDistance: 101,
    minPolarAngle: 0.38,
    maxPolarAngle: 1.72,
    update(elapsed) {
      elapsedNow = elapsed;
      uniforms.weatherTime.value = elapsed;
      plume.uniforms.time.value = elapsed;
      mist.time.value = elapsed;
      convoy.update(elapsed);
      syncLighting();
    },
  };
}
