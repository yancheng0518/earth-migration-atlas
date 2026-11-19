import * as THREE from 'three';

// Galactic coordinates for the wide Solar System shot. Stars and dust share
// this plane so the richer band has the same orientation as the camera moves.
const galacticNorth = new THREE.Vector3(0.64, 0.68, -0.51).normalize();
const galacticCenter = new THREE.Vector3(-0.65, -0.42, -0.7).projectOnPlane(galacticNorth).normalize();
const galacticEast = new THREE.Vector3().crossVectors(galacticNorth, galacticCenter).normalize();

function makeSolarStarField(random) {
  const positions = [], colors = [], sizes = [], phases = [], groups = [];
  const direction = new THREE.Vector3();
  for (let i = 0; i < 19600; i++) {
    const inBand = i > 7800;
    const spill = (random() + random() + random() + random() - 2) * .26;
    const theta = i > 17300 ? (random() + random() + random() - 1.5) * 2.3 : random() * Math.PI * 2;
    const height = inBand ? spill * (1 + .22 * Math.sin(theta * 4)) : random() * 2 - 1;
    const elevation = Math.sqrt(1 - height * height);
    direction.copy(galacticCenter).multiplyScalar(elevation * Math.cos(theta))
      .addScaledVector(galacticEast, elevation * Math.sin(theta)).addScaledVector(galacticNorth, height);
    const near = i < 700;
    direction.multiplyScalar(near ? 290 + random() * 250 : 620);
    positions.push(direction.x, direction.y, direction.z);
    const magnitude = random();
    const prominent = magnitude > .985;
    const tint = random();
    const power = .14 + .43 * magnitude ** 2 + (prominent ? .52 : 0);
    const color = tint < .29 ? [.60, .77, 1] : tint > .73 ? [1, .73, .50] : [.92, .93, 1];
    colors.push(color[0] * power, color[1] * power, color[2] * power);
    sizes.push(prominent ? 2.8 + random() * 1.4 : .87 + magnitude ** 6 * 1.22);
    phases.push(random() * 6.28);
    groups.push(near ? 1 : 0);
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, data, size] of [
    ['position', positions, 3], ['color', colors, 3], ['size', sizes, 1], ['phase', phases, 1], ['localStar', groups, 1],
  ]) geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  const uniforms = {
    pixelRatio: { value: 1 }, time: { value: 0 }, strength: { value: 0 },
    parallax: { value: new THREE.Vector3() },
  };
  const stars = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `
      uniform float pixelRatio, time;
      uniform vec3 parallax;
      attribute float size, phase, localStar;
      varying vec3 tint;
      varying float profile;
      void main() {
        vec3 direction=position-parallax*localStar;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(direction,1.);
        gl_Position.z=gl_Position.w*(1.-1.e-7);
        tint=color*(.96+.04*sin(time*.55+phase));
        profile=size;
        gl_PointSize=max(1.,size*pixelRatio);
      }`,
    fragmentShader: `
      uniform float strength;
      varying vec3 tint;
      varying float profile;
      void main() {
        vec2 q=gl_PointCoord*2.-1.;
        float radius=length(q);
        float soft=exp(-dot(q,q)*mix(2.1,6.,smoothstep(1.7,2.8,profile)));
        float halo=exp(-dot(q,q)*2.5)*smoothstep(2.4,4.2,profile)*.20;
        gl_FragColor=vec4(tint,(soft+halo)*(1.-smoothstep(.57,1.,radius))*strength);
        #include <colorspace_fragment>
      }`,
  }));
  stars.frustumCulled = false;
  return { stars, uniforms };
}

