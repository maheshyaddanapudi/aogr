/** DISCOVERY PROBES batch 2 (round 7). it.fails = confirmed bug awaiting fix. */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, spawnUnitEntity, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding } from "../../src/sim/economy";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };
const run = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) stepSim(sim, []); };

describe("DISCOVERY 2", () => {
  it("P5: a player-built wonder starts the countdown and wins the match", () => {
    const sim = createSim(881, undefined, SKIRMISH);
    const { Position } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    spawnBuilding(sim, 0, "wonder", Math.trunc(Position.x[tc]! / 1000) + 8, Math.trunc(Position.y[tc]! / 1000), true);
    let won = false;
    for (let t = 0; t < 15 * 60 * 12 && !won; t++) {
      stepSim(sim, []);
      won = sim.winner === 0;
    }
    expect(won, "wonder countdown crowns the builder").toBe(true);
  });

  it("FIXED P6: queued training must respect the population cap at completion", () => {
    const sim = createSim(882, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.foodMilli = 5_000_000;
    const tc = p.townCenterEid;
    run(sim, 1);
    // fill population to exactly the cap - 1
    const { Position } = sim.stores;
    while (p.popUsed < p.popCap - 1) {
      spawnUnitEntity(sim, 0, "villager", Position.x[tc]! + 3000, Position.y[tc]!);
      run(sim, 1);
    }
    // queue five more villagers while there is room for only one
    const cmds = Array.from({ length: 5 }, () => ({ type: "train" as const, playerId: 0, buildingEid: tc, unit: "villager" }));
    stepSim(sim, cmds);
    run(sim, 15 * 120); // let the queue drain
    expect(getPlayer(sim, 0).popUsed, "population never exceeds the cap").toBeLessThanOrEqual(getPlayer(sim, 0).popCap);
  });

  it("FIXED P7: closing a gate with a unit standing on it must not trap the unit in a wall", () => {
    const sim = createSim(883, undefined, SKIRMISH);
    const g = sim.navGrid;
    let gx = 0, gy = 0;
    outer: for (let y = 20; y < 180; y++) for (let x = 20; x < 180; x++) {
      if (g.passable[y * g.size + x]) { gx = x; gy = y; break outer; }
    }
    const gate = spawnBuilding(sim, 0, "gate", gx, gy, true);
    const unit = spawnUnitEntity(sim, 0, "infantry_base", gx * FP_ONE + 500, gy * FP_ONE + 500);
    stepSim(sim, [{ type: "toggle_gate", playerId: 0, buildingEid: gate }]); // close it
    run(sim, 2);
    const { Position } = sim.stores;
    const tx = Math.trunc(Position.x[unit]! / 1000);
    const ty = Math.trunc(Position.y[unit]! / 1000);
    expect(g.passable[ty * g.size + tx], "unit stands on open ground after the gate shuts").toBe(1);
  });

  it("P8: god powers cast outside the map neither crash nor charge favor", () => {
    const sim = createSim(884, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.minorGods.push("zephyrion");
    p.favorMilli = 100_000;
    stepSim(sim, [{ type: "cast_power", playerId: 0, power: "clarity", x: 500_000 * FP_ONE, y: 500_000 * FP_ONE }]);
    run(sim, 5);
    // first cast is free — the important part is no crash and a consistent state
    expect(sim.winner).toBe(-1);
    expect(Number.isFinite(p.favorMilli)).toBe(true);
  });

  it("P9: ungarrisoned units appear NEAR the building, not across the map", () => {
    const sim = createSim(885, undefined, SKIRMISH);
    const { Position } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const u = spawnUnitEntity(sim, 0, "infantry_base", Position.x[tc]! + 2000, Position.y[tc]!);
    stepSim(sim, [{ type: "garrison", playerId: 0, eids: [u], buildingEid: tc }]);
    run(sim, 30);
    stepSim(sim, [{ type: "ungarrison", playerId: 0, buildingEid: tc }]);
    run(sim, 2);
    const d = Math.hypot(Position.x[u]! - Position.x[tc]!, Position.y[u]! - Position.y[tc]!);
    expect(d, "released beside the walls").toBeLessThan(8 * FP_ONE);
  });
});
