/**
 * Tech research + age progression: validates costs/prerequisites/age
 * requirements/minor-god pools from data files, runs timed research, and
 * exposes modifier application so every stat read can honor researched techs.
 * Modifiers are DERIVED from researchedTechs (rebuilt on load, never stored).
 */
import { hasComponent, query } from "bitecs";
import type { Checksum } from "./checksum";
import type { Command } from "./commands";
import { AGE_INDEX, getTechStats, type TechStats } from "./techdata";
import { getMinorPool, getMajorEffects } from "./pantheondata";
import { getBuildingStatsByIndex } from "./buildingdata";
import { canAfford, getPlayer, payCost } from "./economy";
// eslint-disable-next-line import/no-cycle -- runtime-safe: functions called post-init
import { TICK_RATE, type Sim } from "./sim";

export interface ResearchEntry {
  techId: string;
  ticksLeft: number;
  minorGod: string | null;
}

const AGE_TIER: Record<string, "classical" | "heroic" | "mythic"> = {
  age_classical: "classical",
  age_heroic: "heroic",
  age_mythic: "mythic",
};

function hasActiveBuilding(sim: Sim, playerId: number, buildingId: string): boolean {
  const { Owner, Building } = sim.stores;
  for (const eid of query(sim.world, [Building])) {
    if (Owner.playerId[eid] !== playerId || Building.active[eid] !== 1) continue;
    if (getBuildingStatsByIndex(Building.typeIndex[eid]!).id === buildingId) return true;
  }
  return false;
}

export function handleResearchCommand(sim: Sim, cmd: Command): boolean {
  if (cmd.type !== "research") return false;
  const p = getPlayer(sim, cmd.playerId);
  let tech: TechStats;
  try {
    tech = getTechStats(cmd.tech);
  } catch {
    return true;
  }
  if (p.researchedTechs.includes(tech.id)) return true;
  if (p.researchQueue.some((r) => r.techId === tech.id)) return true;
  if (!canAfford(p, tech.cost)) return true;
  for (const pre of tech.prerequisites) {
    if (!p.researchedTechs.includes(pre)) return true;
  }
  let minorGod: string | null = null;
  if (tech.isAgeTech) {
    // must be exactly the next age, with its prerequisite building standing
    if (p.age !== tech.age) return true;
    if (tech.requiresBuilding && !hasActiveBuilding(sim, cmd.playerId, tech.requiresBuilding)) return true;
    const tier = AGE_TIER[tech.id]!;
    const pool = getMinorPool(p.pantheon, p.majorGod, tier);
    if (!cmd.minorGod || !pool.includes(cmd.minorGod)) return true;
    minorGod = cmd.minorGod;
  } else {
    if (tech.age > p.age) return true;
    // minor-god techs require their granting god chosen
    if (tech.grantedBy && !p.minorGods.includes(tech.grantedBy)) return true;
    if (tech.pantheon && tech.pantheon !== p.pantheon) return true;
  }
  payCost(p, tech.cost);
  p.researchQueue.push({ techId: tech.id, ticksLeft: tech.researchTicks, minorGod });
  return true;
}

export function researchSystem(sim: Sim): void {
  for (let pid = 0; pid < sim.players.length; pid++) {
    const p = sim.players[pid]!;
    for (let i = p.researchQueue.length - 1; i >= 0; i--) {
      const r = p.researchQueue[i]!;
      r.ticksLeft--;
      if (r.ticksLeft > 0) continue;
      p.researchQueue.splice(i, 1);
      p.researchedTechs.push(r.techId);
      const tech = getTechStats(r.techId);
      if (tech.isAgeTech) {
        const ageEffect = tech.effects.find((e) => e.stat === "age");
        p.age = ageEffect ? ageEffect.value1000 : p.age + 1;
        if (r.minorGod) p.minorGods.push(r.minorGod);
      }
    }
  }
}

/* ─────────────── modifier application (integer-only) ─────────────── */

