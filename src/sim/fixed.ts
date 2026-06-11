/**
 * Fixed-point integer math for sim state (KICKOFF.md §3.3 — no floats in sim).
 * Positions are stored in millitiles: 1 tile = 1000 fixed-point units.
 * HP and damage are stored ×100. All ops truncate toward zero so results
 * are bit-identical on every platform.
 */
export const FP_ONE = 1000;

/** Sim runs at a fixed 15 Hz (lives here so leaf modules avoid import cycles). */
export const TICK_RATE = 15;

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

/**
 * Integer square root (floor), Newton's method. No bit-shifts: inputs can
 * exceed 32 bits (squared millitile distances), and >> truncates to int32.
 */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.trunc((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.trunc((x + Math.trunc(n / x)) / 2);
  }
  return x;
}
