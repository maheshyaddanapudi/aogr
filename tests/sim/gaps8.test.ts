/**
 * Round-9 "cockroach purge" regressions: warship stance + gate-nudge bias +
 * AI polish (towers/techs/hero relic duty/scaled invasions).
 */
import { describe, expect, it } from "vitest";
import { query } from "bitecs";
import { createSim, stepSim, spawnUnitEntity, type Sim } from "../../src/sim/sim";
import { getPlayer, spawnResourceNode, findCoastalSite } from "../../src/sim/economy";
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

  it("worldgen guarantees start-to-start reachability by land OR sea (cell-16 autopsy: seed 3777 generated two disconnected oceans)", { timeout: 120_000 }, () => {
    const reachEither = (sim: Sim): boolean => {
      const { Position } = sim.stores;
      const a = getPlayer(sim, 0).townCenterEid;
      const b = getPlayer(sim, 1).townCenterEid;
      const bfs = (grid: { size: number; passable: Uint8Array }, sx: number, sy: number, gx: number, gy: number, seedR: number): boolean => {
        const seen = new Uint8Array(grid.size * grid.size);
        const qx: number[] = [];
        const qy: number[] = [];
        for (let dy = -seedR; dy <= seedR; dy++) for (let dx = -seedR; dx <= seedR; dx++) {
          const x = sx + dx;
          const y = sy + dy;
          if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
          const k = y * grid.size + x;
          if (!grid.passable[k] || seen[k]) continue;
          seen[k] = 1;
          qx.push(x);
          qy.push(y);
        }
        let head = 0;
        while (head < qx.length) {
          const x = qx[head]!;
          const y = qy[head]!;
          head++;
          if (Math.abs(x - gx) <= seedR && Math.abs(y - gy) <= seedR) return true;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= grid.size || ny >= grid.size) continue;
            const k = ny * grid.size + nx;
            if (seen[k] || !grid.passable[k]) continue;
            seen[k] = 1;
            qx.push(nx);
            qy.push(ny);
          }
        }
        return false;
      };
      const ax = Math.trunc(Position.x[a]! / 1000);
      const ay = Math.trunc(Position.y[a]! / 1000);
      const bx = Math.trunc(Position.x[b]! / 1000);
      const by = Math.trunc(Position.y[b]! / 1000);
      return bfs(sim.navGrid, ax, ay, bx, by, 4) || bfs(sim.waterGrid, ax, ay, bx, by, 8);
    };
    for (const [seed, water] of [[3777, 200], [3888, 200], [1404, 200], [9004, 200], [1101, undefined], [42, undefined]] as const) {
      const sim = createSim(seed, water !== undefined ? { waterLevelFp: water } : undefined, SKIRMISH);
      expect(reachEither(sim), `seed ${seed}${water !== undefined ? "/archipelago" : "/island"}: some route exists between the starts`).toBe(true);
    }
  });

  it("auto-sited docks face the MAIN ocean, not a landlocked lagoon (cell-16 autopsy, seed 3777)", { timeout: 120_000 }, () => {
    const sim = createSim(3777, { waterLevelFp: 200 }, SKIRMISH);
    const { Position } = sim.stores;
    const tc = getPlayer(sim, 0).townCenterEid;
    const tx = Math.trunc(Position.x[tc]! / 1000);
    const ty = Math.trunc(Position.y[tc]! / 1000);
    const site = findCoastalSite(sim, tx, ty, 2);
    expect(site, "a coastal dock site exists").not.toBeNull();
    // the water the dock touches must belong to the biggest sea on the map
    const g = sim.waterGrid;
    const labels = new Int32Array(g.size * g.size).fill(-1);
    const sizes: number[] = [];
    for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) {
      if (!g.passable[y * g.size + x] || labels[y * g.size + x]! >= 0) continue;
      const id = sizes.length;
      let n = 0;
      const qx = [x];
      const qy = [y];
      labels[y * g.size + x] = id;
      let head = 0;
      while (head < qx.length) {
        const cx = qx[head]!;
        const cy = qy[head]!;
        head++;
        n++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= g.size || ny >= g.size) continue;
          const k = ny * g.size + nx;
          if (labels[k]! >= 0 || !g.passable[k]) continue;
          labels[k] = id;
          qx.push(nx);
          qy.push(ny);
        }
      }
      sizes.push(n);
    }
    const main = sizes.indexOf(Math.max(...sizes));
    let touchesMain = false;
    for (let dy = -2; dy <= 3 && !touchesMain; dy++) for (let dx = -2; dx <= 3; dx++) {
      const x = site!.x + dx;
      const y = site!.y + dy;
      if (x >= 0 && y >= 0 && x < g.size && y < g.size && labels[y * g.size + x] === main) { touchesMain = true; break; }
    }
    expect(touchesMain, `dock site (${site!.x},${site!.y}) touches the main ocean (region ${main}, ${Math.max(...sizes)} tiles)`).toBe(true);
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
