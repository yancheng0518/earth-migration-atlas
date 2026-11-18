import * as THREE from 'three';

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
    fragmentShader: `varying vec3 tint;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(tint,.78*(1.-smoothstep(.08,1.,d)));}`,
  });
  sky.add(new THREE.Points(stars, material));
  const dust = new THREE.Mesh(
    new THREE.SphereGeometry(680, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 dir;void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=gl_Position.w*(1.-1e-7);}`,
      fragmentShader: `
      varying vec3 dir;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.545);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec3 d=normalize(dir);float ax=atan(d.z,d.x);float b=d.y-.36*sin(ax-1.8);
      vec2 p=vec2(d.x*4.+d.z*1.5,b*5.);float n=noise(p)*.55+noise(p*2.3)*.29+noise(p*5.7)*.16;
      float band=exp(-b*b*31.)*pow(n,2.4);float cleft=1.-.64*exp(-abs(b+.03*sin(ax*8.))*23.);
      vec3 base=mix(vec3(.011,.022,.035),vec3(.022,.033,.05),.5+.5*d.y);
      gl_FragColor=vec4(base+vec3(.18,.18,.21)*band*cleft,1.);}`,
    }),
  );
  dust.renderOrder = -100;
  sky.add(dust);
  return {
    group: sky,
    setTime(time) {
      material.uniforms.time.value = time;
    },
    setPixelRatio(value) {
      material.uniforms.pixelRatio.value = value;
    },
  };
}
