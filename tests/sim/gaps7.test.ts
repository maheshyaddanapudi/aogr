/**
 * Round-7 fix regressions (Group B): the AI must be able to take a war across
 * water. Archipelago starts are ALWAYS water-separated (verified across 12
 * seeds), so without transports every AI match there is a dead stalemate (F6).
 */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, stepSim, spawnUnitEntity } from "../../src/sim/sim";
import { getPlayer, spawnResourceNode } from "../../src/sim/economy";
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

  it("F16: a crowd-stopped gatherer starts working instead of re-approaching forever", { timeout: 120_000 }, () => {
    // Campaign-M4 autopsy: local-avoidance crowd-stop halts a villager just
    // OUTSIDE the 1.7-tile gather reach; the phase-1 handler re-issues the
    // same move every tick and the villager farms nothing for the whole match.
    const sim = createSim(991, undefined, { players: 2, skirmish: true });
    const { Position, ResourceNode, GatherTask } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const tx = Math.trunc(Position.x[tc]! / 1000);
    const ty = Math.trunc(Position.y[tc]! / 1000);
    const node = spawnResourceNode(sim, "food", tx + 10, ty, 500_000);
    // pack a standing crowd around the bush so the walker stops short
    const blockers: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      blockers.push(spawnUnitEntity(sim, 0, "infantry_base", (tx + 10 + dx) * 1000 + 500, (ty + dy) * 1000 + 500));
    }
    const vill = spawnUnitEntity(sim, 0, "villager", (tx + 3) * 1000 + 500, ty * 1000 + 500);
    stepSim(sim, [{ type: "gather", playerId: 0, eids: [vill], nodeEid: node }]);
    for (let t = 0; t < 15 * 60 * 2; t++) stepSim(sim, []);
    const d = Math.hypot(Position.x[vill]! - Position.x[node]!, Position.y[vill]! - Position.y[node]!);
    expect(
      GatherTask.phase[vill] === 2 || GatherTask.carriedMilli[vill]! > 0 || GatherTask.phase[vill] === 3,
      `gathering despite the crowd (phase=${GatherTask.phase[vill]}, d=${Math.round(d)})`,
    ).toBe(true);
    void ResourceNode;
    void blockers;
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
