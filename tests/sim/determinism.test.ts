import { describe, expect, it } from "vitest";
import { createSim, serializeSim, deserializeSim, simChecksum, stepSim } from "../../src/sim/sim";
import type { Command } from "../../src/sim/commands";

/** Run a sim for n ticks, feeding commands from a tick-indexed script. */
function run(seed: number, ticks: number, script: ReadonlyMap<number, Command[]> = new Map()) {
  const sim = createSim(seed);
  for (let t = 0; t < ticks; t++) {
    stepSim(sim, script.get(t) ?? []);
  }
  return sim;
}

const spawnScript = (): Map<number, Command[]> =>
  new Map<number, Command[]>([
    [0, [{ type: "debug_spawn", playerId: 0, x: 5000, y: 5000 }]],
    [100, [{ type: "debug_spawn", playerId: 1, x: 12000, y: 9000 }]],
    [
      2500,
      [
        { type: "debug_spawn", playerId: 0, x: 1000, y: 1000 },
        { type: "debug_spawn", playerId: 1, x: 2000, y: 2000 },
      ],
    ],
  ]);

describe("PHASE 0 GATE — determinism checksum", () => {
  it("empty sim: same seed ⇒ identical checksum after 10,000 ticks", { timeout: 120_000 }, () => {
    const a = run(0xc0ffee, 10_000);
    const b = run(0xc0ffee, 10_000);
    expect(simChecksum(a)).toBe(simChecksum(b));
    expect(a.tick).toBe(10_000);
  });

  it("same seed + same ordered command list ⇒ identical checksum after 10,000 ticks", { timeout: 120_000 }, () => {
    const a = run(42, 10_000, spawnScript());
    const b = run(42, 10_000, spawnScript());
    // forensic aid for the rare full-suite-only flake: on mismatch, name the
    // diverging state lanes before failing (assertion itself is unchanged)
    if (simChecksum(a) !== simChecksum(b)) {
      const sa = JSON.parse(serializeSim(a)) as Record<string, unknown>;
      const sb = JSON.parse(serializeSim(b)) as Record<string, unknown>;
      const lanes = Object.keys(sa).filter((k) => JSON.stringify(sa[k]) !== JSON.stringify(sb[k]));
      console.error(`DETERMINISM DIVERGENCE — lanes: ${lanes.join(", ")}`);
      for (const k of lanes.slice(0, 3)) {
        console.error(`  ${k} A: ${JSON.stringify(sa[k])?.slice(0, 400)}`);
        console.error(`  ${k} B: ${JSON.stringify(sb[k])?.slice(0, 400)}`);
      }
    }
    expect(simChecksum(a)).toBe(simChecksum(b));
  });

  it("different seed ⇒ different checksum (PRNG feeds sim state)", { timeout: 120_000 }, () => {
    const a = run(1, 10_000, spawnScript());
    const b = run(2, 10_000, spawnScript());
    expect(simChecksum(a)).not.toBe(simChecksum(b));
  });

  it("different command script ⇒ different checksum", { timeout: 120_000 }, () => {
    const a = run(42, 10_000, spawnScript());
    const b = run(42, 10_000);
    expect(simChecksum(a)).not.toBe(simChecksum(b));
  });

  it("checksum evolves over time (tick count is part of state)", { timeout: 120_000 }, () => {
    const a = run(42, 100);
    const b = run(42, 101);
    expect(simChecksum(a)).not.toBe(simChecksum(b));
  });

  it("save/load: serialize → deserialize ⇒ checksum-equal sim that stays in lockstep", { timeout: 120_000 }, () => {
    const script = spawnScript();
    const original = run(42, 3000, script);
    const restored = deserializeSim(serializeSim(original));
    expect(simChecksum(restored)).toBe(simChecksum(original));
    // Both must continue identically after the reload.
    for (let t = 3000; t < 4000; t++) {
      stepSim(original, script.get(t) ?? []);
      stepSim(restored, script.get(t) ?? []);
    }
    expect(simChecksum(restored)).toBe(simChecksum(original));
  });
});
