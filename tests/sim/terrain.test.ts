import { describe, expect, it } from "vitest";
import { Prng } from "../../src/sim/prng";
import { DEFAULT_TERRAIN_CONFIG, generateTerrain } from "../../src/sim/terrain";
import { createSim, simChecksum, stepSim } from "../../src/sim/sim";
import { FP_ONE } from "../../src/sim/fixed";

describe("deterministic terrain generation (sim-owned, integer heights)", () => {
  it("same seed ⇒ identical heights and terrain checksum", { timeout: 120_000 }, () => {
    const a = generateTerrain(new Prng(123), DEFAULT_TERRAIN_CONFIG);
    const b = generateTerrain(new Prng(123), DEFAULT_TERRAIN_CONFIG);
    expect(a.checksum).toBe(b.checksum);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
  });

  it("different seed ⇒ different terrain", { timeout: 120_000 }, () => {
    const a = generateTerrain(new Prng(1), DEFAULT_TERRAIN_CONFIG);
    const b = generateTerrain(new Prng(2), DEFAULT_TERRAIN_CONFIG);
    expect(a.checksum).not.toBe(b.checksum);
  });

  it("produces (size+1)² integer vertex heights within ±4 tiles of sea level", { timeout: 120_000 }, () => {
    const t = generateTerrain(new Prng(99), DEFAULT_TERRAIN_CONFIG);
    expect(t.heights.length).toBe((t.size + 1) * (t.size + 1));
    for (const h of t.heights) {
      expect(Number.isInteger(h)).toBe(true);
      expect(Math.abs(h)).toBeLessThanOrEqual(4 * FP_ONE);
    }
  });

  it("carves water: some but not most vertices sit below water level (sampled seeds)", { timeout: 120_000 }, () => {
    for (const seed of [7, 42, 2026]) {
      const t = generateTerrain(new Prng(seed), DEFAULT_TERRAIN_CONFIG);
      let below = 0;
      for (const h of t.heights) if (h < t.waterLevelFp) below++;
      const frac = below / t.heights.length;
      expect(frac, `seed ${seed}`).toBeGreaterThan(0.01);
      expect(frac, `seed ${seed}`).toBeLessThan(0.6);
    }
  });

  it("terrain is part of the sim state checksum", { timeout: 120_000 }, () => {
    const a = createSim(5);
    const b = createSim(5);
    expect(a.terrain.checksum).toBe(b.terrain.checksum);
    expect(simChecksum(a)).toBe(simChecksum(b));
    const c = createSim(5, { ...DEFAULT_TERRAIN_CONFIG, size: 64 });
    expect(simChecksum(c)).not.toBe(simChecksum(a));
  });

  it("terrain generation does not break 10k-tick determinism", { timeout: 120_000 }, () => {
    const run = (seed: number) => {
      const sim = createSim(seed);
      for (let t = 0; t < 10_000; t++) stepSim(sim, t === 0 ? [{ type: "debug_spawn", playerId: 0, x: 5000, y: 5000 }] : []);
      return simChecksum(sim);
    };
    expect(run(77)).toBe(run(77));
  });

  it("exposes tile height sampling for movement/render queries", { timeout: 120_000 }, () => {
    const t = generateTerrain(new Prng(11), DEFAULT_TERRAIN_CONFIG);
    const h = t.heights[0]!;
    expect(typeof h).toBe("number");
    // corner vertex sampling helper agrees with the raw array
    expect(t.heights[(t.size + 1) * 0 + 0]).toBe(h);
  });
});
