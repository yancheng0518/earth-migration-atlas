import * as THREE from 'three';

const TAU = 2 * Math.PI;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mix = THREE.MathUtils.lerp;
const ease = THREE.MathUtils.smootherstep;
const clamp = THREE.MathUtils.clamp;
const systemDistance = 510;
const galacticDistance = 23300;
const solarPosition = V(-38, -0.6, -15);
const corePosition = V(-5200, -210, -6950);
const galacticRadius = 10150;

function seeded(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const pointsVertex = `
  uniform float pixelRatio, magnification, strength;
  attribute float radius, intensity;
  varying vec3 tint;
  varying float power;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = pixelRatio * clamp(radius * mix(.83, magnification / max(1., -mv.z), .23), .65, 7.0);
    tint = color;
    power = strength * intensity;
  }
`;
const pointsFragment = `
  varying vec3 tint;
  varying float power;
  void main() {
    vec2 q = gl_PointCoord * 2. - 1.;
    float r = dot(q, q);
    float light = (.78 * exp(-6.5 * r) + .22 * exp(-2.35 * r)) * (1. - smoothstep(.43, 1., r));
    gl_FragColor = vec4(tint, light * power);
    #include <colorspace_fragment>
  }
`;

function pointCloud(positions, colors, radii, intensities, magnification, name) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('radius', new THREE.Float32BufferAttribute(radii, 1));
  geometry.setAttribute('intensity', new THREE.Float32BufferAttribute(intensities, 1));
  const uniforms = { pixelRatio: { value: 1 }, strength: { value: 0 }, magnification: { value: magnification } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: pointsVertex,
    fragmentShader: pointsFragment,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Points(geometry, material);
  mesh.name = name;
  mesh.renderOrder = 5;
  return { mesh, uniforms };
}

const planetVertex = `
  varying vec3 normalWorld, normalLocal, positionWorld;
  void main() {
    normalLocal = normalize(position);
    normalWorld = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.);
    positionWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const planetFragment = `
  varying vec3 normalWorld, normalLocal, positionWorld;
  uniform vec3 sunPosition, low, high;
  uniform float banded, fading, nodal;
  void main() {
    vec3 n = normalize(normalWorld), local = normalize(normalLocal);
    vec3 lightDirection = normalize(sunPosition-positionWorld);
    float terminator = dot(n, lightDirection);
    float lambert = pow(max(0., terminator), .72);
    float rim = pow(1.-max(0., dot(n, normalize(cameraPosition-positionWorld))), 5.);
    float bend = local.y + .035 * sin(7. * local.x) * cos(5. * local.z);
    float bands = .48 + .21 * sin(bend * 28.) + .15 * sin(bend * 59.) + .07 * sin(bend * 107.);
    float land = .5 + .21 * sin(15.*local.x+11.*local.z) * sin(14.*local.y+3.*local.x)
      + .12 * sin(31.*local.y+34.*local.x) * cos(34.*local.z);
    vec3 base = mix(low, high, mix(land, bands, banded));
    // The wide bands can still show a storm when the body fills the lens.
    float storm = length((local.xy - vec2(.28,-.24)) * vec2(4.6,12.));
    base = mix(base, base * vec3(1.18,.70,.49), (1.-smoothstep(.1,1.,storm))*banded*step(.22,local.z));
    vec3 lit = base * (.059 + 1.26 * lambert);
    lit += high * (smoothstep(-.14,.55,terminator) * .24 + .027) * rim;
    lit = mix(lit, base * .5, nodal * .48);
    gl_FragColor = vec4(lit, fading);
    #include <colorspace_fragment>
  }
`;

const solarNoise = `
  float seed(vec3 p) {
    p=fract(p*.3183099+vec3(.13,.33,.57));
    p*=17.;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
  }
  float ripple(vec3 x) {
    vec3 i=floor(x), f=fract(x);
    vec3 u=f*f*(3.-2.*f);
    return mix(
      mix(mix(seed(i),seed(i+vec3(1,0,0)),u.x),mix(seed(i+vec3(0,1,0)),seed(i+vec3(1,1,0)),u.x),u.y),
      mix(mix(seed(i+vec3(0,0,1)),seed(i+vec3(1,0,1)),u.x),mix(seed(i+vec3(0,1,1)),seed(i+1.),u.x),u.y),u.z);
  }
`;

function solarPhotosphere(sphere) {
  const uniforms = { age: { value: 0 }, visibility: { value: 0 } };
  const mesh = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    transparent: true,
    vertexShader: planetVertex,
    fragmentShader: `
      uniform float age, visibility;
      varying vec3 normalWorld, normalLocal, positionWorld;
      ${solarNoise}
      void main(){
        vec3 n=normalize(normalLocal), eye=normalize(cameraPosition-positionWorld);
        float edge=max(0.,dot(eye,normalize(normalWorld)));
        vec3 p=n*11.+vec3(age*.048,0.,age*-.015);
        float convection=ripple(p*2.15)+.47*ripple(p*5.4)+.22*ripple(p*11.9);
        float activity=ripple(p*.31+vec3(0.,5.2,2.9));
        float gap=smoothstep(.15,.56,convection);
        float filament=1.-smoothstep(.02,.46,abs(convection-.72));
        vec3 ember=vec3(.92,.13,.016);
        vec3 flame=vec3(2.68,1.06,.24);
        vec3 color=mix(ember,flame,clamp(gap*.69+activity*.38,0.,1.));
        color=(color+.46*flame*filament*activity)*(.66+.48*pow(edge,.44));
        gl_FragColor=vec4(color,visibility);
        #include <colorspace_fragment>
      }
    `,
  }));
  mesh.scale.setScalar(5.8);
  mesh.name = 'Convecting solar photosphere';
  mesh.renderOrder = 12;
  return { mesh, uniforms };
}

function solarCorona() {
  const uniforms = { gain: { value: 0 }, age: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 point;
      void main(){
        point=uv*2.-1.;
        vec4 center=modelViewMatrix*vec4(0.,0.,0.,1.);
        center.xy+=position.xy;
        gl_Position=projectionMatrix*center;
      }
    `,
    fragmentShader: `
      uniform float gain,age;
      varying vec2 point;
      ${solarNoise}
      void main(){
        float r=length(point), a=atan(point.y,point.x);
        float height=max(0.,r-.125);
        float wind=ripple(vec3(cos(a)*8.+1.8*height,sin(a)*8.,height*5.-age*.035));
        float lobe=.5+.5*cos(4.*a+2.3*cos(3.*a+age*.035));
        float ray=pow(wind,.95+2.*height)*(.22+.78*lobe);
        float scald=exp(-height*25.)*(.56+.44*wind);
        float stream=ray*exp(-height*(5.7-2.2*lobe));
        float arch=pow(max(0.,sin(17.*a+22.*height+wind*1.45)),4.)*
          exp(-height*12.)*smoothstep(.52,.93,wind);
        float alpha=(scald*.30+stream*.43+arch*.45)*smoothstep(.108,.142,r)*
          (1.-smoothstep(.72,1.,r));
        vec3 tint=mix(vec3(1.52,.68,.17),vec3(.46,.11,.021),smoothstep(.02,.82,height));
        gl_FragColor=vec4(tint,alpha*gain);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(92, 92), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.name = 'Solar corona and magnetic streamers';
  return { mesh, uniforms };
}

function stellarGlow(size, color, drawOrder) {
  const uniforms = { gain: { value: 0 }, tint: { value: new THREE.Color(color) } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 p;
      void main() {
        p = uv * 2. - 1.;
        vec4 viewCenter = modelViewMatrix * vec4(0.,0.,0.,1.);
        viewCenter.xy += position.xy * length(modelMatrix[0].xyz);
        gl_Position = projectionMatrix * viewCenter;
      }
    `,
    fragmentShader: `
      uniform float gain;
      uniform vec3 tint;
      varying vec2 p;
      void main() {
        float d = dot(p,p);
        float light = (.57 * exp(-21. * d) + .21 * exp(-6.8 * d)) * (1. - smoothstep(.52, 1., d));
        gl_FragColor = vec4(tint, gain * light);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = drawOrder;
  return { mesh, uniforms };
}

function debrisBelt(inner, outer, icy, routeRadius) {
  const random = seeded(icy ? 54711 : 199238);
  const positions = [], colors = [], sizes = [], lights = [];
  const density = icy ? 1850 : 2750;
  const midpoint = (inner + outer) * .5;
  for (let i = 0; i < density; i++) {
    const a = TAU * random();
    const variation = (random() + random() + random()) / 3;
    const resonance = Math.sin(a * (icy ? 2 : 5) + .3);
    const clump = Math.abs(random() - .5) < .41;
    const edge = clump ? .75 + .25 * resonance : 1;
    const r = routeRadius(mix(midpoint, mix(inner, outer, variation), edge));
    const y = (random() + random() - 1) * (icy ? 8.2 : 2.9) + Math.sin(a * 2. + .9) * (icy ? 2.5 : .85);
    const tint = icy ? [mix(.24,.49,random()), mix(.42,.72,random()), .89] :
      [mix(.60,.93,random()), mix(.33,.71,random()), mix(.17,.44,random())];
    positions.push(Math.cos(a) * r, y, Math.sin(a) * r * (icy ? .93 : .98));
    colors.push(...tint);
    sizes.push(.78 + random() ** 5 * (icy ? 1.65 : 2.05));
    lights.push(.10 + random() ** 2 * (icy ? .27 : .60));
  }
  const particles = pointCloud(positions, colors, sizes, lights, 380, icy ? 'Kuiper belt ice bodies' : 'Main asteroid belt rocks');
  const width = routeRadius(outer) - routeRadius(inner);
  const radius = routeRadius(midpoint);
  const innerRadius = radius - width * .54;
  const outerRadius = radius + width * .54;
  const uniforms = { opacity: { value: 0 }, start: { value: innerRadius }, width: { value: outerRadius - innerRadius },
    tint: { value: new THREE.Color(icy ? 0x4e8dd4 : 0x9f7250) } };
  const disc = new THREE.Mesh(new THREE.RingGeometry(innerRadius, outerRadius, 146, 5), new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 point;
      void main(){point=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
    `,
    fragmentShader: `
      varying vec2 point;
      uniform vec3 tint;
      uniform float opacity,start,width;
      ${solarNoise}
      void main(){
        float track=(length(point)-start)/width;
        float envelope=4.*track*(1.-track);
        float lane=ripple(vec3(point*.18,.8));
        float strands=.58+.28*sin(32.*track+lane*1.9)+.14*cos(76.*track);
        float density=envelope*envelope*strands*lane*lane;
        gl_FragColor=vec4(tint,density*opacity);
        #include <colorspace_fragment>
      }
    `,
  }));
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = -2;
  const group = new THREE.Group();
  group.add(disc, particles.mesh);
  return { group, particles, uniforms };
}

