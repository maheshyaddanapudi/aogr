/**
 * Navigation grid derived deterministically from terrain: a tile is passable
 * when all four corner vertices are above water and the tile isn't too steep.
 */
import { Checksum } from "../checksum";
import { heightAtVertex, type Terrain } from "../terrain";

const MAX_SLOPE_FP = 700; // max corner height delta (millitiles) before a tile blocks

export interface NavGrid {
  size: number;
  /** 1 = passable, 0 = blocked; row-major tiles. */
  passable: Uint8Array;
  checksum: number;
}

export function buildNavGrid(terrain: Terrain): NavGrid {
  const size = terrain.size;
  const passable = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h00 = heightAtVertex(terrain, x, y);
      const h10 = heightAtVertex(terrain, x + 1, y);
      const h01 = heightAtVertex(terrain, x, y + 1);
      const h11 = heightAtVertex(terrain, x + 1, y + 1);
      const min = Math.min(h00, h10, h01, h11);
      const max = Math.max(h00, h10, h01, h11);
      const dry = min > terrain.waterLevelFp;
      const walkable = max - min <= MAX_SLOPE_FP;
      passable[y * size + x] = dry && walkable ? 1 : 0;
    }
  }
  const c = new Checksum();
  c.addU32(size);
  for (let i = 0; i < passable.length; i++) c.addU32(passable[i]!);
  return { size, passable, checksum: c.digest() };
}

export function isPassable(grid: NavGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return false;
  return grid.passable[y * grid.size + x] === 1;
}
