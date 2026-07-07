/** DISCOVERY PROBES (round 7). it.fails = confirmed, cataloged, awaiting fix —
 * flip to it() when fixing so the suite enforces the repair. */
import { describe, expect, it } from "vitest";
import { query, entityExists } from "bitecs";
import { createSim, spawnUnitEntity, stepSim, serializeSim, deserializeSim, simChecksum, nearestWaterTile, isWaterTile, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding, spawnResourceNode } from "../../src/sim/economy";
import { FP_ONE } from "../../src/sim/fixed";

const SKIRMISH = { players: 2, skirmish: true };
const run = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) stepSim(sim, []); };

describe("DISCOVERY", () => {
  it("P1: kitchen-sink save/load — every new lane loaded at once stays lockstep", () => {
    const sim = createSim(777, undefined, SKIRMISH);
    const { Position, UnitRef, Owner, GatherTask } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const px = Position.x[tc]!, py = Position.y[tc]!;
    // garrison + patrol + attack-move + stun + relic + caravan + herd + drift all live at once
    const inf = spawnUnitEntity(sim, 0, "infantry_base", px + 2000, py);
    const pat = spawnUnitEntity(sim, 0, "infantry_base", px + 3000, py);
    const am = spawnUnitEntity(sim, 0, "infantry_base", px + 4000, py);
    const naga = spawnUnitEntity(sim, 1, "stonegaze_naga", px + 6000, py);
    const hero = spawnUnitEntity(sim, 0, "sky_herald", px - 3000, py);
    const market = spawnBuilding(sim, 0, "market", Math.trunc(px / 1000) + 10, Math.trunc(py / 1000), true);
    const caravan = spawnUnitEntity(sim, 0, "caravan", Position.x[market]!, Position.y[market]! + 1500);
    const relic = spawnResourceNode(sim, "relic", Math.trunc(px / 1000) - 4, Math.trunc(py / 1000), 1);
    getPlayer(sim, 0).woodMilli = 3_000_000;
    stepSim(sim, [
      { type: "garrison", playerId: 0, eids: [inf], buildingEid: tc },
      { type: "patrol", playerId: 0, eids: [pat], x: px + 9000, y: py },
      { type: "attack_move", playerId: 0, eids: [am], x: px + 12000, y: py },
      { type: "trade_route", playerId: 0, eids: [caravan], buildingEid: market },
      { type: "trade", playerId: 0, sell: "wood", buy: "gold", amountMilli: 200_000 },
      { type: "move", playerId: 0, eids: [hero], x: Position.x[relic]!, y: Position.y[relic]! },
    ]);
    run(sim, 120);
    const copy = deserializeSim(serializeSim(sim));
    expect(simChecksum(copy), "checksum equal after full-state restore").toBe(simChecksum(sim));
    run(sim, 150); run(copy, 150);
    expect(simChecksum(copy), "lockstep after 150 more ticks").toBe(simChecksum(sim));
    void naga;
  });

  it("P2: townCenterEid must not dangle after the TC dies (AI targets it)", () => {
    const sim = createSim(778, undefined, SKIRMISH);
    const { Health } = sim.stores;
    const p1 = getPlayer(sim, 1);
    const tc1 = p1.townCenterEid;
    Health.hp100[tc1] = 0;
    run(sim, 3);
    // either reset to -1, or repointed to another owned TC — never a dead eid
    if (p1.townCenterEid >= 0) {
      expect(entityExists(sim.world, p1.townCenterEid), "townCenterEid points at a live entity").toBe(true);
    }
  });

  it.fails("KNOWN BUG P3: a herd that defects mid-gather should stop feeding the old owner", () => {
    const sim = createSim(779, undefined, SKIRMISH);
    const { ResourceNode, UnitRef, Owner, GatherTask, Position } = sim.stores;
    const herd = Array.from(query(sim.world, [ResourceNode])).filter((e) => ResourceNode.resType[e] === 5)[0]!;
    const vill = Array.from(query(sim.world, [UnitRef, GatherTask])).filter((e) => Owner.playerId[e] === 0)[0]!;
    stepSim(sim, [{ type: "gather", playerId: 0, eids: [vill], nodeEid: herd }]);
    run(sim, 15 * 8); // walk + start gathering
    // enemy shepherd claims it
    spawnUnitEntity(sim, 1, "villager", Position.x[herd]! + 600, Position.y[herd]!);
    run(sim, 15 * 4);
    expect(sim.herdOwner.get(herd), "herd defected").toBe(1);
    const foodBefore = getPlayer(sim, 0).foodMilli;
    run(sim, 15 * 20);
    expect(getPlayer(sim, 0).foodMilli, "old owner no longer milks the defected herd").toBe(foodBefore);
  });

  it.fails("KNOWN BUG P4: a boat ordered to OPEN WATER should go there — not to the nearest beach", () => {
    const sim = createSim(1101, undefined, SKIRMISH);
    const { Position } = sim.stores;
    const w = nearestWaterTile(sim, 100, 100)!;
    const boat = spawnUnitEntity(sim, 0, "fishing_boat", w.x * 1000 + 500, w.y * 1000 + 500);
    // find deep open water far from the spawn
    let deep: { x: number; y: number } | null = null;
    for (let r = 12; r < 80 && !deep; r++) {
      for (let a = 0; a < 16; a++) {
        const x = w.x + Math.trunc(Math.cos((a / 16) * 6.283) * r);
        const y = w.y + Math.trunc(Math.sin((a / 16) * 6.283) * r);
        let wet = true;
        for (let dy = -2; dy <= 2 && wet; dy++) for (let dx = -2; dx <= 2; dx++) if (!isWaterTile(sim, x + dx, y + dy)) { wet = false; break; }
        if (wet) { deep = { x, y }; break; }
      }
    }
    expect(deep, "found open water").not.toBeNull();
    stepSim(sim, [{ type: "move", playerId: 0, eids: [boat], x: deep!.x * FP_ONE, y: deep!.y * FP_ONE }]);
    run(sim, 15 * 60);
    const d = Math.hypot(Position.x[boat]! - deep!.x * FP_ONE, Position.y[boat]! - deep!.y * FP_ONE);
    expect(d, "boat reached the clicked open-water point (not a beach)").toBeLessThan(4 * FP_ONE);
  });
});
