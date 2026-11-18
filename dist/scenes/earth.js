import * as THREE from 'three';

const RADIUS = 2.2;
const TAU = Math.PI * 2;
const LOCAL_NORTH = new THREE.Vector3(0, 1, 0);
const ELEVATOR_LONGITUDE = THREE.MathUtils.degToRad(154);
const ELEVATOR_VERTICAL = new THREE.Vector3(Math.cos(ELEVATOR_LONGITUDE), 0, -Math.sin(ELEVATOR_LONGITUDE));
const ELEVATOR_FOOT = ELEVATOR_VERTICAL.clone().multiplyScalar(RADIUS);
const SUN = new THREE.Vector3(0.92, 0.56, -0.1).normalize();
const START_LONGITUDE = -3.52;
const TEXTURES = {
  'blue-marble.jpg': new URL('../assets/earth/blue-marble.jpg', import.meta.url).href,
  'black-marble.jpg': new URL('../assets/earth/black-marble.jpg', import.meta.url).href,
  // Mapzen Terrain Tiles, USGS SRTM/GMTED2010 and NOAA ETOPO1. The 16.875° Borneo
  // tile encodes east/north slope and elevation; the ice and roads are fictional.
  // https://registry.opendata.aws/terrain-tiles/  https://github.com/tilezen/joerd/blob/master/docs/attribution.md
  'borneo-relief.webp': new URL('../assets/earth/borneo-relief.webp', import.meta.url).href,
  'cloud-cover.jpg': new URL('../assets/earth/cloud-cover.jpg', import.meta.url).href,
};

