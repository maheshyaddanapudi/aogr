import { describe, expect, it } from "vitest";
import { createSim, deserializeSim, serializeSim, simChecksum, spawnUnitEntity, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding } from "../../src/sim/economy";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };

function run(sim: Sim, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepSim(sim, []);
}

describe("PHASE 10 GATE — victory conditions", () => {
  it("conquest: a player with no town center loses", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    expect(sim.winner).toBe(-1);
    // raze player 1's TC
    const tc1 = getPlayer(sim, 1).townCenterEid;
    sim.stores.Health.hp100[tc1] = 1;
    const hammer = spawnUnitEntity(sim, 0, "infantry_base", sim.stores.Position.x[tc1]! - 2000, sim.stores.Position.y[tc1]!);
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [hammer], targetEid: tc1 }]);
    run(sim, 15 * 20);
    expect(sim.winner).toBe(0);
  });

  it("wonder countdown: holding a finished wonder for the countdown wins", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    spawnBuilding(sim, 0, "wonder", 60, 60, true);
    run(sim, 5);
    expect(sim.winner).toBe(-1);
    expect(sim.wonderTicksLeft[0]).toBeGreaterThan(0);
    // fast-forward the full 600s countdown
    run(sim, 15 * 600 + 5);
    expect(sim.winner).toBe(0);
  });

  it("destroying the wonder cancels the countdown", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const w = spawnBuilding(sim, 0, "wonder", 60, 60, true);
    run(sim, 15 * 30);
    expect(sim.wonderTicksLeft[0]).toBeGreaterThan(0);
    sim.stores.Health.hp100[w] = 1;
    const hammer = spawnUnitEntity(sim, 1, "infantry_base", 58 * FP_ONE, 60 * FP_ONE);
    stepSim(sim, [{ type: "attack", playerId: 1, eids: [hammer], targetEid: w }]);
    run(sim, 15 * 20);
    expect(sim.wonderTicksLeft[0] ?? 0).toBe(0);
    expect(sim.winner).toBe(-1);
  });

  it("victory state survives save/load with identical checksum (the release gate)", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    spawnBuilding(sim, 0, "wonder", 60, 60, true);
    run(sim, 15 * 60); // one minute into the countdown
    const snapshot = serializeSim(sim);
    const restored = deserializeSim(snapshot);
    expect(simChecksum(restored)).toBe(simChecksum(sim));
    for (let t = 0; t < 15 * 30; t++) {
      stepSim(sim, []);
      stepSim(restored, []);
    }
    expect(simChecksum(restored)).toBe(simChecksum(sim));
    expect(restored.wonderTicksLeft[0]).toBe(sim.wonderTicksLeft[0]);
  });
});
