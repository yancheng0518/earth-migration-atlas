// All ambience is synthesized locally after the listener enables sound.
export function createAmbience() {
  let context,
    volume,
    filter,
    hum,
    high,
    enabled = false;
  const pitch = { sun: 38, earth: 45, engine: 56, station: 67, elevator: 59, jupiter: 36, proxima: 72 };
  function select(id) {
    if (!context) return;
    const now = context.currentTime;
    hum.frequency.setTargetAtTime(pitch[id], now, 0.65);
    high.frequency.setTargetAtTime(pitch[id] * 1.502, now, 0.8);
    filter.frequency.setTargetAtTime(id === 'engine' ? 380 : id === 'station' ? 190 : 120, now, 1.2);
  }
  async function toggle(id) {
    if (!context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw Error('声音不可用');
      context = new Audio();
      volume = context.createGain();
      volume.gain.value = 0;
      volume.connect(context.destination);
      const low = context.createGain();
      low.gain.value = 0.16;
      low.connect(volume);
      hum = context.createOscillator();
      hum.type = 'sine';
      hum.connect(low);
      hum.start();
      const upper = context.createGain();
      upper.gain.value = 0.044;
      upper.connect(volume);
      high = context.createOscillator();
      high.connect(upper);
      high.start();
      const length = context.sampleRate * 3;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      source.connect(filter);
      filter.connect(volume);
      source.start();
    }
    await context.resume();
    enabled = !enabled;
    select(id);
    volume.gain.setTargetAtTime(enabled ? 0.22 : 0, context.currentTime, 0.25);
    return enabled;
  }
  return { toggle, select };
}
