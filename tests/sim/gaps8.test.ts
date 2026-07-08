/**
 * Round-9 "cockroach purge" regressions: warship stance + gate-nudge bias +
 * AI polish (towers/techs/hero relic duty/scaled invasions).
 */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, stepSim, spawnUnitEntity, type Sim } from "../../src/sim/sim";
import { getPlayer } from "../../src/sim/economy";
import { createAiState, decideAi } from "../../src/ai/brain";

const SKIRMISH = { players: 2, skirmish: true };
const run = (sim: Sim, n: number) => { for (let i = 0; i < n; i++) stepSim(sim, []); };

describe("gaps8 — warships fight back", () => {
  it("a war galley auto-engages an enemy ship in range (no order needed)", () => {
    const sim = createSim(1101, undefined, SKIRMISH);
    const { Position, Health, UnitRef } = sim.stores;
    // find open water for the duel
    let w: { x: number; y: number } | null = null;
    for (let y = 20; y < 180 && !w; y++) for (let x = 20; x < 180; x++) {
      let wet = true;
      for (let dy = -3; dy <= 3 && wet; dy++) for (let dx = -3; dx <= 3; dx++) {
        const verts = sim.terrain.size + 1;
        if (sim.terrain.heights[(y + dy) * verts + (x + dx)]! >= sim.terrain.waterLevelFp) { wet = false; break; }
      }
      if (wet) { w = { x, y }; break; }
    }
    expect(w, "found open water").not.toBeNull();
    const galley = spawnUnitEntity(sim, 0, "war_galley", w!.x * 1000 + 500, w!.y * 1000 + 500);
    const prey = spawnUnitEntity(sim, 1, "fishing_boat", (w!.x + 3) * 1000 + 500, w!.y * 1000 + 500);
    const hpBefore = Health.hp100[prey]!;
    run(sim, 15 * 20);
    expect(Health.hp100[prey]!, "the galley opened fire on its own").toBeLessThan(hpBefore);
    void galley;
    void Position;
    void UnitRef;
  });

  it("a hard AI garrisons its home: towers rise and armory techs land within 20 minutes", { timeout: 300_000 }, () => {
    const sim = createSim(556, undefined, SKIRMISH);
    const ai = createAiState(1, "hard", 556);
    // an effectively unkillable foe keeps the match running — the polish
    // behaviors must appear DURING a war, not be skipped by an early win
    sim.stores.Health.hp100[getPlayer(sim, 0).townCenterEid] = 2_000_000_000;
    for (let t = 0; t < 15 * 60 * 20 && sim.winner < 0; t++) {
      stepSim(sim, t % ai.decisionIntervalTicks === 0 ? decideAi(sim, ai) : []);
    }
    const { Owner, Building } = sim.stores;
    const towers = Array.from(query(sim.world, [Building])).filter(
      (e) => Owner.playerId[e] === 1 && Building.active[e] === 1 && sim.buildingIdOf(e) === "tower",
    ).length;
    const p = getPlayer(sim, 1);
    expect(towers, "the AI raised static defense").toBeGreaterThanOrEqual(1);
    expect(
      p.researchedTechs.some((t) => t.startsWith("bronze_")),
      `armory techs researched (${p.researchedTechs.join(",")})`,
    ).toBe(true);
  });

  it("an AI hero collects a relic and banks it at the temple", { timeout: 300_000 }, () => {
    const sim = createSim(557, undefined, SKIRMISH);
    const ai = createAiState(1, "hard", 557);
    sim.stores.Health.hp100[getPlayer(sim, 0).townCenterEid] = 2_000_000_000;
    let banked = false;
    for (let t = 0; t < 15 * 60 * 25 && sim.winner < 0 && !banked; t++) {
      stepSim(sim, t % ai.decisionIntervalTicks === 0 ? decideAi(sim, ai) : []);
      banked = getPlayer(sim, 1).relicsStored > 0;
    }
    expect(banked, "a relic reached the AI's temple").toBe(true);
  });

  it("fishing boats and transports stay peaceful (no attack data, no aggression)", () => {
    const sim = createSim(1102, undefined, SKIRMISH);
    const { CombatState } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const { Position } = sim.stores;
    const boat = spawnUnitEntity(sim, 0, "fishing_boat", Position.x[tc]! + 3000, Position.y[tc]!);
    const barge = spawnUnitEntity(sim, 0, "transport_barge", Position.x[tc]! + 4000, Position.y[tc]!);
    // no attack stats ⇒ no CombatState aggression to leak
    for (const e of [boat, barge]) {
      if (CombatState.aggressive[e] !== undefined) {
        expect(CombatState.aggressive[e]).not.toBe(1);
      }
    }
  });
});
