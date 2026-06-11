import { describe, expect, it } from "vitest";
import { Prng } from "../../src/sim/prng";

describe("Prng (seeded, deterministic, integer-only)", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = new Prng(12345);
    const b = new Prng(12345);
    for (let i = 0; i < 1000; i++) {
      expect(a.nextU32()).toBe(b.nextU32());
    }
  });

  it("produces different sequences for different seeds", () => {
    const a = new Prng(1);
    const b = new Prng(2);
    const seqA = Array.from({ length: 16 }, () => a.nextU32());
    const seqB = Array.from({ length: 16 }, () => b.nextU32());
    expect(seqA).not.toEqual(seqB);
  });

  it("emits only unsigned 32-bit integers", () => {
    const p = new Prng(99);
    for (let i = 0; i < 1000; i++) {
      const v = p.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("nextInt(max) stays in [0, max) and is deterministic", () => {
    const a = new Prng(7);
    const b = new Prng(7);
    for (let i = 0; i < 1000; i++) {
      const v = a.nextInt(13);
      expect(v).toBe(b.nextInt(13));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(13);
    }
  });

  it("state round-trips through getState/setState", () => {
    const a = new Prng(42);
    a.nextU32();
    a.nextU32();
    const saved = a.getState();
    const fork = new Prng(0);
    fork.setState(saved);
    for (let i = 0; i < 100; i++) {
      expect(fork.nextU32()).toBe(a.nextU32());
    }
  });
});
