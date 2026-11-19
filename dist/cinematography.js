import * as THREE from 'three';
import { cosmicScale, departureCue, liftProgress, ignitionDemand } from './states.js';
import { createLiftShot } from './lift-shot.js';

const R = 2.2;
const up = new THREE.Vector3(0, 1, 0);
const origin = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const mix = THREE.MathUtils.lerp;
const ease = (t, a, b) => THREE.MathUtils.smootherstep(t, a, b);
const phase = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const makePose = () => ({ eye: new THREE.Vector3(), aim: new THREE.Vector3(), up: up.clone(), near: 0.02, fov: 40 });
const still = { yaw: 0, pitch: 0 };
// Time, dolly position, point of interest and lens. Each coordinate has a
// continuous Hermite tangent at each key, including the tilt from trucks to crown.
const yardKeys = [
  [19.2, 9.4, 3.8, 30.5, 10.2, 5.8, 11.8, 51],
  [20.5, 7.6, 2.5, 27, 15, 3.3, 11, 52],
  [22.0, 6.8, 2.45, 24.6, 17, 3.1, 10.3, 49],
  [24.8, 9.2, 3.4, 23, 0.5, 13, 0, 49],
  [26.8, 13, 12, 24, 0, 22, 0, 46],
  [30.0, 20, 10, 34, 0, 21, 0, 48],
];
function yardCoordinate(t, k) {
  const keys = yardKeys,
    last = keys.length - 1;
  if (t <= keys[0][0]) return keys[0][k];
  if (t >= keys[last][0]) return keys[last][k];
  let i = 0;
  while (keys[i + 1][0] < t) i++;
  const a = keys[i],
    b = keys[i + 1],
    before = keys[Math.max(0, i - 1)],
    after = keys[Math.min(last, i + 2)];
  const span = b[0] - a[0],
    u = (t - a[0]) / span,
    u2 = u * u,
    u3 = u2 * u;
  const va = (b[k] - before[k]) / (b[0] - before[0]),
    vb = (after[k] - a[k]) / (after[0] - a[0]);
  return (
    (2 * u3 - 3 * u2 + 1) * a[k] + (u3 - 2 * u2 + u) * span * va + (-2 * u3 + 3 * u2) * b[k] + (u3 - u2) * span * vb
  );
}

/**
 * Absolute-time choreography. Chapter changes only replace the subtitle. The
 * film follows one Earth-centred camera, with overlapping dolly/crane/escort
 * moves. Scrubbing evaluates the ephemeris and the lens at the exact same time.
 */
