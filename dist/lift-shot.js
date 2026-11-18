import * as THREE from 'three';

const ease = THREE.MathUtils.smoothstep;
const mix = THREE.MathUtils.lerp;

/**
 * Follow the moving cabin in the elevator's own frame. Both the cable and the
 * camera gain altitude against the same Earth, so compartment windows, guide
 * collars and the ground horizon pass the lens at different apparent speeds.
 * Call after model.update() and the scene's matrixWorld update for that frame.
 */
export function createLiftShot(model) {
  const pose = { eye: new THREE.Vector3(), aim: new THREE.Vector3(), up: new THREE.Vector3(), fov: 42, near: 0.001 };
  const cab = new THREE.Vector3(),
    eye = new THREE.Vector3(),
    aim = new THREE.Vector3();
  const radialUp = new THREE.Vector3(),
    fromDirection = new THREE.Vector3(),
    toDirection = new THREE.Vector3();
  const liftRotation = new THREE.Quaternion();

  return function sampleLift(progress, overviewPose) {
    const follow = ease(progress, 0.26, 0.44);
    if (follow === 0) return overviewPose;

    const ride = ease(progress, 0.36, 0.84);
    const reveal = ease(progress, 0.82, 0.99);
    const yaw = mix(0.64, 0.29, ride) + 0.15 * reveal;
    const distance = mix(7.45, 6.5, ride) + 9.25 * reveal;
    const elevation = mix(1.6, 2.6, ride) + 6.9 * reveal;

    // Read the rendered cabin rather than reconstructing its ascent schedule.
    // Climber is nested beneath the installation which includes the gate's
    // local translation; convert through the root before adding camera offsets.
    model.climber.getWorldPosition(cab);
    model.group.worldToLocal(cab);
    eye.set(Math.sin(yaw) * distance, elevation, Math.cos(yaw) * distance).add(cab);
    aim.set(-0.42 * (1 - reveal), 0.4 + 0.62 * reveal, 0).add(cab);
    model.group.localToWorld(eye);
    model.group.localToWorld(aim);
    model.group.getWorldQuaternion(liftRotation);
    radialUp.set(0, 1, 0).applyQuaternion(liftRotation).normalize();

    // A position lerp between two low-altitude viewpoints can cut an Earth
    // chord through the crust. Interpolate direction and altitude separately.
    const fromRadius = overviewPose.eye.length(),
      toRadius = eye.length();
    fromDirection.copy(overviewPose.eye).divideScalar(fromRadius);
    toDirection.copy(eye).divideScalar(toRadius);
    pose.eye
      .lerpVectors(fromDirection, toDirection, follow)
      .normalize()
      .multiplyScalar(mix(fromRadius, toRadius, follow));
    // The lens picks up the ground car before the dolly finishes its move.
    // Otherwise the midpoint between the terminal and car frames empty cable.
    pose.aim.lerpVectors(overviewPose.aim, aim, ease(progress, 0.255, 0.395));
    pose.up.lerpVectors(overviewPose.up, radialUp, follow).normalize();
    pose.fov = mix(overviewPose.fov, 40.5 + 4.5 * reveal, follow);
    pose.near = mix(overviewPose.near, 0.0014, follow);
    return pose;
  };
}
