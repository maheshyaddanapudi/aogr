import { describe, expect, it } from "vitest";
import { getUnitStats, listUnitIds } from "../../src/sim/unitdata";

describe("unit data loader (data/units.json → fixed-point sim stats)", () => {
  it("loads every unit with integer-only stats", () => {
    for (const id of listUnitIds()) {
      const s = getUnitStats(id);
      for (const [k, v] of Object.entries({
        hp100: s.hp100,
        speedFpPerTick: s.speedFpPerTick,
        radiusFp: s.radiusFp,
        pop: s.pop,
        trainTicks: s.trainTicks,
      })) {
        expect(Number.isInteger(v), `${id}.${k}`).toBe(true);
        expect(v, `${id}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("converts §7 anchors exactly", () => {
    const inf = getUnitStats("infantry_base");
    expect(inf.hp100).toBe(11500); // 115 HP ×100
    expect(inf.speedFpPerTick).toBe(280); // 4.2 tiles/s ÷ 15Hz = 280 millitiles/tick
    expect(inf.attack?.damage100).toBe(800); // 8 hack ×100
    const arc = getUnitStats("archer_base");
    expect(arc.attack?.damage100).toBe(650); // 6.5 pierce ×100
    expect(getUnitStats("villager").hp100).toBe(6500);
  });

  it("exposes counter multipliers in fixed-point ×1000", () => {
    expect(getUnitStats("spearman").multipliers1000.cavalry).toBe(3000);
    expect(getUnitStats("skirmisher").multipliers1000.archer).toBe(4000);
    expect(getUnitStats("cavalry_base").multipliers1000.archer).toBe(1250);
  });

  it("unknown unit id throws", () => {
    expect(() => getUnitStats("nonexistent_unit")).toThrow();
  });
});
