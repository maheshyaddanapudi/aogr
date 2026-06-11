/**
 * Deterministic terrain: layered integer value-noise over a vertex lattice.
 * Heights are fixed-point (millitiles of elevation); generation consumes a
 * dedicated PRNG stream so the gameplay stream stays independent.
 */
import { Checksum } from "./checksum";
import { FP_ONE } from "./fixed";
import type { Prng } from "./prng";

export interface TerrainOctave {
  /** lattice cell size in tiles */
  cell: number;
  /** amplitude in fixed-point height units */
  ampFp: number;
}

export interface TerrainConfig {
  size: number;
  waterLevelFp: number;
  octaves: TerrainOctave[];
  /** 0..FP_ONE: how strongly heights sink toward the map border (island look). */
  edgeFalloffFp: number;
}

export const DEFAULT_TERRAIN_CONFIG: TerrainConfig = {
  size: 200,
  waterLevelFp: -600,
  octaves: [
    { cell: 50, ampFp: 2200 },
    { cell: 25, ampFp: 900 },
    { cell: 10, ampFp: 400 },
    { cell: 5, ampFp: 150 },
  ],
  edgeFalloffFp: 800,
};

export interface Terrain {
  size: number;
  waterLevelFp: number;
  /** (size+1)² vertex heights, row-major, fixed-point. */
  heights: Int32Array;
  checksum: number;
  config: TerrainConfig;
}

/** Integer lerp, truncating toward zero. */
function ilerp(a: number, b: number, tFp: number): number {
  return a + Math.trunc(((b - a) * tFp) / FP_ONE);
}

/** Integer smoothstep on a fixed-point t in [0, FP_ONE]. */
function ismooth(tFp: number): number {
  return Math.trunc((tFp * tFp * (3 * FP_ONE - 2 * tFp)) / (FP_ONE * FP_ONE));
}

export function generateTerrain(prng: Prng, config: TerrainConfig): Terrain {
  const { size, waterLevelFp, octaves } = config;
  const verts = size + 1;
  const heights = new Int32Array(verts * verts);

  for (const { cell, ampFp } of octaves) {
    const lat = Math.ceil(size / cell) + 2;
    const lattice = new Int32Array(lat * lat);
    for (let i = 0; i < lattice.length; i++) {
      lattice[i] = prng.nextInt(2 * ampFp + 1) - ampFp;
    }
    for (let y = 0; y < verts; y++) {
      const gy = Math.trunc(y / cell);
      const ty = ismooth(Math.trunc(((y % cell) * FP_ONE) / cell));
      for (let x = 0; x < verts; x++) {
        const gx = Math.trunc(x / cell);
        const tx = ismooth(Math.trunc(((x % cell) * FP_ONE) / cell));
        const i00 = lattice[gy * lat + gx]!;
        const i10 = lattice[gy * lat + gx + 1]!;
        const i01 = lattice[(gy + 1) * lat + gx]!;
        const i11 = lattice[(gy + 1) * lat + gx + 1]!;
        heights[y * verts + x] = heights[y * verts + x]! + ilerp(ilerp(i00, i10, tx), ilerp(i01, i11, tx), ty);
      }
    }
  }

  // Gentle continental lift keeps the interior mostly land.
  const liftFp = 400;
  for (let i = 0; i < heights.length; i++) heights[i] = heights[i]! + liftFp;

  // Island falloff: depress heights toward the border (integer ramp over the
  // outer 12% of the map) so coastlines form instead of cliffs at the void.
  if (config.edgeFalloffFp > 0) {
    const margin = Math.max(1, Math.trunc(size * 12 / 100));
    const dropFp = 2 * config.edgeFalloffFp;
    for (let y = 0; y < verts; y++) {
      for (let x = 0; x < verts; x++) {
        const d = Math.min(x, y, size - x, size - y);
        if (d < margin) {
          const tFp = Math.trunc(((margin - d) * FP_ONE) / margin);
          const sFp = ismooth(tFp);
          const i = y * verts + x;
          heights[i] = heights[i]! - Math.trunc((dropFp * sFp) / FP_ONE);
        }
      }
    }
  }

  const c = new Checksum();
  c.addU32(size);
  c.addI32(waterLevelFp);
  for (let i = 0; i < heights.length; i++) c.addI32(heights[i]!);

  return { size, waterLevelFp, heights, checksum: c.digest(), config };
}

/** Vertex height at integer vertex coords (clamped to the lattice). */
export function heightAtVertex(t: Terrain, vx: number, vy: number): number {
  const verts = t.size + 1;
  const x = Math.min(Math.max(vx, 0), t.size);
  const y = Math.min(Math.max(vy, 0), t.size);
  return t.heights[y * verts + x]!;
}
