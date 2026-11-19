import { chapters, telemetry, dossiers, liftProgress, ignitionDemand, subtitleCues } from './states.js';
import { createSoundtrack } from './audio.js';

const $ = (id) => document.getElementById(id);
const gsap = window.gsap,
  reduced = matchMedia('(prefers-reduced-motion: reduce)');
const small = matchMedia('(max-width: 760px), (max-height: 530px)');
const jumpButtons = [...document.querySelectorAll('[data-chapter]')];
const destinations = [...document.querySelectorAll('[data-go]')];
const terms = Object.keys(dossiers);
const soundtrack = createSoundtrack(restartWithSound);
const startTimes = chapters.map((_, i) => chapters.slice(0, i).reduce((n, c) => n + c.length, 0));
const total = startTimes.at(-1) + chapters.at(-1).length;
const clock = { seconds: 0 },
  epoch = Date.UTC(2061, 1, 16, 8, 42, 0),
  intl = new Intl.NumberFormat('zh-CN');
let world,
  mode = 'film',
  current = 'sun',
  chapterIndex = -1,
  previousTime = -1,
  done = false,
  staticMode = false,
  ready = false;
let selected = 'earth',
  inspected = 'earth',
  priorFocus = null,
  exploreTime = 0,
  dataTween,
  pausedForTab = false;
let filmPrint = null,
  printStarting = false;
let startingWithSound = false;
const live = { thrust: 0, speed: 29.78, au: 1, spin: 15.04, alt: 0, delay: 499 };
const fields = Object.keys(live);
const fmt = (seconds) =>
  String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const put = (id, value) => {
  const el = $(id),
    s = String(value);
  if (el.textContent !== s) el.textContent = s;
};
const sceneFor = (i, p) =>
  ['sun', p < 0.75 ? 'engine' : 'earth', 'earth', 'elevator', 'jupiter', 'proxima', 'solar', 'galaxy'][i];
const labels = {
  sun: 'SOL',
  earth: 'EARTH',
  engine: 'CN–07',
  elevator: 'LIFT',
  station: 'AURORA',
  jupiter: 'JOVE',
  proxima: 'PROXIMA',
  solar: 'SOL',
  galaxy: 'MILKY WAY',
};
let shownFraction = 0;
function progress(value, label) {
  shownFraction = Math.max(shownFraction, value);
  $('loading-progress').value = shownFraction;
  put('loading-percent', Math.round(shownFraction) + '%');
  put('loading-label', label);
}
function onScene(id) {
  current = id;
  document.body.dataset.view = id;
  put('view-code', labels[id]);
  if (mode === 'explore' && dossiers[id] && selected !== id) describeDestination(id);
}
function showImage(id) {
  if (current !== id || !$('space').style.backgroundImage) {
    const path = 'assets/previews/' + id + '.webp';
    $('space').style.backgroundImage = 'url("' + (window.atlasAsset?.(path) || './' + path) + '")';
    onScene(id);
  }
}
function loseWebGL(id) {
  staticMode = true;
  world = null;
  document.body.classList.add('static-mode');
  $('space').replaceChildren();
  filmPrint = document.createElement('video');
  filmPrint.className = 'film-print';
  filmPrint.muted = true;
  filmPrint.playsInline = true;
  filmPrint.preload = 'auto';
  filmPrint.setAttribute('aria-hidden', 'true');
  const printPath = 'assets/previews/mission-film.mp4';
  filmPrint.src = window.atlasAsset?.(printPath) || './' + printPath;
  filmPrint.addEventListener('loadeddata', () => filmPrint.classList.add('decoded'));
  filmPrint.addEventListener('error', () => filmPrint.classList.remove('decoded'));
  $('space').append(filmPrint);
  $('space').classList.add('ready');
  $('curtain').style.opacity = '0';
  put('render-state', '静态影像');
  showImage(id);
  updateMarkers({});
}
function renderFilmPrint(id, seconds, force) {
  const v = filmPrint;
  if (!v || v.readyState < 2 || v.error) showImage(id);
  else if (current !== id) onScene(id);
  if (!v || v.readyState < 1 || v.error) return;
  if (force || (!v.seeking && Math.abs(v.currentTime - seconds) > 0.35)) {
    v.currentTime = Math.min(seconds, Math.max(0, v.duration - 0.001));
  }
  if (timeline.paused() || done || document.hidden) v.pause();
  else if (v.paused && !printStarting) {
    printStarting = true;
    v.play()
      .catch(() => {})
      .finally(() => {
        printStarting = false;
      });
  }
}
function layoutPanels() {
  document.querySelectorAll('.hud-panel').forEach((p) => (p.open = !small.matches));
}
layoutPanels();
small.addEventListener('change', layoutPanels);
document.querySelectorAll('.hud-panel').forEach((panel) =>
  panel.addEventListener('toggle', () => {
    if (!panel.open || !small.matches) return;
    document.querySelectorAll('.hud-panel').forEach((other) => {
      if (other !== panel) other.open = false;
    });
  }),
);

