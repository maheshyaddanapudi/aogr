import { describe, expect, it } from "vitest";
// @ts-expect-error plain-JS guard script shared with CI and .claude hooks
import { checkSimPurity } from "../../scripts/check-sim-purity.mjs";

describe("§3 determinism guard", () => {
  it("src/sim/ has no rendering imports, Math.random, wall-clock, or DOM usage", () => {
    const violations = checkSimPurity();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
