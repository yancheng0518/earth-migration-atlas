import * as THREE from 'three';

/** A radiance probe supplies the broad blue Earth reflection and narrow warm
 * solar reflection which directional lights alone cannot give brushed metal.
 * Pre-filter it once for every surface roughness. It is never drawn as a sky. */
export function installReflections(scene, renderer) {
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
      const key = 6.4 * facing ** 420 + 0.54 * facing ** 19;
      const earthshine = 0.29 * Math.max(0, -0.54 * nx - 0.65 * ny + 0.53 * nz) ** 2;
      const horizon = 0.22 * Math.exp(-((ny + 0.1 + 0.14 * nx) ** 2) / 0.022) * (0.62 + 0.38 * nz);
      const i = 4 * (y * width + x);
      pixels[i] = 0.019 + key + earthshine * 0.4 + horizon * 0.64;
      pixels[i + 1] = 0.028 + key * 0.75 + earthshine * 0.72 + horizon * 0.81;
      pixels[i + 2] = 0.044 + key * 0.54 + earthshine * 1.32 + horizon * 1.14;
      pixels[i + 3] = 1;
    }
  }
  const map = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  map.mapping = THREE.EquirectangularReflectionMapping;
  map.needsUpdate = true;
  const filter = new THREE.PMREMGenerator(renderer);
  const probe = filter.fromEquirectangular(map);
  scene.environment = probe.texture;
  scene.environmentIntensity = 0.71;
  filter.dispose();
  map.dispose();
  return probe;
}
