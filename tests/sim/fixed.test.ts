import { describe, expect, it } from "vitest";
import { FP_ONE, fpDiv, fpFromInt, fpMul, fpToIntTrunc } from "../../src/sim/fixed";

describe("fixed-point math (millitile scale, integer-only)", () => {
  it("FP_ONE is 1000 (millitiles per tile)", () => {
    expect(FP_ONE).toBe(1000);
  });

  it("converts whole tiles to fixed-point and back", () => {
    expect(fpFromInt(3)).toBe(3000);
    expect(fpToIntTrunc(3999)).toBe(3);
    expect(fpToIntTrunc(-1500)).toBe(-1);
  });

  it("multiplies with truncation toward zero", () => {
    expect(fpMul(fpFromInt(2), fpFromInt(3))).toBe(fpFromInt(6));
    expect(fpMul(1500, 1500)).toBe(2250); // 1.5 * 1.5 = 2.25
    expect(fpMul(-1500, 1500)).toBe(-2250);
  });

  it("divides with truncation toward zero", () => {
    expect(fpDiv(fpFromInt(6), fpFromInt(3))).toBe(fpFromInt(2));
    expect(fpDiv(1000, 3000)).toBe(333); // 1/3 → 0.333
    expect(fpDiv(-1000, 3000)).toBe(-333);
  });

  it("never produces non-integers", () => {
    const samples = [1, 7, 333, 999, 1001, 123456, -54321];
    for (const a of samples) {
      for (const b of samples) {
        expect(Number.isInteger(fpMul(a, b))).toBe(true);
        expect(Number.isInteger(fpDiv(a, b))).toBe(true);
      }
    }
  });
});
