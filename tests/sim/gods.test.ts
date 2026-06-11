import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, deserializeSim, serializeSim, simChecksum, spawnUnitEntity, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding } from "../../src/sim/economy";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };

function run(sim: Sim, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepSim(sim, []);
}

describe("PHASE 6 GATE — favor mechanics (data-calibrated rates)", () => {
  it("Auryan Devotion Pyres: 5 altars ⇒ ≈28.6 favor/min", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.pantheon = "auryan_dawn";
    p.majorGod = "suryan";
    for (let i = 0; i < 5; i++) spawnBuilding(sim, 0, "sun_altar", 60 + i * 3, 60, true);
    run(sim, 900); // one minute
    expect(p.favorMilli).toBeGreaterThanOrEqual(28_000);
    expect(p.favorMilli).toBeLessThanOrEqual(28_700);
  });

  it("Verdant Tidal Oracles: one stationary Tide-Seer ⇒ 5.5/min; overlapping seers don't stack", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.pantheon = "verdant_deep";
    p.majorGod = "varendra";
    spawnUnitEntity(sim, 0, "tide_seer", 60 * FP_ONE, 60 * FP_ONE);
    run(sim, 900);
    expect(p.favorMilli).toBeGreaterThanOrEqual(5_300);
    expect(p.favorMilli).toBeLessThanOrEqual(5_600);
    // second seer right next to the first: overlapping radius — no extra favor
    const before = p.favorMilli;
    spawnUnitEntity(sim, 0, "tide_seer", 62 * FP_ONE, 60 * FP_ONE);
    run(sim, 900);
    const gained = p.favorMilli - before;
    expect(gained).toBeGreaterThanOrEqual(5_300);
    expect(gained).toBeLessThanOrEqual(5_600);
  });

  it("Ashen Forge-Wrath: favor from combat damage dealt (0.012/point)", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.pantheon = "ashen_forge";
    p.majorGod = "ogarun";
    const atk = spawnUnitEntity(sim, 0, "infantry_base", 100 * FP_ONE, 100 * FP_ONE);
    const def = spawnUnitEntity(sim, 1, "infantry_base", 100 * FP_ONE + 800, 100 * FP_ONE);
    const hpStart = sim.stores.Health.hp100[def]!;
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [atk], targetEid: def }]);
    run(sim, 60);
    const dealt100 = hpStart - (sim.stores.Health.hp100[def] ?? 0);
    expect(dealt100).toBeGreaterThan(0);
    // favorMilli = damage points × 0.012 × 1000 = dealt100 × 0.12
    expect(p.favorMilli).toBe(Math.trunc((dealt100 * 12) / 100));
  });

  it("Storm Skyward Chants rates come from pantheons.json (6/min first villager)", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    spawnBuilding(sim, 0, "sky_temple", 60, 60, true);
    const v = spawnUnitEntity(sim, 0, "villager", 61 * FP_ONE, 61 * FP_ONE);
    stepSim(sim, [{ type: "pray", playerId: 0, eids: [v] }]);
    run(sim, 900);
    expect(p.favorMilli).toBeGreaterThanOrEqual(5_800);
    expect(p.favorMilli).toBeLessThanOrEqual(6_100);
  });
});