const surfaceVertex = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vCenter, vPlanet;
  void main() {
    vPlanet = normal;
    vec4 world = modelMatrix * vec4(position, 1.);
    vUv = uv;
    vPosition = world.xyz;
    vCenter = modelMatrix[3].xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

function makeSurface(engineSite) {
  const loader = new THREE.TextureLoader();
  function load(name, color) {
    const map = loader.load(TEXTURES[name]);
    map.wrapS = THREE.RepeatWrapping;
    map.anisotropy = 4;
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }
  const uniforms = {
    land: { value: load('blue-marble.jpg', true) },
    lights: { value: load('black-marble.jpg') },
    clouds: { value: load('cloud-cover.jpg') },
    relief: { value: load('borneo-relief.webp') },
    site: { value: engineSite.clone().normalize() },
    sun: { value: SUN },
    time: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: surfaceVertex,
    fragmentShader: `
      uniform sampler2D land, lights, clouds, relief;
      uniform vec3 site;
      uniform vec3 sun;
      uniform float time;
      varying vec2 vUv;
      varying vec3 vNormal, vPosition, vPlanet;
      // A quiet strip follows the real freight access and the rounded yard road.
      // Distances are in the engine frame, using precisely the ground model scale.
      float segmentDistance(vec2 p,vec2 a,vec2 b) {
        vec2 delta=b-a;
        return length(p-a-delta*clamp(dot(p-a,delta)/dot(delta,delta),0.,1.));
      }
      float accessRoad(vec2 g) {
        vec2 q=abs(g+vec2(0.,7.))-vec2(24.,16.);
        float belt=abs(length(max(q,0.))+min(max(q.x,q.y),0.)-8.);
        float rail=max(abs(g.x+g.y*.06-14.),abs(g.y)-135.);
        float road=min(belt,rail);
        road=min(road,segmentDistance(g,vec2(-28.,-21.),vec2(-76.,-35.)));
        road=min(road,segmentDistance(g,vec2(-36.,-25.),vec2(-65.,-88.)));
        road=min(road,segmentDistance(g,vec2(10.,-94.),vec2(-13.,-109.)));
        road=min(road,segmentDistance(g,vec2(17.,-58.),vec2(34.,-59.)));
        road=min(road,segmentDistance(g,vec2(12.,34.),vec2(81.,46.)));
        road=min(road,segmentDistance(g,vec2(-28.,10.),vec2(-99.,34.)));
        return road;
      }
      void main() {
        vec3 n = normalize(vNormal);
        vec3 eye = normalize(cameraPosition - vPosition);
        float light = dot(n, sun);
        float facing = max(dot(n, eye), 0.);
        float day = smoothstep(-0.16, 0.68, light);
        float diffuse = pow(max(light, 0.), 0.66);
        vec3 albedo = texture2D(land, vUv).rgb;
        float groundLuma = dot(albedo, vec3(0.22,0.66,0.12));
        float ocean = smoothstep(0.001,0.031,albedo.b - max(albedo.r,albedo.g * 0.94));
        vec2 cloudUV = vUv + vec2(time * 0.000011, 0.);
        float cloud = texture2D(clouds, cloudUV).r;
        // The synoptic cloud mask determines where the fine cirrus can form.
        // Use the observed cloud field at smaller scales for wind-stretched rolls.
        float eyeRange=distance(cameraPosition,vPosition);
        float nearDetail=1.-smoothstep(.72,3.85,eyeRange);
        vec2 detailUV=vec2(10.*vUv.x+1.3*vUv.y,18.*vUv.y-.8*vUv.x);
        float cirrus=texture2D(clouds,detailUV+vec2(cloud*.17,time*.000014)).r;
        float breaking=smoothstep(.11,.6,cloud)*(1.-smoothstep(.7,.98,cloud));
        cloud=clamp(cloud+breaking*(cirrus-.42)*(.21+.38*nearDetail),0.,1.);
        float cloudShade = texture2D(clouds, cloudUV + vec2(0.0023,-0.0012)).r;
        float cover = smoothstep(0.09,0.91,cloud);
        vec3 base = mix(albedo, vec3(groundLuma), 0.20);
        base = mix(base, base * vec3(0.44,0.83,1.32) + vec3(0.001,0.004,0.012), ocean);
        vec3 sunlight = mix(vec3(1.0,0.77,0.62),vec3(1.1,1.08,1.04),smoothstep(0.,0.49,light));
        vec3 surface = base * (vec3(0.067,0.096,0.18) + 1.43 * sunlight * diffuse);
        surface *= 1. - 0.48 * smoothstep(0.12,0.76,cloudShade) * day;
        // Longitude in equirectangular UV, latitude in the original Web Mercator
        // grid. This is the actual Borneo highlands underneath the CN-07 mount.
        vec3 pole=normalize(vPlanet);
        float merc=log((1.+clamp(pole.y,-.9999,.9999))/max(.0001,sqrt(1.-pole.y*pole.y)));
        vec2 reliefUV=vec2((vUv.x*128.-101.)/6.,.5+merc*(64./3.14159265)/6.);
        vec2 edge=min(reliefUV,1.-reliefUV);
        float regional=smoothstep(.005,.13,min(edge.x,edge.y));
        float province=0.;
        if(nearDetail>.001 && dot(pole,site)>.91){
          vec3 east=normalize(cross(site,vec3(0.,1.,0.)));
          vec3 north=normalize(cross(east,site));
          vec2 g=vec2(dot(pole,east),dot(pole,north))*(2.2/.0023);
          vec3 dem=texture2D(relief,clamp(reliefUV,.001,.999)).rgb;
          vec2 slope=(dem.rg-.5)*2.*regional;
          float ridge=dot(slope,vec2(-.7,.67));
          float elevation=clamp((dem.b-.02)/.96,0.,1.)*regional;
          // Wind-swept shelf ice covers the former shallow water. Stationary
          // regional coordinates keep its long fractures fixed during descent.
          vec2 iceUV=mat2(.00115,.00038,-.00037,.00112)*g+vec2(.53,.43);
          float field=texture2D(clouds,iceUV).r;
          float drift=texture2D(clouds,iceUV*2.95+vec2(.13,.19*field)).r;
          float vein=1.-smoothstep(.012,.070,abs(drift+.27*field-.44));
          float yard=1.-smoothstep(48.,178.,length(g));
          province=(1.-smoothstep(143.,325.,length(g)+(field-.45)*64.))*nearDetail;
          float rock=smoothstep(.11,.62,elevation+.22*ridge);
          float snow=smoothstep(.20,.76,elevation+.54*ridge+.12*drift);
          float shelf=.016+.051*field+.026*drift;
          vec3 ice=vec3(.61,.81,1.)*(shelf-.011*vein);
          ice=mix(ice,vec3(.043,.067,.080)*max(.32,.74+.92*ridge),rock);
          ice=mix(ice,vec3(.18,.211,.221)*max(.27,.74+.85*ridge),snow*.91);
          float road=accessRoad(g), width=max(.45,fwidth(road));
          float asphalt=1.-smoothstep(1.20-width,1.35+width,road);
          ice*=1.-.71*yard*asphalt;
          float lamps=1.-smoothstep(.18,1.08,abs(road-1.92));
          ice+=vec3(.039,.027,.012)*lamps*yard;
          surface=mix(surface,ice,province*.93);
          cover*=1.-province*(.54+.26*yard);
        }
        vec3 halfVector = normalize(eye + sun);
        surface += vec3(0.36,0.57,0.69) * pow(max(dot(n,halfVector),0.),100.) * diffuse * ocean;
        vec3 cloudy = vec3(0.012,0.020,0.053) + sunlight * (0.018 * day + 0.92 * diffuse);
        surface = mix(surface, cloudy, cover * .83);
        float radiance = texture2D(lights,vUv).r;
        float city = pow(max(radiance - 0.115,0.) / 0.885,1.65);
        vec3 cityColor = mix(vec3(0.45,0.51,0.74),vec3(0.86,0.92,1.0),city);
        surface += city * cityColor * (1.-.89*province) * (1.47 - day * 1.37) * (1. - cover * 0.65);
        float limb = 1. - facing;
        float skyLight = smoothstep(-0.48,0.58,light);
        surface += vec3(0.018,0.087,0.285) * pow(limb,3.5) * (0.25 + 1.25 * skyLight);
        surface += vec3(0.34,0.51,0.68) * pow(limb,13.) * skyLight;
        gl_FragColor = vec4(surface,1.);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 112, 80), material);
}

function makeAtmosphere() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS * 1.095, 96, 64),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { sun: { value: SUN }, radius: { value: RADIUS }, opacity: { value: 1 } },
      vertexShader: surfaceVertex,
      fragmentShader: `
        uniform vec3 sun;
        uniform float radius,opacity;
        varying vec3 vPosition, vCenter;
        void main() {
          vec3 ray = normalize(vPosition-cameraPosition);
          vec3 center = vCenter-cameraPosition;
          vec3 nearest = ray * dot(ray,center) - center;
          float h = (length(nearest)-radius)/radius;
          float incident = dot(normalize(nearest),sun);
          float light = smoothstep(-0.59,0.76,incident);
          float narrow = exp(-max(0.,h)*179.);
          float wide = exp(-max(0.,h)*50.);
          float edge = 1.-smoothstep(0.06,0.09,h);
          vec3 rim = mix(vec3(0.13,0.24,0.70),vec3(0.56,0.80,1.0),light);
          float density = (0.67*narrow+0.22*wide) * (0.26 + 0.92*light);
          gl_FragColor=vec4(rim,density*edge*opacity);
          #include <colorspace_fragment>
        }
      `,
    }),
  );
}

function makeArray(ignition, visibility, shared) {
  const engines = [];
  // Preserve the original CN-07 mount (including its small latitude offset).
  const index = shared ? 52 : 59,
    longitude = (index * TAU) / 76,
    latitude = 0.007 * Math.sin(index * 2.14);
  const axis = new THREE.Vector3(
    Math.cos(longitude) * Math.cos(latitude),
    Math.sin(latitude),
    Math.sin(longitude) * Math.cos(latitude),
  );
  const engineSite = axis.clone().multiplyScalar(RADIUS + 0.011);
  // Maritime and continental engineering districts. Each serves a different
  // number of smaller nozzles and the projecting length varies by district.
  const districts = [
    [-164, -1, 2, 0.2],
    [-135, 2, 3, 0.28],
    [-106, 1, 4, 0.36],
    [-80, -2, 5, 0.27],
    [-65, 3, 3, 0.19],
    [-47, -2, 4, 0.3],
    [-24, 1, 2, 0.22],
    [-4, -3, 3, 0.21],
    [15, 1, 5, 0.35],
    [31, -2, 3, 0.25],
    [54, 1, 2, 0.18],
    [74, -2, 4, 0.36],
    [91, 2, 4, 0.28],
    [102, -1, 3, 0.19],
    [120, 2, 3, 0.27],
    [138, -3, 4, 0.33],
    [160, 1, 3, 0.24],
  ];
  for (const [lng, lat, count, reach] of districts) {
    for (let j = 0; j < count; j++) {
      const phase = lng * 0.47 + j * 1.79;
      const lon = THREE.MathUtils.degToRad(lng + (j - (count - 1) * 0.5) * (1.15 + 0.27 * Math.sin(lng)));
      const phi = THREE.MathUtils.degToRad(lat + j * 0.56 + 1.08 * Math.sin(phase));
      const dir = new THREE.Vector3(Math.cos(phi) * Math.cos(lon), Math.sin(phi), -Math.cos(phi) * Math.sin(lon));
      const lead = j === Math.floor(count / 2);
      const scale = lead ? 1 : 0.28 + 0.37 * (0.5 + 0.5 * Math.cos(phase));
      const wave = Math.acos(THREE.MathUtils.clamp(dir.dot(axis), -1, 1)) / Math.PI;
      engines.push({
        axis: dir,
        base: dir.clone().multiplyScalar(RADIUS + 0.005),
        reach: reach * scale,
        width: (lead ? 0.024 : 0.013) * (1 + 0.18 * Math.sin(phase)),
        phase,
        delay: 0.05 + 0.59 * wave + 0.035 * j,
      });
    }
  }
  const positions = [],
    uv = [],
    axes = [],
    parameters = [],
    indices = [];
  for (const engine of engines) {
    // The close-range installation supplies its own plumes inside this footprint.
    // Keep the lift's anchored cable clear of the neighbouring equatorial jet.
    if (
      shared &&
      (engine.base.distanceToSquared(engineSite) < 0.35 ** 2 ||
        engine.base.distanceToSquared(ELEVATOR_FOOT) < 0.12 ** 2)
    )
      continue;
    const offset = positions.length / 3;
    for (const corner of [
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ]) {
      positions.push(...engine.base.toArray());
      axes.push(...engine.axis.toArray());
      uv.push(...corner);
      parameters.push(engine.reach, engine.width, engine.phase, engine.delay);
    }
    indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('axis', new THREE.Float32BufferAttribute(axes, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('parameters', new THREE.Float32BufferAttribute(parameters, 4));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS + 0.95);

  const flags = { side: THREE.DoubleSide, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending };
  const time = { value: 0 };
  const beam = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      ...flags,
      uniforms: { time, ignition, visibility },
      vertexShader: `
      attribute vec3 axis;
      attribute vec4 parameters;
      uniform float time, ignition, visibility;
      varying vec2 beamUV;
      varying float seed, sideView, power;
      void main() {
        vec3 base=(modelMatrix*vec4(position,1.)).xyz;
        vec3 dir=normalize(mat3(modelMatrix)*axis);
        vec3 eye=normalize(cameraPosition-base);
        vec3 transverse=cross(eye,dir);
        sideView=length(transverse);
        vec3 side=sideView>0.002 ? transverse/sideView : vec3(1.,0.,0.);
        power=smoothstep(parameters.w,parameters.w+.22,ignition);
        float pulse=(1.0+.022*sin(time*1.3+parameters.z))*power;
        vec3 p=base+dir*(uv.y*parameters.x*pulse)+side*(uv.x*(0.46+uv.y*1.95)*parameters.y);
        beamUV=uv; seed=parameters.z;
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
      }
    `,
      fragmentShader: `
      uniform float time, ignition, visibility;
      varying vec2 beamUV;
      varying float seed, sideView, power;
      void main() {
        float x=beamUV.x, h=beamUV.y;
        float filament = exp(-abs(x)*8.);
        float mist = exp(-x*x*3.5);
        float wave=.94+.06*sin(h*19.-time*2.8+seed);
        float alpha=(0.72*filament+0.53*mist)*pow(1.-h,1.19)*wave;
        alpha*=(.36+.64*sideView)*power*visibility;
        vec3 color=mix(vec3(0.30,0.70,1.),vec3(0.28,0.18,0.93),smoothstep(0.,0.55,h));
        gl_FragColor=vec4(color,alpha);
        #include <colorspace_fragment>
      }
    `,
    }),
  );
  const flares = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      ...flags,
      uniforms: { time, ignition, visibility },
      vertexShader: `
      attribute vec4 parameters;
      uniform float time, ignition;
      varying vec2 p;
      varying float major, power;
      void main() {
        vec4 mv=modelViewMatrix*vec4(position,1.);
        p=vec2(uv.x,uv.y*2.-1.);
        major=step(.019,parameters.y);
        power=smoothstep(parameters.w,parameters.w+.19,ignition);
        mv.xy+=p*(.057+major*.042)*(1.+0.035*sin(parameters.z+time*2.));
        gl_Position=projectionMatrix*mv;
      }
    `,
      fragmentShader: `
      varying vec2 p;
      varying float major, power;
      uniform float visibility;
      void main() {
        float d=length(p);
        float core=exp(-d*26.);
        float halo=exp(-d*6.8);
        float spike=major*0.15*(exp(-abs(p.y)*110.)*exp(-abs(p.x)*6.)+exp(-abs(p.x)*95.)*exp(-abs(p.y)*9.));
        vec3 color=mix(vec3(0.17,0.34,1.),vec3(0.86,0.98,1.),min(1.,core*5.2));
        gl_FragColor=vec4(color,min(1.,core*1.45+halo*0.65+spike)*(1.-smoothstep(0.78,1.,d))*power*visibility);
        #include <colorspace_fragment>
      }
    `,
    }),
  );
  const array = new THREE.Group();
  array.add(beam, flares);
  return { array, time, engine: engineSite.clone() };
}

function makeContinentalEngines(ignition, visibility, engineSite) {
  // The continental thrust fields are separate from the equatorial steering belt.
  const fields = [
    [101, 40, 11, 4],
    [78, 46, 12, 6],
    [113, 34, 5, 3],
    [83, 26, 6, 2],
    [52, 35, 8, 3],
    [28, 49, 9, 4],
    [14, 51, 6, 3],
    [70, 61, 12, 5],
    [-106, 40, 12, 6],
    [-93, 48, 6, 3],
    [-69, -30, 3, 6],
    [132, -25, 8, 5],
    [24, -26, 6, 3],
    [-4, 25, 10, 6],
  ];
  let seed = 198204;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions = [],
    sizes = [],
    delays = [],
    corners = [],
    indices = [];
  for (const [lon, lat, spanX, spanY] of fields) {
    for (let site = 0; site < 14; site++) {
      const angle = random() * TAU,
        radius = Math.sqrt(random());
      const hubX = lon + Math.cos(angle) * radius * spanX,
        hubY = lat + Math.sin(angle) * radius * spanY;
      const footprint = 0.5 + random() * 1.5;
      for (let i = 0; i < 8; i++) {
        const phase = random() * TAU,
          distance = footprint * Math.sqrt(random());
        const lng = THREE.MathUtils.degToRad(hubX + Math.cos(phase) * distance);
        const phi = THREE.MathUtils.degToRad(hubY + Math.sin(phase) * distance * 0.6);
        const point = new THREE.Vector3(Math.cos(phi) * Math.cos(lng), Math.sin(phi), -Math.cos(phi) * Math.sin(lng));
        const delay =
          0.1 +
          (0.61 * Math.acos(THREE.MathUtils.clamp(point.dot(engineSite) / engineSite.length(), -1, 1))) / Math.PI +
          0.045 * radius;
        point.multiplyScalar(RADIUS + 0.002);
        const size = i === 0 && site % 7 === 0 ? 0.072 : 0.01 + random() ** 3 * 0.03;
        const start = positions.length / 3;
        for (const corner of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          positions.push(...point.toArray());
          sizes.push(size);
          delays.push(delay);
          corners.push(...corner);
        }
        indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(corners, 2));
  geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  geo.setAttribute('delay', new THREE.Float32BufferAttribute(delays, 1));
  geo.setIndex(indices);
  const mat = new THREE.ShaderMaterial({
    uniforms: { sun: { value: SUN }, ignition, visibility },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform vec3 sun;
      attribute float size,delay;
      uniform float ignition;
      varying vec2 p;
      varying float intensity, hub;
      void main(){
        vec3 normal=normalize(mat3(modelMatrix)*position);
        intensity=(1.-.85*smoothstep(-.3,.65,dot(normal,sun)))*smoothstep(delay,delay+.19,ignition);
        hub=step(0.055,size);
        vec4 mv=modelViewMatrix*vec4(position,1.);
        mv.xy+=uv*size;
        p=uv; gl_Position=projectionMatrix*mv;
      }
    `,
    fragmentShader: `
      varying vec2 p;
      varying float intensity,hub;
      uniform float visibility;
      void main(){
        float d=length(p);
        float core=exp(-d*11.);
        float halo=exp(-d*3.8);
        float glint=hub*0.15*(exp(-abs(p.y)*64.)*exp(-abs(p.x)*4.5)+exp(-abs(p.x)*64.)*exp(-abs(p.y)*6.));
        vec3 tint=mix(vec3(0.068,0.19,0.9),vec3(0.8,0.98,1.),min(1.,core*3.4));
        gl_FragColor=vec4(tint,min(1.,core*1.15+halo*0.33+glint)*intensity*(1.-smoothstep(.8,1.,d))*visibility);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

function orbit(radius, inclination, tilt, color, opacity, dashed = false) {
  const vertices = [];
  for (let i = 0; i <= 384; i++) {
    const angle = (i / 384) * TAU;
    vertices.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }
  const material = dashed
    ? new THREE.LineDashedMaterial({
        color,
        opacity,
        transparent: true,
        dashSize: 0.026,
        gapSize: 0.085,
        depthWrite: false,
      })
    : new THREE.LineBasicMaterial({ color, opacity, transparent: true, depthWrite: false });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices), material);
  line.rotation.order = 'ZXY';
  line.rotation.set(inclination, 0, tilt, 'ZXY');
  if (dashed) line.computeLineDistances();
  return line;
}

function makeSatellite() {
  const satellite = new THREE.Group();
  const hull = new THREE.MeshBasicMaterial({ color: 0xc4bfaa });
  const panels = new THREE.MeshBasicMaterial({ color: 0x6d96a5 });
  const brass = new THREE.MeshBasicMaterial({ color: 0xd6b783 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.14, 8), hull);
  body.rotation.z = Math.PI / 2;
  satellite.add(body);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.008, 6, 32), brass);
  ring.rotation.y = 1.12;
  satellite.add(ring);
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.036, 0.003), panels);
      wing.position.set(-0.042, sign * (0.035 + i * 0.037), 0);
      satellite.add(wing);
    }
  }
  satellite.rotation.set(0.33, -0.36, -0.48);
  return satellite;
}

function makeElevator() {
  const group = new THREE.Group();
  const radial = ELEVATOR_VERTICAL;
  const side = new THREE.Vector3(Math.sin(ELEVATOR_LONGITUDE), 0, Math.cos(ELEVATOR_LONGITUDE));
  const foot = radial.clone().multiplyScalar(RADIUS + 0.002);
  const terminal = radial
    .clone()
    .multiplyScalar(RADIUS + 0.65)
    .addScaledVector(side, 0.055);
  const cablePoints = [];
  for (const offset of [-0.004, 0.004]) {
    cablePoints.push(foot.clone().addScaledVector(side, offset), terminal.clone().addScaledVector(side, offset));
  }
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(cablePoints),
      new THREE.LineBasicMaterial({ color: 0xa0afb7, transparent: true, opacity: 0.7 }),
    ),
  );
  const steel = new THREE.MeshBasicMaterial({ color: 0xc6b695 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.023, 0.066, 8), steel);
  cap.position.copy(terminal);
  cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), radial);
  group.add(cap);
  const panels = new THREE.Mesh(
    new THREE.BoxGeometry(0.099, 0.011, 0.035),
    new THREE.MeshBasicMaterial({ color: 0x7294a9 }),
  );
  panels.position.copy(terminal);
  panels.quaternion.copy(cap.quaternion);
  group.add(panels);
  const climber = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, 0.038, 0.019),
    new THREE.MeshBasicMaterial({ color: 0xffecd1 }),
  );
  climber.quaternion.copy(cap.quaternion);
  group.add(climber);
  return {
    group,
    terminal,
    update(t) {
      climber.position.lerpVectors(foot, terminal, 0.5 - 0.46 * Math.cos(t * 0.14));
    },
  };
}

function targetingReticle() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.48, 0.48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 v;void main(){v=uv-.5;vec4 c=modelViewMatrix*vec4(0.,0.,0.,1.);c.xy+=position.xy;gl_Position=projectionMatrix*c;}`,
      fragmentShader: `varying vec2 v;void main(){
      float r=length(v),a=atan(v.y,v.x);
      float rim=(1.-smoothstep(.009,.025,abs(r-.36)))*smoothstep(.38,.80,abs(sin(2.*a)));
      gl_FragColor=vec4(.49,.94,1.,rim*.95);
    }`,
    }),
  );
  mesh.visible = false;
  return mesh;
}