function departureTrack() {
  // A fictional transfer arc, in world coordinates. The inhabited Earth's
  // origin is the first vertex and does not move as the viewer zooms out.
  const curve = new THREE.CubicBezierCurve3(V(0,0,0), V(49,-3,-8), V(26,9,-102), V(-105,27,-174));
  const samples = curve.getPoints(145);
  const positions = new THREE.Float32BufferAttribute(samples.flatMap(point => point.toArray()), 3);
  const fraction = new THREE.Float32BufferAttribute(samples.map((_, i) => i / (samples.length - 1)), 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('fraction', fraction);
  const uniforms = { opacity: { value: 0 }, age: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float fraction;
      varying float t;
      void main(){t=fraction;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
    `,
    fragmentShader: `
      varying float t;
      uniform float age,opacity;
      void main(){
        float trail=(1.-smoothstep(.54,1.,t))*smoothstep(.0,.04,t);
        float dash=.25+.75*smoothstep(.21,.49,fract(t*36.));
        float beacon=pow(max(0.,cos(6.283*(t*2.9-age*.22))),38.);
        gl_FragColor=vec4(mix(vec3(.09,.64,.95),vec3(.84,1.1,1.2),beacon),trail*max(dash,beacon)*opacity);
        #include <colorspace_fragment>
      }
    `,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 9;
  line.name = 'Earth migration trajectory (schematic)';
  return { line, uniforms };
}

function makeSolarSystem() {
  const group = new THREE.Group();
  group.name = 'Sun and the eight orbital paths';
  const ecliptic = new THREE.Group();
  const tilt = new THREE.Euler(.078, -.06, .052);
  ecliptic.rotation.copy(tilt);
  ecliptic.position.copy(solarPosition);
  group.add(ecliptic);
  const sphere = new THREE.SphereGeometry(1, 30, 18);
  const sun = solarPhotosphere(sphere);
  const corona = solarCorona();
  const sunAura = stellarGlow(66, 0xf6a167, 8);
  ecliptic.add(sun.mesh, corona.mesh, sunAura.mesh);

  // Map the AU ladder with the same monotonic power curve for every orbit.
  // The installed 2.2-unit Earth stays real; the other discs are enlarged
  // slightly in this view so they remain identifiable rather than aliasing.
  const AU = solarPosition.length();
  const earthAngle = Math.atan2(-solarPosition.z, -solarPosition.x) + .06;
  const earthMarker = stellarGlow(10, 0x90baff, 6);
  group.add(earthMarker.mesh);
  const planetData = [
    ['Mercury', .39, 1.75, 0x454654, 0x9b9389, 0, .53, .9],
    ['Venus', .72, 2.5, 0x6b4736, 0xdfb687, 0, -1.08, .37],
    ['Earth', 1, 2.2, 0, 0, 0, earthAngle, 0],
    ['Mars', 1.52, 2.12, 0x5d3126, 0xc47b5b, 0, 1.9, .22],
    ['Jupiter', 5.2, 5.9, 0x806858, 0xf3cbb0, 1, 2.82, .085],
    ['Saturn', 9.54, 4.52, 0x92745f, 0xf3d29a, 1, -.56, .036],
    ['Uranus', 19.2, 3.08, 0x467385, 0xb2d9db, 1, -2.05, .017],
    ['Neptune', 30.1, 3.22, 0x34517d, 0x668dbf, 1, .89, .011],
  ];
  const orbitPositions = [], orbitColors = [];
  const routeRadius = au => AU * au ** .435;
  const mainBelt = debrisBelt(2.1, 3.35, false, routeRadius);
  const transNeptunian = debrisBelt(31, 50, true, routeRadius);
  ecliptic.add(mainBelt.group, transNeptunian.group);
  const escape = departureTrack();
  group.add(escape.line);
  const planets = [];
  const rings = new THREE.RingGeometry(5.75, 10.2, 96, 3);
  const ringMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { alpha: { value: 0 } },
    vertexShader: `varying vec2 rr;void main(){rr=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `
      uniform float alpha;
      varying vec2 rr;
      void main() {
        float r = (length(rr)-5.75)/4.45;
        float density = smoothstep(.0,.13,r) * (1.-smoothstep(.92,1.,r));
        float cassini=1. - .86 * exp(-pow((r - .65) * 23.,2.));
        density *= (.64+.15*sin(r*47.)+.11*sin(r*94.))*cassini;
        vec3 outside=vec3(.38,.28,.17), inside=vec3(.89,.72,.49);
        gl_FragColor=vec4(mix(inside,outside,smoothstep(.36,.93,r)),density * alpha);
        #include <colorspace_fragment>
      }
    `,
  });

  for (const [name, au, size, low, high, banded, angle, motion] of planetData) {
    const radius = routeRadius(au);
    const tint = name === 'Earth' ? [.28, .66, .85] : au < 2 ? [.32, .40, .50] : [.25, .40, .54];
    for (let i = 0; i < 160; i++) {
      for (const j of [i, i + 1]) {
        const a = j * TAU / 160;
        orbitPositions.push(radius * Math.cos(a), 0, radius * Math.sin(a));
        const grazing = .54 + .46 * Math.pow(.5 + .5 * Math.cos(a - .9), 1.8);
        orbitColors.push(tint[0] * grazing, tint[1] * grazing, tint[2] * grazing);
      }
    }
    if (name === 'Earth') continue;
    const uniforms = {
      sunPosition: { value: solarPosition }, low: { value: new THREE.Color(low) }, high: { value: new THREE.Color(high) },
      banded: { value: banded }, fading: { value: 0 }, nodal: { value: 0 },
    };
    const node = new THREE.Group();
    const globe = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
      uniforms, vertexShader: planetVertex, fragmentShader: planetFragment,
      transparent: true,
    }));
    globe.scale.set(size, size * (banded ? .93 : 1), size);
    node.name = name;
    node.add(globe);
    if (name === 'Saturn') {
      const band = new THREE.Mesh(rings, ringMaterial);
      band.rotation.set(Math.PI * .57, -.28, -.17);
      node.add(band);
    }
    const satellites = [];
    if (name === 'Jupiter' || name === 'Saturn') {
      const count = name === 'Jupiter' ? 4 : 2;
      const moonMaterial = new THREE.MeshBasicMaterial({ color: 0x8e9ca7, transparent: true, opacity: 0 });
      for (let i = 0; i < count; i++) {
        const moon = new THREE.Mesh(sphere, moonMaterial);
        moon.scale.setScalar(.27 + .11 * i);
        node.add(moon);
        satellites.push(moon);
      }
    }
    ecliptic.add(node);
    planets.push({ node, globe, uniforms, radius, angle, motion, satellites, size });
  }
  const orbits = new THREE.BufferGeometry();
  orbits.setAttribute('position', new THREE.Float32BufferAttribute(orbitPositions, 3));
  orbits.setAttribute('color', new THREE.Float32BufferAttribute(orbitColors, 3));
  const orbitLines = new THREE.LineSegments(orbits, new THREE.LineBasicMaterial({
    color: 0xc8dfeb, vertexColors: true, opacity: 0, transparent: true, depthWrite: false,
  }));
  orbitLines.renderOrder = -1;
  ecliptic.add(orbitLines);

  function update(scale, time, height) {
    group.visible = scale > .08 && scale < 1.48;
    if (!group.visible) return;
    const show = ease(scale, .09, .43) * (1 - ease(scale, 1.18, 1.48));
    const lines = ease(scale, .28, .68) * (1 - ease(scale, 1.05, 1.44));
    sun.uniforms.visibility.value = show;
    sun.uniforms.age.value = corona.uniforms.age.value = time;
    sunAura.uniforms.gain.value = show * .52;
    corona.uniforms.gain.value = show * 1.1;
    orbitLines.material.opacity = lines * .41;
    escape.uniforms.opacity.value = lines * .78;
    escape.uniforms.age.value = time;
    const pixelRatio = clamp(height / 560, .78, 1.5);
    const debris = show * ease(scale, .29, .58) * (1 - ease(scale, 1.08, 1.39));
    mainBelt.particles.uniforms.strength.value = debris * .82;
    mainBelt.uniforms.opacity.value = debris * .30;
    transNeptunian.particles.uniforms.strength.value = debris * .70;
    transNeptunian.uniforms.opacity.value = debris * .35;
    mainBelt.particles.uniforms.pixelRatio.value = transNeptunian.particles.uniforms.pixelRatio.value = pixelRatio;
    mainBelt.group.rotation.y = time * .0024;
    transNeptunian.group.rotation.y = time * .0013;
    ringMaterial.uniforms.alpha.value = show * .85;
    earthMarker.uniforms.gain.value = .39 * ease(scale, .58, .91) * (1 - ease(scale, 1.17, 1.48));
    for (const { node, globe, uniforms, radius, angle, motion, satellites, size } of planets) {
      const a = angle + time * motion * .033;
      node.position.set(radius * Math.cos(a), 0, radius * Math.sin(a));
      globe.rotation.y = time * .014;
      uniforms.fading.value = show;
      uniforms.nodal.value = ease(scale, .77, 1.27);
      for (const [i, moon] of satellites.entries()) {
        const aMoon = i * 2.9 + time * (.15 - i * .023);
        const moonRadius = size * (1.9 + i * .48);
        moon.position.set(moonRadius * Math.cos(aMoon), .68 * Math.sin(aMoon * 1.13 + i), moonRadius * Math.sin(aMoon));
        moon.material.opacity = show * .73;
      }
    }
  }
  return { group, update };
}

