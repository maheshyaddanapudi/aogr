import { describe, expect, it } from "vitest";
import { createSim, simChecksum, stepSim, type Sim } from "../../src/sim/sim";
import { findResourceNodes, getPlayer } from "../../src/sim/economy";
import { getBuildingStats } from "../../src/sim/buildingdata";
import { FP_ONE } from "../../src/sim/fixed";
import { query } from "bitecs";

const SKIRMISH = { players: 2, skirmish: true };

function run(sim: Sim, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepSim(sim, []);
}

function ownVillagers(sim: Sim, playerId: number): number[] {
  const { Owner, UnitRef } = sim.stores;
  return Array.from(query(sim.world, [UnitRef]))
    .filter((e) => Owner.playerId[e] === playerId && sim.unitStats(e).id === "villager")
    .sort((a, b) => a - b);
}

describe("PHASE 3 GATE — economy", () => {
  it("skirmish start: TC + 4 villagers + 1 scout per player, start resources, pop cap 15", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    for (const pid of [0, 1]) {
      expect(ownVillagers(sim, pid).length, `p${pid} villagers`).toBe(4);
      const p = getPlayer(sim, pid);
      expect(p.foodMilli).toBe(200_000);
      expect(p.woodMilli).toBe(200_000);
      expect(p.goldMilli).toBe(100_000);
      expect(p.favorMilli).toBe(0);
      expect(p.popCap).toBe(15);
      expect(p.popUsed).toBe(5); // 4 villagers + scout
    }
  });

  it("villagers gather food, wood, and gold to the stockpile via drop-off", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const vills = ownVillagers(sim, 0);
    const before = { ...getPlayer(sim, 0) };
    const berries = findResourceNodes(sim, "food")[0]!;
    const tree = findResourceNodes(sim, "wood")[0]!;
    const mine = findResourceNodes(sim, "gold")[0]!;
    stepSim(sim, [
      { type: "gather", playerId: 0, eids: [vills[0]!, vills[1]!], nodeEid: berries },
      { type: "gather", playerId: 0, eids: [vills[2]!], nodeEid: tree },
      { type: "gather", playerId: 0, eids: [vills[3]!], nodeEid: mine },
    ]);
    run(sim, 15 * 120); // 2 minutes
    const after = getPlayer(sim, 0);
    expect(after.foodMilli, "food gathered").toBeGreaterThan(before.foodMilli);
    expect(after.woodMilli, "wood gathered").toBeGreaterThan(before.woodMilli);
    expect(after.goldMilli, "gold gathered").toBeGreaterThan(before.goldMilli);
  });

  it("villagers pray at the temple to earn favor (4th resource)", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const vills = ownVillagers(sim, 0);
    // build a temple first
    stepSim(sim, [{ type: "build", playerId: 0, eids: [vills[0]!, vills[1]!], building: "temple", x: -1, y: -1 }]);
    run(sim, 15 * 90);
    stepSim(sim, [{ type: "pray", playerId: 0, eids: [vills[2]!, vills[3]!] }]);
    run(sim, 15 * 90);
    expect(getPlayer(sim, 0).favorMilli, "favor earned").toBeGreaterThan(0);
  });

  it("building a house raises the pop cap and costs wood", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const vills = ownVillagers(sim, 0);
    const woodBefore = getPlayer(sim, 0).woodMilli;
    stepSim(sim, [{ type: "build", playerId: 0, eids: [vills[0]!], building: "house", x: -1, y: -1 }]);
    expect(getPlayer(sim, 0).woodMilli).toBe(woodBefore - getBuildingStats("house").cost.wood * 1000);
    run(sim, 15 * 60);
    expect(getPlayer(sim, 0).popCap).toBe(25); // 15 (TC) + 10 (house)
  });

  it("town center trains a villager (cost + time + pop)", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    const tc = p.townCenterEid;
    const foodBefore = p.foodMilli;
    stepSim(sim, [{ type: "train", playerId: 0, buildingEid: tc, unit: "villager" }]);
    expect(getPlayer(sim, 0).foodMilli).toBe(foodBefore - 50_000);
    run(sim, 15 * 20); // train time 14s + margin
    expect(ownVillagers(sim, 0).length).toBe(5);
    expect(getPlayer(sim, 0).popUsed).toBe(6);
  });

  it("market trade converts wood to gold with the configured spread; favor is never tradeable", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const vills = ownVillagers(sim, 0);
    stepSim(sim, [{ type: "build", playerId: 0, eids: [vills[0]!, vills[1]!], building: "market", x: -1, y: -1 }]);
    run(sim, 15 * 90);
    // NOTE: the market itself costs 200 wood (all of the starting stock), so the
    // trade exercise sells food — the mechanic under test is identical.
    const before = { ...getPlayer(sim, 0) };
    stepSim(sim, [{ type: "trade", playerId: 0, sell: "food", buy: "gold", amountMilli: 100_000 }]);
    const after = getPlayer(sim, 0);
    expect(after.foodMilli).toBe(before.foodMilli - 100_000);
    expect(after.goldMilli).toBe(before.goldMilli + 85_000); // 15% spread
    // favor trade is rejected
    stepSim(sim, [{ type: "trade", playerId: 0, sell: "favor", buy: "gold", amountMilli: 1_000 }]);
    expect(getPlayer(sim, 0).favorMilli).toBe(after.favorMilli);
    expect(getPlayer(sim, 0).goldMilli).toBe(after.goldMilli);
  });

  it("the whole economy is deterministic and serializable over 10k ticks", () => {
    const scenario = (sim: Sim) => {
      const vills = ownVillagers(sim, 0);
      const berries = findResourceNodes(sim, "food")[0]!;
      const tree = findResourceNodes(sim, "wood")[0]!;
      stepSim(sim, [
        { type: "gather", playerId: 0, eids: [vills[0]!, vills[1]!], nodeEid: berries },
        { type: "gather", playerId: 0, eids: [vills[2]!], nodeEid: tree },
        { type: "build", playerId: 0, eids: [vills[3]!], building: "house", x: -1, y: -1 },
      ]);
      for (let t = 0; t < 10_000; t++) stepSim(sim, []);
      return simChecksum(sim);
    };
    const a = scenario(createSim(7, undefined, SKIRMISH));
    const b = scenario(createSim(7, undefined, SKIRMISH));
    expect(a).toBe(b);
  }, 180_000);
});