export function createEarth({ shared = false } = {}) {
  const group = new THREE.Group();
  const planet = new THREE.Group();
  planet.rotation.set(0.36, START_LONGITUDE, -0.32, 'ZXY');
  const ignition = { value: 1 };
  const visibility = { value: 1 };
  const { array, time, engine } = makeArray(ignition, visibility, shared);
  const surface = makeSurface(engine);
  const continental = makeContinentalEngines(ignition, visibility, engine);
  planet.add(surface, array, continental);
  const atmosphere = makeAtmosphere();
  const sunDirection = SUN.clone();
  for (const mesh of [surface, continental, atmosphere]) mesh.material.uniforms.sun.value = sunDirection;
  group.add(planet, atmosphere);
  const stationOrbit = orbit(3.06, -0.17, 0.58, 0x95aeb9, 0.26);
  const transferOrbit = orbit(3.86, 0.14, -0.29, 0x9ba7aa, 0.17, true);
  group.add(stationOrbit, transferOrbit);
  const station = shared ? new THREE.Group() : makeSatellite();
  group.add(station);
  const pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const enginePick = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), pickMaterial);
  enginePick.position.copy(engine);
  planet.add(enginePick);
  const stationPick = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), pickMaterial);
  station.add(stationPick);
  const lift = shared ? null : makeElevator();
  const liftTerminal = shared ? ELEVATOR_VERTICAL.clone().multiplyScalar(RADIUS + 0.64) : lift.terminal;
  if (lift) planet.add(lift.group);
  const elevatorPick = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), pickMaterial);
  elevatorPick.position.copy(liftTerminal);
  planet.add(elevatorPick);
  const east = new THREE.Vector3(),
    north = new THREE.Vector3(),
    basis = new THREE.Matrix4();
  function orientFrame(node, normal, polarAxis) {
    east.crossVectors(normal, polarAxis).normalize();
    north.crossVectors(east, normal);
    node.quaternion.setFromRotationMatrix(basis.makeBasis(east, normal, north));
  }
  function groundMount(name, normal) {
    const mount = new THREE.Group();
    mount.name = name;
    mount.position.copy(normal).multiplyScalar(RADIUS);
    orientFrame(mount, normal, LOCAL_NORTH);
    planet.add(mount);
    return mount;
  }
  const orbitalPole = LOCAL_NORTH.clone().applyQuaternion(stationOrbit.quaternion);
  const orbitalVertical = new THREE.Vector3();
  const mounts = shared
    ? {
        engine: groundMount('CN-07 ground frame', engine.clone().normalize()),
        elevator: groundMount('Equatorial elevator ground frame', ELEVATOR_VERTICAL),
        station,
      }
    : undefined;
  if (shared) station.name = 'Aurora orbital frame';
  const reticle = targetingReticle();
  group.add(reticle);
  let highlighted = null;
  let power = 1,
    lowAltitude = 0,
    showDiagrams = true;
  let apparentDiameter = Infinity;
  const groundGeometries = [surface.geometry],
    airGeometries = [atmosphere.geometry];
  const globeOrigin = new THREE.Vector3(),
    viewPosition = new THREE.Vector3(),
    worldScale = new THREE.Vector3();
  let resolution = 0;
  function applyOverviewVisibility() {
    const distanceFade = 1 - THREE.MathUtils.smoothstep(lowAltitude, 0.05, 0.78);
    ignition.value = power;
    visibility.value = distanceFade;
    array.visible = distanceFade > 0.001 && apparentDiameter > 16;
    continental.visible = distanceFade > 0.001 && apparentDiameter > 90;
    atmosphere.material.uniforms.opacity.value = 1 - THREE.MathUtils.smoothstep(lowAltitude, 0.2, 0.93);
    atmosphere.visible = lowAltitude < 0.93 && apparentDiameter > 22;
    stationOrbit.material.opacity = 0.26 * distanceFade;
    transferOrbit.material.opacity = 0.17 * distanceFade;
    stationOrbit.visible = transferOrbit.visible = showDiagrams && distanceFade > 0.001;
    reticle.visible = showDiagrams && Boolean(highlighted) && lowAltitude < 0.35;
  }
  let angularSpeed = 0.008,
    previousTime,
    phaseOverride = null;
  const anchors = { engine: new THREE.Vector3(), station: new THREE.Vector3(), elevator: new THREE.Vector3() };
  function update(elapsed, delta) {
    time.value = elapsed;
    surface.material.uniforms.time.value = elapsed;
    if (phaseOverride !== null) planet.rotation.y = START_LONGITUDE + phaseOverride;
    else if (previousTime !== undefined && elapsed > previousTime) {
      planet.rotation.y += angularSpeed * Math.min(delta ?? elapsed - previousTime, 0.25);
    }
    previousTime = elapsed;
    const angle = -0.33 + elapsed * 0.013;
    station.position.set(Math.cos(angle) * 3.06, 0, Math.sin(angle) * 3.06).applyQuaternion(stationOrbit.quaternion);
    if (shared) orientFrame(station, orbitalVertical.copy(station.position).normalize(), orbitalPole);
    anchors.station.copy(station.position);
    anchors.engine.copy(engine).applyQuaternion(planet.quaternion);
    anchors.elevator.copy(liftTerminal).applyQuaternion(planet.quaternion);
    lift?.update(elapsed);
    if (highlighted) reticle.position.copy(anchors[highlighted]);
  }
  update(0);
  return {
    group,
    mounts,
    camera: [0, 0, 8.6],
    target: [0, 0, 0],
    fov: 40,
    minDistance: 3.05,
    maxDistance: 13.0,
    anchors,
    updateLOD(camera, viewportHeight) {
      if (!camera || !viewportHeight) return;
      group.getWorldPosition(globeOrigin);
      group.getWorldScale(worldScale);
      camera.getWorldPosition(viewPosition);
      apparentDiameter =
        (RADIUS * worldScale.x * viewportHeight * camera.zoom) /
        (Math.max(0.001, viewPosition.distanceTo(globeOrigin)) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const next = apparentDiameter > 300 ? 0 : apparentDiameter > 96 ? 1 : 2;
      if (resolution !== next) {
        resolution = next;
        const slices = next === 1 ? 64 : 32;
        groundGeometries[next] ??= new THREE.SphereGeometry(RADIUS, slices, slices / 2);
        airGeometries[next] ??= new THREE.SphereGeometry(RADIUS * 1.095, slices, slices / 2);
        surface.geometry = groundGeometries[next];
        atmosphere.geometry = airGeometries[next];
      }
      applyOverviewVisibility();
    },
    setSunDirection(direction) {
      sunDirection.copy(direction ?? SUN);
      if (sunDirection.lengthSq() < 1e-8) sunDirection.copy(SUN);
      else sunDirection.normalize();
    },
    pickables: [
      { id: 'earth', object: surface },
      { id: 'engine', object: enginePick },
      { id: 'station', object: stationPick },
      { id: 'elevator', object: elevatorPick },
    ],
    setHighlight(id) {
      highlighted = id && Object.hasOwn(anchors, id) ? id : null;
      reticle.visible = showDiagrams && Boolean(highlighted) && lowAltitude < 0.35;
      if (highlighted) reticle.position.copy(anchors[highlighted]);
    },
    setIgnition(value) {
      power = THREE.MathUtils.clamp(value, 0, 1);
      applyOverviewVisibility();
    },
    setGroundApproach(value) {
      const level = THREE.MathUtils.clamp(value, 0, 1);
      if (level === lowAltitude) return;
      lowAltitude = level;
      applyOverviewVisibility();
    },
    setDiagrams(visible) {
      if (showDiagrams === Boolean(visible)) return;
      showDiagrams = Boolean(visible);
      applyOverviewVisibility();
    },
    setSpin(value) {
      angularSpeed = THREE.MathUtils.clamp(value, 0, 1) * 0.075;
    },
    setRotationPhase(radians) {
      phaseOverride = Number.isFinite(radians) ? radians : null;
    },
    update,
  };
}
