/** Keep the platform's own player and controls in one iframe across film and
 * exploration. The official widget does not expose a public seek API. A file
 * picked by its owner can use the camera clock directly, entirely on-device. */
export function createSoundtrack() {
  const byId = id => document.getElementById(id);
  const panel = byId('music-panel');
  const triggers = [byId('sound'), byId('score-unlock')];
  const service = byId('music-service');
  const music = new Audio();
  const climax = 98;
  let mode = 'film', time = 0, playing = false, cue = climax, fileUrl = '';
  let localEnabled = false, opener, lastCorrection = 0, playPending = false, needsGesture = false;

  function releaseLocal() {
    localEnabled = false;
    music.pause();
    if (fileUrl) {
      music.removeAttribute('src');
      music.load();
      URL.revokeObjectURL(fileUrl);
      fileUrl = '';
    }
    byId('local-file').value = '';
    byId('cue-editor').hidden = true;
    byId('music-hint').textContent = '本机文件仅在此浏览器播放。可将曲中高潮对齐电影 01:38 的地球推进。';
  }

  function showOfficial() {
    if (service.firstElementChild || fileUrl) return;
    const frame = document.createElement('iframe');
    frame.title = '网易云音乐官方播放器 · 开启新征程 · 阿鲲';
    frame.src = 'https://music.163.com/outchain/player?type=2&id=1343461538&auto=0&height=66';
    frame.allow = 'autoplay';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    service.append(frame);
  }

  function close() {
    if (panel.hidden) return false;
    panel.hidden = true;
    for (const button of triggers) button.setAttribute('aria-expanded', 'false');
    const visible = opener && opener.offsetParent && !opener.closest('[inert]') ? opener :
      (mode === 'film' ? byId('reveal-player') : byId('sound'));
    visible.focus({preventScroll:true});
    return true;
  }

  function open(button) {
    if (!panel.hidden) { close(); return; }
    opener = button;
    panel.hidden = false;
    if (!fileUrl) showOfficial();
    for (const trigger of triggers) trigger.setAttribute('aria-expanded', 'true');
    byId('music-close').focus({preventScroll:true});
  }

  function sync(nextMode, seconds, running, force = false) {
    const switched = mode !== nextMode;
    mode = nextMode; time = seconds; playing = running;
    if (!fileUrl || !localEnabled || !Number.isFinite(music.duration)) return;
    music.loop = mode === 'explore';
    const position = time + cue - climax;
    const inRange = position >= 0 && position < music.duration;
    if (mode === 'film' && (force || switched || performance.now()-lastCorrection > 350)) {
      lastCorrection = performance.now();
      const target = Math.max(0, Math.min(position, music.duration));
      if (!music.seeking && Math.abs(music.currentTime-target) > .18) music.currentTime = target;
    }
    if (!playing || document.hidden || (mode === 'film' && !inRange)) { music.pause(); return; }
    if (mode === 'explore' && (switched && music.ended)) music.currentTime = 0;
    if (music.paused && !playPending && !needsGesture) {
      playPending = true;
      music.play().catch(err => {
        if (err.name === 'AbortError') return;
        needsGesture = true;
        byId('music-hint').textContent = '点「对齐片尾推进」重试播放；浏览器需支持该文件格式。';
      }).finally(() => { playPending = false; });
    }
  }

  triggers.forEach(button => button.addEventListener('click', () => open(button)));
  byId('music-close').onclick = close;
  byId('music-stop').onclick = () => {
    service.replaceChildren();
    releaseLocal();
    close();
  };
  byId('local-file').onchange = event => {
    const file = event.target.files[0];
    if (!file) return;
    // Keep the official player available until a replacement file actually decodes.
    localEnabled = false;
    music.pause();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = URL.createObjectURL(file);
    music.src = fileUrl;
    music.load();
  };
  music.onloadedmetadata = () => {
    if (!fileUrl || !Number.isFinite(music.duration)) return;
    service.replaceChildren();
    const input = byId('cue-time');
    input.max = String(Math.max(0, Math.floor((music.duration-.01)*10)/10));
    cue = Math.min(climax, Number(input.max));
    input.value = String(Math.round(cue*10)/10);
    byId('cue-editor').hidden = false;
    byId('music-hint').textContent = '填入这份录音高潮出现的秒数，然后点「对齐片尾推进」。';
  };
  music.onerror = () => {
    if (!fileUrl) return;
    releaseLocal(); showOfficial();
    byId('music-hint').textContent = '浏览器未能解码这份音频。可换用 MP3、M4A 或 WAV。';
  };
  byId('apply-cue').onclick = () => {
    const input = byId('cue-time');
    if (input.value === '' || !input.reportValidity()) return;
    cue = Number(input.value); localEnabled = true; needsGesture = false;
    sync(mode,time,playing,true);
    byId('music-hint').textContent = '本机音源已接入。电影暂停或跳章时，音乐跟随画面；自由探索时循环播放。';
  };
  window.addEventListener('pagehide', e => { if (!e.persisted) releaseLocal(); });
  return {sync, close};
}
