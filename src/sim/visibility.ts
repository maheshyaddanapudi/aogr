/**
 * Per-player visibility grids (fog of war): 0 unexplored, 1 explored,
 * 2 visible. DERIVED state — recomputed from unit/building positions each
 * tick, never hashed or serialized (a reload reconstructs it next tick;
 * explored memory is rebuilt conservatively from current LOS, which a save
 * may later persist as polish).
 */
import { query } from "bitecs";
import { getBuildingStatsByIndex } from "./buildingdata";
import { getPower } from "./powers";
// eslint-disable-next-line import/no-cycle -- runtime-safe
import { type Sim } from "./sim";

export const VIS_UNEXPLORED = 0;
export const VIS_EXPLORED = 1;
export const VIS_VISIBLE = 2;

export function visibilitySystem(sim: Sim): void {
  const size = sim.navGrid.size;
  if (sim.visibility.length !== sim.players.length) {
    sim.visibility.length = 0;
    for (let i = 0; i < sim.players.length; i++) sim.visibility.push(new Uint8Array(size * size));
  }
  const { Position, Owner, UnitRef, Building } = sim.stores;

  for (let pid = 0; pid < sim.players.length; pid++) {
    const grid = sim.visibility[pid]!;
    // decay: visible → explored
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === VIS_VISIBLE) grid[i] = VIS_EXPLORED;
    }
    // global reveal (clarity-style powers)
    const revealed = sim.activeEffects.some(
      (fx) => fx.playerId === pid && (getPower(fx.powerId).params as { revealsMap?: boolean }).revealsMap === true,
    );
    if (revealed) {
      grid.fill(VIS_VISIBLE);
      continue;
    }
    const stamp = (cx: number, cy: number, losTiles: number) => {
      const r = losTiles;
      const r2 = r * r;
      const x0 = Math.max(0, cx - r);
      const x1 = Math.min(size - 1, cx + r);
      const y0 = Math.max(0, cy - r);
      const y1 = Math.min(size - 1, cy + r);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= r2) grid[y * size + x] = VIS_VISIBLE;
        }
      }
    };
    for (const eid of query(sim.world, [Position, UnitRef])) {
      if (Owner.playerId[eid] !== pid) continue;
      stamp(Math.trunc(Position.x[eid]! / 1000), Math.trunc(Position.y[eid]! / 1000), Math.trunc(sim.unitStats(eid).losFp / 1000));
    }
    for (const eid of query(sim.world, [Position, Building])) {
      if (Owner.playerId[eid] !== pid) continue;
      stamp(
        Math.trunc(Position.x[eid]! / 1000),
        Math.trunc(Position.y[eid]! / 1000),
        Math.trunc(getBuildingStatsByIndex(Building.typeIndex[eid]!).losFp / 1000),
      );
    }
  }
}

export function getVisibility(sim: Sim, playerId: number, tileX: number, tileY: number): number {
  const grid = sim.visibility[playerId];
  if (!grid) return VIS_UNEXPLORED;
  const size = sim.navGrid.size;
  if (tileX < 0 || tileY < 0 || tileX >= size || tileY >= size) return VIS_UNEXPLORED;
  return grid[tileY * size + tileX]!;
}

export function isEnemyVisible(sim: Sim, viewerPid: number, eid: number): boolean {
  const { Position } = sim.stores;
  return (
    getVisibility(sim, viewerPid, Math.trunc(Position.x[eid]! / 1000), Math.trunc(Position.y[eid]! / 1000)) === VIS_VISIBLE
  );
}