// A fixed celestial sphere keeps distant stars free of parallax during orbital flights.
export function makeSky() {
  const sky = new THREE.Group();
  let seed = 7401632;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const positions = [],
    colors = [],
    sizes = [];
  const radius = 640;
  for (let i = 0; i < 5300; i++) {
    const angle = random() * Math.PI * 2;
    const clustered = i > 3450;
    const height = clustered
      ? 0.36 * Math.sin(angle - 1.8) + (random() + random() + random() - 1.5) * 0.135
      : random() * 2 - 1;
    const circle = Math.sqrt(1 - height * height);
    positions.push(radius * circle * Math.cos(angle), radius * height, radius * circle * Math.sin(angle));
    const hue = random(),
      brightness = 0.38 + 0.58 * random();
    const tint = hue < 0.23 ? [0.84, 0.88, 1] : hue > 0.91 ? [1, 0.77, 0.61] : [0.84, 0.98, 1];
    colors.push(...tint.map((c) => c * brightness));
    sizes.push((clustered ? 0.56 : 0.65) + Math.pow(random(), 7) * 2.25);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  stars.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  stars.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: 1 }, time: { value: 0 } },
    vertexColors: true,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float size; uniform float pixelRatio,time; varying vec3 tint;
      void main(){tint=color*(.86+.14*sin(time*.63+position.y));gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=gl_Position.w*(1.-1e-7);gl_PointSize=max(1.,size*pixelRatio);}`,
    fragmentShader: `varying vec3 tint;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(tint*.62,.64*(1.-smoothstep(.08,1.,d)));
      #include <colorspace_fragment>
    }`,
  });
  sky.add(new THREE.Points(stars, material));
  const solarField = makeSolarStarField(random);
  sky.add(solarField.stars);
  const dust = new THREE.Mesh(
    new THREE.SphereGeometry(680, 32, 24),
    new THREE.ShaderMaterial({
      uniforms: {
        dustVisibility: { value: 1 }, solarExposure: { value: 0 },
        galacticNorth: { value: galacticNorth }, galacticCenter: { value: galacticCenter },
        galacticEast: { value: galacticEast },
      },
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 dir;void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=gl_Position.w*(1.-1e-7);}`,
      fragmentShader: `
      varying vec3 dir;
      uniform float dustVisibility,solarExposure;
      uniform vec3 galacticNorth,galacticCenter,galacticEast;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.545);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 d=normalize(dir);float ax=atan(d.z,d.x);float b=d.y-.36*sin(ax-1.8);
      vec2 p=vec2(d.x*4.+d.z*1.5,b*5.);float n=noise(p)*.55+noise(p*2.3)*.29+noise(p*5.7)*.16;
      float band=exp(-b*b*31.)*pow(n,2.4);float cleft=1.-.64*exp(-abs(b+.03*sin(ax*8.))*23.);
      vec3 base=mix(vec3(.0025,.0035,.0055),vec3(.004,.0055,.008),.5+.5*d.y);
      vec3 sky=base+vec3(.060,.060,.067)*band*cleft*dustVisibility;
      if(solarExposure>.001){
        float longitude=atan(dot(d,galacticEast),dot(d,galacticCenter));
        float latitude=dot(d,galacticNorth);
        vec2 q=vec2(dot(d,galacticEast)*5.8+dot(d,galacticCenter)*3.7,latitude*8.4);
        float curl=noise(q*1.7+vec2(8.4,2.1));
        float lanes=.42*curl+.28*noise(q*3.7-vec2(7.,3.))
          +.17*noise(q*8.4+vec2(curl*1.6,15.))+.13*noise(q*18.5);
        float ridge=latitude-.11*sin(longitude*4.);
        float core=exp(-longitude*longitude*.92);
        float envelope=exp(-latitude*latitude*(12.+4.*core));
        float rift=exp(-abs(ridge+(curl-.5)*.25)*22.)*smoothstep(.25,.8,lanes);
        float glow=pow(smoothstep(.15,.76,lanes),1.16)
          *envelope*(.56+.44*core)*(1.-rift*.86);
        vec3 cold=vec3(.034,.050,.094);
        vec3 warm=vec3(.111,.078,.063);
        vec3 haze=mix(cold,warm,smoothstep(.28,.83,lanes)*(.4+.6*core));
        float powder=noise(q*64.)*noise(q*26.);
        sky+=solarExposure*(haze*glow+powder*envelope*vec3(.009,.008,.012));
      }
      gl_FragColor=vec4(sky,1.);
      #include <colorspace_fragment>
      }`,
    }),
  );
  dust.renderOrder = -100;
  sky.add(dust);
  const cameraOffset = solarField.uniforms.parallax.value;
  return {
    group: sky,
    setTime(time) {
      material.uniforms.time.value = time;
      solarField.uniforms.time.value = time;
    },
    setPixelRatio(value) {
      material.uniforms.pixelRatio.value = value;
      solarField.uniforms.pixelRatio.value = value;
    },
    setDistance(scale, observer) {
      // The fixed sky is the view from the Solar neighbourhood. Its dust band
      // yields to the modeled galactic disk as the camera leaves that volume.
      dust.material.uniforms.dustVisibility.value = 1 - 0.96 * THREE.MathUtils.smoothstep(scale, 1.2, 2);
      const exposure = THREE.MathUtils.smoothstep(scale, .16, .66) *
        (1 - THREE.MathUtils.smoothstep(scale, 1.09, 1.48));
      dust.material.uniforms.solarExposure.value = exposure;
      solarField.uniforms.strength.value = exposure * .87;
      solarField.stars.visible = exposure > .001;
      if (observer) cameraOffset.copy(observer).multiplyScalar(.12).clampLength(0, 73);
    },
  };
}
