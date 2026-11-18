import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const up = new THREE.Vector3(0, 1, 0);
const radius = 2.2;

/** Interpolate two directions along the short great-circle arc. Even a flight
 * to the antipode stays outside the crust. The fallback picks a meridian when
 * the endpoints themselves cannot define one. All scratch storage is reused. */
function arc(a, b, t, result, tangent) {
  const dot = clamp(a.dot(b), -1, 1);
  if (dot > 0.99995) return result.lerpVectors(a, b, t).normalize();
  tangent.copy(b).addScaledVector(a, -dot);
  if (tangent.lengthSq() < 1e-10) {
    tangent.set(0, Math.abs(a.y) > 0.95 ? 0 : 1, Math.abs(a.y) > 0.95 ? 1 : 0);
    tangent.addScaledVector(a, -tangent.dot(a));
  }
  const angle = Math.acos(dot) * t;
  return result.copy(a).multiplyScalar(Math.cos(angle)).addScaledVector(tangent.normalize(), Math.sin(angle));
}

export function createNavigation(models) {
  const orbit = new THREE.Vector3(0, 0, 1);
  let azimuth = 0,
    latitude = 0,
    overviewDistance = 8.6;
  let depth = 0,
    destination = 0,
    route = 'engine',
    queued = null;
  const angles = Object.fromEntries(['engine', 'elevator', 'station'].map((id) => [id, { yaw: 0, pitch: 0 }]));
  const siteEye = new THREE.Vector3(),
    siteAim = new THREE.Vector3(),
    normal = new THREE.Vector3();
  const endDirection = new THREE.Vector3(),
    tangent = new THREE.Vector3(),
    local = new THREE.Spherical();
  const shoulder = new THREE.Vector3(),
    arcAxis = new THREE.Vector3();
  const skyUp = new THREE.Vector3(),
    groundUp = new THREE.Vector3(),
    cross = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const pose = { eye: new THREE.Vector3(), aim: new THREE.Vector3(), up: up.clone(), fov: 40, near: 0.025 };

  // All endpoints are read in world coordinates *after* the orbital ephemeris
  // has advanced. Looking at Aurora therefore tracks the actual moving station.
  function sample(id, fraction, start = orbit, anglesForSite = angles[id], distance = overviewDistance) {
    const model = models[id],
      root = model.group;
    siteAim.fromArray(model.target);
    siteEye.fromArray(model.camera).sub(siteAim);
    local.setFromVector3(siteEye);
    local.theta += anglesForSite.yaw;
    local.phi = clamp(local.phi + anglesForSite.pitch, 0.15, id === 'engine' ? 1.85 : 2.7);
    siteEye.setFromSpherical(local).add(siteAim);
    if (id === 'engine') siteEye.y = Math.max(2.8, siteEye.y);
    root.localToWorld(siteEye);
    root.localToWorld(siteAim);
    root.getWorldQuaternion(rotation);
    normal.copy(up).applyQuaternion(rotation);
    endDirection.copy(siteEye).normalize();

    // Give a far-side approach time to round the limb before descending.
    const back = id === 'engine' ? smooth(-start.dot(normal), 0.05, 0.95) : 0;
    const top = distance - radius,
      bottom = Math.max(0.0015, siteEye.length() - radius);
    const descent = smooth(fraction, 0.025 + 0.21 * back, 1);
    const h = THREE.MathUtils.lerp(Math.log(top), Math.log(bottom), id === 'engine' ? descent ** 1.45 : descent);
    const height = Math.exp(h);
    if (id === 'engine') {
      // Meet the site at an oblique shoulder, then orbit towards the chosen
      // ground-level heading. The real tower stays upright through the retreat.
      const endAngle = Math.acos(clamp(endDirection.dot(normal), -1, 1));
      shoulder.copy(endDirection).addScaledVector(normal, -endDirection.dot(normal)).normalize();
      shoulder.applyAxisAngle(normal, 2.8 * (1 - smooth(fraction, 0.52, 0.94)));
      const clearance = 0.71 * Math.tanh((height - bottom) * 0.99);
      const angle = endAngle + THREE.MathUtils.lerp(0.42, clearance, smooth(fraction, 0.52, 0.67));
      endDirection.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(shoulder, Math.sin(angle));
      const arrival = smooth(fraction, 0, 0.52 - 0.08 * back);
      arc(start, endDirection, arrival, pose.eye, tangent);
      if (arrival < 1) {
        // Parallel-transport camera up along the orbital arc. Compute the entire
        // twist at its fixed endpoint so passing a pole never flips the horizon.
        const journeyAngle = Math.acos(clamp(start.dot(endDirection), -1, 1));
        arcAxis.crossVectors(start, endDirection);
        if (arcAxis.lengthSq() < 1e-10) {
          tangent.set(0, Math.abs(start.y) > 0.95 ? 0 : 1, Math.abs(start.y) > 0.95 ? 1 : 0);
          arcAxis.crossVectors(start, tangent);
        }
        arcAxis.normalize();
        skyUp.copy(up).addScaledVector(start, -up.dot(start));
        if (skyUp.lengthSq() < 1e-10) skyUp.set(0, 0, 1);
        skyUp.normalize();
        groundUp.copy(normal).addScaledVector(endDirection, -normal.dot(endDirection)).normalize();
        groundUp.applyAxisAngle(arcAxis, -journeyAngle);
        const roll = Math.atan2(start.dot(cross.crossVectors(skyUp, groundUp)), skyUp.dot(groundUp));
        pose.up.copy(skyUp).applyAxisAngle(start, roll * smooth(arrival, 0, 1));
        pose.up.applyAxisAngle(arcAxis, journeyAngle * arrival);
      } else {
        pose.up.copy(normal);
      }
    } else {
      arc(start, endDirection, smooth(fraction, 0, 0.86), pose.eye, tangent);
      arc(up, normal, smooth(fraction, 0.25, 0.99), pose.up, tangent);
    }
    pose.eye.multiplyScalar(radius + height);
    pose.aim.copy(siteAim).multiplyScalar(smooth(fraction, 0, id === 'engine' ? 0.48 : 0.73));
    pose.fov = THREE.MathUtils.lerp(40, model.fov, smooth(fraction, 0.37, 1));
    pose.near = THREE.MathUtils.lerp(0.00065, 0.034, smooth(height, 0.018, 0.7));
    return pose;
  }
  function setOrbit() {
    const c = Math.cos(latitude);
    orbit.set(c * Math.sin(azimuth), Math.sin(latitude), c * Math.cos(azimuth));
  }
  function reset() {
    azimuth = latitude = depth = destination = 0;
    overviewDistance = 8.6;
    route = 'engine';
    queued = null;
    for (const a of Object.values(angles)) a.yaw = a.pitch = 0;
    setOrbit();
  }
  function resumeShot(id, fraction, dir) {
    route = id;
    depth = destination = fraction;
    latitude = Math.asin(dir.y);
    azimuth = Math.atan2(dir.x, dir.z);
    setOrbit();
  }
  function go(id) {
    queued = null;
    if (id === 'earth') {
      destination = 0;
      return;
    }
    if (route === id || depth < 0.012) {
      route = id;
      destination = 1;
    } else {
      queued = id;
      destination = 0;
    }
  }
  function zoom(amount, candidate) {
    queued = null;
    if (depth < 0.015 && destination < 0.025 && amount > 0) route = angles[candidate] ? candidate : 'engine';
    if (destination === 0 && amount < 0) overviewDistance = Math.min(12.5, overviewDistance - amount * 3);
    destination = clamp(destination + amount, 0, 1);
  }
  function drag(x, y, extent) {
    const gain = (Math.PI * 1.45) / Math.max(280, extent);
    const localWeight = smooth(depth, 0.16, 0.82);
    azimuth -= x * gain * (1 - localWeight);
    latitude = clamp(latitude + y * gain * (1 - localWeight), -1.43, 1.43);
    setOrbit();
    angles[route].yaw -= x * gain * localWeight;
    angles[route].pitch = clamp(angles[route].pitch - y * gain * localWeight, -1.25, 1.12);
  }
  function step(dt, reduced) {
    // Limit automatic travel speed yet retain fine wheel/trackpad stopping.
    const delta = destination - depth,
      cap = (reduced ? 3.0 : 0.54) * dt;
    depth += clamp(delta * (1 - Math.exp(-dt * 9)), -cap, cap);
    if (Math.abs(depth - destination) < 0.001) depth = destination;
    if (queued && depth <= 0.002) {
      route = queued;
      queued = null;
      destination = 1;
    }
    return sample(route, depth);
  }
  return {
    sample,
    reset,
    resumeShot,
    go,
    drag,
    zoom,
    step,
    get depth() {
      return depth;
    },
    get route() {
      return route;
    },
  };
}
