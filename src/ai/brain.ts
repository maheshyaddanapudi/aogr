/**
 * Petra-style AI brain (docs/05): HQ strategy + queue/defense/attack managers.
 * A PURE decision function over sim state: same sim + same AiState ⇒ same
 * commands, so AI matches replay deterministically. Runs synchronously in
 * tests and identically inside the AI worker (which feeds it deserialized
 * snapshots). Reads sim state, NEVER mutates it — commands are the only door.
 */
import { query } from "bitecs";
import aiJson from "../../data/ai.json";
import type { Command } from "../sim/commands";
import type { Sim } from "../sim/sim";
import { getPlayer, findResourceNodes } from "../sim/economy";
import { getTechStats } from "../sim/techdata";
import { getMinorPool, getMinor, getPantheon } from "../sim/pantheondata";
import { getPower, nextCastCostMilli } from "../sim/powers";
import { getUnitStats } from "../sim/unitdata";
import { getBuildingStats } from "../sim/buildingdata";

export type AiDifficulty = "easy" | "medium" | "hard";

interface Knobs {
  decisionIntervalTicks: number;
  villagerTarget: number;
  armyTarget: number;
  waveSize: number;
  usePowers: boolean;
  prayerVillagers: number;
  mythTarget: number;
}

const KNOBS = (aiJson as { difficulties: Record<string, Knobs> }).difficulties;

export interface AiState {
  playerId: number;
  difficulty: AiDifficulty;
  decisionIntervalTicks: number;
  /** tick of the last launched attack wave */
  lastWaveTick: number;
  attacking: boolean;
}

export function createAiState(playerId: number, difficulty: AiDifficulty, _seed: number): AiState {
  return {
    playerId,
    difficulty,
    decisionIntervalTicks: KNOBS[difficulty]!.decisionIntervalTicks,
    lastWaveTick: -100000,
    attacking: false,
  };
}

const AGE_TECHS = ["age_classical", "age_heroic", "age_mythic"] as const;
const AGE_TIERS = ["classical", "heroic", "mythic"] as const;
const AGE_PREREQ = ["temple", "armory", "market"] as const;

