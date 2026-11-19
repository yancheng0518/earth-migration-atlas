import { departureCue } from './states.js';

const trackUrl = 'https://music.163.com/song/media/outer/url?id=1343461538.mp3';
// The drums return at 04:59.8 in the full NetEase recording.
const offset = 299.8 - departureCue;

export function createSoundtrack(button, status) {
  const music = new Audio();
  const label = button.querySelector('span');
  const icon = button.querySelector('use');
  let mode = 'explore', time = 0, running = false;
  let enabled = false, mutedByUser = false, preparing = false;
  let attempt = null, lastCorrection = -Infinity;

  function updateButton() {
    label.textContent = enabled ? '声音开启' : '已静音';
    icon.setAttribute('href', enabled ? '#i-sound' : '#i-muted');
  }

  function mute() {
    mutedByUser = true;
    enabled = preparing = false;
    attempt = null;
    music.pause();
    status.textContent = '';
    updateButton();
  }

  function streamUnavailable(message = '网易云音源暂不可用，请再点声音按钮重试。') {
    if (!enabled) return;
    enabled = false;
    music.pause();
    updateButton();
    if (!preparing) status.textContent = message;
  }

  function play() {
    if (attempt) return attempt;
    const pending = music.play().then(() => enabled && attempt === pending).catch(error => {
      if (attempt !== pending || error.name === 'AbortError') return false;
      streamUnavailable(error.name === 'NotAllowedError' ? '请再点声音按钮继续。' : undefined);
      return false;
    }).finally(() => {
      if (attempt === pending) attempt = null;
    });
    attempt = pending;
    return pending;
  }

  function align() {
    if (mode !== 'film') return;
    const end = Number.isFinite(music.duration) ? music.duration : Infinity;
    const target = Math.min(end, time + offset);
    if (Math.abs(music.currentTime - target) > .15) music.currentTime = target;
  }

  // Play within the trusted click only when the film is running or is waiting
  // at its opening frame. Enabling sound during pause arms it for resume.
  function startOnline(waitForAudio = false) {
    if (!music.getAttribute('src') || music.error) {
      music.src = trackUrl;
      music.load();
    }
    mutedByUser = false;
    enabled = true;
    preparing = waitForAudio;
    music.loop = mode === 'explore';
    align();
    updateButton();
    status.textContent = '';
    return running || waitForAudio ? play() : Promise.resolve(true);
  }

  function cancelStart() {
    streamUnavailable();
    preparing = false;
  }

  function sync(nextMode, seconds, playing, force = false) {
    const switched = mode !== nextMode;
    mode = nextMode;
    time = seconds;
    running = playing;
    if (!enabled) return;
    music.loop = mode === 'explore';
    const now = performance.now();
    if (force || switched || (!music.seeking && now - lastCorrection > 350)) {
      lastCorrection = now;
      align();
    }
    if (preparing && !document.hidden && !switched) return;
    if (!running || document.hidden || (mode === 'film' && music.ended)) {
      if (music.paused) return;
      music.pause();
      attempt = null;
    } else if (music.paused) play();
  }

  button.addEventListener('click', () => {
    if (enabled) mute();
    else startOnline();
  });
  music.addEventListener('error', () => streamUnavailable());

  return {
    sync, startOnline, cancelStart, mute,
    get mutedByUser() { return mutedByUser; },
    resumeStart() { preparing = false; },
  };
}