/** add-op unit conversion per stat path (data values are human-readable). */
const ADD_SCALE: Record<string, number> = {
  "attack.damage": 100,
  "attack.crushDamage": 100,
  "attack.range": 1000,
  los: 1000,
  hp: 100,
  "armor.hack": 1,
  "armor.pierce": 1,
  "armor.crush": 1,
  "market.spreadPercent": 1,
};

/**
 * Apply every researched modifier matching (targetKeys, statPath) to a base
 * value, in research order. Mul values are ×1000.
 */
export function applyModifiers(sim: Sim, playerId: number, targetKeys: readonly string[], statPath: string, base: number): number {
  const p = sim.players[playerId];
  if (!p) return base;
  let v = base;
  for (const e of getMajorEffects(p.pantheon, p.majorGod)) {
    if (e.stat !== statPath || !targetKeys.includes(e.target)) continue;
    if (e.op === "mul") v = Math.trunc((v * e.value1000) / 1000);
    else if (e.op === "add") v += e.value1000 * (ADD_SCALE[statPath] ?? 1);
  }
  for (const techId of p.researchedTechs) {
    for (const e of getTechStats(techId).effects) {
      if (e.stat !== statPath || !targetKeys.includes(e.target)) continue;
      if (e.op === "mul") v = Math.trunc((v * e.value1000) / 1000);
      else if (e.op === "add") v += e.value1000 * (ADD_SCALE[statPath] ?? 1);
      else v = e.value1000;
    }
  }
  return v;
}

const RES_STAT: Record<number, string> = {
  0: "gatherRates.forageFoodPerSec",
  3: "gatherRates.huntFoodPerSec",
  1: "gatherRates.woodPerSec",
  2: "gatherRates.goldPerSec",
};

/** Effective gather rate in micro-res/tick: modifiers apply to the per-second rate. */
export function effectiveGatherMicroPerTick(sim: Sim, eid: number, resType: number): number {
  const stats = sim.unitStats(eid);
  // herd(5) harvests at the hunt rate; fish(6) at the ship's slot-0 fish rate
  if (resType === 5) resType = 3;
  else if (resType === 6) resType = 0;
  const perSec = stats.gatherMicroPerSec?.[resType] ?? 0;
  if (perSec === 0) return 0;
  const playerId = sim.stores.Owner.playerId[eid]!;
  const modified = applyModifiers(sim, playerId, [stats.unitClass, stats.id], RES_STAT[resType]!, perSec);
  return Math.trunc(modified / TICK_RATE);
}

export function effectiveDamage100(sim: Sim, eid: number, base: number): number {
  const stats = sim.unitStats(eid);
  return applyModifiers(sim, eid >= 0 ? sim.stores.Owner.playerId[eid]! : 0, [stats.unitClass, stats.id], "attack.damage", base);
}

export function effectiveArmor(sim: Sim, eid: number, type: "hack" | "pierce" | "crush", base: number): number {
  const stats = sim.unitStats(eid);
  const v = applyModifiers(sim, sim.stores.Owner.playerId[eid]!, [stats.unitClass, stats.id], `armor.${type}`, base);
  return Math.min(99, Math.max(0, v));
}

export function effectiveTrainTicks(sim: Sim, playerId: number, unitClass: string, unitId: string, base: number): number {
  return Math.max(1, applyModifiers(sim, playerId, [unitClass, unitId], "trainTime", base));
}

export function effectiveMaxHp100(sim: Sim, playerId: number, unitClass: string, unitId: string, base: number): number {
  return applyModifiers(sim, playerId, [unitClass, unitId], "hp", base);
}

export function effectiveSpeedFpPerTick(sim: Sim, eid: number): number {
  const stats = sim.unitStats(eid);
  return applyModifiers(sim, sim.stores.Owner.playerId[eid]!, [stats.unitClass, stats.id], "speed", stats.speedFpPerTick);
}

export function hashResearch(sim: Sim, c: Checksum): void {
  for (const p of sim.players) {
    c.addI32(p.age);
    c.addString(p.majorGod);
    for (const g of p.minorGods) c.addString(g);
    for (const t of p.researchedTechs) c.addString(t);
    for (const r of p.researchQueue) {
      c.addString(r.techId);
      c.addI32(r.ticksLeft);
    }
  }
}

export { AGE_INDEX };