export function decideAi(sim: Sim, ai: AiState): Command[] {
  const pid = ai.playerId;
  const knobs = KNOBS[ai.difficulty]!;
  const p = getPlayer(sim, pid);
  const cmds: Command[] = [];
  const { Owner, UnitRef, Building, Position, GatherTask, MoveState, CombatState } = sim.stores;

  // ── census ──
  const myUnits = Array.from(query(sim.world, [UnitRef])).filter((e) => Owner.playerId[e] === pid).sort((a, b) => a - b);
  const villagers = myUnits.filter((e) => sim.unitStats(e).id === "villager");
  const military = myUnits.filter((e) => ["infantry", "archer", "cavalry", "myth", "hero"].includes(sim.unitStats(e).unitClass));
  const myth = myUnits.filter((e) => sim.unitStats(e).unitClass === "myth");
  const myBuildings = Array.from(query(sim.world, [Building])).filter((e) => Owner.playerId[e] === pid).sort((a, b) => a - b);
  const active = (id: string) => myBuildings.filter((e) => Building.active[e] === 1 && sim.buildingIdOf(e) === id);
  const anyOf = (id: string) => myBuildings.filter((e) => sim.buildingIdOf(e) === id); // incl. under construction
  const tc = p.townCenterEid >= 0 ? p.townCenterEid : active("town_center")[0] ?? -1;
  if (tc < 0) return cmds; // base lost: nothing smart to do yet

  const idleVillagers = villagers.filter((e) => GatherTask.phase[e] === 0 && MoveState.active[e] !== 1);
  const builders = villagers.filter((e) => GatherTask.phase[e] === 4);

  // ── queueManager: economy ──
  // villager production — but bank food for the next age once the economy stands
  const queued = sim.trainQueues.get(tc)?.length ?? 0;
  let foodReserveMilli = 0;
  if (p.age < 3 && villagers.length >= 14) {
    foodReserveMilli = getTechStats(AGE_TECHS[p.age]!).cost.food * 1000 + 100_000;
  }
  if (
    villagers.length + queued < knobs.villagerTarget &&
    p.popUsed < p.popCap &&
    (foodReserveMilli === 0 || p.foodMilli > foodReserveMilli + 50_000)
  ) {
    cmds.push({ type: "train", playerId: pid, buildingEid: tc, unit: "villager" });
  }
  // housing ahead of pop block
  const underConstruction = (id: string) => myBuildings.filter((e) => Building.active[e] !== 1 && sim.buildingIdOf(e) === id).length;
  if (p.popCap - p.popUsed < 6 && anyOf("house").length < 10 && p.woodMilli >= 50_000 && underConstruction("house") === 0) {
    const builder = idleVillagers[0] ?? villagers[0];
    if (builder !== undefined) cmds.push({ type: "build", playerId: pid, eids: [builder], building: "house", x: -1, y: -1 });
  }
  // gather assignment: keep food/wood/gold crews per simple ratios by age
  if (idleVillagers.length > 0) {
    const crews: Array<["food" | "wood" | "gold", number]> = p.age === 0 ? [["food", 5], ["wood", 3], ["gold", 2]] : [["food", 4], ["wood", 3], ["gold", 3]];
    const counts: Record<string, number> = { food: 0, wood: 0, gold: 0 };
    for (const v of villagers) {
      if (GatherTask.phase[v]! >= 1 && GatherTask.phase[v]! <= 3) {
        counts[["food", "wood", "gold"][GatherTask.carriedType[v]!]!]!++;
      }
    }
    for (const v of idleVillagers) {
      // pick the most understaffed crew
      let best: "food" | "wood" | "gold" = "food";
      let bestDeficit = -Infinity;
      for (const [kind, weight] of crews) {
        const deficit = weight - (counts[kind] ?? 0);
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          best = kind;
        }
      }
      const nodes = findResourceNodes(sim, best);
      if (nodes.length === 0) continue;
      let nearest = nodes[0]!;
      let nd = Number.MAX_SAFE_INTEGER;
      for (const n of nodes) {
        const dx = Position.x[n]! - Position.x[tc]!;
        const dy = Position.y[n]! - Position.y[tc]!;
        if (dx * dx + dy * dy < nd) {
          nd = dx * dx + dy * dy;
          nearest = n;
        }
      }
      cmds.push({ type: "gather", playerId: pid, eids: [v], nodeEid: nearest });
      counts[best] = (counts[best] ?? 0) + 1;
    }
  }

  // resume orphaned construction sites before starting anything new
  const sites = myBuildings.filter((e) => Building.active[e] !== 1);
  for (const site of sites) {
    const hasWorker = villagers.some((v) => GatherTask.phase[v] === 4 && GatherTask.nodeEid[v] === site);
    if (!hasWorker) {
      const worker = idleVillagers[0] ?? villagers.find((v) => GatherTask.phase[v]! <= 3 && GatherTask.phase[v]! >= 1);
      if (worker !== undefined) {
        cmds.push({ type: "work_on", playerId: pid, eids: [worker], buildingEid: site });
        break; // one resume per cycle
      }
    }
  }

  // ── HQ: tech buildings + age-ups ──
  const buildIfMissing = (id: string, minVillagers: number): boolean => {
    if (anyOf(id).length > 0 || villagers.length < minVillagers || sites.length > 1) return false;
    const stats = getBuildingStats(id);
    if (!canAffordMilli(p, stats.cost)) return false;
    const builder = idleVillagers[0] ?? villagers[villagers.length - 1];
    if (builder === undefined) return false;
    cmds.push({ type: "build", playerId: pid, eids: [builder], building: id, x: -1, y: -1 });
    return true;
  };
  buildIfMissing("temple", 8);
  // farms when wild food runs thin near the base
  const foodNodesNearBase = findResourceNodes(sim, "food").filter((n) => {
    const dx = Position.x[n]! - Position.x[tc]!;
    const dy = Position.y[n]! - Position.y[tc]!;
    return dx * dx + dy * dy < 30_000 * 30_000;
  }).length;
  if (foodNodesNearBase < 6 && anyOf("farm").length < 8 && p.woodMilli >= 80_000 && underConstruction("farm") === 0) {
    const builder = idleVillagers[0] ?? villagers[0];
    if (builder !== undefined) cmds.push({ type: "build", playerId: pid, eids: [builder], building: "farm", x: -1, y: -1 });
  }
  if (p.age >= 1) {
    buildIfMissing("barracks", 10);
    buildIfMissing("armory", 12);
    if (p.age >= 2) buildIfMissing("market", 14);
  }
  // age-up when possible
  if (p.age < 3 && p.researchQueue.length === 0) {
    const techId = AGE_TECHS[p.age]!;
    const tech = getTechStats(techId);
    if (canAffordMilli(p, tech.cost) && active(AGE_PREREQ[p.age]!).length > 0) {
      const pool = getMinorPool(p.pantheon, p.majorGod, AGE_TIERS[p.age]!);
      cmds.push({ type: "research", playerId: pid, tech: techId, minorGod: pool[0]! });
    }
  }

  // ── favor: prayer crew (storm pantheon default) ──
  if (getPantheon(p.pantheon).favorMechanic.type === "skyward_chants" && active("temple").length > 0) {
    const praying = villagers.filter((e) => GatherTask.phase[e] === 5).length;
    if (praying < knobs.prayerVillagers && villagers.length >= 12) {
      const candidates = villagers.filter((e) => GatherTask.phase[e]! <= 3).slice(0, knobs.prayerVillagers - praying);
      if (candidates.length > 0) cmds.push({ type: "pray", playerId: pid, eids: candidates });
    }
  }

  // ── military production ──
  const barracks = active("barracks")[0];
  if (barracks !== undefined && military.length < knobs.armyTarget) {
    const unit = military.length % 3 === 2 ? "spearman" : "infantry_base";
    if (canAffordMilli(p, getUnitStats(unit).cost)) {
      if ((sim.trainQueues.get(barracks)?.length ?? 0) < 3) {
        cmds.push({ type: "train", playerId: pid, buildingEid: barracks, unit });
      }
    }
  }
  // myth units at the temple
  const temple = active("temple")[0];
  if (temple !== undefined && myth.length < knobs.mythTarget && p.minorGods.length > 0) {
    for (const minorId of p.minorGods) {
      const grants = getMinor(p.pantheon, minorId).grants.mythUnits;
      const trainable = grants.find((u) => canAffordMilli(p, getUnitStats(u).cost));
      if (trainable && (sim.trainQueues.get(temple)?.length ?? 0) < 2) {
        cmds.push({ type: "train", playerId: pid, buildingEid: temple, unit: trainable });
        break;
      }
    }
  }

  // ── defenseManager: enemies near base ⇒ recall the army ──
  const enemyNearBase = Array.from(query(sim.world, [UnitRef])).some((e) => {
    if (Owner.playerId[e] === pid) return false;
    if (sim.unitStats(e).unitClass === "villager") return false;
    const dx = Position.x[e]! - Position.x[tc]!;
    const dy = Position.y[e]! - Position.y[tc]!;
    return dx * dx + dy * dy < 20_000 * 20_000;
  });
  if (enemyNearBase && military.length > 0) {
    cmds.push({ type: "move", playerId: pid, eids: military, x: Position.x[tc]!, y: Position.y[tc]! });
    ai.attacking = false;
    return cmds; // defense overrides offense this cycle
  }

  // ── attackManager: launch waves at the enemy base ──
  const enemyTc = sim.players.map((pp, i) => ({ pp, i })).find(({ pp, i }) => i !== pid && pp.townCenterEid >= 0);
  if (enemyTc && military.length >= knobs.waveSize && sim.tick - ai.lastWaveTick > 15 * 60) {
    const target = enemyTc.pp.townCenterEid;
    cmds.push({ type: "move", playerId: pid, eids: military, x: Position.x[target]!, y: Position.y[target]! });
    ai.lastWaveTick = sim.tick;
    ai.attacking = true;
  }

  // ── god powers: drop on the enemy base when affordable ──
  if (knobs.usePowers && enemyTc) {
    for (const minorId of p.minorGods) {
      let powerId: string;
      try {
        powerId = getMinor(p.pantheon, minorId).grants.power;
      } catch {
        continue;
      }
      const power = getPower(powerId);
      const cost = nextCastCostMilli(power, p.castCounts[powerId] ?? 0);
      if ((p.powerReadyTick[powerId] ?? 0) <= sim.tick && p.favorMilli >= cost) {
        const target = enemyTc.pp.townCenterEid;
        cmds.push({ type: "cast_power", playerId: pid, power: powerId, x: Position.x[target]!, y: Position.y[target]! });
        break;
      }
    }
  }

  void CombatState;
  return cmds;
}

function canAffordMilli(p: ReturnType<typeof getPlayer>, cost: { food: number; wood: number; gold: number; favor: number }): boolean {
  return (
    p.foodMilli >= cost.food * 1000 &&
    p.woodMilli >= cost.wood * 1000 &&
    p.goldMilli >= cost.gold * 1000 &&
    p.favorMilli >= cost.favor * 1000
  );
}