describe("PHASE 6 GATE — god powers", () => {
  function stormReady(sim: Sim): void {
    const p = getPlayer(sim, 0);
    p.minorGods.push("zephyrion", "maruth", "ashvayu");
    p.favorMilli = 500_000;
  }

  it("powers cast with ramping favor cost: free, base, ×1.5, ×2.25…", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    stormReady(sim);
    const p = getPlayer(sim, 0);
    // tempest: baseFavorCost 40, ramp 50%
    const cast = () => stepSim(sim, [{ type: "cast_power", playerId: 0, power: "tempest", x: 100 * FP_ONE, y: 100 * FP_ONE }]);
    cast();
    expect(p.favorMilli).toBe(500_000); // first cast free
    run(sim, 15 * 200); // wait out cooldown
    cast();
    expect(p.favorMilli).toBe(460_000); // 40
    run(sim, 15 * 200);
    cast();
    expect(p.favorMilli).toBe(400_000); // 60 = 40 ×1.5
  });

  it("cooldown blocks immediate recast; ungranted powers are rejected", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    stormReady(sim);
    const p = getPlayer(sim, 0);
    stepSim(sim, [{ type: "cast_power", playerId: 0, power: "tempest", x: 100 * FP_ONE, y: 100 * FP_ONE }]);
    stepSim(sim, [{ type: "cast_power", playerId: 0, power: "tempest", x: 100 * FP_ONE, y: 100 * FP_ONE }]);
    expect(p.castCounts["tempest"]).toBe(1); // second cast blocked by cooldown
    stepSim(sim, [{ type: "cast_power", playerId: 0, power: "solar_lance", x: 100 * FP_ONE, y: 100 * FP_ONE }]);
    expect(p.castCounts["solar_lance"]).toBeUndefined(); // not granted to Storm
  });

  it("solar lance deals its data-driven divine damage in the target area", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.pantheon = "auryan_dawn";
    p.majorGod = "suryan";
    p.minorGods.push("helior");
    p.favorMilli = 500_000;
    const target = spawnUnitEntity(sim, 1, "infantry_base", 100 * FP_ONE, 100 * FP_ONE);
    const hpStart = sim.stores.Health.hp100[target]!;
    stepSim(sim, [{ type: "cast_power", playerId: 0, power: "solar_lance", x: 100 * FP_ONE, y: 100 * FP_ONE }]);
    run(sim, 2);
    // 120 divine (ignores armor) ⇒ 12000 hp100
    expect(hpStart - (sim.stores.Health.hp100[target] ?? 0)).toBe(12_000);
  });

  it("pyre storm deals damage over time in the area", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.pantheon = "auryan_dawn";
    p.majorGod = "suryan";
    p.minorGods.push("mithrun");
    p.favorMilli = 500_000;
    const target = spawnUnitEntity(sim, 1, "bronze_colossus", 100 * FP_ONE, 100 * FP_ONE); // tanky: survives the DoT
    const hpStart = sim.stores.Health.hp100[target]!;
    stepSim(sim, [{ type: "cast_power", playerId: 0, power: "pyre_storm", x: 100 * FP_ONE, y: 100 * FP_ONE }]);
    run(sim, 15 * 9); // duration 8s
    // 25 dps × 8s = 200 points = 20000 hp100 (divine)
    expect(hpStart - (sim.stores.Health.hp100[target] ?? 0)).toBe(20_000);
  });

  it("myth units train only with their granting minor god chosen", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    const p = getPlayer(sim, 0);
    p.pantheon = "auryan_dawn";
    p.majorGod = "suryan";
    p.age = 1;
    p.foodMilli = 1_000_000;
    p.favorMilli = 100_000;
    const temple = spawnBuilding(sim, 0, "temple", 60, 60, true);
    stepSim(sim, [{ type: "train", playerId: 0, buildingEid: temple, unit: "sunhawk" }]);
    expect(sim.trainQueues.get(temple)).toBeUndefined(); // helior not chosen
    p.minorGods.push("helior");
    stepSim(sim, [{ type: "train", playerId: 0, buildingEid: temple, unit: "sunhawk" }]);
    expect(sim.trainQueues.get(temple)?.length).toBe(1);
  });

  it("heroes counter myth: Forgeborn beats Emberbull 1v1", () => {
    const sim = createSim(7, undefined, SKIRMISH);
    const hero = spawnUnitEntity(sim, 0, "forgeborn", 100 * FP_ONE, 100 * FP_ONE);
    const myth = spawnUnitEntity(sim, 1, "emberbull", 102 * FP_ONE, 100 * FP_ONE);
    stepSim(sim, [
      { type: "attack", playerId: 0, eids: [hero], targetEid: myth },
      { type: "attack", playerId: 1, eids: [myth], targetEid: hero },
    ]);
    run(sim, 15 * 120);
    const { Health } = sim.stores;
    expect(Health.hp100[myth] ?? 0).toBeLessThanOrEqual(0); // bull dead (entity removed)
    const alive = Array.from(query(sim.world, [sim.stores.UnitRef]));
    expect(alive).toContain(hero);
    expect(alive).not.toContain(myth);
  });

  it("powers + favor stay deterministic and serializable", () => {
    const scenario = () => {
      const sim = createSim(99, undefined, SKIRMISH);
      const p = getPlayer(sim, 0);
      p.pantheon = "auryan_dawn";
      p.majorGod = "suryan";
      p.minorGods.push("helior", "mithrun");
      p.favorMilli = 300_000;
      for (let i = 0; i < 3; i++) spawnBuilding(sim, 0, "sun_altar", 60 + i * 3, 60, true);
      spawnUnitEntity(sim, 1, "infantry_base", 100 * FP_ONE, 100 * FP_ONE);
      stepSim(sim, [{ type: "cast_power", playerId: 0, power: "pyre_storm", x: 100 * FP_ONE, y: 100 * FP_ONE }]);
      for (let t = 0; t < 500; t++) stepSim(sim, []);
      const restored = deserializeSim(serializeSim(sim));
      expect(simChecksum(restored)).toBe(simChecksum(sim));
      for (let t = 0; t < 500; t++) {
        stepSim(sim, []);
        stepSim(restored, []);
      }
      expect(simChecksum(restored)).toBe(simChecksum(sim));
      return simChecksum(sim);
    };
    expect(scenario()).toBe(scenario());
  }, 240_000);
});
