/** DISCOVERY PROBES batch 3 (round 7). */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, stepSim, type Sim } from "../../src/sim/sim";
import { getPlayer } from "../../src/sim/economy";
import { createAiState, decideAi } from "../../src/ai/brain";

describe("DISCOVERY 3", () => {
  it("P10: archipelago starts are viable for every player across seeds (quantifies the dead-AI finding)", { timeout: 120_000 }, () => {
    const bad: string[] = [];
    for (const seed of [3888, 1404, 9001, 9002, 9003, 9004]) {
      for (const players of [2, 3]) {
        const sim = createSim(seed, { waterLevelFp: 200 }, { players, skirmish: true });
        const { ResourceNode, Position } = sim.stores;
        for (let pid = 0; pid < players; pid++) {
          const tc = getPlayer(sim, pid).townCenterEid;
          if (tc < 0) { bad.push(`seed ${seed}/${players}p: p${pid} has NO town center`); continue; }
          // count reachable-ish resources within 25 tiles of the TC
          let near = 0;
          for (const n of query(sim.world, [ResourceNode])) {
            if (ResourceNode.resType[n]! > 3) continue;
            const d = Math.hypot(Position.x[n]! - Position.x[tc]!, Position.y[n]! - Position.y[tc]!);
            if (d < 25_000) near++;
          }
          if (near < 6) bad.push(`seed ${seed}/${players}p: p${pid} starts with only ${near} nearby resources`);
        }
      }
    }
    expect(bad, `unviable archipelago starts:\n${bad.join("\n")}`).toHaveLength(0);
  });

  it.fails("KNOWN BUG P11: a titan AI left alone reaches the late game (age 3 or a wonder) within 35 minutes", { timeout: 120_000 }, () => {
    const sim = createSim(555, undefined, { players: 2, skirmish: true });
    const ai = createAiState(1, "titan", 555);
    for (let t = 0; t < 15 * 60 * 35 && sim.winner < 0; t++) {
      stepSim(sim, t % ai.decisionIntervalTicks === 0 ? decideAi(sim, ai) : []);
      if (getPlayer(sim, 1).age >= 3) break;
    }
    expect(getPlayer(sim, 1).age, "titan reaches the Mythic Age unopposed").toBeGreaterThanOrEqual(3);
  });
});
