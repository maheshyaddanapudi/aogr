import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, deserializeSim, serializeSim, simChecksum, spawnUnitEntity, stepSim, type Sim } from "../../src/sim/sim";
import { getUnitStats } from "../../src/sim/unitdata";
import { FP_ONE } from "../../src/sim/fixed";

const OPEN = { players: 2, skirmish: false };

/** Find a flat open area and spawn two opposing lines there. */
function spawnLine(sim: Sim, playerId: number, unit: string, count: number, baseX: number, baseY: number): number[] {
  const eids: number[] = [];
  for (let i = 0; i < count; i++) {
    eids.push(spawnUnitEntity(sim, playerId, unit, baseX * FP_ONE + i * 1500, baseY * FP_ONE));
  }
  return eids;
}

function aliveOf(sim: Sim, playerId: number): number[] {
  const { Owner, UnitRef } = sim.stores;
  return Array.from(query(sim.world, [UnitRef]))
    .filter((e) => Owner.playerId[e] === playerId)
    .sort((a, b) => a - b);
}

function fight(unitA: string, countA: number, unitB: string, countB: number, maxTicks = 15 * 180): { a: number; b: number; sim: Sim } {
  const sim = createSim(1234, undefined, OPEN);
  const a = spawnLine(sim, 0, unitA, countA, 95, 95);
  const b = spawnLine(sim, 1, unitB, countB, 95, 105);
  stepSim(sim, [
    { type: "attack", playerId: 0, eids: a, targetEid: -1 },
    { type: "attack", playerId: 1, eids: b, targetEid: -1 },
  ]);
  for (let t = 0; t < maxTicks; t++) {
    stepSim(sim, []);
    if (aliveOf(sim, 0).length === 0 || aliveOf(sim, 1).length === 0) break;
  }
  return { a: aliveOf(sim, 0).length, b: aliveOf(sim, 1).length, sim };
}

describe("PHASE 4 GATE — combat & counters", () => {
  it("damage math matches units.json exactly (hack vs armor)", () => {
    const sim = createSim(7, undefined, OPEN);
    const atk = spawnUnitEntity(sim, 0, "infantry_base", 100 * FP_ONE, 100 * FP_ONE);
    const def = spawnUnitEntity(sim, 1, "infantry_base", 100 * FP_ONE + 800, 100 * FP_ONE);
    const { Health, CombatState } = sim.stores;
    const hpBefore = Health.hp100[def]!;
    expect(hpBefore).toBe(11500);
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [atk], targetEid: def }]);
    // run until exactly one hit lands on the defender
    let hits = 0;
    for (let t = 0; t < 60 && hits === 0; t++) {
      stepSim(sim, []);
      if (Health.hp100[def]! < hpBefore) hits = 1;
    }
    // 8.00 hack × (100−35)% armor = 5.20 ⇒ 520 in ×100 units
    const inf = getUnitStats("infantry_base");
    const expected = Math.max(1, Math.trunc((inf.attack!.damage100 * (100 - 35)) / 100));
    expect(expected).toBe(520);
    expect(hpBefore - Health.hp100[def]!).toBe(expected);
    expect(CombatState.targetEid[atk]).toBe(def);
  });

  it("divine damage ignores armor entirely", () => {
    const sim = createSim(7, undefined, OPEN);
    const hero = spawnUnitEntity(sim, 0, "forgeborn", 100 * FP_ONE, 100 * FP_ONE);
    const def = spawnUnitEntity(sim, 1, "infantry_base", 100 * FP_ONE + 800, 100 * FP_ONE);
    const { Health } = sim.stores;
    const hpBefore = Health.hp100[def]!;
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [hero], targetEid: def }]);
    let dmg = 0;
    for (let t = 0; t < 60 && dmg === 0; t++) {
      stepSim(sim, []);
      dmg = hpBefore - Health.hp100[def]!;
    }
    expect(dmg).toBe(getUnitStats("forgeborn").attack!.damage100); // 10.00 → 1000, no reduction
  });

  it("spearman ×3 multiplier vs cavalry applies exactly", () => {
    const sim = createSim(7, undefined, OPEN);
    const spear = spawnUnitEntity(sim, 0, "spearman", 100 * FP_ONE, 100 * FP_ONE);
    const cav = spawnUnitEntity(sim, 1, "cavalry_base", 100 * FP_ONE + 800, 100 * FP_ONE);
    const { Health } = sim.stores;
    const hpBefore = Health.hp100[cav]!;
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [spear], targetEid: cav }]);
    let dmg = 0;
    for (let t = 0; t < 60 && dmg === 0; t++) {
      stepSim(sim, []);
      dmg = hpBefore - Health.hp100[cav]!;
    }
    // 5.5 hack ×3 vs cavalry × (100−20)% = 13.20 ⇒ 1320
    expect(dmg).toBe(Math.trunc((550 * 3000 * (100 - 20)) / 1000 / 100));
  });

  it("counter triangle: archers beat infantry (equal pop)", () => {
    const r = fight("archer_base", 8, "infantry_base", 8);
    expect(r.b, "infantry remaining vs archers").toBe(0);
    expect(r.a, "archers surviving").toBeGreaterThan(0);
  });

  it("counter triangle: cavalry beat archers (equal pop)", () => {
    const r = fight("cavalry_base", 4, "archer_base", 6);
    expect(r.b, "archers remaining vs cavalry").toBe(0);
    expect(r.a, "cavalry surviving").toBeGreaterThan(0);
  });

  it("counter triangle: infantry beat cavalry (equal pop)", () => {
    const r = fight("infantry_base", 6, "cavalry_base", 4);
    expect(r.b, "cavalry remaining vs infantry").toBe(0);
    expect(r.a, "infantry surviving").toBeGreaterThan(0);
  });

  it("death frees population and removes the entity", () => {
    const sim = createSim(7, undefined, { players: 2, skirmish: true });
    const v = aliveOf(sim, 1).find((e) => sim.unitStats(e).id === "villager")!;
    const knights = spawnLine(sim, 0, "infantry_base", 3, sim.stores.Position.x[v]! / FP_ONE - 3, sim.stores.Position.y[v]! / FP_ONE);
    const popBefore = sim.players[1]!.popUsed;
    stepSim(sim, [{ type: "attack", playerId: 0, eids: knights, targetEid: v }]);
    for (let t = 0; t < 15 * 30; t++) {
      stepSim(sim, []);
      if (!aliveOf(sim, 1).includes(v)) break;
    }
    expect(aliveOf(sim, 1).includes(v)).toBe(false);
    expect(sim.players[1]!.popUsed).toBe(popBefore - 1);
  });

  it("combat with deaths stays deterministic and serializable over 10k ticks", () => {
    const scenario = () => {
      const sim = createSim(99, undefined, OPEN);
      const a = spawnLine(sim, 0, "infantry_base", 10, 90, 95);
      const b = spawnLine(sim, 1, "archer_base", 10, 90, 105);
      stepSim(sim, [
        { type: "attack", playerId: 0, eids: a, targetEid: -1 },
        { type: "attack", playerId: 1, eids: b, targetEid: -1 },
      ]);
      for (let t = 0; t < 1500; t++) stepSim(sim, []);
      const restored = deserializeSim(serializeSim(sim));
      expect(simChecksum(restored)).toBe(simChecksum(sim));
      for (let t = 0; t < 8500; t++) {
        stepSim(sim, []);
        stepSim(restored, []);
      }
      expect(simChecksum(restored)).toBe(simChecksum(sim));
      return simChecksum(sim);
    };
    expect(scenario()).toBe(scenario());
  }, 240_000);
});