// Seeded density at the centreline of four winding arms. A shifted copy of the
// envelope cuts dust lanes along the inside of each bright stellar ridge.
const armPhase = angle => 4 * angle;
const spiralPhase = (angle, radius) => armPhase(angle - 2.89 * Math.log(Math.max(.055, radius)));
const ridge = (phase, tightness) => Math.exp((Math.cos(phase) - 1) * tightness);

function noiseTable() {
  const random = seeded(310454);
  const table = Float32Array.from({ length: 128 ** 2 }, () => random());
  function at(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    const a = x - i, b = y - j, u = a * a * (3 - 2 * a), v = b * b * (3 - 2 * b);
    const k = (j & 127) * 128, l = ((j + 1) & 127) * 128;
    return mix(mix(table[k + (i & 127)], table[k + ((i + 1) & 127)], u),
      mix(table[l + (i & 127)], table[l + ((i + 1) & 127)], u), v);
  }
  return (x, y) => .52 * at(x, y) + .24 * at(x * 2.13 + 18.5, y * 2.13) +
    .15 * at(x * 5.3 + 8.4, y * 5.3 + 37.8) + .09 * at(x * 13.1, y * 13.1);
}

function galacticLightMap() {
  const size = 640;
  const pixels = new Uint8Array(size * size * 4);
  const noise = noiseTable();
  for (let y = 0; y < size; y++) {
    const b = 2 * (y + .5) / size - 1;
    for (let x = 0; x < size; x++) {
      const a = 2 * (x + .5) / size - 1;
      const r = Math.hypot(a, b);
      if (r >= 1) continue;
      const angle = Math.atan2(-b, a);
      const gas = noise(a * 13, b * 13);
      const ph = spiralPhase(angle + .8 * (gas - .5), r);
      const envelope = (1 - ease(r, .71, 1)) * (1 - Math.exp(-r * 21));
      const lane = 1 - .7 * ridge(ph - .69 + (gas - .5) * 1.1, 9.0) * ease(r, .12, .77);
      const outer = .095 * Math.exp(-3.4 * r) * (gas + .33) * envelope;
      const arm = .86 * (ridge(ph, 1.68) + .31 * ridge(ph + .29, 7.2)) *
        Math.exp(-2.32 * r) * envelope * lane * (.16 + gas * gas * 2.2);
      const central = Math.exp(-10.5 * Math.hypot(a, b * 1.84));
      const nucleus = Math.exp(-r * 36);
      const ion = .074 * Math.max(0, gas - .59) * (ridge(ph - .35, 3.8) + .14);
      const offset = 4 * (y * size + x);
      const write = (channel, density) => { pixels[offset + channel] = Math.min(255, 255 * (1 - Math.exp(-density))); };
      write(0, (outer * .94 + arm * (.77 + .27 * (1 - r)) + central * 1.68 + nucleus * 2.7 + ion * 2.7) * 1.3);
      write(1, (outer * .87 + arm * (.60 + .19 * r) + central * .92 + nucleus * 1.94 + ion * .6) * 1.32);
      write(2, (outer * 1.08 + arm * (.65 + .54 * r) + central * .43 + nucleus * 1.37 + ion * 2.6) * 1.27);
      pixels[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function makeGalaxy() {
  const group = new THREE.Group();
  group.position.copy(corePosition);
  group.name = 'Milky Way spiral disc';
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(galacticRadius * 2, galacticRadius * 2),
    new THREE.ShaderMaterial({
      uniforms: { lightMap: { value: galacticLightMap() }, gain: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 uvMap;void main(){uvMap=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `
        uniform sampler2D lightMap;
        uniform float gain;
        varying vec2 uvMap;
        void main() {
          vec3 radiance = texture2D(lightMap, uvMap).rgb;
          gl_FragColor = vec4(pow(radiance, vec3(1.62)) * .85, gain);
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 1;
  group.add(plane);

  const random = seeded(123346);
  const positions = [], colors = [], sizes = [], levels = [];
  for (let i = 0; i < 28500; i++) {
    const bulge = i < 3300, halo = i > 26350;
    const draw = random();
    const r = bulge ? Math.min(.57, -Math.log(1 - draw * .987) * .085) :
      halo ? Math.sqrt(draw) : .063 + .92 * (random() + draw * 1.15) / 2.15;
    const arm = Math.floor(random() * 4);
    const scatter = random() + random() + random() - 1.5;
    const angle = halo || bulge ? TAU * random() : 2.89 * Math.log(r) + TAU / 4 * arm + scatter * (.36 + .25 * r);
    const y = scatter * galacticRadius * (bulge ? .28 * Math.exp(-r * 4) : halo ? .26 : .046 + .05 * r);
    const h = random();
    const standard = [0.67, .77, 1], warm = [1, .76, .51], hot = [1, .91, .75], nebular = [1, .52, .68];
    const tint = h < .044 && !bulge ? nebular : h < (bulge ? .76 : .21) ? warm : h > .78 ? hot : standard;
    positions.push(galacticRadius * r * Math.cos(angle), y, galacticRadius * r * Math.sin(angle));
    colors.push(...tint);
    const sparkle = random() ** 12;
    sizes.push(.68 + sparkle * 1.85 + (bulge ? .12 : 0));
    levels.push((halo ? .24 : bulge ? .48 : .43) * (.48 + random() * .46) + .55 * sparkle);
  }
  const stars = pointCloud(positions, colors, sizes, levels, 22500, 'Resolved stars');
  group.add(stars.mesh);
  return { group, plane, stars };
}

function makeLocalStars() {
  const random = seeded(11856);
  const positions = [], colors = [], radii = [], levels = [];
  for (let i = 0; i < 650; i++) {
    const a = random() * TAU;
    const r = 150 + 9100 * Math.sqrt(random());
    const height = (random() + random() + random() - 1.5) * 2000;
    positions.push(Math.cos(a) * r, height, Math.sin(a) * r);
    colors.push(...(random() < .29 ? [1, .69, .42] : [.65, .79, 1]));
    const bright = random() ** 10;
    radii.push(.85 + bright * 2.7);
    levels.push(.35 + bright * .47);
  }
  return pointCloud(positions, colors, radii, levels, 1300, 'Solar neighbourhood');
}

/** The atlas retains the original Earth-centred frame. Distance grows along
 * one logarithmic dolly, and the aim gradually moves from Earth to the Sun
 * and the galactic core without swaps of camera or world coordinates. */
export function createCosmic() {
  const group = new THREE.Group();
  group.name = 'Solar and galactic observatory';
  const solar = makeSolarSystem();
  const galaxy = makeGalaxy();
  const local = makeLocalStars();
  const home = stellarGlow(190, 0x9acaff, 7);
  const star = pointCloud([0, 0, 0], [.66, .82, 1], [4.5], [1.2], 12000, 'Sun seen from the galactic disc');
  group.add(solar.group, galaxy.group, local.mesh, home.mesh, star.mesh);
  const sourceDirection = V(0, 0, 1), direction = V(0, 0, 1);
  const systemView = V(.38, .55, .74).normalize();
  const approach = V(.51, .15, .85).normalize(), galacticView = V(.18, .80, .58).normalize();
  const finalAim = V(0, 0, 0);
  const north = V(0, 1, 0);
  const turn = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const spherical = new THREE.Spherical();
  const pose = { eye: V(0,0,0), aim: V(0,0,0), up: north.clone(), fov: 40, near: .03, far: 1400 };

  function sample(scale, source, yaw = 0, pitch = 0) {
    if (scale <= 0) return source;
    const s = Math.min(2, scale);
    const originDistance = Math.max(3, source.eye.length());
    const radius = s <= 1 ? originDistance * (systemDistance / originDistance) ** s :
      systemDistance * (galacticDistance / systemDistance) ** (s - 1);
    const globeToSun = ease(s, .02, .88);
    const toDisc = ease(s, 1.12, 1.72);
    sourceDirection.copy(source.eye).normalize();
    turn.setFromUnitVectors(sourceDirection, systemView);
    rotation.identity().slerp(turn, globeToSun);
    direction.copy(sourceDirection).applyQuaternion(rotation);
    turn.setFromUnitVectors(direction, approach);
    rotation.identity().slerp(turn, ease(s, 1.02, 1.42));
    direction.applyQuaternion(rotation);
    turn.setFromUnitVectors(direction, galacticView);
    rotation.identity().slerp(turn, ease(s, 1.41, 2.04));
    direction.applyQuaternion(rotation);
    spherical.setFromVector3(direction);
    const drag = ease(s, 0, .32);
    spherical.theta += yaw * drag;
    spherical.phi = clamp(spherical.phi + pitch * drag, .13, Math.PI - .13);
    direction.setFromSpherical(spherical);
    finalAim.copy(source.aim).lerp(solarPosition, .73 * ease(s, .29, .94)).lerp(corePosition, toDisc);
    pose.aim.copy(finalAim);
    // As aim begins to move off Earth the camera follows it, preserving the
    // same local lens height and keeping the migration path out of the globe.
    pose.eye.copy(direction).multiplyScalar(radius).addScaledVector(solarPosition, .73 * ease(s, .3, .94) * (1 - toDisc));
    pose.eye.addScaledVector(corePosition, ease(s, 1.39, 1.88));
    pose.up.copy(source.up).lerp(north, globeToSun).normalize();
    pose.fov = mix(source.fov, 37, ease(s, .04, .54)) + 5 * toDisc;
    pose.near = mix(source.near, Math.max(1, radius * .007), ease(s, .21, .92));
    pose.far = Math.max(1400, radius + 720 + 26000 * ease(s, 1, 1.31));
    return pose;
  }

  function update(scale, time, camera, height) {
    group.visible = scale > .08;
    if (!group.visible) return;
    solar.update(scale, time, height);
    const nearby = ease(scale, .96, 1.32) * (1 - ease(scale, 1.83, 2.12));
    const disc = ease(scale, 1.10, 1.58);
    const homeLight = ease(scale, 1.05, 1.4);
    galaxy.group.visible = scale > 1.10;
    galaxy.plane.material.uniforms.gain.value = .91 * disc;
    galaxy.stars.uniforms.strength.value = .92 * disc;
    local.mesh.visible = nearby > .001;
    local.uniforms.strength.value = nearby * .72;
    home.mesh.visible = star.mesh.visible = homeLight > .001;
    home.mesh.scale.setScalar(mix(.16, 1.15, ease(scale, 1.2, 1.9)));
    home.uniforms.gain.value = .72 * homeLight;
    star.uniforms.strength.value = homeLight;
    const ratio = clamp(height / 650, .6, 1.3);
    for (const cloud of [galaxy.stars, local, star]) cloud.uniforms.pixelRatio.value = ratio;
  }

  group.visible = false;
  return { group, sample, update };
}
