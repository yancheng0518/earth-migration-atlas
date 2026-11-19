import * as THREE from 'three';

const overviewSun = new THREE.Vector3(0.92, 0.56, -0.1).normalize();
// Custom material shaders may share the same light vector as standard meshes.
export const worldSunDirection = overviewSun.clone();

/** Bake the solar lobe once per material roughness. Rotating this probe with
 * the shared key preserves its direction without regenerating it on each seek. */
function installReflections(scene, renderer) {
  // PMREM also uses half-float color attachments. The directional lights
  // remain available on devices that expose WebGL 2 without float targets.
  if (!renderer.extensions.has('EXT_color_buffer_float')) return null;
  const width = 256,
    height = 128;
  const pixels = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const lat = ((y + 0.5) / height - 0.5) * Math.PI;
    const ny = Math.sin(lat),
      horizontal = Math.cos(lat);
    for (let x = 0; x < width; x++) {
      const a = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      const nx = Math.cos(a) * horizontal,
        nz = Math.sin(a) * horizontal;
      const facing = Math.max(0, nx * overviewSun.x + ny * overviewSun.y + nz * overviewSun.z);
      const key = 8.3 * facing ** 430 + 0.48 * facing ** 22;
      const i = 4 * (y * width + x);
      pixels[i] = 0.030 + key;
      pixels[i + 1] = 0.038 + key * 0.81;
      pixels[i + 2] = 0.052 + key * 0.65;
      pixels[i + 3] = 1;
    }
  }
  const map = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  map.mapping = THREE.EquirectangularReflectionMapping;
  map.needsUpdate = true;
  const filter = new THREE.PMREMGenerator(renderer);
  const probe = filter.fromEquirectangular(map);
  scene.environment = probe.texture;
  scene.environmentIntensity = 0.78;
  filter.dispose();
  map.dispose();
  return probe;
}

export function createWorldLighting(scene, renderer) {
  const key = new THREE.DirectionalLight(0xffe6cb);
  // With Earth at the shared origin, each surface sees the blue fill from its
  // own suborbital direction instead of receiving a constant camera-side wash.
  const earthBounce = new THREE.PointLight(0xa6c8f0, 3.45, 9, 2);
  const base = new THREE.HemisphereLight(0xc5d3e4, 0x4d4e58, 0.63);
  scene.add(key, earthBounce, base);
  const probe = installReflections(scene, renderer);
  const fromSun = new THREE.Quaternion();
  const sampleRotation = new THREE.Euler();

  function update(sunDirection, groundApproach = 0) {
    worldSunDirection.copy(sunDirection ?? overviewSun).normalize();
    key.position.copy(worldSunDirection);
    key.intensity = 2.28 * (1 - 0.87 * groundApproach);
    earthBounce.intensity = 3.45 * (1 - 0.82 * groundApproach);
    base.intensity = 0.63 * (1 - 0.72 * groundApproach);
    if (!probe) return;
    // Convert the inverse into the shader's Euler convention. Three negates
    // the Euler components before sampling the world-space environment.
    fromSun.setFromUnitVectors(overviewSun, worldSunDirection).invert();
    sampleRotation.setFromQuaternion(fromSun, 'XYZ');
    scene.environmentRotation.set(-sampleRotation.x, -sampleRotation.y, -sampleRotation.z);
    scene.environmentIntensity = 0.78 * (1 - 0.36 * groundApproach);
  }

  update(null);
  return { update, dispose: () => probe?.dispose() };
}

const screenVertex = `
  varying vec2 uvScreen;
  void main() {
    uvScreen = position.xy * .5 + .5;
    gl_Position = vec4(position.xy, 0., 1.);
  }
`;