/** GSAP's playhead drives the camera, captions, scene animations and all readings
 * from the same timestamp. Scrubbing backward and pausing retain exact poses. */
function drawReadings(seconds, target, state) {
  const { thrust, speed, au, spin, alt, delay } = live;
  put('engine-output', thrust.toFixed(1));
  put('engine-count', intl.format(Math.round((10824 * thrust) / 100)));
  put('engine-temp', thrust < 0.3 ? '环境温度' : (thrust * 1.52).toFixed(1) + ' MK');
  $('meter-fill').style.width = thrust.toFixed(1) + '%';
  put('orbit-speed', speed.toFixed(2) + ' km/s');
  put('orbit-au', au.toFixed(3) + ' AU');
  put('orbit-spin', spin.toFixed(2) + ' °/h');
  $('orbit-dot').setAttribute('cx', String(88 + Math.min(75, Math.log(au + 1) * 20)));
  $('orbit-dot').setAttribute('cy', String(46 - Math.min(23, Math.log(au + 1) * 6)));
  put('elevator-alt', intl.format(Math.round(alt)) + ' km');
  put('elevator-state', state);
  put('mission-target', target);
  put(
    'mission-duration',
    delay > 86400 * 365
      ? (delay / (86400 * 365.25)).toFixed(2) + ' yr'
      : delay > 600
        ? (delay / 60).toFixed(1) + ' min'
        : delay.toFixed(delay < 1 ? 2 : 1) + ' s',
  );
  const date = new Date(epoch + Math.floor(seconds) * 1000).toISOString();
  put('mission-clock', date.slice(0, 10).replaceAll('-', '.') + '  ' + date.slice(11, 19));
}
function paintFilm(force = false) {
  if (mode !== 'film' || !ready) return;
  const s = clamp(clock.seconds, 0, total);
  syncSound(force);
  let i = 0;
  while (i < chapters.length - 1 && s >= startTimes[i + 1]) i++;
  const c = chapters[i],
    p = clamp((s - startTimes[i]) / c.length, 0, 1);
  if (staticMode) renderFilmPrint(sceneFor(i, p), s, force);
  else world?.film(i, p, s);
  if (i !== chapterIndex || force) {
    chapterIndex = i;
    put('chapter-zh', c.title);
    jumpButtons.forEach((b, k) => {
      if (k === i) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    put('announce', '第' + (i + 1) + '章，' + c.title);
  }
  // Update the DOM at 12 Hz while GSAP interpolates geometry on every frame.
  if (force || previousTime < 0 || Math.abs(s - previousTime) > 0.08 || s === total) {
    previousTime = s;
    const local = s - startTimes[i],
      cue = subtitleCues[i].find(([a, b]) => local >= a && local < b);
    put('chapter-copy', cue?.[2] || '');
    $('chapter-zh').style.opacity = local < 3.8 ? '1' : '0';
    const factor = gsap.parseEase('power1.inOut')(p);
    fields.forEach((k, n) => (live[k] = gsap.utils.interpolate(telemetry[i][n], telemetry[i + 1][n], factor)));
    if (i === 1) {
      const fired = clamp((ignitionDemand(s) - 0.105) / 0.875, 0, 1);
      live.thrust = 96.8 * fired * fired * (3 - 2 * fired);
    }
    if (i === 2) live.spin = 15.04 * (1 - Math.min(1, p / 0.82)) ** 2;
    if (i === 3) live.alt = liftProgress(p) * 35786;
    drawReadings(
      s,
      c.target,
      i < 3 ? '待命' : i === 3 ? (p >= 0.6 ? '进站' : p <= 0.11 ? '准备上行' : '上行') : '枢纽停靠',
    );
    const range = $('film-progress');
    range.value = String(Math.round((s / total) * 1000));
    range.style.setProperty('--progress', ((s / total) * 100).toFixed(2) + '%');
    range.setAttribute('aria-valuetext', fmt(s) + '，' + c.title);
    put('film-time', fmt(s));
  }
}
function playButton() {
  if (filmPrint && timeline.paused()) filmPrint.pause();
  syncSound();
  const pause = !timeline.paused() && !done;
  put('film-label', pause ? '暂停' : '继续');
  $('film-toggle').setAttribute('aria-label', pause ? '暂停电影' : '继续电影');
  $('film-icon').setAttribute('href', pause ? '#i-pause' : '#i-play');
  if (mode === 'film' && !done && timeline.paused()) showControls();
}
let idleTimer = 0;
const player = $('film-player');
const revealButton = $('reveal-player');
const filmTools = ['mode-explore', 'telemetry-toggle', 'sound', 'fullscreen'].map((id) => {
  const button = $(id);
  const home = document.createComment(id + ' in exploration');
  button.before(home);
  return { button, home };
});
function setHud(open) {
  document.body.dataset.filmHud = open ? 'open' : 'closed';
  $('telemetry-toggle').setAttribute('aria-expanded', String(open));
  put('telemetry-label', open ? '隐藏遥测' : '展开遥测');
}
function hideControls(restoreFocus = false) {
  clearTimeout(idleTimer);
  setHud(false);
  document.body.dataset.filmIdle = 'true';
  player.inert = true;
  revealButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) revealButton.focus({ preventScroll: true });
}
function scheduleHide() {
  clearTimeout(idleTimer);
  if (!ready || mode !== 'film' || done || timeline.paused() || player.inert) return;
  idleTimer = setTimeout(() => {
    const keyboardFocus = document.activeElement?.matches(':focus-visible');
    if (keyboardFocus && (player.contains(document.activeElement) || $('hud').contains(document.activeElement))) return;
    hideControls();
  }, 3200);
}
function showControls() {
  if (!ready || mode !== 'film' || done) return;
  player.inert = false;
  document.body.dataset.filmIdle = 'false';
  revealButton.setAttribute('aria-expanded', 'true');
  scheduleHide();
}
$('telemetry-toggle').onclick = () => {
  setHud($('telemetry-toggle').getAttribute('aria-expanded') !== 'true');
  scheduleHide();
};
revealButton.onclick = () => {
  showControls();
  $('film-toggle').focus({ preventScroll: true });
};
$('film-hide').onclick = () => hideControls(true);
$('space').addEventListener('click', () => {
  if (mode !== 'film' || done) return;
  if (player.inert) showControls();
  else hideControls();
});
for (const region of [player, $('hud')]) {
  for (const event of ['pointermove', 'pointerdown', 'focusout']) region.addEventListener(event, scheduleHide);
}
const timeline = gsap.timeline({
  paused: true,
  onUpdate: () => paintFilm(),
  onComplete: () => {
    if (mode !== 'film') return;
    done = true;
    timeline.pause();
    playButton();
    paintFilm(true);
    $('ending').hidden = false;
    $('replay').focus({ preventScroll: true });
  },
});
timeline.to(clock, { seconds: total, duration: total, ease: 'none' }, 0);
put('film-total', fmt(total));
put('ending-copy', '银河旋臂里，地球继续飞向比邻星。下一班值守人员将接续记录这段航程。');
function setMode(next) {
  mode = next;
  document.body.dataset.mode = next;
  if (filmPrint) {
    if (next === 'explore') filmPrint.pause();
    put('render-state', next === 'film' ? '宽银幕回放' : '静态影像');
  }
  $('space').tabIndex = next === 'film' ? -1 : 0;
  for (const { button, home } of filmTools) {
    if (next === 'film') $('film-tools').insertBefore(button, $('film-hide'));
    else home.after(button);
  }
  hideControls();
  $('mode-film').setAttribute('aria-pressed', String(next === 'film'));
  $('mode-explore').setAttribute('aria-pressed', String(next === 'explore'));
  $('ending').hidden = true;
  closeInfo(false);
  dataTween?.kill();
  updateMarkers({});
  if(next==='explore')syncSound(true);
}
function enterFilm(replay = false) {
  if (!ready) return;
  setMode('film');
  done = false;
  if (replay || clock.seconds >= total - 0.01) timeline.time(0);
  timeline.play();
  previousTime = -1;
  paintFilm(true);
  playButton();
}
async function restartWithSound() {
  if (!ready || startingWithSound) return;
  startingWithSound = true;
  const button = $('score-unlock');
  button.disabled = true;
  timeline.pause();
  if (mode !== 'film') setMode('film');
  done = false;
  $('ending').hidden = true;
  timeline.time(0);
  paintFilm(true);
  const audioReady = soundtrack.startOnline(true);
  let timeout;
  await Promise.race([audioReady, new Promise(resolve => {
    timeout = setTimeout(() => {
      soundtrack.cancelStart();
      resolve();
    }, 8000);
  })]);
  clearTimeout(timeout);
  startingWithSound = false;
  button.disabled = false;
  soundtrack.resumeStart();
  if (mode !== 'film' || document.hidden) return;
  if (timeline.paused() && clock.seconds === 0) enterFilm();
}
function seek(s) {
  if (!ready) return;
  if (done) {
    done = false;
    $('ending').hidden = true;
  }
  timeline.time(clamp(s, 0, total));
  paintFilm(true);
  playButton();
  if (!done) showControls();
}
function toggleFilm() {
  if (mode !== 'film' || !ready) return;
  soundtrack.allowRetry();
  if (done) return enterFilm(true);
  timeline.paused(!timeline.paused());
  playButton();
  showControls();
}
function choose(id) {
  if (!ready || !dossiers[id]) return;
  if (mode !== 'explore') {
    timeline.pause();
    setMode('explore');
    describeDestination('earth');
  }
  closeInfo(false);
  if (staticMode) {
    showImage(id);
    if (selected !== id) describeDestination(id);
  } else world.explore(id);
}
const exploreReadings = {
  earth: [94.7, 31.3, 1.02, 0, 35786, 499],
  engine: [98.6, 31.3, 1.02, 0, 35786, 0.12],
  elevator: [92.9, 31.3, 1.02, 0, 16000, 0.22],
  station: [93.8, 31.3, 1.02, 0, 35786, 0.16],
  solar: [96.5, 49.81, 82.3, 0, 35786, 41068],
  galaxy: [96.5, 49.81, 82.3, 0, 35786, 133790000],
};
function describeDestination(id) {
  selected = id;
  const d = dossiers[id];
  put('hero-title', d.title);
  put('hero-en', d.en);
  destinations.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.go === id)));
  dataTween?.kill();
  const v = exploreReadings[id];
  dataTween = gsap.to(live, {
    ...Object.fromEntries(fields.map((key, n) => [key, v[n]])),
    duration: reduced.matches ? 0 : 1.25,
    ease: 'power2.out',
  });
  put('announce', '自由探索，' + d.title);
}
// Throttle text layout independently of the WebGL refresh rate.
let lastExplore = -1;
gsap.ticker.add((time, ms) => {
  if (mode !== 'explore' || document.hidden) return;
  exploreTime += Math.min(ms / 1000, 0.12);
  if (time - lastExplore < 0.14) return;
  lastExplore = time;
  if (!dataTween?.isActive()) {
    live.thrust = exploreReadings[selected][0] + Math.sin(exploreTime * 0.51) * 0.22;
    if (selected === 'elevator')
      live.alt = 35786 * (world?.lift.ascent ?? 0.5 + 0.5 * Math.sin(exploreTime * 0.126 + 0.05));
  }
  drawReadings(
    clock.seconds + exploreTime,
    dossiers[selected].title,
    selected === 'elevator'
      ? (world?.lift.ascending ?? Math.cos(exploreTime * 0.126 + 0.05) > 0)
        ? '上行'
        : '下行'
      : '枢纽停靠',
  );
});

