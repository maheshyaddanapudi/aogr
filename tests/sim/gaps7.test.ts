/**
 * Round-7 fix regressions (Group B): the AI must be able to take a war across
 * water. Archipelago starts are ALWAYS water-separated (verified across 12
 * seeds), so without transports every AI match there is a dead stalemate (F6).
 */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, stepSim } from "../../src/sim/sim";
import { getPlayer } from "../../src/sim/economy";
import { createAiState, decideAi } from "../../src/ai/brain";

describe("gaps7 — AI naval invasion (F6)", () => {
  it("a hard AI separated by water ferries an attack wave to the enemy island", { timeout: 300_000 }, () => {
    const sim = createSim(3888, { waterLevelFp: 200 }, { players: 2, skirmish: true });
    const { Position, Owner, UnitRef } = sim.stores;
    const ai = createAiState(1, "hard", 3888);
    const foeTc = getPlayer(sim, 0).townCenterEid;
    let contact = false;
    for (let t = 0; t < 15 * 60 * 30 && sim.winner < 0 && !contact; t++) {
      stepSim(sim, t % ai.decisionIntervalTicks === 0 ? decideAi(sim, ai) : []);
      if (t % 45 !== 0) continue;
      for (const e of query(sim.world, [UnitRef])) {
        if (Owner.playerId[e] !== 1) continue;
        const cls = sim.unitStats(e).unitClass;
        if (cls === "villager" || cls === "ship") continue;
        const dx = Position.x[e]! - Position.x[foeTc]!;
        const dy = Position.y[e]! - Position.y[foeTc]!;
        if (dx * dx + dy * dy < 15_000 * 15_000) { contact = true; break; }
      }
    }
    expect(contact || sim.winner === 1, "AI landed troops on the enemy island (or won outright)").toBe(true);
  });

  it("F5: no dead-pocket starts — an AI on archipelago 3888 grows a real base (was: 1 building forever)", { timeout: 300_000 }, () => {
    const sim = createSim(3888, { waterLevelFp: 200 }, { players: 2, skirmish: true });
    const { Owner, Building } = sim.stores;
    const ai = createAiState(1, "hard", 3888);
    for (let t = 0; t < 15 * 60 * 10; t++) {
      stepSim(sim, t % ai.decisionIntervalTicks === 0 ? decideAi(sim, ai) : []);
    }
    const built = Array.from(query(sim.world, [Building])).filter((e) => Owner.playerId[e] === 1 && Building.active[e] === 1).length;
    expect(built, "the AI's base grew past its town center within 10 minutes").toBeGreaterThanOrEqual(4);
    expect(getPlayer(sim, 1).popCap, "houses raised the population cap").toBeGreaterThan(15);
  });
});