export function createCinematography(models, navigation, traffic) {
  const { earth, engine, elevator, station, sun, jupiter, proxima } = models;
  const liftShot = createLiftShot(elevator);
  const orbit = new THREE.Vector3();
  const rig = new THREE.Quaternion(),
    turn = new THREE.Quaternion(),
    partial = new THREE.Quaternion();
  const aDir = new THREE.Vector3(),
    bDir = new THREE.Vector3(),
    tmp = new THREE.Vector3();
  const light = new THREE.Vector3(),
    defaultLight = new THREE.Vector3(0.92, 0.56, -0.1).normalize();
  const mixed = makePose(),
    macro = makePose(),
    stationPose = makePose(),
    escort = makePose();
  const yard = makePose();
  const departure = makePose();
  const departureAxis = new THREE.Vector3();
  const departureSide = new THREE.Vector3();
  const nearDeparture = new THREE.Vector3();
  const basis = new THREE.Matrix4(),
    qa = new THREE.Quaternion(),
    qb = new THREE.Quaternion();
  const eyeLocal = new THREE.Vector3(),
    aimLocal = new THREE.Vector3(),
    worldUp = new THREE.Vector3();
  const ship = new THREE.Vector3(),
    forward = new THREE.Vector3(),
    laneNormal = new THREE.Vector3();
  const engineAngles = { yaw: 0, pitch: 0 };
  const planetState = { time: 0, rotation: 0, depth: 0, power: 0, ground: 0, cabin: 0 };
  let jovePhase = 0,
    exitPhase = 0,
    solarPhase = 0;

  function update(time) {
    const state = planetState;
    state.time = time;
    // The same tower is approached before ignition and left behind after the
    // relay reaches its outer batteries. Neither leg changes its geometric scale.
    state.depth = ease(time, 11.4, 21.4) * (1 - ease(time, 30.8, 42.2));
    state.power = ignitionDemand(time);
    state.ground = THREE.MathUtils.smoothstep(state.depth, 0.49, 0.96);
    state.cabin = liftProgress(phase(time, 52, 77));
    // Integrate a linearly slowing angular velocity rather than switching
    // between two phases at the caption boundary.
    const coast = Math.min(time, 38),
      brake = clamp(time - 38, 0, 14);
    const brakingTurn = clamp(time - 36, 0, 16);
    state.rotation = 0.0175 * (coast + brake - (brake * brake) / 28)
      + .36 * Math.sin(Math.PI * ease(brakingTurn, 0, 16) / 2);
    solarPhase = phase(time, 0, 16);
    jovePhase = ease(time, 76, 100);
    exitPhase = phase(time, 91.5, 108);
    return state;
  }

  function positionSystem(m, t, progress, distance) {
    m.update(t, 0, progress);
    const { anchor, radius } = m.sharedEarth;
    const scale = R / (radius * anchor.scale.x);
    m.group.scale.setScalar(scale);
    m.group.position.copy(anchor.position).multiplyScalar(-scale);
    const shift = (m.group.userData.travelOffset ??= new THREE.Vector3());
    shift.set(0, 0, 0);
    if (distance) {
      shift.copy(m.landmark.position).sub(anchor.position).setLength(distance);
      m.group.position.add(shift);
    }
    m.group.updateMatrixWorld();
  }

  function environment(t) {
    // Slow interplanetary time compression. All three systems keep their
    // positions through chapter boundaries. Jupiter grows on approach and
    // recedes into the star field when the encounter is over.
    positionSystem(sun, t, solarPhase, 520 * ease(t, 11.5, 30) + 170 * ease(t, 45, 97));
    positionSystem(jupiter, t, jovePhase, 570 * (1 - ease(t, 62, 86)) + 820 * ease(t, 94.5, 108));
    positionSystem(proxima, t, exitPhase, 0);
    proxima.setWake(ease(t, 96, departureCue - .6) * (1 - ease(cosmicScale(t), 0.035, 0.29)));
    sun.lightSource
      .getWorldPosition(light)
      .normalize()
      .lerp(defaultLight, ease(t, 5.4, 15))
      .normalize();
    proxima.lightSource.getWorldPosition(tmp).normalize();
    light.lerp(tmp, .77 * ease(t, 91, 104)).normalize();
    earth.setSunDirection(light);
    earth.setDiagrams(false);
    return light;
  }

  // Slerp the direction instead of interpolating a chord through the planet.
  // Optical distance is logarithmic, so the same move can cover kilometres at
  // a port and a planetary diameter in space without an uncontrolled zoom.
  function join(a, b, w) {
    if (w <= 0) return a;
    if (w >= 1) return b;
    const ar = a.eye.length(),
      br = b.eye.length();
    aDir.copy(a.eye).divideScalar(ar);
    bDir.copy(b.eye).divideScalar(br);
    turn.setFromUnitVectors(aDir, bDir);
    partial.identity().slerp(turn, w);
    const alt = Math.exp(mix(Math.log(Math.max(0.001, ar - R)), Math.log(Math.max(0.001, br - R)), w));
    mixed.eye
      .copy(aDir)
      .applyQuaternion(partial)
      .multiplyScalar(R + alt);
    mixed.aim.lerpVectors(a.aim, b.aim, w);
    turn.setFromUnitVectors(a.up, b.up);
    partial.identity().slerp(turn, w);
    mixed.up.copy(a.up).applyQuaternion(partial).normalize();
    mixed.near = Math.exp(mix(Math.log(a.near), Math.log(b.near), w));
    mixed.fov = mix(a.fov, b.fov, w);
    return mixed;
  }

  function systemLens(m, t) {
    aimLocal.fromArray(m.target);
    eyeLocal.fromArray(m.camera).sub(aimLocal);
    if (m === sun) {
      eyeLocal.applyAxisAngle(up, mix(-0.16, 0.13, ease(t, 0, 14))).multiplyScalar(mix(1.03, 0.85, solarPhase));
      eyeLocal.y += 0.46 * (1 - ease(t, 1, 10));
      aimLocal.x += 0.35;
    } else {
      eyeLocal.applyAxisAngle(up, mix(-0.15, 0.17, jovePhase)).multiplyScalar(mix(0.86, 1.05, jovePhase));
      eyeLocal.y += 0.65 * Math.sin(Math.PI * jovePhase);
    }
    macro.aim.copy(aimLocal);
    macro.eye.copy(aimLocal).add(eyeLocal);
    m.group.localToWorld(macro.eye);
    m.group.localToWorld(macro.aim);
    macro.eye.sub(m.group.userData.travelOffset);
    macro.aim.sub(m.group.userData.travelOffset);
    if (m === sun) macro.aim.lerp(origin, ease(t, 3.4, 11.8));
    if (m === jupiter) macro.aim.lerp(origin, 0.22 + 0.40 * ease(t, 86, 95));
    macro.up.copy(up);
    macro.fov = m === sun ? 37 : 39;
    macro.near = Math.max(0.005, macro.eye.length() * 0.0011);
    return macro;
  }

  // At a hand-off the target passes from one vessel to another. Interpolate
  // view orientation around that target so a reversing ship cannot flip the lens.
  function handOver(a, b, w) {
    if (w <= 0) return a;
    if (w >= 1) return b;
    qa.setFromRotationMatrix(basis.lookAt(a.eye, a.aim, a.up));
    qb.setFromRotationMatrix(basis.lookAt(b.eye, b.aim, b.up));
    qa.slerp(qb, w);
    mixed.aim.lerpVectors(a.aim, b.aim, w);
    const distance = Math.exp(mix(Math.log(a.eye.distanceTo(a.aim)), Math.log(b.eye.distanceTo(b.aim)), w));
    mixed.eye.set(0, 0, distance).applyQuaternion(qa).add(mixed.aim);
    mixed.up.set(0, 1, 0).applyQuaternion(qa);
    mixed.near = mix(a.near, b.near, w);
    mixed.fov = mix(a.fov, b.fov, w);
    return mixed;
  }

  function portLens(t) {
    // A moving berth, not a neutral studio turntable. Crane past the forward
    // truss with a view through the rotating ring to the actual curved Earth.
    const s = ease(t, 73.5, 84);
    stationPose.eye.set(mix(4.6, 2.25, s), mix(6.15, 6.9, s), mix(5.7, 7.25, s));
    stationPose.aim.set(0.1 + 0.39 * s, 0.12, -0.1);
    station.group.localToWorld(stationPose.eye);
    station.group.localToWorld(stationPose.aim);
    station.group.getWorldQuaternion(rig);
    stationPose.up.copy(up).applyQuaternion(rig);
    stationPose.near = 0.002;
    stationPose.fov = 42;
    return stationPose;
  }

  function escortLens(t) {
    traffic.getHeroPose(ship, forward);
    if (ship.lengthSq() < R * R) return portLens(t);
    worldUp.copy(ship).normalize();
    // Frame at a stable offset from the plane of the traffic lane so the world
    // horizon remains legible when a tug reverses thrust on its final approach.
    earth.mounts.elevator.getWorldPosition(aDir);
    earth.mounts.station.getWorldPosition(bDir);
    laneNormal.crossVectors(aDir, bDir).normalize();
    forward.crossVectors(laneNormal, worldUp).normalize();
    const tracking = ease(t, 68.1, 75.5);
    escort.eye
      .copy(ship)
      .addScaledVector(laneNormal, 0.235 - 0.035 * tracking)
      .addScaledVector(worldUp, 0.222 + 0.083 * tracking)
      .addScaledVector(forward, -0.17 - 0.035 * tracking);
    escort.aim.copy(ship).addScaledVector(forward, 0.018 + 0.035 * tracking);
    escort.up.copy(worldUp);
    escort.near = 0.001;
    escort.fov = 42;
    return escort;
  }

  function departureLens(t) {
    // Hold a three-quarter view of the exhaust hemisphere through the music
    // cue. In our Earth-centred frame only the lens and its target move.
    const travel = proxima.wakeDirection || nearDeparture.set(.23, .11, -.97).normalize();
    departureSide.crossVectors(up, travel).normalize();
    departureAxis.copy(travel).multiplyScalar(-.43).addScaledVector(departureSide, -.87);
    departureAxis.y += .28;
    departureAxis.normalize();
    const retreat = ease(t, departureCue + .6, 108);
    departureAxis.applyAxisAngle(up, -.19 * retreat);
    departure.eye.copy(departureAxis).multiplyScalar(mix(15.4, 24.0, retreat));
    departure.aim.copy(travel).multiplyScalar(-.93 - .55 * retreat);
    departure.up.copy(up);
    departure.fov = 36;
    departure.near = .055;
    return departure;
  }

  function sample(t) {
    // A small sideways translation carries across the stop-rotation chapter.
    // The same starting vector is passed to the ground and elevator routes.
    const az = 0.075 - 0.44 * ease(t, 35, 39.7) + 0.16 * ease(t, 49, 58);
    orbit.set(Math.sin(az), 0.046 + 0.049 * ease(t, 39, 52), Math.cos(az)).normalize();
    const distance = 8.75 - 0.65 * ease(t, 37, 52);
    if (t < 49) {
      engineAngles.yaw = mix(-0.38, 0.39, ease(t, 16.5, 35));
      engineAngles.pitch = mix(-0.085, 0.043, ease(t, 18, 32));
      const local = navigation.sample('engine', planetState.depth, orbit, engineAngles, distance);
      if (t > 18.5 && t < 32.4) {
        yard.eye.set(yardCoordinate(t, 1), yardCoordinate(t, 2), yardCoordinate(t, 3));
        yard.aim.set(yardCoordinate(t, 4), yardCoordinate(t, 5), yardCoordinate(t, 6));
        engine.group.localToWorld(yard.eye);
        engine.group.localToWorld(yard.aim);
        engine.group.getWorldQuaternion(rig);
        yard.up.copy(up).applyQuaternion(rig);
        yard.near = 0.00058;
        yard.fov = yardCoordinate(t, 7);
        return handOver(local, yard, ease(t, 18.5, 20.45) * (1 - ease(t, 28.6, 32.4)));
      }
      if (t >= 15.5) return local;
      const far = systemLens(sun, t);
      return join(far, local, ease(t, 4.4, 15.5));
    }
    if (t < 70.2) {
      const p = phase(t, 49, 67.8);
      const base = navigation.sample('elevator', ease(t, 49, 57.7), orbit, still, distance);
      const lift = liftShot(p, base);
      if (t <= 65.7) return lift;
      return handOver(lift, escortLens(t), ease(t, 65.7, 70.2));
    }
    if (t < 79.6) return handOver(escortLens(t), portLens(t), ease(t, 75.7, 79.6));
    if (t < 88.8) {
      const pose = join(portLens(t), systemLens(jupiter, t), ease(t, 79.6, 88.8));
      // Hold the Earth limb as a reference while the station falls away and
      // Jupiter enters from the other side of the same frame.
      pose.aim.lerp(origin, 0.44 * ease(t, 79.6, 81.4) * (1 - ease(t, 82.5, 85.5)));
      return pose;
    }
    if (t < 92.6) return systemLens(jupiter, t);
    return join(systemLens(jupiter, t), departureLens(t), ease(t, 92.6, 97.7));
  }
  function resumeNavigation(t) {
    if (t >= 11.4 && t < 49) navigation.resumeShot('engine', planetState.depth, orbit);
    else if (t >= 49 && t < 67) navigation.resumeShot('elevator', ease(t, 49, 57.7), orbit);
  }
  return { update, environment, sample, resumeNavigation };
}
