/** MATRIX FINDINGS — bugs captured by actually playing the game (round 6). */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, stepSim, isWaterTile, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnBuilding } from "../../src/sim/economy";

const SKIRMISH = { players: 2, skirmish: true };
const run = (sim: Sim, n: number) => {
  for (let i = 0; i < n; i++) stepSim(sim, []);
};

describe("MATRIX FINDINGS", () => {
  it("partial terrain configs (map types) merge over defaults — inland/archipelago must not crash", () => {
    // cell 1 crashed boot: { waterLevelFp } alone left octaves undefined
    const inland = createSim(1202, { waterLevelFp: -3000 }, SKIRMISH);
    expect(inland.players.length).toBe(2);
    const archi = createSim(1404, { waterLevelFp: 200 }, SKIRMISH);
    expect(archi.players.length).toBe(2);
    run(inland, 30);
    run(archi, 30);
  });

  it("auto-sited docks (-1,-1) land on the coast and their boats launch onto water", () => {
    const sim = createSim(1101, undefined, SKIRMISH); // the exact map cell 0 played
    const { UnitRef, Owner, GatherTask, Position, Building } = sim.stores;
    const vill = Array.from(query(sim.world, [UnitRef, GatherTask])).filter((e) => Owner.playerId[e] === 0)[0]!;
    const p = getPlayer(sim, 0);
    p.woodMilli = 2_000_000;
    stepSim(sim, [{ type: "build", playerId: 0, eids: [vill], building: "dock", x: -1, y: -1 }]);
    run(sim, 15 * 90);
    const dock = Array.from(query(sim.world, [Building])).find((e) => Owner.playerId[e] === 0 && sim.buildingIdOf(e) === "dock");
    expect(dock, "dock built").toBeDefined();
    const dtx = Building.tileX[dock!]!;
    const dty = Building.tileY[dock!]!;
    let coastal = false;
    for (let dy = -2; dy <= 4 && !coastal; dy++) for (let dx = -2; dx <= 4; dx++) {
      if (isWaterTile(sim, dtx + dx, dty + dy)) { coastal = true; break; }
    }
    expect(coastal, "auto-sited dock touches the coast").toBe(true);
    stepSim(sim, [{ type: "train", playerId: 0, buildingEid: dock!, unit: "fishing_boat" }]);
    run(sim, 15 * 25);
    const boat = Array.from(query(sim.world, [UnitRef])).find((e) => Owner.playerId[e] === 0 && sim.unitStats(e).id === "fishing_boat");
    expect(boat, "boat trained").toBeDefined();
    expect(
      isWaterTile(sim, Math.trunc(Position.x[boat!]! / 1000), Math.trunc(Position.y[boat!]! / 1000)),
      "boat floats — never stands on grass",
    ).toBe(true);
  });

  it("a landlocked dock refuses to launch ships and refunds the cost", () => {
    const sim = createSim(1202, { waterLevelFp: -3000 }, SKIRMISH); // no water anywhere
    const { UnitRef, Owner, Position } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const dock = spawnBuilding(sim, 0, "dock", Math.trunc(Position.x[tc]! / 1000) + 6, Math.trunc(Position.y[tc]! / 1000), true);
    const wood0 = getPlayer(sim, 0).woodMilli;
    stepSim(sim, [{ type: "train", playerId: 0, buildingEid: dock, unit: "fishing_boat" }]);
    run(sim, 15 * 25);
    const boats = Array.from(query(sim.world, [UnitRef])).filter((e) => Owner.playerId[e] === 0 && sim.unitStats(e).id === "fishing_boat");
    expect(boats, "no beached boat").toHaveLength(0);
    expect(getPlayer(sim, 0).woodMilli, "cost refunded").toBe(wood0);
  });
});
