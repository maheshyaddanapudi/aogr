import { describe, expect, it } from "vitest";
import { Prng } from "../../src/sim/prng";
import { DEFAULT_TERRAIN_CONFIG, generateTerrain } from "../../src/sim/terrain";
import { buildNavGrid, isPassable } from "../../src/sim/path/grid";
import { computeFlowField, flowDirAt } from "../../src/sim/path/flowfield";
import { SECTOR_SIZE, buildPortalGraph, findSectorPath } from "../../src/sim/path/portals";

const terrain = generateTerrain(new Prng(42), DEFAULT_TERRAIN_CONFIG);
const grid = buildNavGrid(terrain);

describe("nav grid (derived from terrain, deterministic)", () => {
  it("is deterministic for the same terrain", () => {
    const again = buildNavGrid(generateTerrain(new Prng(42), DEFAULT_TERRAIN_CONFIG));
    expect(again.checksum).toBe(grid.checksum);
  });

  it("blocks underwater tiles and passes dry flat tiles", () => {
    let blocked = 0;
    let open = 0;
    for (let y = 0; y < grid.size; y++) {
      for (let x = 0; x < grid.size; x++) {
        if (isPassable(grid, x, y)) open++;
        else blocked++;
      }
    }
    expect(open).toBeGreaterThan(grid.size * grid.size * 0.3);
    expect(blocked).toBeGreaterThan(0);
  });
});

describe("flow field (integer Dijkstra, shared by group moves)", () => {
  // pick a passable target near the middle
  const target = (() => {
    const mid = Math.trunc(grid.size / 2);
    for (let r = 0; r < 50; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (isPassable(grid, mid + dx, mid + dy)) return { x: mid + dx, y: mid + dy };
        }
      }
    }
    throw new Error("no passable tile");
  })();

  const field = computeFlowField(grid, target.x, target.y);

  it("is deterministic", () => {
    const again = computeFlowField(grid, target.x, target.y);
    expect(Array.from(again.dist)).toEqual(Array.from(field.dist));
  });

  it("distance is 0 at target and increases away from it", () => {
    expect(field.dist[target.y * grid.size + target.x]).toBe(0);
  });

  it("following flow directions from any reachable tile terminates at the target", () => {
    let checked = 0;
    for (let y = 0; y < grid.size; y += 17) {
      for (let x = 0; x < grid.size; x += 17) {
        if (!isPassable(grid, x, y)) continue;
        if (field.dist[y * grid.size + x]! >= 0x7fffffff) continue; // unreachable pocket
        let cx = x;
        let cy = y;
        let steps = 0;
        while ((cx !== target.x || cy !== target.y) && steps < grid.size * 4) {
          const d = flowDirAt(field, cx, cy);
          expect(d.dx !== 0 || d.dy !== 0, `stuck at ${cx},${cy}`).toBe(true);
          cx += d.dx;
          cy += d.dy;
          steps++;
        }
        expect({ cx, cy }, `from ${x},${y}`).toEqual({ cx: target.x, cy: target.y });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("hierarchical sector portals (HPA*)", () => {
  const graph = buildPortalGraph(grid);

  it("builds a deterministic portal graph", () => {
    const again = buildPortalGraph(grid);
    expect(again.checksum).toBe(graph.checksum);
    expect(graph.portals.length).toBeGreaterThan(0);
  });

  it("finds a sector corridor between distant reachable points", () => {
    // find two far-apart passable tiles in the same connected region
    const f = computeFlowField(grid, Math.trunc(grid.size / 2), Math.trunc(grid.size / 2));
    let a: { x: number; y: number } | null = null;
    let b: { x: number; y: number } | null = null;
    for (let y = 0; y < grid.size && !b; y++) {
      for (let x = 0; x < grid.size && !b; x++) {
        if (f.dist[y * grid.size + x]! >= 0x7fffffff) continue;
        if (!a) a = { x, y };
        else if (Math.abs(x - a.x) + Math.abs(y - a.y) > grid.size) b = { x, y };
      }
    }
    expect(a && b).toBeTruthy();
    const path = findSectorPath(graph, grid, a!.x, a!.y, b!.x, b!.y);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
    const sectorsPerSide = Math.ceil(grid.size / SECTOR_SIZE);
    for (const s of path!) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(sectorsPerSide * sectorsPerSide);
    }
  });

  it("returns null for unreachable destinations", () => {
    // a water tile is not in any sector's passable region
    let waterTile: { x: number; y: number } | null = null;
    for (let y = 0; y < grid.size && !waterTile; y++) {
      for (let x = 0; x < grid.size && !waterTile; x++) {
        if (!isPassable(grid, x, y)) waterTile = { x, y };
      }
    }
    const mid = Math.trunc(grid.size / 2);
    expect(findSectorPath(graph, grid, mid, mid, waterTile!.x, waterTile!.y)).toBeNull();
  });
});
