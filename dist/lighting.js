import * as THREE from 'three';

/** A radiance probe supplies the broad blue Earth reflection and narrow warm
 * solar reflection which directional lights alone cannot give brushed metal.
 * Pre-filter it once for every surface roughness. It is never drawn as a sky. */
export function installReflections(scene, renderer) {
  // PMREM also uses half-float color attachments. The directional lights
  // remain available on devices that expose WebGL 2 without float targets.
  if (!renderer.extensions.has('EXT_color_buffer_float')) return { dispose() {} };
  const width = 256,
    height = 128;
  const pixels = new Float32Array(width * height * 4);
  const sun = new THREE.Vector3(0.9, 0.36, -0.24).normalize();
  for (let y = 0; y < height; y++) {
    const lat = ((y + 0.5) / height - 0.5) * Math.PI;
    const ny = Math.sin(lat),
      horizontal = Math.cos(lat);
    for (let x = 0; x < width; x++) {
      const a = ((x + 0.5) / width - 0.5) * Math.PI * 2;
      const nx = Math.cos(a) * horizontal,
        nz = Math.sin(a) * horizontal;
      const facing = Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
      const key = 7.4 * facing ** 520 + 0.4 * facing ** 24;
      const earthshine = 0.43 * Math.max(0, -0.44 * nx - 0.55 * ny + 0.71 * nz) ** 2;
      const horizon = 0.15 * Math.exp(-((ny + 0.1 + 0.14 * nx) ** 2) / 0.019) * (0.62 + 0.38 * nz);
      const i = 4 * (y * width + x);
      pixels[i] = 0.012 + key + earthshine * 0.48 + horizon * 0.64;
      pixels[i + 1] = 0.017 + key * 0.8 + earthshine * 0.75 + horizon * 0.81;
      pixels[i + 2] = 0.026 + key * 0.61 + earthshine * 1.13 + horizon * 1.14;
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
