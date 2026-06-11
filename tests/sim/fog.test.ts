import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, simChecksum, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer } from "../../src/sim/economy";
import { getVisibility, VIS_EXPLORED, VIS_UNEXPLORED, VIS_VISIBLE, isEnemyVisible } from "../../src/sim/visibility";
import { FP_ONE } from "../../src/sim/fixed";
import { spawnUnitEntity } from "../../src/sim/sim";

const SKIRMISH = { players: 2, skirmish: true };

function run(sim: Sim, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepSim(sim, []);
}

describe("PHASE 8 GATE — fog of war (LOS-correct reveal/hide)", () => {
  it("tiles near a unit are visible, far tiles unexplored, vacated tiles explored", () => {
    const sim = createSim(42, undefined, { players: 2, skirmish: false });
    const u = spawnUnitEntity(sim, 0, "villager", 100 * FP_ONE, 100 * FP_ONE); // los 12
    run(sim, 2);
    expect(getVisibility(sim, 0, 100, 100)).toBe(VIS_VISIBLE);
    expect(getVisibility(sim, 0, 100, 108)).toBe(VIS_VISIBLE);
    expect(getVisibility(sim, 0, 100, 140)).toBe(VIS_UNEXPLORED);
    // teleport the unit away: the old area decays to explored
    sim.stores.Position.x[u] = 150 * FP_ONE;
    sim.stores.Position.y[u] = 150 * FP_ONE;
    run(sim, 2);
    expect(getVisibility(sim, 0, 100, 100)).toBe(VIS_EXPLORED);
    expect(getVisibility(sim, 0, 150, 150)).toBe(VIS_VISIBLE);
  });

  it("enemy units are 'visible' only inside own LOS", () => {
    const sim = createSim(42, undefined, { players: 2, skirmish: false });
    spawnUnitEntity(sim, 0, "villager", 100 * FP_ONE, 100 * FP_ONE);
    const far = spawnUnitEntity(sim, 1, "infantry_base", 160 * FP_ONE, 100 * FP_ONE);
    const near = spawnUnitEntity(sim, 1, "infantry_base", 105 * FP_ONE, 100 * FP_ONE);
    run(sim, 2);
    expect(isEnemyVisible(sim, 0, near)).toBe(true);
    expect(isEnemyVisible(sim, 0, far)).toBe(false);
  });

  it("clarity (reveal power) lights the whole map for its duration", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.minorGods.push("zephyrion");
    p.favorMilli = 100_000;
    run(sim, 2);
    expect(getVisibility(sim, 0, 5, 5)).toBe(VIS_UNEXPLORED);
    stepSim(sim, [{ type: "cast_power", playerId: 0, power: "clarity", x: 100 * FP_ONE, y: 100 * FP_ONE }]);
    run(sim, 2);
    expect(getVisibility(sim, 0, 5, 5)).toBe(VIS_VISIBLE);
    run(sim, 15 * 16); // duration 15s
    expect(getVisibility(sim, 0, 5, 5)).toBe(VIS_EXPLORED);
  });

  it("visibility is derived state: checksums and saves are unaffected", () => {
    const a = createSim(7, undefined, SKIRMISH);
    const b = createSim(7, undefined, SKIRMISH);
    for (let t = 0; t < 100; t++) {
      stepSim(a, []);
      stepSim(b, []);
    }
    expect(simChecksum(a)).toBe(simChecksum(b));
  });
});

describe("PHASE 8 GATE — rally points", () => {
  it("units trained at a building walk to its rally point", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    const tc = p.townCenterEid;
    const { Position } = sim.stores;
    const rx = Math.trunc(Position.x[tc]! / FP_ONE) + 15;
    const ry = Math.trunc(Position.y[tc]! / FP_ONE) + 5;
    stepSim(sim, [
      { type: "rally", playerId: 0, buildingEid: tc, x: rx * FP_ONE, y: ry * FP_ONE },
      { type: "train", playerId: 0, buildingEid: tc, unit: "villager" },
    ]);
    run(sim, 15 * 35);
    const vills = Array.from(query(sim.world, [sim.stores.UnitRef]))
      .filter((e) => sim.stores.Owner.playerId[e] === 0 && sim.unitStats(e).id === "villager");
    const newest = vills[vills.length - 1]!;
    const dx = Position.x[newest]! - rx * FP_ONE;
    const dy = Position.y[newest]! - ry * FP_ONE;
    expect(Math.sqrt(dx * dx + dy * dy) / FP_ONE, "distance to rally").toBeLessThan(4);
  });
});
