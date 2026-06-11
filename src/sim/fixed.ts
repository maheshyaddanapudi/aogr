/**
 * Fixed-point integer math for sim state (KICKOFF.md §3.3 — no floats in sim).
 * Positions are stored in millitiles: 1 tile = 1000 fixed-point units.
 * HP and damage are stored ×100. All ops truncate toward zero so results
 * are bit-identical on every platform.
 */
export const FP_ONE = 1000;

/** Whole tiles → millitiles. */
export function fpFromInt(tiles: number): number {
  return tiles * FP_ONE;
}

/** Millitiles → whole tiles, truncating toward zero. */
export function fpToIntTrunc(fp: number): number {
  return Math.trunc(fp / FP_ONE);
}

/** Fixed-point multiply, truncating toward zero. */
export function fpMul(a: number, b: number): number {
  return Math.trunc((a * b) / FP_ONE);
}

/** Fixed-point divide, truncating toward zero. */
export function fpDiv(a: number, b: number): number {
  return Math.trunc((a * FP_ONE) / b);
}
