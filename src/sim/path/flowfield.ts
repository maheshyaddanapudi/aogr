/**
 * Flow field: integer Dijkstra from a target tile over the nav grid
 * (octile costs 10/14, no corner cutting). One field serves an entire
 * group move — every unit descends the same gradient. Fully deterministic:
 * binary heap ties broken by push sequence.
 */
import { isPassable, type NavGrid } from "./grid";

export const UNREACHABLE = 0x7fffffff;

/** Neighbor order is part of the determinism contract — never reorder. */
const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 10],
  [-1, 0, 10],
  [0, 1, 10],
  [0, -1, 10],
  [1, 1, 14],
  [1, -1, 14],
  [-1, 1, 14],
  [-1, -1, 14],
];

export interface FlowField {
  size: number;
  targetX: number;
  targetY: number;
  /** Octile distance ×10 to target, UNREACHABLE where blocked/cut off. */
  dist: Int32Array;
  /** Index into NEIGHBORS (0–7) of the descent direction, 8 = none/at target. */
  dirs: Uint8Array;
}

/** Min-heap of (key, seq, tile) — seq makes equal keys pop in push order. */
class Heap {
  private k: number[] = [];
  private s: number[] = [];
  private v: number[] = [];
  private seq = 0;

  get size(): number {
    return this.k.length;
  }

  push(key: number, value: number): void {
    const { k, s, v } = this;
    let i = k.length;
    k.push(key);
    s.push(this.seq++);
    v.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! < k[i]! || (k[p]! === k[i]! && s[p]! < s[i]!)) break;
      [k[p], k[i]] = [k[i]!, k[p]!];
      [s[p], s[i]] = [s[i]!, s[p]!];
      [v[p], v[i]] = [v[i]!, v[p]!];
      i = p;
    }
  }

  pop(): number {
    const { k, s, v } = this;
    const top = v[0]!;
    const lastK = k.pop()!;
    const lastS = s.pop()!;
    const lastV = v.pop()!;
    if (k.length > 0) {
      k[0] = lastK;
      s[0] = lastS;
      v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && (k[l]! < k[m]! || (k[l]! === k[m]! && s[l]! < s[m]!))) m = l;
        if (r < k.length && (k[r]! < k[m]! || (k[r]! === k[m]! && s[r]! < s[m]!))) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [s[m], s[i]] = [s[i]!, s[m]!];
        [v[m], v[i]] = [v[i]!, v[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function computeFlowField(grid: NavGrid, targetX: number, targetY: number): FlowField {
  const size = grid.size;
  const dist = new Int32Array(size * size).fill(UNREACHABLE);
  const dirs = new Uint8Array(size * size).fill(8);
  const field: FlowField = { size, targetX, targetY, dist, dirs };
  if (!isPassable(grid, targetX, targetY)) return field;

  const heap = new Heap();
  dist[targetY * size + targetX] = 0;
  heap.push(0, targetY * size + targetX);

  while (heap.size > 0) {
    const tile = heap.pop();
    const tx = tile % size;
    const ty = Math.trunc(tile / size);
    const d = dist[tile]!;
    for (let n = 0; n < 8; n++) {
      const [dx, dy, cost] = NEIGHBORS[n]!;
      const nx = tx + dx;
      const ny = ty + dy;
      if (!isPassable(grid, nx, ny)) continue;
      // no corner cutting: diagonal needs both orthogonals open
      if (dx !== 0 && dy !== 0 && (!isPassable(grid, tx + dx, ty) || !isPassable(grid, tx, ty + dy))) continue;
      const ni = ny * size + nx;
      const nd = d + cost;
      if (nd < dist[ni]!) {
        dist[ni] = nd;
        heap.push(nd, ni);
      }
    }
  }

  // Precompute descent directions (lowest-dist neighbor, fixed tie-break order).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (dist[i]! >= UNREACHABLE || dist[i] === 0) continue;
      let best = 8;
      let bestD = dist[i]!;
      for (let n = 0; n < 8; n++) {
        const [dx, dy] = NEIGHBORS[n]!;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (dx !== 0 && dy !== 0 && (!isPassable(grid, x + dx, y) || !isPassable(grid, x, y + dy))) continue;
        const nd = dist[ny * size + nx]!;
        if (nd < bestD) {
          bestD = nd;
          best = n;
        }
      }
      dirs[i] = best;
    }
  }
  return field;
}

export function flowDirAt(field: FlowField, x: number, y: number): { dx: number; dy: number } {
  if (x < 0 || y < 0 || x >= field.size || y >= field.size) return { dx: 0, dy: 0 };
  const n = field.dirs[y * field.size + x]!;
  if (n >= 8) return { dx: 0, dy: 0 };
  const [dx, dy] = NEIGHBORS[n]!;
  return { dx, dy };
}

export function flowDistAt(field: FlowField, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= field.size || y >= field.size) return UNREACHABLE;
  return field.dist[y * field.size + x]!;
}
