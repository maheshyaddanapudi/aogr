import { describe, expect, it } from "vitest";
import { Checksum } from "../../src/sim/checksum";

describe("Checksum (FNV-1a over 32-bit lanes)", () => {
  it("is stable for the same input stream", () => {
    const a = new Checksum();
    const b = new Checksum();
    for (const v of [0, 1, 2, 0xffffffff, 12345, -7]) {
      a.addI32(v);
      b.addI32(v);
    }
    expect(a.digest()).toBe(b.digest());
  });

  it("differs when any value differs", () => {
    const a = new Checksum();
    const b = new Checksum();
    a.addI32(1);
    a.addI32(2);
    b.addI32(1);
    b.addI32(3);
    expect(a.digest()).not.toBe(b.digest());
  });

  it("is order-sensitive", () => {
    const a = new Checksum();
    const b = new Checksum();
    a.addI32(1);
    a.addI32(2);
    b.addI32(2);
    b.addI32(1);
    expect(a.digest()).not.toBe(b.digest());
  });

  it("digest is an unsigned 32-bit integer", () => {
    const c = new Checksum();
    c.addI32(-123456);
    const d = c.digest();
    expect(Number.isInteger(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(0xffffffff);
  });
});
