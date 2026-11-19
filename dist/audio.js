import { departureCue } from './states.js';

const trackUrl = 'https://music.163.com/song/media/outer/url?id=1343461538.mp3';
// Cue in the full NetEase release: the bass and drums return at 04:59.8.
const onlineCue = 299.8;

export function createSoundtrack(restartWithSound) {
  const byId = id => document.getElementById(id);
  const panel = byId('music-panel');
  const service = byId('music-service');
  const music = new Audio();
  const toggle = byId('sound');
  const start = byId('score-unlock');
  const streamStatus = byId('stream-status');
  const manualPlayer = byId('music-widget');
  let mode = 'film', time = 0, playing = false, cue = departureCue, fileUrl = '';
  let source = '', enabled = false, lastCorrection = 0, needsGesture = false;
  let preparing = false, attempt = null;

  function setStatus(message, fallback = false) {
    streamStatus.textContent = message;
    manualPlayer.hidden = !fallback;
  }

  function release() {
    source = '';
    enabled = preparing = needsGesture = false;
    attempt = null;
    music.pause();
    music.removeAttribute('src');
    music.load();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = '';
    byId('local-file').value = '';
    byId('cue-editor').hidden = true;
    byId('music-hint').textContent = '本机文件仅在此浏览器播放。可将曲中高潮对齐电影 01:38 的地球推进。';
  }

  function showOfficial() {
    release();
    if (service.firstElementChild) return;
    const frame = document.createElement('iframe');
    frame.title = '网易云音乐官方播放器 · 开启新征程 · 阿鲲';
    frame.src = 'https://music.163.com/outchain/player?type=2&id=1343461538&auto=0&height=66';
    frame.allow = 'autoplay';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    service.append(frame);
    setStatus('网易云播放器独立播放，请在下方控制。');
  }

  function close() {
    if (panel.hidden) return false;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    const target = toggle.offsetParent && !toggle.closest('[inert]') ? toggle : byId('reveal-player');
    target.focus({preventScroll:true});
    return true;
  }

  function open() {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    byId('music-close').focus({preventScroll:true});
  }

  function streamUnavailable() {
    needsGesture = true;
    setStatus('在线音源暂不可用，可用网易云播放器收听。', true);
  }

  function tryPlay() {
    if (attempt) return attempt;
    const current = music.play().catch(err => {
      if (attempt !== current || err.name === 'AbortError') return false;
      if (source === 'online') {
        if (err.name === 'NotAllowedError') {
          needsGesture = true;
          setStatus('请点「开始电影」重试连接。');
        } else streamUnavailable();
      } else {
        needsGesture = true;
        byId('music-hint').textContent = '点「对齐片尾推进」重试播放。';
      }
      return false;
    }).then(result => result !== false).finally(() => {
      if (attempt === current) attempt = null;
    });
    attempt = current;
    return current;
  }

  // A trusted click can start playback even on browsers that block autoplay.
  // Set the movie-derived seek position before asking the browser to play.
  function startOnline(waitForAudio = false) {
    service.replaceChildren();
    if (source !== 'online' || music.error) {
      release();
      source = 'online';
      cue = onlineCue;
      music.src = trackUrl;
    }
    enabled = true;
    needsGesture = false;
    preparing = waitForAudio;
    music.loop = mode === 'explore';
    if (mode === 'film') music.currentTime = time + cue - departureCue;
    setStatus('正在连接网易云音源…');
    return tryPlay();
  }

  function cancelStart() {
    streamUnavailable();
    preparing = false;
    music.pause();
  }

  function allowRetry() {
    if (!music.error) needsGesture = false;
  }

  function sync(nextMode, seconds, running, force = false) {
    const switched = mode !== nextMode;
    mode = nextMode;
    time = seconds;
    playing = running;
    if (!source || !enabled) return;

    music.loop = mode === 'explore';
    const position = time + cue - departureCue;
    const duration = music.duration;
    const inRange = position >= 0 && (!Number.isFinite(duration) || position < duration);
    if (mode === 'film' && (force || switched || performance.now() - lastCorrection > 350)) {
      lastCorrection = performance.now();
      const target = Math.max(0, Number.isFinite(duration) ? Math.min(position, duration) : position);
      if ((force || !music.seeking) && Math.abs(music.currentTime - target) > .15) music.currentTime = target;
    }
    if (preparing && !document.hidden && !switched) return;
    if (!playing || document.hidden || (mode === 'film' && !inRange)) {
      music.pause();
      return;
    }
    if (mode === 'explore' && switched && music.ended) music.currentTime = 0;
    if (music.paused && !needsGesture) tryPlay();
  }

  start.addEventListener('click', restartWithSound);
  toggle.addEventListener('click', open);
  byId('music-sync').onclick = () => {
    close();
    if (mode === 'film') restartWithSound();
    else startOnline();
  };
  byId('music-close').onclick = close;
  manualPlayer.onclick = showOfficial;
  byId('music-stop').onclick = () => {
    service.replaceChildren();
    release();
    setStatus('音乐已关闭。');
    close();
  };
  byId('local-file').onchange = event => {
    const file = event.target.files[0];
    if (!file) return;
    music.pause();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    source = 'local';
    enabled = preparing = false;
    attempt = null;
    fileUrl = URL.createObjectURL(file);
    music.src = fileUrl;
    music.load();
  };
  music.onloadedmetadata = () => {
    if (source !== 'local' || !Number.isFinite(music.duration)) return;
    service.replaceChildren();
    setStatus('');
    const input = byId('cue-time');
    input.max = String(Math.max(0, Math.floor((music.duration - .01) * 10) / 10));
    cue = Math.min(departureCue, Number(input.max));
    input.value = String(Math.round(cue * 10) / 10);
    byId('cue-editor').hidden = false;
    byId('music-hint').textContent = '填入这份录音高潮出现的秒数，然后点「对齐片尾推进」。';
  };
  music.onplaying = () => {
    if (source === 'online') setStatus('配乐随电影播放、暂停和跳转。');
  };
  music.onerror = () => {
    if (source === 'online') streamUnavailable();
    else if (source === 'local') {
      release();
      byId('music-hint').textContent = '浏览器未能解码这份音频。可换用 MP3、M4A 或 WAV。';
    }
  };
  byId('apply-cue').onclick = () => {
    const input = byId('cue-time');
    if (input.value === '' || !input.reportValidity()) return;
    cue = Number(input.value);
    enabled = true;
    needsGesture = false;
    sync(mode, time, playing, true);
    byId('music-hint').textContent = '本机音源已接入。电影暂停或跳章时，音乐跟随画面；自由探索时循环播放。';
  };
  window.addEventListener('pagehide', e => {
    if (!e.persisted && fileUrl) URL.revokeObjectURL(fileUrl);
  });
  return { sync, close, startOnline, cancelStart, allowRetry, mute: release, resumeStart() { preparing = false; } };
}
