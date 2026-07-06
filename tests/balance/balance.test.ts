/** BALANCE GATE — automated AI-vs-AI sanity: higher difficulty dominates, the
 * match is a real war (not a stalemate), and all four pantheons function as
 * player civs. The human remains the final judge; this catches degeneracy. */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer } from "../../src/sim/economy";
import { createAiState, decideAi } from "../../src/ai/brain";
import { listPantheonIds, getPantheon } from "../../src/sim/pantheondata";

function aiMatch(seed: number, d0: "easiest" | "hard", d1: "easiest" | "hard", minutes: number): Sim {
  const sim = createSim(seed, undefined, { players: 2, skirmish: true });
  const a0 = createAiState(0, d0, seed);
  const a1 = createAiState(1, d1, seed);
  for (let t = 0; t < minutes * 900 && sim.winner < 0; t++) {
    const cmds = [
      ...(t % a0.decisionIntervalTicks === 0 ? decideAi(sim, a0) : []),
      ...(t % a1.decisionIntervalTicks === 0 ? decideAi(sim, a1) : []),
    ];
    stepSim(sim, cmds);
  }
  return sim;
}

function score(sim: Sim, pid: number): number {
  const { Owner, UnitRef, Building } = sim.stores;
  const units = Array.from(query(sim.world, [UnitRef])).filter((e) => Owner.playerId[e] === pid).length;
  const bldgs = Array.from(query(sim.world, [Building])).filter((e) => Owner.playerId[e] === pid && sim.stores.Building.active[e] === 1).length;
  const p = getPlayer(sim, pid);
  return units * 3 + bldgs * 5 + Math.trunc((p.foodMilli + p.woodMilli + p.goldMilli) / 50_000) + p.age * 20;
}

describe("BALANCE GATE", () => {
  it("a hard AI dominates an easiest AI inside 25 minutes", { timeout: 90_000 }, () => {
    const sim = aiMatch(42, "easiest", "hard", 25);
    if (sim.winner >= 0) {
      expect(sim.winner, "hard wins outright").toBe(1);
    } else {
      expect(score(sim, 1), "hard holds a decisive lead").toBeGreaterThan(Math.trunc(score(sim, 0) * 1.3));
    }
  });

  it("the war is real: units die on both sides (no pacifist stalemate)", { timeout: 90_000 }, () => {
    const sim = createSim(7, undefined, { players: 2, skirmish: true });
    const a0 = createAiState(0, "hard", 7);
    const a1 = createAiState(1, "hard", 7);
    let deaths = 0;
    for (let t = 0; t < 18 * 900 && sim.winner < 0; t++) {
      const cmds = [
        ...(t % a0.decisionIntervalTicks === 0 ? decideAi(sim, a0) : []),
        ...(t % a1.decisionIntervalTicks === 0 ? decideAi(sim, a1) : []),
      ];
      stepSim(sim, cmds);
      deaths += sim.events.deaths.length;
    }
    expect(deaths, "blood was spilled").toBeGreaterThan(10);
  });

  it("every pantheon functions as a playable civ (economy grows, favor flows)", { timeout: 180_000 }, () => {
    for (const pid of listPantheonIds()) {
      const sim = createSim(99, undefined, { players: 2, skirmish: true });
      getPlayer(sim, 0).pantheon = pid;
      getPlayer(sim, 0).majorGod = getPantheon(pid).majors[0]!.id;
      const ai = createAiState(0, "hard", 99);
      for (let t = 0; t < 10 * 900; t++) {
        stepSim(sim, t % ai.decisionIntervalTicks === 0 ? decideAi(sim, ai) : []);
      }
      const p = getPlayer(sim, 0);
      expect(p.popUsed, `${pid}: population grew`).toBeGreaterThan(8);
      expect(p.favorMilli + Object.keys(p.castCounts).length, `${pid}: favor mechanism alive`).toBeGreaterThan(0);
    }
  });
});
