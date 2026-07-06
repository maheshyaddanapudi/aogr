/**
 * GAP-FIX SUITE — mechanics the AoM capability audit found missing or
 * unreachable. Every fix lands here first (TDD, KICKOFF §6).
 */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, spawnUnitEntity, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding, findResourceNodes } from "../../src/sim/economy";
import { getUnitStats } from "../../src/sim/unitdata";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };
const OPEN = { players: 2, skirmish: false };
const run = (sim: Sim, n: number) => {
  for (let i = 0; i < n; i++) stepSim(sim, []);
};

describe("GAP FIXES — sim mechanics", () => {
  it("defensive buildings (town center) shoot enemy units in range, ignore far ones", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Position, Health } = sim.stores;
    const tc0 = getPlayer(sim, 0).townCenterEid;
    const inRange = spawnUnitEntity(sim, 1, "infantry_base", Position.x[tc0]! + 4000, Position.y[tc0]!);
    const far = spawnUnitEntity(sim, 1, "infantry_base", Position.x[tc0]! + 70000, Position.y[tc0]!);
    const hp0 = Health.hp100[inRange]!;
    const hpFar = Health.hp100[far]!;
    run(sim, 90);
    expect(Health.hp100[inRange]!, "unit under TC fire takes damage").toBeLessThan(hp0);
    expect(Health.hp100[far]!, "unit out of range untouched").toBe(hpFar);
  });

  it("stances: hold-ground fights without chasing; passive never fires", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Position, Health } = sim.stores;
    const holder = spawnUnitEntity(sim, 0, "infantry_base", 95 * FP_ONE, 95 * FP_ONE);
    const bait = spawnUnitEntity(sim, 1, "archer_base", 103 * FP_ONE, 95 * FP_ONE);
    stepSim(sim, [{ type: "stance", playerId: 0, eids: [holder], stance: 2 }]);
    const x0 = Position.x[holder]!;
    run(sim, 40);
    expect(Math.abs(Position.x[holder]! - x0), "hold-ground did not chase").toBeLessThan(900);

    const sim2 = createSim(1, undefined, OPEN);
    const p0 = spawnUnitEntity(sim2, 0, "infantry_base", 95 * FP_ONE, 95 * FP_ONE);
    const p1 = spawnUnitEntity(sim2, 1, "infantry_base", 96 * FP_ONE, 95 * FP_ONE);
    stepSim(sim2, [{ type: "stance", playerId: 0, eids: [p0], stance: 0 }]);
    const enemyHp = sim2.stores.Health.hp100[p1]!;
    run(sim2, 40);
    expect(sim2.stores.Health.hp100[p1]!, "passive unit never fired back").toBe(enemyHp);
  });

  it("villagers repair damaged buildings back toward full HP", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Health, UnitRef, Owner, GatherTask } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const full = Health.hp100[tc]!;
    Health.hp100[tc] = Math.trunc(full / 2);
    const vill = Array.from(query(sim.world, [UnitRef, GatherTask])).filter((e) => Owner.playerId[e] === 0)[0]!;
    stepSim(sim, [{ type: "repair", playerId: 0, eids: [vill], buildingEid: tc }]);
    run(sim, 15 * 30);
    expect(Health.hp100[tc]!, "repaired upward").toBeGreaterThan(Math.trunc(full / 2));
    run(sim, 15 * 240);
    expect(Health.hp100[tc]!, "repair stops at full").toBe(full);
  });

  it("caravans earn gold running market ↔ town center routes", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Position } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const market = spawnBuilding(sim, 0, "market", Math.trunc(Position.x[tc]! / 1000) + 14, Math.trunc(Position.y[tc]! / 1000), true);
    const caravan = spawnUnitEntity(sim, 0, "caravan", Position.x[market]!, Position.y[market]! + 2000);
    const gold0 = getPlayer(sim, 0).goldMilli;
    stepSim(sim, [{ type: "trade_route", playerId: 0, eids: [caravan], buildingEid: market }]);
    run(sim, 15 * 120);
    expect(getPlayer(sim, 0).goldMilli, "trade gold earned").toBeGreaterThan(gold0);
  });

  it("wild game roams skirmish maps and villagers hunt it for food", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { ResourceNode, UnitRef, Owner, Position, GatherTask } = sim.stores;
    const game = Array.from(query(sim.world, [ResourceNode])).filter((e) => ResourceNode.resType[e] === 3);
    expect(game.length, "game herds spawned").toBeGreaterThan(0);
    const vill = Array.from(query(sim.world, [UnitRef, GatherTask])).filter((e) => Owner.playerId[e] === 0)[0]!;
    let best = game[0]!;
    let bd = Number.MAX_SAFE_INTEGER;
    for (const g of game) {
      const d = (Position.x[g]! - Position.x[vill]!) ** 2 + (Position.y[g]! - Position.y[vill]!) ** 2;
      if (d < bd) { bd = d; best = g; }
    }
    const food0 = getPlayer(sim, 0).foodMilli;
    stepSim(sim, [{ type: "gather", playerId: 0, eids: [vill], nodeEid: best }]);
    run(sim, 15 * 90);
    expect(getPlayer(sim, 0).foodMilli, "hunted food banked").toBeGreaterThan(food0);
  });

  it("rally point set on a resource auto-tasks newly trained villagers", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { Position, GatherTask, UnitRef, Owner } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const node = findResourceNodes(sim, "wood")[0]!;
    stepSim(sim, [
      { type: "rally", playerId: 0, buildingEid: tc, x: Position.x[node]!, y: Position.y[node]! },
      { type: "train", playerId: 0, buildingEid: tc, unit: "villager" },
    ]);
    const before = new Set(Array.from(query(sim.world, [UnitRef])).filter((e) => Owner.playerId[e] === 0));
    run(sim, 15 * 20);
    const fresh = Array.from(query(sim.world, [UnitRef])).filter((e) => Owner.playerId[e] === 0 && !before.has(e));
    expect(fresh.length, "villager trained").toBe(1);
    expect([1, 2, 3], "auto-tasked to gather the rallied resource").toContain(GatherTask.phase[fresh[0]!]);
  });

  it("heroes slowly heal nearby wounded allies (not distant ones)", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Health } = sim.stores;
    const hero = spawnUnitEntity(sim, 0, "sky_herald", 95 * FP_ONE, 95 * FP_ONE);
    const near = spawnUnitEntity(sim, 0, "infantry_base", 97 * FP_ONE, 95 * FP_ONE);
    const farAway = spawnUnitEntity(sim, 0, "infantry_base", 130 * FP_ONE, 95 * FP_ONE);
    Health.hp100[near] = 1000;
    Health.hp100[farAway] = 1000;
    run(sim, 15 * 20);
    expect(Health.hp100[near]!, "nearby ally healed").toBeGreaterThan(1000);
    expect(Health.hp100[farAway]!, "distant ally untouched").toBe(1000);
    const cap = getUnitStats("infantry_base").hp100;
    run(sim, 15 * 600);
    expect(Health.hp100[near]!, "heal caps at max HP").toBeLessThanOrEqual(cap);
    void hero;
  });

  it("cancelling a queued unit refunds its cost and empties the slot", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const tc = getPlayer(sim, 0).townCenterEid;
    const food0 = getPlayer(sim, 0).foodMilli;
    stepSim(sim, [{ type: "train", playerId: 0, buildingEid: tc, unit: "villager" }]);
    expect(getPlayer(sim, 0).foodMilli).toBe(food0 - getUnitStats("villager").cost.food * 1000);
    stepSim(sim, [{ type: "cancel_train", playerId: 0, buildingEid: tc, index: 0 }]);
    expect(getPlayer(sim, 0).foodMilli, "cost refunded").toBe(food0);
    expect(sim.trainQueues.get(tc) ?? [], "queue empty").toHaveLength(0);
    const pop0 = getPlayer(sim, 0).popUsed;
    run(sim, 15 * 20);
    expect(getPlayer(sim, 0).popUsed, "nothing trained").toBe(pop0);
  });

  it("walls block movement; gates stay passable", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const g = sim.navGrid;
    const free = (tx: number, ty: number) => g.passable[ty * g.size + tx];
    // find two clear tiles
    let wx = 0, wy = 0;
    outer: for (let y = 20; y < 180; y++) for (let x = 20; x < 180; x++) {
      if (free(x, y) && free(x + 3, y)) { wx = x; wy = y; break outer; }
    }
    spawnBuilding(sim, 0, "wall", wx, wy, true);
    spawnBuilding(sim, 0, "gate", wx + 3, wy, true);
    expect(free(wx, wy), "wall tile blocked").toBe(0);
    expect(free(wx + 3, wy), "gate tile passable").toBe(1);
  });
});