/** Mesh picking and gesture capture live in world.js;
 * the same dossiers are accessible by keyboard using the archive button. */
function showInfo(id) {
  if (mode !== 'explore' || !dossiers[id]) return;
  inspected = id;
  const d = dossiers[id],
    panel = $('info-panel');
  priorFocus = document.activeElement;
  put('info-title', d.title);
  put('info-en', d.en);
  put('info-copy', d.copy);
  $('info-data').replaceChildren(
    ...d.rows.map(([k, v]) => {
      const row = document.createElement('div'),
        a = document.createElement('dt'),
        b = document.createElement('dd');
      a.textContent = k;
      b.textContent = v;
      row.append(a, b);
      return row;
    }),
  );
  panel.hidden = false;
  $('show-info').setAttribute('aria-expanded', 'true');
  $('info-open').hidden = selected === id;
  keepOnScreen();
  $('info-close').focus({ preventScroll: true });
}
function closeInfo(restore = true) {
  if ($('info-panel').hidden) return;
  $('info-panel').hidden = true;
  $('show-info').setAttribute('aria-expanded', 'false');
  if (restore)
    (priorFocus?.isConnected && priorFocus !== document.body ? priorFocus : $('show-info')).focus({
      preventScroll: true,
    });
}
function movePanel(x, y) {
  const p = $('info-panel'),
    r = p.getBoundingClientRect();
  p.style.right = 'auto';
  p.style.bottom = 'auto';
  p.style.transform = 'none';
  p.style.left = clamp(x, 7, Math.max(7, innerWidth - r.width - 7)) + 'px';
  p.style.top = clamp(y, 7, Math.max(7, innerHeight - r.height - 7)) + 'px';
}
function keepOnScreen() {
  const p = $('info-panel');
  if (!p.hidden) {
    const r = p.getBoundingClientRect();
    movePanel(r.left, r.top);
  }
}
let drag = null;
const handle = $('info-handle');
handle.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const r = $('info-panel').getBoundingClientRect();
  drag = { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top };
  handle.setPointerCapture(e.pointerId);
});
handle.addEventListener('pointermove', (e) => {
  if (drag?.id === e.pointerId) movePanel(e.clientX - drag.x, e.clientY - drag.y);
});
handle.addEventListener('lostpointercapture', () => (drag = null));
handle.addEventListener('keydown', (e) => {
  const d = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key];
  if (d) {
    e.preventDefault();
    const r = $('info-panel').getBoundingClientRect();
    movePanel(r.left + d[0], r.top + d[1]);
  }
});
window.addEventListener('resize', keepOnScreen);
const markers = {};
for (const id of ['engine', 'elevator', 'station']) {
  const b = document.createElement('button');
  b.className = 'world-marker';
  b.dataset.facility = id;
  b.hidden = true;
  b.textContent = dossiers[id].title + ' ↗';
  b.setAttribute('aria-label', '查看' + dossiers[id].title + '档案');
  b.addEventListener('click', () => showInfo(id));
  $('markers').append(b);
  markers[id] = b;
}
function updateMarkers(coords) {
  const shown = [];
  for (const [id, b] of Object.entries(markers)) {
    const p = coords[id],
      mobile = small.matches;
    b.hidden =
      !p ||
      p[0] < 12 ||
      p[0] > innerWidth - 100 ||
      p[1] < innerHeight * 0.19 ||
      p[1] > innerHeight * (mobile ? 0.61 : 0.71) ||
      shown.some((q) => Math.abs(q[0] - p[0]) < 90 && Math.abs(q[1] - p[1]) < 29);
    if (!b.hidden) {
      shown.push(p);
      b.style.transform = 'translate(' + Math.round(p[0] + 10) + 'px,' + Math.round(p[1] - 10) + 'px)';
    }
  }
}
// A tap immediately after orbit dragging may lose its synthetic click on Android.
// Explicit destinations are idempotent, so the native keyboard click stays intact.
for (const button of destinations) {
  let start = null;
  button.addEventListener(
    'pointerdown',
    (e) => (start = e.pointerType === 'touch' && e.isPrimary ? [e.pointerId, e.clientX, e.clientY] : null),
  );
  button.addEventListener('pointercancel', () => (start = null));
  button.addEventListener('pointerup', (e) => {
    if (start?.[0] === e.pointerId && Math.hypot(e.clientX - start[1], e.clientY - start[2]) < 8)
      choose(button.dataset.go);
    start = null;
  });
  button.addEventListener('click', () => {
    choose(button.dataset.go);
  });
}
$('film-toggle').onclick = toggleFilm;
$('film-progress').addEventListener('input', (e) => seek((Number(e.target.value) * total) / 1000));
jumpButtons.forEach((b, i) => (b.onclick = () => seek(startTimes[i])));
$('mode-film').onclick = () => {
  if (mode !== 'film' || done) enterFilm();
};
$('mode-explore').onclick = () => {
  if (mode !== 'explore') choose('earth');
};
$('replay').onclick = () => enterFilm(true);
$('end-explore').onclick = () => choose('earth');
$('show-info').onclick = () => showInfo(selected);
$('info-close').onclick = () => closeInfo();
$('info-open').onclick = () => choose(inspected);
function syncSound(force=false) {
  soundtrack.sync(mode,clock.seconds,ready && (mode==='explore' || (!done && !timeline.paused())),force);
}
if (!document.documentElement.requestFullscreen) $('fullscreen').hidden = true;
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    put('announce', '当前视窗无法全屏');
  }
};
document.addEventListener('fullscreenchange', () => {
  const text = document.fullscreenElement ? '退出全屏' : '进入全屏';
  $('fullscreen').title = text;
  $('fullscreen').setAttribute('aria-label', text);
});
window.addEventListener('keydown', (e) => {
  if (!ready || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.key === 'Escape') {
    if (soundtrack.close()) return;
    if (!$('info-panel').hidden) closeInfo();
    else if (done) choose('earth');
    else if (mode === 'film' && !player.inert) hideControls(true);
    return;
  }
  if (done && e.key === 'Tab') {
    e.preventDefault();
    (document.activeElement === $('replay') ? $('end-explore') : $('replay')).focus();
    return;
  }
  if (e.target.closest('#music-panel')) return;
  if (e.key.toLowerCase() === 'e' && mode === 'film' && !done && !e.target.matches('input')) {
    choose('earth');
    $('mode-film').focus({ preventScroll: true });
    return;
  }
  if (e.code === 'Space' && mode === 'film' && !e.target.closest('button,input,summary')) {
    e.preventDefault();
    toggleFilm();
  }
  const n = Number(e.key) - 1;
  if (!e.target.matches('input') && Number.isInteger(n) && n >= 0) {
    if (mode === 'film' && n < chapters.length) seek(startTimes[n]);
    else if (mode === 'explore' && n < terms.length) choose(terms[n]);
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pausedForTab = mode === 'film' && !timeline.paused();
    if (pausedForTab) timeline.pause();
  } else if (pausedForTab && mode === 'film' && !done) {
    timeline.play();
    pausedForTab = false;
  }
  syncSound(true);
});
progress(8, '载入观测系统');
try {
  const { openWorld } = await import('./world.js');
  world = await openWorld({
    viewport: $('space'),
    curtain: $('curtain'),
    reduced,
    onProgress: progress,
    onScene,
    onInspect: showInfo,
    onHover: (id) => {
      $('space').dataset.hover = id || '';
    },
    onMarkers: updateMarkers,
    onLoss: loseWebGL,
  });
} catch (err) {
  console.warn('WebGL initialization failed; using recorded scene frames.', err);
  loseWebGL('sun');
}
progress(100, '观测系统就绪');
ready = true;
$('loading').hidden = true;
enterFilm(true);
if (soundtrack.wantsOnline()) soundtrack.startOnline();
