/** GAP-FIX ROUND 2 — garrison, myth specials, formations, patrol, market
 * drift, relics, major-god passives. TDD (KICKOFF §6). */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, spawnUnitEntity, stepSim, serializeSim, deserializeSim, simChecksum, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding, spawnResourceNode } from "../../src/sim/economy";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };
const OPEN = { players: 2, skirmish: false };
const run = (sim: Sim, n: number) => {
  for (let i = 0; i < n; i++) stepSim(sim, []);
};

describe("GAP FIXES 2", () => {
  it("garrison: units shelter untargetable inside, keep pop, ungarrison restores, razing releases", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Position, Health, Owner } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const u = spawnUnitEntity(sim, 0, "infantry_base", Position.x[tc]! + 2000, Position.y[tc]!);
    run(sim, 1); // recomputePop sees the new unit
    const pop0 = getPlayer(sim, 0).popUsed;
    stepSim(sim, [{ type: "garrison", playerId: 0, eids: [u], buildingEid: tc }]);
    run(sim, 30);
    expect(sim.garrisons.get(tc) ?? [], "unit inside").toContain(u);
    expect(getPlayer(sim, 0).popUsed, "pop unchanged").toBe(pop0);
    // enemy raider standing next to the TC cannot target the garrisoned unit
    const raider = spawnUnitEntity(sim, 1, "infantry_base", Position.x[tc]! + 3000, Position.y[tc]!);
    const hp0 = Health.hp100[u]!;
    run(sim, 45);
    expect(Health.hp100[u]!, "garrisoned unit untouched").toBe(hp0);
    stepSim(sim, [{ type: "ungarrison", playerId: 0, buildingEid: tc }]);
    run(sim, 2);
    expect(sim.garrisons.get(tc) ?? [], "empty after ungarrison").toHaveLength(0);
    // re-garrison, then raze the building → occupants released, not deleted
    stepSim(sim, [{ type: "garrison", playerId: 0, eids: [u], buildingEid: tc }]);
    run(sim, 30);
    Health.hp100[tc] = 1;
    run(sim, 60); // raider + defenders finish it
    const alive = query(sim.world, [sim.stores.UnitRef]).includes(u);
    expect(alive, "released on collapse (or died fighting) — never leaked").toBe(true);
    void Owner;
    void raider;
  });

  it("garrison survives serialize round-trip with identical checksum", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Position } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const u = spawnUnitEntity(sim, 0, "infantry_base", Position.x[tc]! + 2000, Position.y[tc]!);
    stepSim(sim, [{ type: "garrison", playerId: 0, eids: [u], buildingEid: tc }]);
    run(sim, 30);
    const copy = deserializeSim(serializeSim(sim));
    expect(simChecksum(copy)).toBe(simChecksum(sim));
    run(sim, 50);
    run(copy, 50);
    expect(simChecksum(copy), "lockstep after restore").toBe(simChecksum(sim));
  });

  it("myth specials: splash damage hits units near the target", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Health } = sim.stores;
    const bull = spawnUnitEntity(sim, 0, "emberbull", 95 * FP_ONE, 95 * FP_ONE);
    const main = spawnUnitEntity(sim, 1, "infantry_base", 97 * FP_ONE, 95 * FP_ONE);
    const near = spawnUnitEntity(sim, 1, "infantry_base", 98 * FP_ONE, 96 * FP_ONE);
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [bull], targetEid: main }]);
    run(sim, 40);
    expect(Health.hp100[near]!, "splash hit the neighbor").toBeLessThan(sim.unitStats(near).hp100);
  });

  it("myth specials: regeneration heals out of combat", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Health } = sim.stores;
    const regenUnit = spawnUnitEntity(sim, 0, "rivermaw", 95 * FP_ONE, 95 * FP_ONE);
    Health.hp100[regenUnit] = 1000;
    run(sim, 15 * 10);
    expect(Health.hp100[regenUnit]!, "regenerated").toBeGreaterThan(1000);
  });

  it("formations: a group move spreads units into a grid, not a single point", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Position } = sim.stores;
    const eids = Array.from({ length: 9 }, (_, i) => spawnUnitEntity(sim, 0, "infantry_base", (90 + i) * FP_ONE, 90 * FP_ONE));
    stepSim(sim, [{ type: "move", playerId: 0, eids, x: 110 * FP_ONE, y: 110 * FP_ONE }]);
    run(sim, 15 * 30);
    let minPair = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < eids.length; i++) {
      for (let j = i + 1; j < eids.length; j++) {
        const d = Math.hypot(Position.x[eids[i]!]! - Position.x[eids[j]!]!, Position.y[eids[i]!]! - Position.y[eids[j]!]!);
        minPair = Math.min(minPair, d);
      }
    }
    for (const e of eids) {
      expect(Math.hypot(Position.x[e]! - 110 * FP_ONE, Position.y[e]! - 110 * FP_ONE), "arrived near target").toBeLessThan(6 * FP_ONE);
    }
    expect(minPair, "grid spacing, no stacking").toBeGreaterThan(600);
  });

  it("patrol: units walk the leg back and forth until ordered otherwise", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Position } = sim.stores;
    const u = spawnUnitEntity(sim, 0, "infantry_base", 95 * FP_ONE, 95 * FP_ONE);
    stepSim(sim, [{ type: "patrol", playerId: 0, eids: [u], x: 103 * FP_ONE, y: 95 * FP_ONE }]);
    const xs: number[] = [];
    for (let i = 0; i < 15 * 60; i++) {
      stepSim(sim, []);
      if (i % 15 === 0) xs.push(Position.x[u]!);
    }
    const max = Math.max(...xs);
    const min = Math.min(...xs);
    expect(max, "reached far leg").toBeGreaterThan(101 * FP_ONE);
    expect(min, "returned toward home leg").toBeLessThan(98 * FP_ONE);
    const tail = xs.slice(-20);
    expect(Math.max(...tail) - Math.min(...tail), "still moving late").toBeGreaterThan(2 * FP_ONE);
  });

  it("market drift: repeated identical trades pay out less, then recover over time", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.woodMilli = 10_000_000;
    const { Position } = sim.stores;
    const tc = p.townCenterEid;
    spawnBuilding(sim, 0, "market", Math.trunc(Position.x[tc]! / 1000) + 10, Math.trunc(Position.y[tc]! / 1000), true);
    const goldBefore1 = p.goldMilli;
    stepSim(sim, [{ type: "trade", playerId: 0, sell: "wood", buy: "gold", amountMilli: 100_000 }]);
    const gain1 = p.goldMilli - goldBefore1;
    for (let i = 0; i < 8; i++) stepSim(sim, [{ type: "trade", playerId: 0, sell: "wood", buy: "gold", amountMilli: 100_000 }]);
    const goldBefore2 = p.goldMilli;
    stepSim(sim, [{ type: "trade", playerId: 0, sell: "wood", buy: "gold", amountMilli: 100_000 }]);
    const gain2 = p.goldMilli - goldBefore2;
    expect(gain2, "drifted price pays less").toBeLessThan(gain1);
    run(sim, 15 * 120);
    const goldBefore3 = p.goldMilli;
    stepSim(sim, [{ type: "trade", playerId: 0, sell: "wood", buy: "gold", amountMilli: 100_000 }]);
    const gain3 = p.goldMilli - goldBefore3;
    expect(gain3, "price recovers").toBeGreaterThan(gain2);
  });

  it("relics: heroes collect them, temples bank them, favor trickles faster", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Position } = sim.stores;
    const relics = Array.from(query(sim.world, [sim.stores.ResourceNode])).filter((e) => sim.stores.ResourceNode.resType[e] === 4);
    expect(relics.length, "relics spawn on skirmish maps").toBeGreaterThan(0);
    const tc = getPlayer(sim, 0).townCenterEid;
    const temple = spawnBuilding(sim, 0, "temple", Math.trunc(Position.x[tc]! / 1000) + 8, Math.trunc(Position.y[tc]! / 1000), true);
    const relic = spawnResourceNode(sim, "relic", Math.trunc(Position.x[tc]! / 1000) - 6, Math.trunc(Position.y[tc]! / 1000), 1);
    const hero = spawnUnitEntity(sim, 0, "sky_herald", Position.x[relic]! + 1000, Position.y[relic]!);
    stepSim(sim, [{ type: "move", playerId: 0, eids: [hero], x: Position.x[relic]!, y: Position.y[relic]! }]);
    run(sim, 15 * 10);
    expect(sim.relicHolder.get(hero) ?? 0, "hero picked it up").toBeGreaterThan(0);
    stepSim(sim, [{ type: "move", playerId: 0, eids: [hero], x: Position.x[temple]!, y: Position.y[temple]! }]);
    run(sim, 15 * 20);
    expect(getPlayer(sim, 0).relicsStored, "banked at the temple").toBeGreaterThan(0);
    const favor0 = getPlayer(sim, 0).favorMilli;
    run(sim, 15 * 60);
    expect(getPlayer(sim, 0).favorMilli, "relic favor trickle").toBeGreaterThan(favor0);
  });

  it("major-god passives: the chosen major changes real numbers", () => {
    const a = createSim(42, undefined, SKIRMISH);
    const b = createSim(42, undefined, SKIRMISH);
    getPlayer(a, 0).pantheon = "storm_concord";
    getPlayer(a, 0).majorGod = "indravan";
    getPlayer(b, 0).pantheon = "storm_concord";
    getPlayer(b, 0).majorGod = "vayuna";
    // same villager, same node, different majors ⇒ different gather output
    const gather = (sim: Sim) => {
      const { UnitRef, Owner, GatherTask } = sim.stores;
      const v = Array.from(query(sim.world, [UnitRef, GatherTask])).filter((e) => Owner.playerId[e] === 0)[0]!;
      const nodes = Array.from(query(sim.world, [sim.stores.ResourceNode])).filter((e) => sim.stores.ResourceNode.resType[e] === 1);
      const before = getPlayer(sim, 0).woodMilli;
      stepSim(sim, [{ type: "gather", playerId: 0, eids: [v], nodeEid: nodes[0]! }]);
      run(sim, 15 * 90);
      return getPlayer(sim, 0).woodMilli - before;
    };
    expect(gather(b), "vayuna (swift winds) out-gathers indravan").toBeGreaterThan(gather(a));
  });
});
