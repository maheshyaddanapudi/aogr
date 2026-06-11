/**
 * Hierarchical pathfinding skeleton: the map divides into SECTOR_SIZE² sectors;
 * portals are connected open spans on sector borders. A* over the portal graph
 * answers long-range reachability and yields a sector corridor (the scaling
 * seam for maps where whole-grid flow fields would be too expensive).
 * Sectors are flood-filled into regions so disconnected pockets don't connect.
 */
import { Checksum } from "../checksum";
import { isPassable, type NavGrid } from "./grid";

export const SECTOR_SIZE = 10;

export interface Portal {
  /** tile coords of the span center on the border */
  x: number;
  y: number;
  sectorA: number;
  sectorB: number;
  regionA: number;
  regionB: number;
}

export interface PortalGraph {
  sectorsPerSide: number;
  portals: Portal[];
  /** adjacency: portal index -> [neighbor portal index, cost ×10][] */
  edges: Array<Array<[number, number]>>;
  /** per-tile region label (sector-local flood fill), -1 where blocked */
  regions: Int32Array;
  checksum: number;
}

function sectorOf(grid: NavGrid, x: number, y: number, sectorsPerSide: number): number {
  return Math.trunc(y / SECTOR_SIZE) * sectorsPerSide + Math.trunc(x / SECTOR_SIZE);
}

export function buildPortalGraph(grid: NavGrid): PortalGraph {
  const size = grid.size;
  const sectorsPerSide = Math.ceil(size / SECTOR_SIZE);
  const regions = new Int32Array(size * size).fill(-1);

  // Sector-local flood fill: regions are globally unique labels.
  let nextRegion = 0;
  const stack: number[] = [];
  for (let sy = 0; sy < sectorsPerSide; sy++) {
    for (let sx = 0; sx < sectorsPerSide; sx++) {
      const x0 = sx * SECTOR_SIZE;
      const y0 = sy * SECTOR_SIZE;
      const x1 = Math.min(x0 + SECTOR_SIZE, size);
      const y1 = Math.min(y0 + SECTOR_SIZE, size);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (!isPassable(grid, x, y) || regions[y * size + x]! >= 0) continue;
          const label = nextRegion++;
          stack.push(y * size + x);
          regions[y * size + x] = label;
          while (stack.length) {
            const t = stack.pop()!;
            const tx = t % size;
            const ty = Math.trunc(t / size);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const nx = tx + dx;
              const ny = ty + dy;
              if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
              if (!isPassable(grid, nx, ny) || regions[ny * size + nx]! >= 0) continue;
              regions[ny * size + nx] = label;
              stack.push(ny * size + nx);
            }
          }
        }
      }
    }
  }

  // Portals: maximal open spans along each sector border, split per sector
  // segment so every portal belongs to exactly one sector pair.
  const portals: Portal[] = [];
  const addSpanPortals = (horizontal: boolean) => {
    const borders = sectorsPerSide - 1;
    for (let b = 0; b < borders; b++) {
      const edge = (b + 1) * SECTOR_SIZE; // first tile of the far sector
      if (edge >= size) continue;
      for (let seg = 0; seg < sectorsPerSide; seg++) {
        const t0 = seg * SECTOR_SIZE;
        const t1 = Math.min(t0 + SECTOR_SIZE, size);
        let spanStart = -1;
        for (let t = t0; t <= t1; t++) {
          const ax = horizontal ? t : edge - 1;
          const ay = horizontal ? edge - 1 : t;
          const bx = horizontal ? t : edge;
          const by = horizontal ? edge : t;
          const open = t < t1 && isPassable(grid, ax, ay) && isPassable(grid, bx, by);
          if (open && spanStart < 0) spanStart = t;
          if (!open && spanStart >= 0) {
            const mid = spanStart + ((t - 1 - spanStart) >> 1);
            const px = horizontal ? mid : edge - 1;
            const py = horizontal ? edge - 1 : mid;
            const qx = horizontal ? mid : edge;
            const qy = horizontal ? edge : mid;
            portals.push({
              x: px,
              y: py,
              sectorA: sectorOf(grid, px, py, sectorsPerSide),
              sectorB: sectorOf(grid, qx, qy, sectorsPerSide),
              regionA: regions[py * size + px]!,
              regionB: regions[qy * size + qx]!,
            });
            spanStart = -1;
          }
        }
      }
    }
  };
  addSpanPortals(true);
  addSpanPortals(false);

  // Edges: portals sharing a region connect (octile estimate); crossing a portal costs 10.
  const edges: Array<Array<[number, number]>> = portals.map(() => []);
  const byRegion = new Map<number, number[]>();
  portals.forEach((p, i) => {
    for (const r of [p.regionA, p.regionB]) {
      if (!byRegion.has(r)) byRegion.set(r, []);
      byRegion.get(r)!.push(i);
    }
  });
  const sortedRegions = Array.from(byRegion.keys()).sort((a, b) => a - b);
  for (const r of sortedRegions) {
    const list = byRegion.get(r)!;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const pa = portals[list[a]!]!;
        const pb = portals[list[b]!]!;
        const dx = Math.abs(pa.x - pb.x);
        const dy = Math.abs(pa.y - pb.y);
        const cost = 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy);
        edges[list[a]!]!.push([list[b]!, cost]);
        edges[list[b]!]!.push([list[a]!, cost]);
      }
    }
  }

  const c = new Checksum();
  c.addU32(portals.length);
  for (const p of portals) {
    c.addU32(p.x);
    c.addU32(p.y);
    c.addI32(p.regionA);
    c.addI32(p.regionB);
  }
  return { sectorsPerSide, portals, edges, regions, checksum: c.digest() };
}

