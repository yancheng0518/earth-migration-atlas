import * as THREE from 'three';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const assets = {
  jupiter: new URL('../assets/journey/jupiter-cassini.jpg', import.meta.url).href,
  solar: new URL('../assets/journey/sdo-active-regions.jpg', import.meta.url).href,
};
const textures = new Map();
function texture(name) {
  if (!textures.has(name)) {
    const map = new THREE.TextureLoader().load(assets[name]);
    map.wrapS = THREE.RepeatWrapping;
    map.anisotropy = 4;
    if (name === 'jupiter') map.colorSpace = THREE.SRGBColorSpace;
    textures.set(name, map);
  }
  return textures.get(name);
}

function seeded(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

let stellarField;
function turbulence() {
  if (stellarField) return stellarField;
  const side = 48;
  const values = new Uint8Array(side ** 3 * 4);
  const random = seeded(2061);
  for (let i = 0; i < values.length; i++) values[i] = random() * 255;
  stellarField = new THREE.Data3DTexture(values, side, side, side);
  stellarField.format = THREE.RGBAFormat;
  stellarField.minFilter = stellarField.magFilter = THREE.LinearFilter;
  stellarField.wrapS = stellarField.wrapT = stellarField.wrapR = THREE.RepeatWrapping;
  stellarField.unpackAlignment = 1;
  stellarField.needsUpdate = true;
  return stellarField;
}

const sphereVertex = `
  varying vec2 vUv;
  varying vec3 vWorld,vNorm,vLocal;
  void main(){
    vUv=uv; vLocal=normalize(position);
    vNorm=normalize(mat3(modelMatrix)*normal);
    vec4 w=modelMatrix*vec4(position,1.);
    vWorld=w.xyz;
    gl_Position=projectionMatrix*viewMatrix*w;
  }
`;
function makeStar(radius, redDwarf = false) {
  const group = new THREE.Group();
  const time = { value: 0 },
    activity = { value: 1 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      field: { value: turbulence() },
      magnetic: { value: texture('solar') },
      time,
      activity,
      dwarf: { value: redDwarf ? 1 : 0 },
    },
    vertexShader: sphereVertex,
    fragmentShader: `
      precision highp sampler3D;
      uniform sampler3D field;
      uniform sampler2D magnetic;
      uniform float time,activity,dwarf;
      varying vec3 vLocal,vNorm,vWorld;
      void main(){
        vec3 p=normalize(vLocal);
        vec3 drift=vec3(time*.00045,-time*.00033,time*.00025);
        vec3 wind=texture(field,p*.064+drift).rgb-0.5;
        float cell=texture(field,p*.18+wind*.062-drift*1.3).r;
        float detail=texture(field,p*.64+wind*.033+drift).g;
        float grain=texture(field,p*1.85+wind*.03-drift).b;
        float filament=1.-smoothstep(.015,.125,abs(cell+detail*.21-.60));
        float hot=clamp(.36*cell+.34*detail+.18*grain+.26*filament,0.,1.);
        float spot=smoothstep(.25,.78,length(wind))*smoothstep(.39,.65,1.-cell);
        vec2 uv=.5+p.xy*.489+wind.xy*.0021+.0008*sin(time*.27+p.yx*19.);
        float observed=texture2D(magnetic,uv).r;
        float heat=observed*.84+hot*.20;
        vec3 cooled=vec3(.095,.003,.0008), bright=vec3(1.0,.215,.017);
        vec3 stellar=mix(cooled,bright,smoothstep(.11,.61,heat));
        stellar+=vec3(.72,.63,.27)*smoothstep(.44,.86,heat);
        stellar*=.83+.31*grain+.10*filament-spot*.18;
        stellar*=vec3(1.,1.-dwarf*.75,1.-dwarf*.55);
        float cooling=(1.-smoothstep(.31,.94,activity))*(1.-dwarf);
        stellar*=mix(vec3(1.),vec3(.77,.28,.15),cooling);
        stellar*=1.-.48*cooling*(1.-smoothstep(.22,.58,observed));
        float facing=max(dot(normalize(cameraPosition-vWorld),normalize(vNorm)),0.);
        stellar*=.65+.36*pow(facing,.33);
        stellar+=vec3(.55,.13,.027)*pow(1.-facing,6.)*activity;
        stellar*=.58+activity*.42;
        gl_FragColor=vec4(stellar,1.);
        #include <colorspace_fragment>
      }`,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, 80, 52), material);
  group.add(surface);

  // A camera-facing corona surrounds the solid stellar disc. The sphere writes
  // depth first, so dark foreground silhouettes naturally cut into the glow.
  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 3.45, radius * 3.45),
    new THREE.ShaderMaterial({
      uniforms: { time, activity, dwarf: { value: redDwarf ? 1 : 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
      varying vec2 p;
      void main(){
        p=uv*2.-1.;
        vec4 mv=modelViewMatrix*vec4(0.,0.,0.,1.);
        mv.xy+=position.xy*length(modelMatrix[0].xyz);
        gl_Position=projectionMatrix*mv;
      }`,
      fragmentShader: `
      uniform float time,activity,dwarf;
      varying vec2 p;
      void main(){
        float r=length(p)*1.725;
        float edge=max(0.,r-.986);
        float a=atan(p.y,p.x);
        float ray=.5+.5*sin(9.*a+.8*sin(5.*a)+time*.08);
        float tendril=pow(max(0.,sin(21.*a+sin(a*7.-time*.15)+edge*4.)),3.);
        float density=exp(-edge*19.)*.65+exp(-edge*(7.3-2.*ray))*(.16+.18*ray+.11*tendril);
        density*=smoothstep(.82,.985,r)*(1.-smoothstep(1.4,1.72,r));
        vec3 tint=mix(vec3(1.,.095,.009),vec3(1.,.026,.013),dwarf);
        gl_FragColor=vec4(tint,density*(.82+.18*activity));
        #include <colorspace_fragment>
      }`,
    }),
  );
  group.add(corona);

  // Neighbouring strands in each magnetic flux loop share the same footpoints.
  // All ribbons are one mesh so the prominence field costs a single draw.
  const loops = [],
    indices = [],
    params = [];
  const random = seeded(redDwarf ? 199 : 4105);
  for (let i = 0; i < (redDwarf ? 4 : 13); i++) {
    const angle = (i * TAU) / (redDwarf ? 4 : 13) + random() * 0.14;
    const normal = V(Math.cos(angle), Math.sin(angle), (random() - 0.47) * 0.74).normalize();
    const tangent = V(-Math.sin(angle), Math.cos(angle), 0.25 * (random() - 0.5)).normalize();
    const lift = 0.035 + random() ** 1.6 * 0.19 + (i === 2 ? 0.12 : 0);
    const span = 0.032 + random() * 0.085;
    for (let f = 0; f < 4; f++) {
      const offset = loops.length / 3,
        steps = 38;
      for (let s = 0; s <= steps; s++) {
        const q = s / steps,
          bend = (q - 0.5) * 2,
          bowl = Math.sin(q * Math.PI);
        const longitude = bend * span * (0.89 + 0.055 * f) + bowl * 0.025 * Math.sin(i);
        const n = normal
          .clone()
          .multiplyScalar(Math.cos(longitude))
          .addScaledVector(tangent, Math.sin(longitude))
          .normalize();
        const height = radius * (0.998 + lift * (0.9 + f * 0.072) * bowl ** 0.78);
        for (const side of [-1, 1]) {
          const pt = n
            .clone()
            .multiplyScalar(height + side * radius * 0.0018)
            .addScaledVector(tangent, radius * 0.0012 * Math.sin(q * 18 + i + f));
          loops.push(...pt.toArray());
          params.push(q, side, i * 1.7 + f * 0.6);
        }
        if (s < steps) {
          const k = offset + s * 2;
          indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(loops, 3));
  geometry.setAttribute('strand', new THREE.Float32BufferAttribute(params, 3));
  geometry.setIndex(indices);
  const prominences = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { time, activity },
      vertexShader: `attribute vec3 strand; varying vec3 s; uniform float time; void main(){
      s=strand;vec3 p=position*(1.+.003*sin(time*.72+strand.z+strand.x*9.)*sin(strand.x*3.14159));
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader: `varying vec3 s; uniform float time,activity; void main(){
      float current=.5+.5*sin(s.x*16.-time*2.2+s.z);
      gl_FragColor=vec4(vec3(1.,.15+.29*current,.032),(.40+.50*current)*activity);
      #include <colorspace_fragment>
    }`,
    }),
  );
  group.add(prominences);
  return {
    group,
    update(t, strength) {
      time.value = t;
      activity.value = strength;
      surface.rotation.y = t * 0.019;
    },
  };
}

const clamp = THREE.MathUtils.clamp;
function phase(elapsed, progress) {
  return Number.isFinite(progress) ? clamp(progress, 0, 1) : 0.5 - 0.5 * Math.cos(elapsed * 0.16);
}
function chapter(group, camera, target, fov, minDistance, maxDistance, update, earth, radius, landmark, lightSource) {
  update(0, 0, 0);
  return {
    group,
    camera,
    target,
    fov,
    minDistance,
    maxDistance,
    update,
    sharedEarth: { anchor: earth, radius },
    lightSource,
    landmark,
  };
}

// Rough, irregular fragments drift between the lens and the remote sun.
// Their sunward faces catch a little amber light; the closer silhouettes move
// farther across the frame during the same nine seconds.
function debrisField() {
  const group = new THREE.Group(),
    random = seeded(4719),
    batches = [];
  const rock = new THREE.ShaderMaterial({
    uniforms: { field: { value: turbulence() } },
    vertexShader: `
      varying vec3 stonePoint, worldNormal, worldPosition, solarDirection;
      void main(){
        mat4 transform=modelMatrix*instanceMatrix;
        stonePoint=position;
        worldNormal=normalize(mat3(transform)*normal);
        solarDirection=normalize(mat3(modelMatrix)*vec3(.12,.19,-.97));
        vec4 world=transform*vec4(position,1.);
        worldPosition=world.xyz;
        gl_Position=projectionMatrix*viewMatrix*world;
      }`,
    fragmentShader: `
      precision highp sampler3D;
      varying vec3 stonePoint,worldNormal,worldPosition,solarDirection;
      uniform sampler3D field;
      void main(){
        vec3 fault=texture(field,stonePoint*.072).rgb;
        vec3 grain=texture(field,stonePoint*.53+fault*.036).rgb;
        float strata=.5+.5*sin(dot(stonePoint,vec3(8.,17.,4.))+fault.r*7.+grain.g*2.);
        float dust=.17+.42*grain.r+.34*strata;
        vec3 n=normalize(worldNormal+(grain-.5)*.16);
        vec3 eye=normalize(cameraPosition-worldPosition);
        float illumination=max(dot(n,normalize(solarDirection)),0.);
        float edge=pow(1.-max(0.,dot(n,eye)),3.);
        vec3 stone=mix(vec3(.063,.072,.086),vec3(.32,.28,.24),dust);
        vec3 color=stone*(vec3(.077,.11,.15)*(1.+n.y*.31)+vec3(1.08,.49,.23)*illumination);
        color+=vec3(.065,.031,.019)*edge*illumination;
        gl_FragColor=vec4(color,1.);
        #include <colorspace_fragment>
      }`,
  });
  const transform = new THREE.Object3D();
  const fragments = [
    [-3.7, 1.12, 4.5, 0.58],
    [3.35, -1.43, 4.6, 0.81],
    [-1.73, -0.74, 3.4, 0.2],
    [2.2, 1.83, 3.2, 0.22],
    [1.56, 0.04, 1.85, 0.095],
    [-2.28, 0.32, 2.55, 0.145],
    [-0.62, 1.79, 2.2, 0.12],
    [0.51, -1.1, 1.35, 0.1],
    [-3.31, -0.55, 1.1, 0.13],
  ];
  for (let i = 0; i < 23; i++)
    fragments.push([
      (random() - 0.5) * 9.5,
      (random() - 0.5) * 5.6,
      -2.35 + random() * 3,
      0.025 + random() ** 2 * 0.12,
    ]);
  for (let kind = 0; kind < 3; kind++) {
    const geometry = new THREE.IcosahedronGeometry(1, 3),
      pos = geometry.attributes.position;
    for (let j = 0; j < pos.count; j++) {
      const x = pos.getX(j),
        y = pos.getY(j),
        z = pos.getZ(j);
      const rough =
        0.86 +
        0.17 * Math.sin(x * 6.3 + y * 4.1 + kind) * Math.cos(y * 6.6 - z * 3.9) +
        0.075 * Math.sin(z * 11.4 + x * 6.5);
      pos.setXYZ(j, rough * x * (1.26 + kind * 0.21), rough * y * (0.63 - kind * 0.04), rough * z * 0.85);
    }
    geometry.computeVertexNormals();
    const pieces = fragments
      .filter((_, i) => i % 3 === kind)
      .map(([x, y, z, r]) => ({
        x,
        y,
        z,
        r,
        axis: V(random(), random(), random()).normalize(),
        roll: random() * TAU,
        speed: ((0.04 + random() * 0.17) * (z + 4)) / 7,
        tilt: (random() - 0.5) * 0.53,
      }));
    const batch = new THREE.InstancedMesh(geometry, rock, pieces.length);
    batch.frustumCulled = false;
    group.add(batch);
    batches.push({ batch, pieces });
  }
  return {
    group,
    update(f) {
      for (const { batch, pieces } of batches) {
        pieces.forEach((b, i) => {
          transform.position.set(b.x + (f - 0.5) * b.speed * 2.8, b.y + f * b.tilt * 0.21, b.z + 0.13 * f);
          transform.scale.setScalar(b.r);
          transform.quaternion.setFromAxisAngle(b.axis, b.roll + b.tilt * f);
          transform.updateMatrix();
          batch.setMatrixAt(i, transform.matrix);
        });
        batch.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

export function createSun() {
  const group = new THREE.Group();
  const star = makeStar(0.82);
  const radius = 0.11,
    earth = new THREE.Group(),
    debris = debrisField();
  group.add(star.group, earth, debris.group);
  return chapter(
    group,
    [0, 0.08, 10.55],
    [0, 0.06, 0],
    40,
    5.4,
    22,
    (t, dt, p) => {
      const f = phase(t, p);
      star.group.position.set(0.96 - 0.035 * f, 0.75, -5.8);
      star.group.scale.setScalar(1 - 0.065 * f);
      star.update(t, 0.76 - 0.33 * f + 0.025 * Math.sin(t * 1.08));
      earth.position.set(3.82 - 0.16 * f, -0.52, -3.95);
      debris.update(f);
    },
    earth,
    radius,
    star.group,
    star.group,
  );
}

// Earth is the floating origin. This curve is a physical flight path and
// the port, ships and surface all share its motion relative to the gas giant.
function flightPath(points) {
  return new THREE.CatmullRomCurve3(
    points.map((p) => V(...p)),
    false,
    'centripetal',
  );
}

export function createJupiter() {
  const group = new THREE.Group();
  const source = V(-0.72, 0.55, 0.58).normalize();
  const giant = new THREE.Mesh(
    new THREE.SphereGeometry(2.48, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader: sphereVertex,
      uniforms: { atlas: { value: texture('jupiter') }, sun: { value: source } },
      fragmentShader: `
      varying vec2 vUv; varying vec3 vNorm,vWorld;
      uniform sampler2D atlas;uniform vec3 sun;
      void main(){
        vec3 n=normalize(vNorm), eye=normalize(cameraPosition-vWorld);
        vec3 base=texture2D(atlas,vUv).rgb;
        float l=dot(n,sun),facing=max(dot(n,eye),0.);
        float diffuse=pow(max(l,0.),.62);
        vec3 gas=base*(vec3(.075,.081,.12)+diffuse*vec3(1.43,1.24,1.06));
        gas+=vec3(.32,.23,.17)*pow(1.-facing,4.)*(.10+smoothstep(-.51,.64,l));
        gl_FragColor=vec4(gas,1.);
        #include <colorspace_fragment>
      }`,
    }),
  );
  giant.scale.y = 0.94;
  giant.position.set(-0.38, 0.26, -0.85);
  giant.rotation.set(-0.04, -0.66, -0.13, 'ZXY');
  const earth = new THREE.Group();
  const flight = flightPath([
    [-4.25, -0.64, 1.05],
    [-3.22, -1.6, 1.15],
    [-1.68, -2.29, 1.37],
    [-0.1, -2.34, 1.55],
    [1.43, -1.7, 1.66],
    [2.34, -0.4, 1.57],
    [2.84, 1.12, 1.3],
    [3.46, 2.75, 0.9],
  ]);
  const moons = [];
  for (const [x, y, z, r, tint] of [
    [-3.85, 1.27, -1.7, 0.13, 0xcbbfa8],
    [3.57, -0.88, -0.17, 0.11, 0xbab6aa],
    [2.43, 2.04, -2.04, 0.065, 0xaaa8a9],
  ]) {
    const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), new THREE.MeshBasicMaterial({ color: tint }));
    moon.position.set(x, y, z);
    group.add(moon);
    moons.push(moon);
  }
  group.add(giant, earth);
  // This curve drives the actual near-pass ephemeris. The wide film frame
  // conveys the bend through parallax against Jupiter and its moons.
  return chapter(
    group,
    [0, 0.1, 11.7],
    [0, 0, 0],
    40,
    5.45,
    21,
    (t, dt, p) => {
      const f = phase(t, p);
      giant.rotation.y = -0.66 + 0.21 * f + 0.008 * Math.sin(t * 0.13);
      flight.getPointAt(f, earth.position);
      moons[0].position.y = 1.27 + 0.08 * Math.sin(t * 0.08);
    },
    earth,
    0.31,
    giant,
  );
}

// Sample the wake by particle age. The same film time always produces the same
// front, filaments and breakup, including after a backwards scrub.
function propulsionWake() {
  const positions = [], origins = [], parameters = [], profiles = [], triangles = [];
  const random = seeded(91105);
  const banks = [97.16, 97.51, 97.77, 98.0, 98.31, 98.63];
  const nozzleCount = 30;
  const slices = 45;

  function ribbon(x, z, rank, ignition, width, span, strength, phase) {
    const start = positions.length / 3;
    for (let row = 0; row <= slices; row++) {
      for (const edge of [-1, 1]) {
        positions.push(edge, row / slices, 0);
        origins.push(x, z, phase, ignition);
        parameters.push(width, span, strength);
        profiles.push(rank);
      }
      if (row === slices) continue;
      const k = start + row * 2;
      triangles.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }

  // Spread each bank around the hemisphere. The rim array remains legible as
  // several separate bright roots before the wider sheets begin to mix.
  for (let i = 0; i < nozzleCount; i++) {
    const angle = i * 2.399963;
    const radius = Math.sqrt((i + 0.5) / nozzleCount) * .88;
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    const phase = random() * 29;
    const ignition = banks[i % banks.length] + random() * .10;
    const thrust = .69 + .31 * random();
    ribbon(x, z, 0, ignition, .041 + random() * .017, .028 + random() * .022, thrust, phase);
    ribbon(x, z, 1, ignition, .065 + random() * .05, .47 + random() * .48, thrust, phase);
    if (i % 2 === 0)
      ribbon(x, z, 2, ignition, .27 + random() * .41, .78 + random() * .22, thrust, phase + 48.7);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('origin', new THREE.Float32BufferAttribute(origins, 4));
  geometry.setAttribute('parameters', new THREE.Float32BufferAttribute(parameters, 3));
  geometry.setAttribute('profile', new THREE.Float32BufferAttribute(profiles, 1));
  geometry.setIndex(triangles);
  const uniforms = {
    wakeLength: { value: 8 }, rPlanet: { value: .9 }, time: { value: 0 }, wakePower: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `
      attribute vec4 origin;
      attribute vec3 parameters;
      attribute float profile;
      uniform float rPlanet, wakeLength, time;
      varying vec4 sampleAt;
      varying vec3 volume;
      void main() {
        float rank=profile;
        float x=position.x, u=position.y;
        float age=time-origin.w;
        float spread=u*wakeLength*parameters.y;
        float hot=1.-step(.5,rank);
        float mist=step(1.5,rank);
        float speed=mix(4.6,5.7,parameters.z);
        float parcel=age-spread/speed;
        vec3 root=vec3(origin.x,-sqrt(1.-dot(origin.xy,origin.xy)),origin.y)*1.013;
        vec3 center=root;
        center.y-=spread;
        // Root stays pinned. Old parcels curl outward and advect downstream
        // instead of resembling sine waves sliding sideways across the ship.
        float loose=smoothstep(.18,2.85,spread);
        float whirl=parcel*5.1+origin.z;
        vec2 curl=vec2(sin(whirl+sin(parcel*7.3-origin.z)),cos(whirl*.83+origin.z*.59));
        curl+=.42*vec2(cos(parcel*13.8+origin.z*.66),sin(parcel*12.7-origin.z));
        center.xz+=(origin.xy*(.064*spread+.093*spread*loose)
          +curl*mix(.28,.67,mist)*loose*pow(u,.55))*(1.-hot*.89);
        vec3 point=(modelMatrix*vec4(center*rPlanet,1.)).xyz;
        vec3 axis=normalize(mat3(modelMatrix)*vec3(0.,-1.,0.));
        vec3 eye=normalize(cameraPosition-point);
        vec3 crossAxis=cross(axis,eye);
        if (dot(crossAxis,crossAxis)<1.e-7) crossAxis=cross(axis,vec3(1.,.2,.07));
        crossAxis=normalize(crossAxis);
        float roll=loose*(.68*sin(parcel*4.+origin.z)+mist*.64);
        crossAxis=crossAxis*cos(roll)+cross(axis,crossAxis)*sin(roll);
        float opening=u*u;
        float width=parameters.x*(1.+.85*u)+loose*mix(.25,.64,mist)*opening;
        width*=1.+.31*sin(parcel*6.6+origin.z)*loose;
        point+=crossAxis*x*width*rPlanet*length(modelMatrix[0].xyz);
        gl_Position=projectionMatrix*viewMatrix*vec4(point,1.);
        sampleAt=vec4(x,u,parcel,origin.z);
        volume=vec3(rank,parameters.z,spread);
      }`,
    fragmentShader: `
      varying vec4 sampleAt;
      varying vec3 volume;
      uniform float wakePower, time;
      float hash(vec2 p) {
        vec3 q=fract(vec3(p.xyx)*.1031);
        q+=dot(q,q.yzx+33.33);
        return fract((q.x+q.y)*q.z);
      }
      float noise(vec2 p) {
        vec2 cell=floor(p), f=fract(p);
        f=f*f*(3.-2.*f);
        return mix(mix(hash(cell),hash(cell+vec2(1.,0.)),f.x),
          mix(hash(cell+vec2(0.,1.)),hash(cell+1.),f.x),f.y);
      }
      void main() {
        float s=sampleAt.x,u=sampleAt.y,parcel=sampleAt.z,phase=sampleAt.w;
        float spread=volume.z;
        float arrival=smoothstep(0.,.29,parcel);
        if (arrival<.001) discard;
        float pressure=.83+.17*sin(phase+parcel*15.);
        float roll=noise(vec2(s*2.3+phase,parcel*3.9));
        float shear=noise(vec2(s*7.5-roll*1.8,parcel*12.4+phase*.31));
        float pocket=noise(vec2(s*3.15+shear,parcel*6.1+phase*.63));
        float radial=s+(roll-.5)*.72*smoothstep(.16,1.5,spread);
        float edge=1.-smoothstep(.72,1.,abs(s));
        vec3 color;
        float strength;
        if (volume.x<.5) {
          // Short shocks keep an intense white center while retaining blue
          // edges. No long, solid white line continues beyond the nozzle.
          float shock=.78+.22*pow(.5+.5*sin(spread*31.-parcel*11.0),2.);
          color=mix(vec3(.3,.87,1.8),vec3(2.34,2.96,3.56),exp(-radial*radial*8.));
          strength=.68*exp(-radial*radial*4.9)*pow(1.-u,2.06)*shock;
        } else if(volume.x<1.5) {
          float crest=sin(parcel*18.0+s*8.8+roll*5.5);
          float eddies=smoothstep(.33,.81,.42*roll+.44*shear+.27*pocket)*(.46+.54*pow(.5+.5*crest,2.));
          float density=exp(-radial*radial*2.8)*eddies;
          float violet=smoothstep(2.15,6.0,spread);
          color=mix(vec3(.055,.76,1.78),vec3(.24,.17,1.03),violet);
          strength=.65*density*pow(1.-u,1.45)*(1.-smoothstep(.67,1.,u))
            *(.61+.39*smoothstep(.015,.75,spread));
        } else {
          float breakUp=mix(.37,.65,smoothstep(3.,7.5,spread));
          float cloud=smoothstep(breakUp,.83,.34*roll+.44*pocket+.32*shear);
          color=mix(vec3(.09,.27,.94),vec3(.43,.12,.87),pocket);
          float farFade=1.-.56*smoothstep(104.,112.,time);
          strength=.20*exp(-radial*radial*2.4)*cloud*farFade
            *smoothstep(1.19,3.35,spread)*(1.-smoothstep(.47,.97,u));
        }
        float gain=strength*volume.y*pressure*edge*arrival*wakePower;
        gl_FragColor=vec4(color*gain,1.);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(radius, extent, seconds) {
      uniforms.rPlanet.value = radius;
      uniforms.wakeLength.value = extent;
      uniforms.time.value = seconds;
    },
  };
}

export function createProxima() {
  const group = new THREE.Group(),
    radius = 0.9,
    earth = new THREE.Group();
  const destination = makeStar(0.072, true),
    wake = propulsionWake();
  const start = V(-0.38, -0.12, 2.46),
    end = V(1.27, 0.69, -4.56);
  const direction = end.clone().sub(start).normalize();
  destination.group.position.copy(end).addScaledVector(direction, 9.6);
  const pin = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: (() => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d'),
          glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        glow.addColorStop(0, 'rgba(255,180,122,1)');
        glow.addColorStop(0.1, 'rgba(255,100,62,.9)');
        glow.addColorStop(0.23, 'rgba(253,60,36,.28)');
        glow.addColorStop(0.52, 'rgba(172,28,16,.095)');
        glow.addColorStop(1, 'rgba(127,17,10,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })(),
      color: 0xffa084,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    }),
  );
  pin.scale.setScalar(0.64);
  pin.position.copy(destination.group.position);
  group.add(destination.group, pin, earth, wake.mesh);
  const shot = chapter(
    group,
    [0, 0.12, 10.65],
    [0, 0.12, 0],
    40,
    5.3,
    22,
    (time, dt, p) => {
      // Finish translating before the edit; the last two seconds hold the wide
      // composition with only stellar flicker and exhaust flowing into the dark.
      const f = Math.min(1, phase(time, p) / 0.8);
      const travel = f * f * (3 - 2 * f);
      earth.position.lerpVectors(start, end, travel);
      const size = 1.03 - 0.57 * travel;
      earth.scale.setScalar(size);
      wake.mesh.position.copy(earth.position);
      wake.mesh.quaternion.setFromUnitVectors(UP, direction);
      wake.update(radius * size, 8.1 + 1.0 * travel, time);
      destination.update(time, 0.83 + 0.03 * Math.sin(time * 0.77));
    },
    earth,
    radius,
    destination.group,
    destination.group,
  );
  shot.wakeDirection = direction;
  shot.setWake = (value) => {
    wake.mesh.material.uniforms.wakePower.value = value;
    wake.mesh.visible = value > 0.0001;
  };
  return shot;
}
