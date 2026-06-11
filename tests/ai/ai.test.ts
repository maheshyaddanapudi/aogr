import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, simChecksum, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer } from "../../src/sim/economy";
import { createAiState, decideAi, type AiDifficulty } from "../../src/ai/brain";

const SKIRMISH = { players: 2, skirmish: true };

function unitsOf(sim: Sim, pid: number, klass?: string): number[] {
  const { Owner, UnitRef } = sim.stores;
  return Array.from(query(sim.world, [UnitRef]))
    .filter((e) => Owner.playerId[e] === pid && (!klass || sim.unitStats(e).unitClass === klass))
    .sort((a, b) => a - b);
}

function buildingsOf(sim: Sim, pid: number, id?: string): number[] {
  const { Owner, Building } = sim.stores;
  return Array.from(query(sim.world, [Building]))
    .filter((e) => Owner.playerId[e] === pid && Building.active[e] === 1 && (!id || sim.buildingIdOf(e) === id))
    .sort((a, b) => a - b);
}

/** Run a match with an AI driving player 1. */
function runWithAi(seed: number, difficulty: AiDifficulty, ticks: number): { sim: Sim; checksum: number } {
  const sim = createSim(seed, undefined, SKIRMISH);
  const ai = createAiState(1, difficulty, seed);
  for (let t = 0; t < ticks; t++) {
    const commands = t % ai.decisionIntervalTicks === 0 ? decideAi(sim, ai) : [];
    stepSim(sim, commands);
  }
  return { sim, checksum: simChecksum(sim) };
}

describe("PHASE 7 GATE — AI opponent", () => {
  it("AI booms: trains villagers, gathers, expands houses, builds a temple", () => {
    const { sim } = runWithAi(42, "medium", 15 * 60 * 5); // 5 minutes
    const p = getPlayer(sim, 1);
    expect(unitsOf(sim, 1, "villager").length, "villagers").toBeGreaterThanOrEqual(10);
    expect(buildingsOf(sim, 1, "house").length, "houses").toBeGreaterThanOrEqual(1);
    expect(buildingsOf(sim, 1, "temple").length, "temple").toBe(1);
    expect(p.foodMilli + p.woodMilli + p.goldMilli, "income happened").toBeGreaterThan(0);
  }, 300_000);

  it("AI ages up to Mythic and fields an army with myth units", () => {
    const { sim } = runWithAi(42, "hard", 15 * 60 * 22); // 22 minutes
    const p = getPlayer(sim, 1);
    expect(p.age, "age").toBe(3);
    expect(p.minorGods.length).toBe(3);
    expect(unitsOf(sim, 1).filter((e) => ["infantry", "archer", "cavalry"].includes(sim.unitStats(e).unitClass)).length, "army").toBeGreaterThanOrEqual(6);
  }, 600_000);

  it("AI attacks: its army shows up near the enemy base", () => {
    const { sim } = runWithAi(7, "hard", 15 * 60 * 14);
    const enemyTc = getPlayer(sim, 0).townCenterEid;
    const { Position } = sim.stores;
    const tx = Position.x[enemyTc]!;
    const ty = Position.y[enemyTc]!;
    const near = unitsOf(sim, 1).filter((e) => {
      if (sim.unitStats(e).unitClass === "villager") return false;
      const dx = Position.x[e]! - tx;
      const dy = Position.y[e]! - ty;
      return dx * dx + dy * dy < 30_000 * 30_000; // within 30 tiles
    });
    // either the wave is at the gates, or it already razed villagers/the TC
    const enemyVillagers = unitsOf(sim, 0, "villager").length;
    expect(near.length >= 3 || enemyVillagers < 4, `wave near base (${near.length}) or damage done (${enemyVillagers} vills left)`).toBe(true);
  }, 600_000);

  it("AI casts a god power", () => {
    const { sim } = runWithAi(42, "hard", 15 * 60 * 12);
    const p = getPlayer(sim, 1);
    expect(Object.keys(p.castCounts).length, "powers cast").toBeGreaterThanOrEqual(1);
  }, 600_000);

  it("difficulties measurably differ (hard out-booms easy)", () => {
    const easy = runWithAi(42, "easy", 15 * 60 * 8);
    const hard = runWithAi(42, "hard", 15 * 60 * 8);
    const easyVills = unitsOf(easy.sim, 1, "villager").length;
    const hardVills = unitsOf(hard.sim, 1, "villager").length;
    expect(hardVills, `hard ${hardVills} vs easy ${easyVills}`).toBeGreaterThan(easyVills);
    expect(getPlayer(hard.sim, 1).age).toBeGreaterThanOrEqual(getPlayer(easy.sim, 1).age);
  }, 600_000);

  it("AI-driven matches are deterministic", () => {
    const a = runWithAi(99, "medium", 15 * 60 * 3);
    const b = runWithAi(99, "medium", 15 * 60 * 3);
    expect(a.checksum).toBe(b.checksum);
  }, 300_000);
});
