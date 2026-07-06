/** GAP-FIX ROUND 5 — herd wander/capture, AI navies, battle-order formation,
 * healer, attack-move, gate toggle, chain-bolt, 3-player FFA. */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, spawnUnitEntity, stepSim, isWaterTile, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding } from "../../src/sim/economy";
import { createAiState, decideAi } from "../../src/ai/brain";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };
const OPEN = { players: 2, skirmish: false };
const run = (sim: Sim, n: number) => {
  for (let i = 0; i < n; i++) stepSim(sim, []);
};

describe("GAP FIXES 5", () => {
  it("herds wander near home and defect to whoever grazes them", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const { ResourceNode, Position, UnitRef, Owner, GatherTask } = sim.stores;
    const herd = Array.from(query(sim.world, [ResourceNode])).filter((e) => ResourceNode.resType[e] === 5)[0]!;
    const x0 = Position.x[herd]!;
    const y0 = Position.y[herd]!;
    run(sim, 15 * 60);
    const drift = Math.hypot(Position.x[herd]! - x0, Position.y[herd]! - y0);
    expect(drift, "wandered").toBeGreaterThan(0);
    expect(drift, "stays near home").toBeLessThan(9 * FP_ONE);
    // capture: an enemy villager standing beside it claims it; owner-locked gathering
    const vill1 = spawnUnitEntity(sim, 1, "villager", Position.x[herd]! + 800, Position.y[herd]!);
    run(sim, 15 * 4);
    expect(sim.herdOwner.get(herd), "claimed by p1").toBe(1);
    const vill0 = Array.from(query(sim.world, [UnitRef, GatherTask])).filter((e) => Owner.playerId[e] === 0)[0]!;
    stepSim(sim, [{ type: "gather", playerId: 0, eids: [vill0], nodeEid: herd }]);
    expect(GatherTask.phase[vill0], "p0 cannot gather p1's herd").toBe(0);
    void vill1;
  });

  it("a coastal AI builds a dock and fields fishing boats", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const p1 = getPlayer(sim, 1);
    p1.woodMilli = 1_000_000;
    const ai = createAiState(1, "hard", 42);
    const { Building, Owner, UnitRef } = sim.stores;
    let boats = 0;
    for (let i = 0; i < 15 * 300; i++) {
      if (i % ai.decisionIntervalTicks === 0) stepSim(sim, decideAi(sim, ai));
      else stepSim(sim, []);
      boats = Array.from(query(sim.world, [UnitRef])).filter((e) => Owner.playerId[e] === 1 && sim.unitStats(e).id === "fishing_boat").length;
      if (boats >= 1) break;
    }
    const docks = Array.from(query(sim.world, [Building])).filter((e) => Owner.playerId[e] === 1 && sim.buildingIdOf(e) === "dock").length;
    expect(docks, "dock built").toBeGreaterThan(0);
    expect(boats, "fishing boat trained").toBeGreaterThan(0);
  });

  it("battle-order formation puts melee nearer the objective than archers", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Position } = sim.stores;
    const melee = Array.from({ length: 4 }, (_, i) => spawnUnitEntity(sim, 0, "infantry_base", (92 + i) * FP_ONE, 90 * FP_ONE));
    const ranged = Array.from({ length: 4 }, (_, i) => spawnUnitEntity(sim, 0, "archer_base", (92 + i) * FP_ONE, 91 * FP_ONE));
    stepSim(sim, [{ type: "move", playerId: 0, eids: [...melee, ...ranged], x: 93 * FP_ONE, y: 112 * FP_ONE, formation: 2 }]);
    run(sim, 15 * 30);
    const avgY = (es: number[]) => es.reduce((a, e) => a + Position.y[e]!, 0) / es.length;
    expect(avgY(melee), "melee front line closer to the target").toBeGreaterThan(avgY(ranged));
  });

  it("menders heal nearby wounded allies", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Health } = sim.stores;
    const mender = spawnUnitEntity(sim, 0, "mender", 95 * FP_ONE, 95 * FP_ONE);
    const hurt = spawnUnitEntity(sim, 0, "infantry_base", 96 * FP_ONE, 95 * FP_ONE);
    Health.hp100[hurt] = 1000;
    run(sim, 15 * 10);
    expect(Health.hp100[hurt]!, "mended").toBeGreaterThan(1000);
    void mender;
  });

  it("attack-move: units fight through and still arrive at the destination", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Position, UnitRef } = sim.stores;
    const sq = Array.from({ length: 4 }, (_, i) => spawnUnitEntity(sim, 0, "infantry_base", (92 + i) * FP_ONE, 90 * FP_ONE));
    const bait = spawnUnitEntity(sim, 1, "archer_base", 94 * FP_ONE, 100 * FP_ONE);
    stepSim(sim, [{ type: "attack_move", playerId: 0, eids: sq, x: 94 * FP_ONE, y: 112 * FP_ONE }]);
    run(sim, 15 * 60);
    expect(query(sim.world, [UnitRef]).includes(bait), "bait killed en route").toBe(false);
    for (const e of sq) {
      if (!query(sim.world, [UnitRef]).includes(e)) continue;
      expect(Math.hypot(Position.x[e]! - 94 * FP_ONE, Position.y[e]! - 112 * FP_ONE), "resumed to destination").toBeLessThan(8 * FP_ONE);
    }
  });

  it("gates toggle: closed blocks the tile, open frees it", () => {
    const sim = createSim(42, undefined, SKIRMISH);
    const g = sim.navGrid;
    let gx = 0, gy = 0;
    outer: for (let y = 20; y < 180; y++) for (let x = 20; x < 180; x++) {
      if (g.passable[y * g.size + x]) { gx = x; gy = y; break outer; }
    }
    const gate = spawnBuilding(sim, 0, "gate", gx, gy, true);
    expect(g.passable[gy * g.size + gx], "open by default").toBe(1);
    stepSim(sim, [{ type: "toggle_gate", playerId: 0, buildingEid: gate }]);
    expect(g.passable[gy * g.size + gx], "closed blocks").toBe(0);
    stepSim(sim, [{ type: "toggle_gate", playerId: 0, buildingEid: gate }]);
    expect(g.passable[gy * g.size + gx], "reopened").toBe(1);
  });

  it("chain-bolt: the stormserpent's hit arcs to a second enemy", () => {
    const sim = createSim(1, undefined, OPEN);
    const { Health } = sim.stores;
    const serpent = spawnUnitEntity(sim, 0, "stormserpent", 95 * FP_ONE, 95 * FP_ONE);
    const first = spawnUnitEntity(sim, 1, "infantry_base", 97 * FP_ONE, 95 * FP_ONE);
    const second = spawnUnitEntity(sim, 1, "infantry_base", 101 * FP_ONE, 95 * FP_ONE);
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [serpent], targetEid: first }]);
    run(sim, 30);
    expect(Health.hp100[second]!, "arc hit the second enemy").toBeLessThan(sim.unitStats(second).hp100);
  });

  it("three-player FFA: distinct bases; the game ends only when one throne stands", () => {
    const sim = createSim(42, undefined, { players: 3, skirmish: true });
    const { Building, Owner, Health } = sim.stores;
    const tcs = [0, 1, 2].map((pid) => getPlayer(sim, pid).townCenterEid);
    expect(new Set(tcs).size, "three town centers").toBe(3);
    Health.hp100[tcs[2]!] = 1;
    const raider = spawnUnitEntity(sim, 0, "infantry_base", sim.stores.Position.x[tcs[2]!]! + 2000, sim.stores.Position.y[tcs[2]!]!);
    stepSim(sim, [{ type: "attack", playerId: 0, eids: [raider], targetEid: tcs[2]! }]);
    run(sim, 15 * 20);
    expect(sim.winner, "two players remain — no winner yet").toBe(-1);
    Health.hp100[tcs[1]!] = 0;
    run(sim, 3);
    expect(sim.winner, "last throne wins").toBe(0);
    void Building;
    void Owner;
  });
});
