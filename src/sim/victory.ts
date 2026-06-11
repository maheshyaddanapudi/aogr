/**
 * Victory conditions (docs/01 §8): conquest (lose every town center ⇒ lose)
 * and wonder countdown (hold a finished wonder for its countdown ⇒ win).
 * Settlement/relic control is deferred (relics not yet in worldgen) — flagged
 * in docs/04, never silently skipped.
 */
import { query } from "bitecs";
import type { Checksum } from "./checksum";
import { getBuildingStatsByIndex } from "./buildingdata";
import { TICK_RATE } from "./fixed";
// eslint-disable-next-line import/no-cycle -- runtime-safe
import { type Sim } from "./sim";

const WONDER_COUNTDOWN_TICKS = 600 * TICK_RATE;

export function victorySystem(sim: Sim): void {
  if (sim.winner >= 0 || sim.players.length < 2) return;
  const { Owner, Building } = sim.stores;

  // census: town centers + finished wonders per player
  const tcs = new Array(sim.players.length).fill(0);
  const wonders = new Array(sim.players.length).fill(0);
  for (const eid of query(sim.world, [Building])) {
    if (Building.active[eid] !== 1) continue;
    const id = getBuildingStatsByIndex(Building.typeIndex[eid]!).id;
    const pid = Owner.playerId[eid]!;
    if (pid < 0 || pid >= sim.players.length) continue;
    if (id === "town_center") tcs[pid]++;
    if (id === "wonder") wonders[pid]++;
  }

  // wonder countdowns
  for (let pid = 0; pid < sim.players.length; pid++) {
    if (wonders[pid] > 0) {
      if ((sim.wonderTicksLeft[pid] ?? 0) <= 0) sim.wonderTicksLeft[pid] = WONDER_COUNTDOWN_TICKS;
      else {
        sim.wonderTicksLeft[pid] = sim.wonderTicksLeft[pid]! - 1;
        if (sim.wonderTicksLeft[pid] === 0) {
          sim.winner = pid;
          return;
        }
      }
    } else {
      sim.wonderTicksLeft[pid] = 0;
    }
  }

  // conquest: exactly one player still holding a town center wins
  const holders = tcs.map((n, i) => ({ n, i })).filter((x) => x.n > 0);
  if (holders.length === 1 && tcs.some((n, i) => n === 0 && i !== holders[0]!.i)) {
    sim.winner = holders[0]!.i;
  }
}

export function hashVictory(sim: Sim, c: Checksum): void {
  c.addI32(sim.winner);
  for (const w of sim.wonderTicksLeft) c.addI32(w);
}
