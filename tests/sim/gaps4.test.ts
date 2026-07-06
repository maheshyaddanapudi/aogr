/** GAP-FIX ROUND 4 — transports/amphibious, consume actives, AI expansion. */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, spawnUnitEntity, stepSim, nearestWaterTile, type Sim } from "../../src/sim/sim";
import { getPlayer } from "../../src/sim/economy";
import { createAiState, decideAi } from "../../src/ai/brain";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };
const OPEN = { players: 2, skirmish: false };
const run = (sim: Sim, n: number) => {
  for (let i = 0; i < n; i++) stepSim(sim, []);
};

describe("GAP FIXES 4", () => {
  it("transports: soldiers board a barge at the shore, sail, and unload on land", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Position } = sim.stores;
    // shore near p0 base: find water near the TC then the closest land tile
    const tc = getPlayer(sim, 0).townCenterEid;
    const btx = Math.trunc(Position.x[tc]! / 1000);
    const bty = Math.trunc(Position.y[tc]! / 1000);
    const w = nearestWaterTile(sim, btx, bty)!;
    const barge = spawnUnitEntity(sim, 0, "transport_barge", w.x * 1000 + 500, w.y * 1000 + 500);
    const soldier = spawnUnitEntity(sim, 0, "infantry_base", Position.x[tc]! + 2000, Position.y[tc]!);
    stepSim(sim, [{ type: "garrison", playerId: 0, eids: [soldier], buildingEid: barge }]);
    run(sim, 15 * 40); // walk to the shore and board
    expect(sim.garrisons.get(barge) ?? [], "boarded").toContain(soldier);
    // sail along the coast, then unload
    const w2 = nearestWaterTile(sim, btx + 20, bty)!;
    stepSim(sim, [{ type: "move", playerId: 0, eids: [barge], x: w2.x * FP_ONE, y: w2.y * FP_ONE }]);
    run(sim, 15 * 40);
    expect(Position.x[soldier], "occupant rides along").toBe(Position.x[barge]);
    stepSim(sim, [{ type: "ungarrison", playerId: 0, buildingEid: barge }]);
    run(sim, 2);
    expect(sim.garrisons.get(barge) ?? [], "unloaded").toHaveLength(0);
    const stx = Math.trunc(Position.x[soldier]! / 1000);
    const sty = Math.trunc(Position.y[soldier]! / 1000);
    expect(sim.navGrid.passable[sty * sim.navGrid.size + stx], "stands on land").toBe(1);
  });

  it("transports sunk at sea drown their passengers", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Position, Health, UnitRef } = sim.stores;
    const w = nearestWaterTile(sim, 100, 100)!;
    const barge = spawnUnitEntity(sim, 0, "transport_barge", w.x * 1000 + 500, w.y * 1000 + 500);
    const soldier = spawnUnitEntity(sim, 0, "infantry_base", Position.x[barge]!, Position.y[barge]!);
    sim.garrisons.set(barge, [soldier]);
    sim.garrisonOf.set(soldier, barge);
    Health.hp100[barge] = 1;
    const galley = spawnUnitEntity(sim, 1, "war_galley", (w.x + 2) * 1000 + 500, w.y * 1000 + 500);
    stepSim(sim, [{ type: "attack", playerId: 1, eids: [galley], targetEid: barge }]);
    run(sim, 15 * 30);
    const alive = new Set(query(sim.world, [UnitRef]));
    expect(alive.has(barge), "barge sunk").toBe(false);
    expect(alive.has(soldier), "passenger drowned with it").toBe(false);
  });

  it("consume active: the cyclorn executes gravely wounded victims outright", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Health, UnitRef } = sim.stores;
    const cyclorn = spawnUnitEntity(sim, 0, "cyclorn", 95 * FP_ONE, 95 * FP_ONE);
    const victim = spawnUnitEntity(sim, 1, "infantry_base", 96 * FP_ONE, 95 * FP_ONE);
    Health.hp100[victim] = Math.trunc(sim.unitStats(victim).hp100 * 0.15); // below the 20% threshold
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [cyclorn], targetEid: victim }]);
    run(sim, 15 * 5);
    expect(query(sim.world, [UnitRef]).includes(victim), "devoured in one bite").toBe(false);
    void cyclorn;
  });

  it("a rich AI founds a second town center on a free settlement", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Building, Owner } = sim.stores;
    const p1 = getPlayer(sim, 1);
    p1.age = 2;
    p1.woodMilli = 2_000_000;
    p1.goldMilli = 2_000_000;
    p1.foodMilli = 2_000_000;
    const ai = createAiState(1, "hard", 42);
    const tcsOf = () =>
      Array.from(query(sim.world, [Building])).filter((e) => Owner.playerId[e] === 1 && sim.buildingIdOf(e) === "town_center").length;
    expect(tcsOf()).toBe(1);
    for (let i = 0; i < 15 * 240; i++) {
      if (i % ai.decisionIntervalTicks === 0) stepSim(sim, decideAi(sim, ai));
      else stepSim(sim, []);
      if (tcsOf() > 1) break;
    }
    expect(tcsOf(), "AI expanded to a settlement").toBeGreaterThan(1);
  });
});
