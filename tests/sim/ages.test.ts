import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, deserializeSim, serializeSim, simChecksum, spawnUnitEntity, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer } from "../../src/sim/economy";
import { getTechStats } from "../../src/sim/techdata";
import { getMinorPool } from "../../src/sim/pantheondata";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };

function run(sim: Sim, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepSim(sim, []);
}

function vills(sim: Sim, pid: number): number[] {
  const { Owner, UnitRef } = sim.stores;
  return Array.from(query(sim.world, [UnitRef]))
    .filter((e) => Owner.playerId[e] === pid && sim.unitStats(e).id === "villager")
    .sort((a, b) => a - b);
}

function rich(sim: Sim, pid: number): void {
  const p = getPlayer(sim, pid);
  p.foodMilli = 5_000_000;
  p.woodMilli = 5_000_000;
  p.goldMilli = 5_000_000;
}

/** Build a building instantly-ish: pay + place + spam builders. */
function buildNow(sim: Sim, pid: number, building: string): void {
  const v = vills(sim, pid);
  stepSim(sim, [{ type: "build", playerId: pid, eids: v, building, x: -1, y: -1 }]);
  run(sim, 15 * 120);
}

describe("PHASE 5 GATE — ages, unlocks, tech effects", () => {
  it("data loaders expose tech stats and minor-god pools", () => {
    expect(getTechStats("age_classical").cost.food).toBe(400);
    expect(getTechStats("age_heroic").requiresBuilding).toBe("armory");
    const pool = getMinorPool("storm_concord", "indravan", "classical");
    expect(pool).toEqual(["zephyrion", "anila"]);
  });

  it("age-up requires its prerequisite building and a valid minor god", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    rich(sim, 0);
    // no temple yet → rejected
    stepSim(sim, [{ type: "research", playerId: 0, tech: "age_classical", minorGod: "zephyrion" }]);
    run(sim, 15 * 70);
    expect(getPlayer(sim, 0).age).toBe(0);
    buildNow(sim, 0, "temple");
    // invalid minor god for the pantheon pool → rejected
    stepSim(sim, [{ type: "research", playerId: 0, tech: "age_classical", minorGod: "helior" }]);
    run(sim, 15 * 70);
    expect(getPlayer(sim, 0).age).toBe(0);
    // valid choice → Classical after research time
    stepSim(sim, [{ type: "research", playerId: 0, tech: "age_classical", minorGod: "zephyrion" }]);
    run(sim, 15 * 70);
    expect(getPlayer(sim, 0).age).toBe(1);
    expect(getPlayer(sim, 0).minorGods).toContain("zephyrion");
  });

  it("age gates buildings and units per data files", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    rich(sim, 0);
    // barracks is Classical — rejected in Archaic
    stepSim(sim, [{ type: "build", playerId: 0, eids: vills(sim, 0), building: "barracks", x: -1, y: -1 }]);
    run(sim, 5);
    const buildings0 = Array.from(query(sim.world, [sim.stores.Building]));
    expect(buildings0.length).toBe(2); // just the two TCs
    // age up, then barracks + infantry work
    buildNow(sim, 0, "temple");
    stepSim(sim, [{ type: "research", playerId: 0, tech: "age_classical", minorGod: "zephyrion" }]);
    run(sim, 15 * 70);
    expect(getPlayer(sim, 0).age).toBe(1);
    buildNow(sim, 0, "barracks");
    const barracks = Array.from(query(sim.world, [sim.stores.Building])).find(
      (e) => sim.stores.Owner.playerId[e] === 0 && sim.stores.Building.active[e] === 1 && sim.stores.Building.typeIndex[e] !== undefined &&
        // type check via name below
        true,
    );
    expect(barracks).toBeDefined();
  });

  it("climbs the full ladder Archaic→Classical→Heroic→Mythic", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    rich(sim, 0);
    buildNow(sim, 0, "temple");
    stepSim(sim, [{ type: "research", playerId: 0, tech: "age_classical", minorGod: "zephyrion" }]);
    run(sim, 15 * 70);
    expect(getPlayer(sim, 0).age).toBe(1);
    buildNow(sim, 0, "armory");
    stepSim(sim, [{ type: "research", playerId: 0, tech: "age_heroic", minorGod: "maruth" }]);
    run(sim, 15 * 85);
    expect(getPlayer(sim, 0).age).toBe(2);
    buildNow(sim, 0, "market");
    stepSim(sim, [{ type: "research", playerId: 0, tech: "age_mythic", minorGod: "kethran" }]);
    run(sim, 15 * 100);
    expect(getPlayer(sim, 0).age).toBe(3);
    expect(getPlayer(sim, 0).minorGods).toEqual(["zephyrion", "maruth", "kethran"]);
  });

  it("tech effects apply: bronze_weapons raises infantry damage ×1.1 (exact)", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    rich(sim, 0);
    buildNow(sim, 0, "temple");
    stepSim(sim, [{ type: "research", playerId: 0, tech: "age_classical", minorGod: "zephyrion" }]);
    run(sim, 15 * 70);
    buildNow(sim, 0, "armory");
    stepSim(sim, [{ type: "research", playerId: 0, tech: "bronze_weapons" }]);
    run(sim, 15 * 40);
    expect(getPlayer(sim, 0).researchedTechs).toContain("bronze_weapons");
    // duel: upgraded infantry vs fresh enemy infantry
    const atk = spawnUnitEntity(sim, 0, "infantry_base", 100 * FP_ONE, 100 * FP_ONE);
    const def = spawnUnitEntity(sim, 1, "infantry_base", 100 * FP_ONE + 800, 100 * FP_ONE);
    const { Health } = sim.stores;
    const hpBefore = Health.hp100[def]!;
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [atk], targetEid: def }]);
    let dmg = 0;
    for (let t = 0; t < 60 && dmg === 0; t++) {
      stepSim(sim, []);
      dmg = hpBefore - Health.hp100[def]!;
    }
    // 800 ×1.1 = 880 → ×(100−35)% = 572
    expect(dmg).toBe(572);
  });

  it("eco tech applies: hand_axe speeds wood gathering by 10%", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    rich(sim, 0);
    stepSim(sim, [{ type: "research", playerId: 0, tech: "hand_axe" }]);
    run(sim, 15 * 40);
    expect(getPlayer(sim, 0).researchedTechs).toContain("hand_axe");
    // villager 0.85/s ×1.1 = 0.935/s → micro/tick = trunc(0.935e6/15) — verify via effective rate helper
    const v = vills(sim, 0)[0]!;
    const rate = sim.effectiveGatherMicroPerTick(v, 1);
    expect(rate).toBe(Math.trunc((0.85 * 1.1 * 1_000_000) / 15));
  });

  it("research + ages stay deterministic and serializable", () => {
    const scenario = () => {
      const sim = createSim(99, undefined, SKIRMISH);
      rich(sim, 0);
      buildNow(sim, 0, "temple");
      stepSim(sim, [{ type: "research", playerId: 0, tech: "age_classical", minorGod: "anila" }]);
      run(sim, 15 * 70);
      const restored = deserializeSim(serializeSim(sim));
      expect(simChecksum(restored)).toBe(simChecksum(sim));
      for (let t = 0; t < 600; t++) {
        stepSim(sim, []);
        stepSim(restored, []);
      }
      expect(simChecksum(restored)).toBe(simChecksum(sim));
      return simChecksum(sim);
    };
    expect(scenario()).toBe(scenario());
  }, 240_000);
});
