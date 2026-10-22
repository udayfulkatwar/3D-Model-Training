// Synthesised office audio (Web Audio API): ambience, keyboard clicks, coffee machine, lift chime,
// door and UI clicks. No audio files. The AudioContext is only created after a user gesture.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let enabled = false;

function noiseBuffer(c: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}

function ensure(): boolean {
  if (ctx) return true;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.6 : 0;
    master.connect(ctx.destination);
    return true;
  } catch {
    return false;
  }
}

/** Call from a user gesture handler. */
export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (!on) {
    if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    return;
  }
  if (!ensure() || !ctx || !master) return;
  void ctx.resume();
  master.gain.setTargetAtTime(0.6, ctx.currentTime, 0.2);
  if (!ambience) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 4, true);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0.18;
    src.connect(lp).connect(gain).connect(master);
    src.start();
    const hum = ctx.createOscillator();
    hum.frequency.value = 58;
    const hg = ctx.createGain();
    hg.gain.value = 0.012;
    hum.connect(hg).connect(master);
    hum.start();
    ambience = { src, gain };
  }
}

export function soundEnabled() {
  return enabled;
}

/** Ambience level follows how busy the area around the listener is (0..1). */
export function setAmbienceLevel(level: number) {
  if (ambience && ctx) ambience.gain.gain.setTargetAtTime(0.1 + level * 0.25, ctx.currentTime, 0.5);
}

export type SoundName = 'ui' | 'door' | 'ding' | 'coffee' | 'click' | 'key';

export function playSound(name: SoundName, volume = 1) {
  if (!enabled || !ensure() || !ctx || !master) return;
  const c = ctx;
  const t = c.currentTime;
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(master);
  const env = (g: GainNode, a: number, peak: number, d: number) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  switch (name) {
    case 'ui':
    case 'click': {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = name === 'ui' ? 880 : 1400;
      const g = c.createGain();
      env(g, 0.005, 0.15, 0.08);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.12);
      break;
    }
    case 'key': {
      const s = c.createBufferSource();
      s.buffer = noiseBuffer(c, 0.03, false);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2500 + Math.random() * 1500;
      const g = c.createGain();
      env(g, 0.001, 0.08, 0.03);
      s.connect(bp).connect(g).connect(out);
      s.start(t);
      break;
    }
    case 'door': {
      const s = c.createBufferSource();
      s.buffer = noiseBuffer(c, 0.25, true);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 300;
      const g = c.createGain();
      env(g, 0.01, 0.6, 0.2);
      s.connect(lp).connect(g).connect(out);
      s.start(t);
      break;
    }
    case 'ding': {
      for (const [f, dly] of [[1318.5, 0], [987.8, 0.18]] as const) {
        const o = c.createOscillator();
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t + dly);
        g.gain.linearRampToValueAtTime(0.18, t + dly + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dly + 1.1);
        o.connect(g).connect(out);
        o.start(t + dly);
        o.stop(t + dly + 1.2);
      }
      break;
    }
    case 'coffee': {
      // grinder buzz then steam hiss
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 95;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.05);
      g.gain.setValueAtTime(0.05, t + 1.2);
      g.gain.linearRampToValueAtTime(0, t + 1.4);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.5);
      const s = c.createBufferSource();
      s.buffer = noiseBuffer(c, 1.6, false);
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      const g2 = c.createGain();
      g2.gain.setValueAtTime(0, t + 1.5);
      g2.gain.linearRampToValueAtTime(0.06, t + 1.7);
      g2.gain.linearRampToValueAtTime(0, t + 3.0);
      s.connect(hp).connect(g2).connect(out);
      s.start(t + 1.5);
      break;
    }
  }
}
