/**
 * Procedural ambience: wind bed (filtered noise with a slow swell), songbirds
 * (random chirp figures), and shore wash when the map has open water. Pure
 * WebAudio — render-side only, never touches the sim.
 */
import { loadSettings } from "./storage";

export interface Ambience {
  start: () => void;
  dispose: () => void;
}

export function createAmbience(hasWater: boolean): Ambience {
  let ctx: AudioContext | null = null;
  let alive = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (alive) return;
    const vol = loadSettings().sfxVol;
    if (vol <= 0) return;
    try {
      ctx = new AudioContext();
      alive = true;
      const master = ctx.createGain();
      master.gain.value = 0.12 * vol;
      master.connect(ctx.destination);
      // wind: looped noise through a lowpass, gain swelling on an LFO
      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      const wind = ctx.createBufferSource();
      wind.buffer = noiseBuf;
      wind.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 420;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.25;
      lfo.connect(lfoGain);
      lfoGain.connect(windGain.gain);
      wind.connect(lp);
      lp.connect(windGain);
      windGain.connect(master);
      wind.start();
      lfo.start();
      if (hasWater) {
        // shore wash: slower, deeper swells of the same noise
        const surf = ctx.createBufferSource();
        surf.buffer = noiseBuf;
        surf.loop = true;
        const lp2 = ctx.createBiquadFilter();
        lp2.type = "lowpass";
        lp2.frequency.value = 240;
        const surfGain = ctx.createGain();
        surfGain.gain.value = 0.35;
        const lfo2 = ctx.createOscillator();
        lfo2.frequency.value = 0.045;
        const lfo2Gain = ctx.createGain();
        lfo2Gain.gain.value = 0.3;
        lfo2.connect(lfo2Gain);
        lfo2Gain.connect(surfGain.gain);
        surf.connect(lp2);
        lp2.connect(surfGain);
        surfGain.connect(master);
        surf.start();
        lfo2.start();
      }
      // birds: occasional two-note chirps
      timer = setInterval(() => {
        if (!ctx || Math.random() < 0.4) return;
        const t = ctx.currentTime;
        for (let n = 0; n < 2; n++) {
          const o = ctx.createOscillator();
          o.type = "sine";
          const f = 2400 + Math.random() * 1600;
          o.frequency.setValueAtTime(f, t + n * 0.12);
          o.frequency.exponentialRampToValueAtTime(f * 1.3, t + n * 0.12 + 0.07);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t + n * 0.12);
          g.gain.exponentialRampToValueAtTime(0.05, t + n * 0.12 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + n * 0.12 + 0.09);
          o.connect(g);
          g.connect(master);
          o.start(t + n * 0.12);
          o.stop(t + n * 0.12 + 0.1);
        }
      }, 3500);
    } catch {
      alive = false;
    }
  };

  return {
    start,
    dispose() {
      if (timer) clearInterval(timer);
      void ctx?.close();
      alive = false;
    },
  };
}
