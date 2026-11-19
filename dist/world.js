import * as THREE from 'three';
import { createEarth } from './scenes/earth.js';
import { createEngine } from './scenes/engine.js';
import { createStation } from './scenes/station.js';
import { createElevator } from './scenes/elevator.js';
import { createSun, createJupiter, createProxima } from './scenes/journey.js';
import { createNavigation } from './navigation.js';
import { makeSky } from './sky.js';
import { createCinematography } from './cinematography.js';
import { createTraffic } from './scenes/traffic.js';
import { createBloom, installReflections } from './lighting.js';
import { createCosmic } from './cosmic.js';
import { cosmicScale, cosmicStart } from './states.js';

const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const facilities = ['engine', 'elevator', 'station'];
const epochs = ['sun', 'jupiter', 'proxima'];

export async function openWorld({
  viewport,
  curtain,
  reduced,
  onProgress,
  onScene,
  onInspect,
  onHover,
  onMarkers,
  onLoss,
}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const bloom = createBloom(renderer);
  const surface = renderer.domElement;
  surface.style.touchAction = 'none';
  viewport.append(surface);
  const scene = new THREE.Scene(),
    sky = makeSky();
  scene.background = new THREE.Color(0x0a0a1a);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.025, 1400);
  const solar = new THREE.DirectionalLight(0xffe6cb, 2.2);
  solar.position.set(0.92, 0.56, -0.1);
  const bounce = new THREE.DirectionalLight(0xb4c9e6, 0.72);
  bounce.position.set(-0.38, -0.44, 1);
  const hemi = new THREE.HemisphereLight(0xc8d5e2, 0x484e60, 0.92);
  scene.add(sky.group, solar, bounce, hemi);
  const reflections = installReflections(scene, renderer);

  // Register the actual texture requests before the loader can finish an epoch.
  THREE.Cache.enabled = true;
  const manager = THREE.DefaultLoadingManager;
  let decoded = 0;
  const loaded = new Promise((resolve) => {
    manager.onLoad = resolve;
  });
  manager.onProgress = (_url, done, total) => {
    decoded = done / Math.max(1, total);
  };
  manager.itemStart('assembly');
  const models = {};
  const factories = {
    earth: createEarth,
    engine: createEngine,
    elevator: createElevator,
    station: createStation,
    sun: createSun,
    jupiter: createJupiter,
    proxima: createProxima,
  };
  for (const [i, [id, make]] of Object.entries(factories).entries()) {
    models[id] = make({ shared: true });
    models[id].group.name ||= id;
    onProgress(11 + 6 * (i + 1), '组装地表设施与轨道');
    await nextFrame();
  }
  manager.itemEnd('assembly');
  const poll = setInterval(() => onProgress(54 + decoded * 28, '解码行星观测影像'), 100);
  await loaded;
  clearInterval(poll);
  manager.onLoad = manager.onProgress = undefined;

  // One ground-normal coordinate frame per installation. Frames, model identity
  // and geometry survive zoom, orbit, inspection, cinematic playback and replay.
  const earth = models.earth;
  const cosmic = createCosmic();
  scene.add(earth.group, cosmic.group);
  for (const id of facilities) {
    const model = models[id];
    model.group.scale.setScalar(model.sharedScale ?? { engine: 0.0023, elevator: 0.02, station: 0.065 }[id]);
    earth.mounts[id].add(model.group);
  }
  for (const id of epochs) {
    const model = models[id];
    scene.add(model.group);
  }
  const navigation = createNavigation(models);
  const facilityHits = facilities.flatMap(id => models[id].pickables);
  const surfaceHit = earth.pickables[0];
  const traffic = createTraffic({ earth, elevator: models.elevator, station: models.station });
  scene.add(traffic.group);
  const cinematography = createCinematography(models, navigation, traffic);
  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2(),
    parallax = new THREE.Vector2();
  const temp = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    closest = new THREE.Vector3();
  const lastAim = new THREE.Vector3(),
    departureEye = new THREE.Vector3(),
    departureAim = new THREE.Vector3();
  const departureUp = new THREE.Vector3();
  let handoff = 1,
    departureFov = 40,
    departureNear = 0.03,
    departureFar = 1400,
    departureScale = 0,
    visibleScale = 0;
  const celestialOrbit = new THREE.Vector3(0, 0.12, 1).normalize();
  const closingPose = {eye: new THREE.Vector3(), aim: new THREE.Vector3(), up: new THREE.Vector3(), near: 0.03, fov: 40};
  const closingDirection = new THREE.Vector3();
  const closingTurn = new THREE.Quaternion();
  const closingRotation = new THREE.Quaternion();
  const reticleUniforms = new Map();
  for (const id of ['earth', ...facilities]) {
    for (const entry of models[id].pickables) {
      entry.object.traverse((node) => {
        if (!node.isMesh || !node.material || node.material.visible === false) return;
        for (const mat of [].concat(node.material)) {
          if (reticleUniforms.has(mat)) continue;
          const u = { value: 0 };
          reticleUniforms.set(mat, { id: entry.id, u });
          const original = mat.onBeforeCompile;
          mat.onBeforeCompile = function (shader, ...args) {
            original.call(this, shader, ...args);
            shader.uniforms.inspectGlow = u;
            shader.fragmentShader =
              'uniform float inspectGlow;\n' +
              shader.fragmentShader.replace(
                /}\s*$/,
                'gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.12,.91,1.),inspectGlow*.22);\n}',
              );
          };
          mat.customProgramCacheKey = () => 'atlas-inspection-' + original.toString();
        }
      });
    }
  }
  let current = '',
    exploring = false,
    alive = true,
    hovered = null,
    dirty = false;
  let width = 1,
    height = 1,
    dpr = 1,
    last = 0,
    slow = 0,
    lastHud = -1000,
    elapsed = 0;
  let lastFov = 0,
    lastNear = 0;
  const frame = { index: 0, p: 0, time: 0 };
  function sceneName(id) {
    if (id === current) return;
    current = id;
    onScene(id);
  }
  function highlight(id) {
    if (hovered === id) return;
    hovered = id;
    earth.setHighlight(navigation.depth < 0.38 ? id : null);
    models.engine.setHighlight?.(navigation.depth > 0.55 ? id : null);
    for (const v of reticleUniforms.values()) v.u.value = v.id === id ? 1 : 0;
    viewport.style.cursor = id ? 'pointer' : 'grab';
    onHover(id);
  }
  function updateEarth(time, dt, approach, ignition, liftPhase) {
    earth.setIgnition(ignition);
    earth.setGroundApproach?.(approach);
    models.engine.setProximity(approach);
    models.engine.setIgnition(ignition);
    earth.update(time, dt);
    models.engine.update(time, dt);
    models.elevator.update(time, dt, liftPhase);
    models.station.update(time, dt);
    // Fixed horizon lighting remains available on the cable and rotating station;
    // the engine's local warm sources take over inside its twilight valley.
    solar.intensity = 2.28 * (1 - 0.87 * approach);
    hemi.intensity = 0.92 * (1 - 0.78 * approach);
    bounce.intensity = 0.72 * (1 - 0.79 * approach);
    earth.group.updateMatrixWorld();
  }
  function density(v) {
    dpr = v;
    renderer.setPixelRatio(v);
    sky.setPixelRatio(v);
  }
  function resize() {
    width = Math.max(1, viewport.clientWidth);
    height = Math.max(1, viewport.clientHeight);
    density(Math.min(devicePixelRatio || 1, width < 760 ? 1.3 : 1.4, Math.sqrt(1650000 / (width * height))));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // In the theatre the canvas itself matches the anamorphic frame.
    if (document.body.dataset.mode === 'explore')
      camera.setViewOffset(width, height, 0, Math.round(height * 0.025), width, height);
    else camera.clearViewOffset();
    lastFov = 0;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  function applyPose(pose, minAspect) {
    camera.position.copy(pose.eye);
    camera.up.copy(pose.up);
    camera.lookAt(pose.aim);
    lastAim.copy(pose.aim);
    const fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(pose.fov / 2)) * Math.max(1, minAspect / camera.aspect)),
    );
    const far = pose.far ?? 1400;
    if (Math.abs(fov - lastFov) > 0.001 || Math.abs(pose.near - lastNear) > 1e-7 || camera.far !== far) {
      lastFov = camera.fov = fov;
      lastNear = camera.near = pose.near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  }
  function updateScale(scale, time) {
    visibleScale = scale;
    earth.group.visible = scale < 1.35;
    for (const id of epochs) models[id].group.visible = scale <= 0.16;
    for (const id of facilities) models[id].group.visible = scale < 0.31;
    traffic.group.visible = scale < 0.31;
    cosmic.update(scale, time, camera, height);
    sky.setDistance?.(scale);
  }
  const scaleName = (scale) => scale >= 1.46 ? 'galaxy' : scale >= 0.48 ? 'solar' : 'earth';
  function storyPose() {
    const { index, p, time } = frame;
    const state = cinematography.update(time);
    earth.setRotationPhase(state.rotation);
    updateEarth(time, 0, state.ground, state.power, state.cabin);
    cinematography.environment(time);
    traffic.update(time, camera, height);
    const scale = cosmicScale(time);
    let pose = cinematography.sample(Math.min(time, cosmicStart));
    if (time > 104.5) {
      // Level the lens on the same moving Earth before the wider orbits enter
      // the field. The zero-scale pose is shared with the reversible flyout.
      const v = THREE.MathUtils.smootherstep(time, 104.5, cosmicStart);
      const globe = navigation.sample('engine', 0, celestialOrbit);
      // Orbit the Earth instead of taking a chord that could cross the crust.
      closingDirection.copy(pose.eye).normalize();
      closingTurn.setFromUnitVectors(closingDirection, celestialOrbit);
      closingRotation.identity().slerp(closingTurn, v);
      const altitude = 2.2 + Math.exp(THREE.MathUtils.lerp(
        Math.log(Math.max(0.001, pose.eye.length() - 2.2)),
        Math.log(globe.eye.length() - 2.2),
        v,
      ));
      closingPose.eye.copy(closingDirection).applyQuaternion(closingRotation).multiplyScalar(altitude);
      closingPose.aim.lerpVectors(pose.aim, globe.aim, v);
      closingPose.up.lerpVectors(pose.up, globe.up, v).normalize();
      closingPose.near = THREE.MathUtils.lerp(pose.near, globe.near, v);
      closingPose.fov = THREE.MathUtils.lerp(pose.fov, globe.fov, v);
      pose = scale > 0 ? cosmic.sample(scale, closingPose) : closingPose;
    }
    applyPose(pose, 1);
    updateScale(scale, time);
    const id = [
      'sun',
      state.depth > 0.41 ? 'engine' : 'earth',
      'earth',
      time > 71.5 ? 'station' : 'elevator',
      'jupiter',
      'proxima',
      'solar',
      'galaxy',
    ][index];
    sceneName(id);
  }
  function film(index, p, time) {
    if (exploring) {
      highlight(null);
      onMarkers({});
      handoff = 1;
      earth.setDiagrams(false);
    }
    exploring = false;
    Object.assign(frame, { index, p, time });
    curtain.style.opacity = '0';
  }
  function explore(id = 'earth', initial = false) {
    if (!exploring) {
      departureEye.copy(camera.position);
      departureAim.copy(lastAim);
      departureUp.copy(camera.up);
      departureFov =
        2 *
        THREE.MathUtils.radToDeg(
          Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, 0.93 / camera.aspect)),
        );
      departureNear = camera.near;
      departureFar = camera.far;
      departureScale = visibleScale;
      navigation.reset();
      cinematography.resumeNavigation(frame.time);
      if (visibleScale > 0) navigation.resumeShot('engine', -visibleScale, celestialOrbit);
      handoff = initial || reduced.matches ? 1 : 0;
      exploring = true;
      elapsed = frame.time;
      // Preserve continuity of the moving station when leaving a film chapter.
      earth.setRotationPhase(null);
      earth.setSpin(0.035);
      earth.setDiagrams(true);
      earth.setSunDirection(null);
      sceneName('earth');
    }
    navigation.go(id);
    highlight(null);
    curtain.style.opacity = '0';
  }
  function locate(x, y) {
    const rect = surface.getBoundingClientRect();
    pointer.set(((x - rect.left) * 2) / rect.width - 1, 1 - ((y - rect.top) * 2) / rect.height);
  }
  function occluded(anchor) {
    direction.copy(anchor).sub(camera.position);
    const len = direction.length();
    direction.multiplyScalar(1 / Math.max(0.00001, len));
    const along = -camera.position.dot(direction);
    return (
      along > 0 &&
      along < len &&
      closest.copy(camera.position).addScaledVector(direction, along).lengthSq() < 2.195 ** 2
    );
  }
  function readMarkers() {
    const result = {};
    for (const [id, anchor] of Object.entries(earth.anchors)) {
      if (occluded(anchor)) continue;
      temp.copy(anchor).project(camera);
      if (temp.z > 0 && temp.z < 1 && Math.abs(temp.x) < 1 && Math.abs(temp.y) < 1)
        result[id] = [((1 + temp.x) * width) / 2, ((1 - temp.y) * height) / 2];
    }
    return result;
  }
  function hit(includeDetails = false) {
    if (!exploring || visibleScale > 0.25) return null;
    // The orbital proxies are useful at a distance. Inside a terminal their
    // radius can enclose the camera: use only the actual model at this scale.
    const deep = navigation.depth > 0.55;
    const entries = deep ? [...models[navigation.route].pickables, surfaceHit] : earth.pickables;
    ray.setFromCamera(pointer, camera);
    let nearest = ray.intersectObjects(entries.map(entry => entry.object), true)[0];
    let candidates = entries;
    // The proxies keep hover inexpensive. An explicit click also checks
    // protruding parts outside the proxies, such as the station's solar wings.
    if (includeDetails && !deep) {
      for (const entry of facilityHits) {
        if (!models[entry.id].group.visible) continue;
        const detail = ray.intersectObject(entry.object, true).find(result => result.object.visible);
        if (!detail || (nearest && detail.distance >= nearest.distance)) continue;
        nearest = detail;
        candidates = facilityHits;
      }
    }
    for (let node = nearest?.object; node; node = node.parent) {
      const entry = candidates.find(candidate => candidate.object === node);
      if (entry) return entry.id;
    }
    return null;
  }
  function zoomTarget() {
    if (Math.abs(navigation.depth) > 0.015) return null;
    const exact = hit();
    if (facilities.includes(exact)) return exact;
    const coords = readMarkers(),
      x = ((1 + pointer.x) * width) / 2,
      y = ((1 - pointer.y) * height) / 2;
    let target = null,
      best = 35;
    for (const [id, [mx, my]] of Object.entries(coords)) {
      const d = Math.hypot(mx - x, my - y);
      if (d < best) {
        target = id;
        best = d;
      }
    }
    return target;
  }
  const fingers = new Map();
  let pinch = 0;
  const measure = () => {
    const [a, b] = fingers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  // The label and the few pixels of geometry beside it are the same destination.
  viewport.parentElement.addEventListener(
    'wheel',
    (e) => {
      const label = e.target.closest('.world-marker');
      if (!exploring || (e.target !== surface && !label)) return;
      e.preventDefault();
      locate(e.clientX, e.clientY);
      const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
      navigation.zoom(clamp((-e.deltaY * units) / 1250, -0.27, 0.27), label?.dataset.facility || zoomTarget());
      highlight(null);
    },
    { passive: false },
  );
  surface.addEventListener('pointerdown', (e) => {
    if (!exploring || e.button !== 0) return;
    locate(e.clientX, e.clientY);
    surface.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, dragged: false });
    if (fingers.size >= 2) {
      for (const finger of fingers.values()) finger.dragged = true;
      pinch = measure();
    }
    dirty = false;
  });
  surface.addEventListener('pointermove', (e) => {
    locate(e.clientX, e.clientY);
    const f = fingers.get(e.pointerId);
    if (!exploring || !f) {
      dirty = e.pointerType !== 'touch';
      return;
    }
    const dx = e.clientX - f.x,
      dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    if (fingers.size === 2) {
      const span = measure(),
        [a, b] = fingers.values();
      locate((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (pinch > 2 && span > 2) navigation.zoom(Math.log(span / pinch) * 0.85, zoomTarget());
      pinch = span;
    } else if (fingers.size === 1) {
      if (Math.hypot(f.x - f.startX, f.y - f.startY) > 4) f.dragged = true;
      if (f.dragged) navigation.drag(dx, dy, Math.min(width, height));
    }
    highlight(null);
  });
  surface.addEventListener('pointerup', (e) => {
    const f = fingers.get(e.pointerId);
    if (f && !f.dragged && Math.hypot(e.clientX - f.startX, e.clientY - f.startY) < 6) {
      locate(e.clientX, e.clientY);
      const id = hit(true);
      if (id) {
        highlight(id);
        onInspect(id);
      }
    }
    fingers.delete(e.pointerId);
    pinch = 0;
  });
  surface.addEventListener('lostpointercapture', (e) => {
    fingers.delete(e.pointerId);
    pinch = 0;
  });
  surface.addEventListener('pointerleave', () => {
    dirty = false;
    highlight(null);
  });
  // Prime the full system, including the near-ground materials and rotating
  // berth lights. All of it remains attached to this scene for the entire reel.
  for (const [i, [index, time]] of [[0,1],[1,26],[3,60],[3,73],[4,90],[5,103],[6,120],[7,135]].entries()) {
    frame.index = index;
    frame.time = time;
    storyPose();
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    onProgress(83 + (i + 1) * 2, '校准宽银幕摄影机');
    await nextFrame();
  }
  frame.time = frame.index = 0;
  storyPose();
  sceneName('sun');
  viewport.classList.add('ready');
  function render(stamp) {
    if (!alive) return;
    const dt = last ? Math.min((stamp - last) / 1000, 0.12) : 0;
    last = stamp;
    if (!document.hidden) {
      if (exploring) {
        elapsed += dt;
        const ground = navigation.route === 'engine' ? smooth(navigation.depth, 0.49, 0.96) : 0;
        updateEarth(elapsed, dt, ground, 1);
        let pose = navigation.step(dt, reduced.matches);
        let scale = Math.max(0, -navigation.depth);
        if (scale > 0) {
          const { yaw, pitch } = navigation.farAngles;
          pose = cosmic.sample(scale, pose, yaw, pitch);
        }
        if (handoff < 1) {
          // When leaving a wide film shot the viewer can watch its Earth grow
          // into the explorable globe. Preserve altitude even on a far-side arc.
          handoff = Math.min(1, handoff + dt / 1.65);
          const v = smooth(handoff, 0, 1),
            r0 = departureEye.length(),
            r1 = pose.eye.length();
          temp.copy(departureEye).normalize();
          direction.copy(pose.eye).normalize();
          departureTurn.setFromUnitVectors(temp, direction);
          rotationBlend.identity().slerp(departureTurn, v);
          pose.eye
            .copy(temp)
            .applyQuaternion(rotationBlend)
            .multiplyScalar(
              2.2 +
                Math.exp(
                  THREE.MathUtils.lerp(Math.log(Math.max(0.001, r0 - 2.2)), Math.log(Math.max(0.001, r1 - 2.2)), v),
                ),
            );
          pose.aim.lerp(departureAim, (1 - v) ** 3);
          pose.up.lerp(departureUp, 1 - v).normalize();
          pose.fov = THREE.MathUtils.lerp(departureFov, pose.fov, v);
          pose.near = THREE.MathUtils.lerp(departureNear, pose.near, v);
          pose.far = Math.max(pose.far ?? 1400, departureFar);
          scale = THREE.MathUtils.lerp(departureScale, scale, v);
        }
        models.proxima.setWake(0);
        applyPose(pose, 0.93);
        updateScale(scale, elapsed);
        earth.setDiagrams(scale < 0.24);
        traffic.update(elapsed, camera, height);
        sceneName(navigation.depth > 0.45 ? navigation.route : scaleName(scale));
        if (stamp - lastHud > 95) {
          onMarkers(navigation.depth < 0.34 && scale < 0.20 ? readMarkers() : {});
          viewport.dataset.flight = String(Math.round(navigation.depth * 100));
          lastHud = stamp;
        }
      } else storyPose();
      sky.group.position.copy(camera.position);
      if (!exploring) sky.group.rotation.set(0, 0, 0);
      if (exploring && !reduced.matches) {
        parallax.lerp(pointer, 1 - Math.exp(-dt * 3.4));
        sky.group.rotation.set(-parallax.y * 0.026, parallax.x * 0.037, 0);
      }
      sky.setTime(exploring ? elapsed : frame.time);
      if (dirty) {
        highlight(hit());
        dirty = false;
      }
      for (const model of lodModels) model.updateLOD(camera, height);
      bloom.render(scene, camera);
      slow = dt > 0.034 ? slow + 1 : Math.max(0, slow - 0.55);
      if (slow > 15 && dpr > 0.49) {
        density(Math.max(0.48, dpr * 0.82));
        slow = 0;
      }
    }
    requestAnimationFrame(render);
  }
  surface.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      alive = false;
      observer.disconnect();
      bloom.dispose();
      reflections.dispose();
      onLoss(current);
    },
    { once: true },
  );
  const lodModels = [earth, models.elevator, models.station];
  const rotationBlend = new THREE.Quaternion(),
    departureTurn = new THREE.Quaternion();
  requestAnimationFrame(render);
  return {
    film,
    explore,
    get scene() {
      return current;
    },
    get lift() {
      return models.elevator;
    },
  };
}
