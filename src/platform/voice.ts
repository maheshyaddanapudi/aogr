/**
 * Mythic tongue: procedural fictional-language voice lines. Each pantheon has
 * its own phoneme palette (formant targets + pitch base); each unit class has
 * a fixed utterance seed, so a villager always "says" the same phrase. Pure
 * WebAudio synthesis — offline, tiny, and thematically AoM (units speak an
 * ancient language you don't understand).
 */
import { loadSettings } from "./storage";

interface Dialect {
  basePitch: number;
  formants: Array<[number, number]>; // [f1, f2] vowel targets
  rasp: number; // 0..1 consonant noise
}

const DIALECTS: Record<string, Dialect> = {
  auryan_dawn: { basePitch: 150, formants: [[730, 1090], [530, 1840], [400, 800]], rasp: 0.25 },
  verdant_deep: { basePitch: 120, formants: [[300, 870], [440, 1020], [530, 1840]], rasp: 0.15 },
  ashen_forge: { basePitch: 95, formants: [[640, 1190], [730, 1090], [570, 840]], rasp: 0.5 },
  storm_concord: { basePitch: 135, formants: [[390, 1990], [530, 1840], [660, 1720]], rasp: 0.2 },
};

let ctx: AudioContext | null = null;
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 4294967296);

export function speakMythic(pantheon: string, phraseSeed: number): void {
  const vol = loadSettings().sfxVol;
  if (vol <= 0) return;
  try {
    ctx = ctx ?? new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const d = DIALECTS[pantheon] ?? DIALECTS.storm_concord!;
    const r = rng(phraseSeed * 2654435761);
    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = 0.22 * vol;
    master.connect(ctx.destination);
    let t = t0;
    const syllables = 2 + Math.trunc(r() * 3);
    for (let i = 0; i < syllables; i++) {
      const dur = 0.1 + r() * 0.12;
      // voiced vowel: source osc through two formant bandpasses
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const jitter = 0.9 + r() * 0.25;
      osc.frequency.setValueAtTime(d.basePitch * jitter, t);
      osc.frequency.exponentialRampToValueAtTime(d.basePitch * jitter * (0.85 + r() * 0.2), t + dur);
      const [f1, f2] = d.formants[Math.trunc(r() * d.formants.length)]!;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(1, t + 0.03);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      for (const f of [f1, f2]) {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = f;
        bp.Q.value = 6;
        osc.connect(bp);
        bp.connect(env);
      }
      env.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      // consonant: short noise burst between syllables
      if (r() < 0.7) {
        const len = 0.03;
        const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let s = 0; s < ch.length; s++) ch[s] = (r() * 2 - 1) * (1 - s / ch.length);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const ng = ctx.createGain();
        ng.gain.value = d.rasp;
        src.connect(ng);
        ng.connect(master);
        src.start(t + dur);
      }
      t += dur + 0.03 + r() * 0.04;
    }
  } catch {
    /* audio unavailable — stay silent */
  }
}