const extract = `
  varying vec2 uvScreen;
  uniform sampler2D source;
  uniform vec2 texel;
  vec3 highlights(vec2 uv) {
    vec3 color = texture2D(source, uv).rgb;
    if (any(isnan(color)) || any(isinf(color))) return vec3(0.);
    float brightness = max(max(color.r, color.g), color.b);
    // A small knee takes the flicker out of fine highlights as the camera moves.
    float knee = .25;
    float soft = clamp(brightness-1.35+knee, 0., 2.*knee);
    float energy = min(3.5, max(brightness-1.35, soft*soft/(4.*knee)));
    return color * energy / max(brightness, .001);
  }
  void main() {
    vec2 d = texel * 1.0;
    vec3 color = highlights(uvScreen+vec2(d.x,d.y)) + highlights(uvScreen+vec2(d.x,-d.y))
               + highlights(uvScreen+vec2(-d.x,d.y)) + highlights(uvScreen-vec2(d.x,d.y));
    gl_FragColor = vec4(color * .25, 1.);
  }
`;

const blur = `
  varying vec2 uvScreen;
  uniform sampler2D source;
  uniform vec2 stepSize;
  void main() {
    // Bilinear taps combine six pairs of neighbouring points in a wide kernel.
    vec3 color = .19648 * texture2D(source, uvScreen).rgb;
    vec3 plus = vec3(1.41176, 3.29412, 5.17647);
    vec3 weights = vec3(.29691, .09447, .01038);
    for(int i=0; i<3; i++) {
      vec2 n = stepSize * plus[i];
      color += weights[i]*(texture2D(source,uvScreen+n).rgb+texture2D(source,uvScreen-n).rgb);
    }
    gl_FragColor = vec4(color, 1.);
  }
`;

const composite = `
  varying vec2 uvScreen;
  uniform sampler2D base;
  uniform sampler2D halo;
  void main() {
    vec3 color = texture2D(base, uvScreen).rgb;
    vec3 scattered = texture2D(halo, uvScreen).rgb;
    gl_FragColor = vec4(color + .17 * scattered, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Linear HDR post-processing before the renderer's ACES and display encoding.
 * Three small passes extract and blur saturated cores without veiling the
 * penumbra. A browser lacking float framebuffers can still render the scene. */
export function createBloom(renderer) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) {
    return { render: (scene, camera) => renderer.render(scene, camera), dispose() {} };
  }

  function target(depthBuffer) {
    return new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });
  }

  const base = target(true),
    light = target(false),
    temporary = target(false);
  const resolution = new THREE.Vector2();
  const screenCamera = new THREE.Camera();
  const screen = new THREE.Scene();
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));

  function pass(fragmentShader, uniforms, toneMapped = false) {
    return new THREE.ShaderMaterial({
      vertexShader: screenVertex, fragmentShader, uniforms, toneMapped,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
  }
  const threshold = pass(extract, { source: { value: base.texture }, texel: { value: new THREE.Vector2() } });
  const gaussian = pass(blur, { source: { value: light.texture }, stepSize: { value: new THREE.Vector2() } });
  const output = pass(composite, { base: { value: base.texture }, halo: { value: light.texture } }, true);
  const quad = new THREE.Mesh(triangle, threshold);
  quad.frustumCulled = false;
  screen.add(quad);

  function draw(material, renderTarget) {
    quad.material = material;
    renderer.setRenderTarget(renderTarget);
    renderer.render(screen, screenCamera);
  }

  function render(scene, camera) {
    renderer.getDrawingBufferSize(resolution);
    const x = Math.max(1, resolution.x),
      y = Math.max(1, resolution.y);
    if (base.width !== x || base.height !== y) {
      base.setSize(x, y);
      light.setSize(Math.max(1, Math.ceil(x * .25)), Math.max(1, Math.ceil(y * .25)));
      temporary.setSize(light.width, light.height);
      threshold.uniforms.texel.value.set(1 / x, 1 / y);
    }
    renderer.setRenderTarget(base);
    renderer.render(scene, camera);
    draw(threshold, light);
    gaussian.uniforms.source.value = light.texture;
    gaussian.uniforms.stepSize.value.set(1 / light.width, 0);
    draw(gaussian, temporary);
    gaussian.uniforms.source.value = temporary.texture;
    gaussian.uniforms.stepSize.value.set(0, 1 / light.height);
    draw(gaussian, light);
    draw(output, null);
  }

  function dispose() {
    for (const resource of [base, light, temporary, triangle, threshold, gaussian, output]) resource.dispose();
  }
  return { render, dispose };
}
