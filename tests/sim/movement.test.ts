import { describe, expect, it } from "vitest";
import { createSim, deserializeSim, serializeSim, simChecksum, stepSim } from "../../src/sim/sim";
import type { Command } from "../../src/sim/commands";
import { FP_ONE } from "../../src/sim/fixed";
import { isPassable } from "../../src/sim/path/grid";
import { query } from "bitecs";

/** Find a passable tile near (px, py) on the sim's nav grid. */
function passableNear(sim: ReturnType<typeof createSim>, px: number, py: number): { x: number; y: number } {
  for (let r = 0; r < 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (x < 1 || y < 1 || x >= sim.navGrid.size - 1 || y >= sim.navGrid.size - 1) continue;
        if (isPassable(sim.navGrid, x, y)) return { x, y };
      }
    }
  }
  throw new Error("no passable tile near " + px + "," + py);
}

function spawnArmy(sim: ReturnType<typeof createSim>, count: number, cx: number, cy: number): Command[] {
  const cmds: Command[] = [];
  const side = Math.ceil(Math.sqrt(count));
  let placed = 0;
  for (let gy = 0; gy < side && placed < count; gy++) {
    for (let gx = 0; gx < side && placed < count; gx++) {
      const t = passableNear(sim, cx + gx * 2, cy + gy * 2);
      cmds.push({ type: "spawn_unit", playerId: 0, unit: "infantry_base", x: t.x * FP_ONE + 500, y: t.y * FP_ONE + 500 });
      placed++;
    }
  }
  return cmds;
}

describe("PHASE 2 GATE — 200 units to a shared destination", () => {
  it("all 200 arrive near the target with no overlapping pairs, deterministically", () => {
    const run = () => {
      const sim = createSim(777);
      const start = passableNear(sim, 50, 50);
      const dest = passableNear(sim, 150, 150);
      stepSim(sim, spawnArmy(sim, 200, start.x, start.y));
      const { Position } = sim.stores;
      const eids = Array.from(query(sim.world, [Position]));
      expect(eids.length).toBe(200);
      stepSim(sim, [{ type: "move", playerId: 0, eids, x: dest.x * FP_ONE, y: dest.y * FP_ONE }]);
      for (let t = 0; t < 1800; t++) stepSim(sim, []); // 2 minutes of sim time
      return { sim, eids, dest };
    };

    const { sim, eids, dest } = run();
    const { Position, UnitRef } = sim.stores;

    // 1) arrival: every unit within 12 tiles of the shared destination (200 units pack a big blob)
    let worst = 0;
    for (const eid of eids) {
      const dx = Position.x[eid]! - dest.x * FP_ONE;
      const dy = Position.y[eid]! - dest.y * FP_ONE;
      const d = Math.sqrt(dx * dx + dy * dy) / FP_ONE;
      worst = Math.max(worst, d);
    }
    expect(worst, "furthest unit from target (tiles)").toBeLessThan(12);

    // 2) no overlap: pairwise distance ≥ 70% of summed radii after settling
    const r = sim.unitRadiusFp(eids[0]!);
    let overlaps = 0;
    for (let i = 0; i < eids.length; i++) {
      for (let j = i + 1; j < eids.length; j++) {
        const dx = Position.x[eids[i]!]! - Position.x[eids[j]!]!;
        const dy = Position.y[eids[i]!]! - Position.y[eids[j]!]!;
        const minD = (2 * r * 7) / 10;
        if (dx * dx + dy * dy < minD * minD) overlaps++;
      }
    }
    expect(overlaps, "overlapping pairs").toBe(0);
    expect(UnitRef).toBeDefined();

    // 3) determinism: the whole 200-unit march reproduces checksum-identically
    const second = run();
    expect(simChecksum(second.sim)).toBe(simChecksum(sim));
  }, 120_000);

  it("units never end up on impassable tiles", () => {
    const sim = createSim(31337);
    const start = passableNear(sim, 60, 60);
    const dest = passableNear(sim, 140, 80);
    stepSim(sim, spawnArmy(sim, 50, start.x, start.y));
    const eids = Array.from(query(sim.world, [sim.stores.Position]));
    stepSim(sim, [{ type: "move", playerId: 0, eids, x: dest.x * FP_ONE, y: dest.y * FP_ONE }]);
    for (let t = 0; t < 900; t++) stepSim(sim, []);
    const { Position } = sim.stores;
    for (const eid of eids) {
      const tx = Math.trunc(Position.x[eid]! / FP_ONE);
      const ty = Math.trunc(Position.y[eid]! / FP_ONE);
      expect(isPassable(sim.navGrid, tx, ty), `unit ${eid} at ${tx},${ty}`).toBe(true);
    }
  }, 60_000);

  it("a moving 200-unit sim stays serializable in lockstep", () => {
    const sim = createSim(99);
    const start = passableNear(sim, 50, 50);
    const dest = passableNear(sim, 150, 150);
    stepSim(sim, spawnArmy(sim, 200, start.x, start.y));
    const eids = Array.from(query(sim.world, [sim.stores.Position]));
    stepSim(sim, [{ type: "move", playerId: 0, eids, x: dest.x * FP_ONE, y: dest.y * FP_ONE }]);
    for (let t = 0; t < 300; t++) stepSim(sim, []);
    const restored = deserializeSim(serializeSim(sim));
    expect(simChecksum(restored)).toBe(simChecksum(sim));
    for (let t = 0; t < 300; t++) {
      stepSim(sim, []);
      stepSim(restored, []);
    }
    expect(simChecksum(restored)).toBe(simChecksum(sim));
  }, 60_000);

  it("tick budget: 200 moving units step in well under the 66ms tick budget", () => {
    const sim = createSim(2026);
    const start = passableNear(sim, 50, 50);
    const dest = passableNear(sim, 150, 150);
    stepSim(sim, spawnArmy(sim, 200, start.x, start.y));
    const eids = Array.from(query(sim.world, [sim.stores.Position]));
    stepSim(sim, [{ type: "move", playerId: 0, eids, x: dest.x * FP_ONE, y: dest.y * FP_ONE }]);
    for (let t = 0; t < 100; t++) stepSim(sim, []); // warmup
    const t0 = performance.now();
    for (let t = 0; t < 300; t++) stepSim(sim, []);
    const msPerTick = (performance.now() - t0) / 300;
    expect(msPerTick, "ms per tick").toBeLessThan(20);
  }, 60_000);
});