/**
 * A* over the portal graph. Returns the sector-id corridor from start to goal,
 * or null when unreachable. Start/goal connect to portals touching their region.
 */
export function findSectorPath(
  graph: PortalGraph,
  grid: NavGrid,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
): number[] | null {
  const size = grid.size;
  if (!isPassable(grid, startX, startY) || !isPassable(grid, goalX, goalY)) return null;
  const startRegion = graph.regions[startY * size + startX]!;
  const goalRegion = graph.regions[goalY * size + goalX]!;
  const startSector = sectorOf(grid, startX, startY, graph.sectorsPerSide);
  const goalSector = sectorOf(grid, goalX, goalY, graph.sectorsPerSide);
  if (startRegion === goalRegion) return [startSector, goalSector];

  const touches = (p: Portal, region: number) => p.regionA === region || p.regionB === region;
  const open: Array<{ f: number; g: number; i: number; seq: number }> = [];
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  let seq = 0;
  const h = (p: Portal) => 10 * Math.max(Math.abs(p.x - goalX), Math.abs(p.y - goalY));

  graph.portals.forEach((p, i) => {
    if (touches(p, startRegion)) {
      const g = 10 * Math.max(Math.abs(p.x - startX), Math.abs(p.y - startY));
      gScore.set(i, g);
      open.push({ f: g + h(p), g, i, seq: seq++ });
    }
  });

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f || a.seq - b.seq);
    const cur = open.shift()!;
    if (cur.g > (gScore.get(cur.i) ?? Infinity)) continue;
    const p = graph.portals[cur.i]!;
    if (touches(p, goalRegion)) {
      // reconstruct sector corridor
      const sectors: number[] = [goalSector];
      let at: number | undefined = cur.i;
      while (at !== undefined) {
        const portal = graph.portals[at]!;
        sectors.push(portal.sectorB, portal.sectorA);
        at = cameFrom.get(at);
      }
      sectors.push(startSector);
      sectors.reverse();
      return sectors.filter((s, idx) => idx === 0 || s !== sectors[idx - 1]);
    }
    for (const [ni, cost] of graph.edges[cur.i]!) {
      const ng = cur.g + cost;
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        cameFrom.set(ni, cur.i);
        open.push({ f: ng + h(graph.portals[ni]!), g: ng, i: ni, seq: seq++ });
      }
    }
  }
  return null;
}
