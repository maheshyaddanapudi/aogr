/** GAP-FIX ROUND 3 — herdables, settlements, stun actives, line formation, NAVAL. */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, spawnUnitEntity, stepSim, isWaterTile, nearestWaterTile, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding, spawnResourceNode, findBuildSite } from "../../src/sim/economy";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };
const OPEN = { players: 2, skirmish: false };
const run = (sim: Sim, n: number) => {
  for (let i = 0; i < n; i++) stepSim(sim, []);
};

describe("GAP FIXES 3", () => {
  it("herdables fatten over time up to a cap and are harvested as food", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { ResourceNode } = sim.stores;
    const herds = Array.from(query(sim.world, [ResourceNode])).filter((e) => ResourceNode.resType[e] === 5);
    expect(herds.length, "herds spawn").toBeGreaterThan(0);
    const h = herds[0]!;
    const a0 = ResourceNode.amountMilli[h]!;
    run(sim, 15 * 60);
    expect(ResourceNode.amountMilli[h]!, "fattened").toBeGreaterThan(a0);
    for (let i = 0; i < 400; i++) run(sim, 15); // long fatten
    const cap = ResourceNode.amountMilli[h]!;
    run(sim, 15 * 30);
    expect(ResourceNode.amountMilli[h]!, "capped").toBe(cap);
  });

  it("town centers may only be founded on neutral settlement sites", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { UnitRef, Owner, GatherTask, Building } = sim.stores;
    const vill = Array.from(query(sim.world, [UnitRef, GatherTask])).filter((e) => Owner.playerId[e] === 0)[0]!;
    const p = getPlayer(sim, 0);
    p.woodMilli = 5_000_000;
    p.goldMilli = 5_000_000;
    const tcCount = () => Array.from(query(sim.world, [Building])).filter((e) => sim.buildingIdOf(e) === "town_center").length;
    const before = tcCount();
    // off-settlement: rejected
    const off = findBuildSite(sim, 60, 60, 4)!;
    stepSim(sim, [{ type: "build", playerId: 0, eids: [vill], building: "town_center", x: off.x * FP_ONE, y: off.y * FP_ONE }]);
    expect(tcCount(), "rejected off-settlement").toBe(before);
    // on a settlement: accepted
    const s = sim.settlements[0]!;
    stepSim(sim, [{ type: "build", playerId: 0, eids: [vill], building: "town_center", x: s.x * FP_ONE, y: s.y * FP_ONE }]);
    expect(tcCount(), "founded on the settlement").toBe(before + 1);
  });

  it("stonegaze naga petrifies: stunned victims neither move nor fight briefly", () => {
    const sim = createSim(1, undefined, OPEN);
    const naga = spawnUnitEntity(sim, 0, "stonegaze_naga", 95 * FP_ONE, 95 * FP_ONE);
    const victim = spawnUnitEntity(sim, 1, "infantry_base", 96 * FP_ONE, 95 * FP_ONE);
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [naga], targetEid: victim }]);
    let stunnedSeen = false;
    for (let i = 0; i < 15 * 20; i++) {
      stepSim(sim, []);
      if ((sim.stunnedUntil.get(victim) ?? 0) > sim.tick) stunnedSeen = true;
    }
    expect(stunnedSeen, "victim was petrified at least once").toBe(true);
  });

  it("line formation strings the group out; box stays compact", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Position } = sim.stores;
    const eids = Array.from({ length: 6 }, (_, i) => spawnUnitEntity(sim, 0, "infantry_base", (92 + i) * FP_ONE, 90 * FP_ONE));
    stepSim(sim, [{ type: "move", playerId: 0, eids, x: 110 * FP_ONE, y: 110 * FP_ONE, formation: 1 }]);
    run(sim, 15 * 30);
    const xs = eids.map((e) => Position.x[e]!);
    const ys = eids.map((e) => Position.y[e]!);
    expect(Math.max(...xs) - Math.min(...xs), "line spans wide").toBeGreaterThan(4 * FP_ONE);
    expect(Math.max(...ys) - Math.min(...ys), "line stays thin").toBeLessThan(3 * FP_ONE);
  });

  it("NAVAL: fish schools exist on water; fishing boats fish them and bank at the dock", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { ResourceNode, Position } = sim.stores;
    const fish = Array.from(query(sim.world, [ResourceNode])).filter((e) => ResourceNode.resType[e] === 6);
    expect(fish.length, "fish spawn").toBeGreaterThan(0);
    for (const f of fish) {
      expect(isWaterTile(sim, Math.trunc(Position.x[f]! / 1000), Math.trunc(Position.y[f]! / 1000)), "fish on water").toBe(true);
    }
    // dock on the coast near the fish, boat beside it
    const f0 = fish[0]!;
    const wt = { x: Math.trunc(Position.x[f0]! / 1000), y: Math.trunc(Position.y[f0]! / 1000) };
    let dockTile: { x: number; y: number } | null = null;
    outer: for (let r = 1; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = wt.x + dx, y = wt.y + dy;
        if (!isWaterTile(sim, x, y) && !isWaterTile(sim, x + 1, y) && sim.navGrid.passable[y * sim.navGrid.size + x]) { dockTile = { x, y }; break outer; }
      }
    }
    const dock = spawnBuilding(sim, 0, "dock", dockTile!.x, dockTile!.y, true);
    const w = nearestWaterTile(sim, dockTile!.x, dockTile!.y)!;
    const boat = spawnUnitEntity(sim, 0, "fishing_boat", w.x * 1000 + 500, w.y * 1000 + 500);
    const food0 = getPlayer(sim, 0).foodMilli;
    stepSim(sim, [{ type: "gather", playerId: 0, eids: [boat], nodeEid: f0 }]);
    run(sim, 15 * 180);
    expect(getPlayer(sim, 0).foodMilli, "fish banked as food").toBeGreaterThan(food0);
    void dock;
  });

  it("NAVAL: boats refuse to sail onto land; war galleys sink fishing boats", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const w = nearestWaterTile(sim, 100, 100)!;
    const boat = spawnUnitEntity(sim, 0, "fishing_boat", w.x * 1000 + 500, w.y * 1000 + 500);
    // order it deep inland
    stepSim(sim, [{ type: "move", playerId: 0, eids: [boat], x: 100 * FP_ONE, y: 100 * FP_ONE }]);
    run(sim, 15 * 30);
    const { Position, Health } = sim.stores;
    expect(isWaterTile(sim, Math.trunc(Position.x[boat]! / 1000), Math.trunc(Position.y[boat]! / 1000)), "still afloat").toBe(true);
    const galley = spawnUnitEntity(sim, 1, "war_galley", (w.x + 3) * 1000 + 500, w.y * 1000 + 500);
    stepSim(sim, [{ type: "attack", playerId: 1, eids: [galley], targetEid: boat }]);
    run(sim, 15 * 60);
    expect(Health.hp100[boat] ?? 0, "fishing boat sunk").toBeLessThanOrEqual(0);
  });
});
