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
import { isWaterTile, nearestWaterTile } from "../sim/sim";
import { getPower, nextCastCostMilli } from "../sim/powers";
import { getUnitStats } from "../sim/unitdata";
import { getBuildingStats } from "../sim/buildingdata";

export type AiDifficulty = "easiest" | "easy" | "medium" | "hard" | "titan";

interface Knobs {
  decisionIntervalTicks: number;
  villagerTarget: number;
  armyTarget: number;
  waveSize: number;
  usePowers: boolean;
  prayerVillagers: number;
  mythTarget: number;
  /** no attack wave (land or naval) before this game-minute — the classic difficulty lever */
  firstWaveMin: number;
}

const KNOBS = (aiJson as { difficulties: Record<string, Knobs> }).difficulties;

export interface AiState {
  playerId: number;
  difficulty: AiDifficulty;
  decisionIntervalTicks: number;
  /** tick of the last launched attack wave */
  lastWaveTick: number;
  attacking: boolean;
  /** naval invasion machine: 0 idle · 1 boarding · 2 sailing */
  invasionPhase: 0 | 1 | 2;
  invasionShips: number[];
  invasionSince: number;
  /** cached land-path answer to the current enemy TC (BFS is not free) */
  reachCache: { target: number; ok: boolean; tick: number } | null;
}

export function createAiState(playerId: number, difficulty: AiDifficulty, _seed: number): AiState {
  return {
    playerId,
    difficulty,
    decisionIntervalTicks: KNOBS[difficulty]!.decisionIntervalTicks,
    lastWaveTick: -100000,
    attacking: false,
    invasionPhase: 0,
    invasionShips: [],
    invasionSince: 0,
    reachCache: null,
  };
}

/** BFS over the nav grid: is there a land path between two entities' tiles?
 * Cached per enemy TC for 5 game-minutes — island topology barely changes. */
function landReachable(sim: Sim, ai: AiState, fromEid: number, toEid: number): boolean {
  if (ai.reachCache && ai.reachCache.target === toEid && sim.tick - ai.reachCache.tick < 15 * 300) {
    return ai.reachCache.ok;
  }
  const { Position } = sim.stores;
  const g = sim.navGrid;
  const sx = Math.trunc(Position.x[fromEid]! / 1000);
  const sy = Math.trunc(Position.y[fromEid]! / 1000);
  const gx = Math.trunc(Position.x[toEid]! / 1000);
  const gy = Math.trunc(Position.y[toEid]! / 1000);
  const seen = new Uint8Array(g.size * g.size);
  // the TC's own footprint is blocked — seed the BFS from the walkable ring around it
  let qx: number[] = [];
  let qy: number[] = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      if (x < 0 || y < 0 || x >= g.size || y >= g.size) continue;
      const k = y * g.size + x;
      if (!g.passable[k] || seen[k]) continue;
      seen[k] = 1;
      qx.push(x);
      qy.push(y);
    }
  }
  let ok = false;
  while (qx.length > 0 && !ok) {
    const nqx: number[] = [];
    const nqy: number[] = [];
    for (let i = 0; i < qx.length; i++) {
      const x = qx[i]!;
      const y = qy[i]!;
      // TC footprints are unwalkable — arriving beside the goal counts
      if (Math.abs(x - gx) <= 4 && Math.abs(y - gy) <= 4) { ok = true; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.size || ny >= g.size) continue;
        const k = ny * g.size + nx;
        if (seen[k] || !g.passable[k]) continue;
        seen[k] = 1;
        nqx.push(nx);
        nqy.push(ny);
      }
    }
    qx = nqx;
    qy = nqy;
  }
  ai.reachCache = { target: toEid, ok, tick: sim.tick };
  return ok;
}

const AGE_TECHS = ["age_classical", "age_heroic", "age_mythic"] as const;
const AGE_TIERS = ["classical", "heroic", "mythic"] as const;
const AGE_PREREQ = ["temple", "armory", "market"] as const;
const HERO_OF: Record<string, string> = {
  auryan_dawn: "radiant_champion",
  verdant_deep: "tide_seer",
  ashen_forge: "forgeborn",
  storm_concord: "sky_herald",
};

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
  // navy: a coastal base builds a dock and works the fish
  if (anyOf("dock").length === 0 && underConstruction("dock") === 0 && p.woodMilli >= 200_000) {
    const btx = Math.trunc(Position.x[tc]! / 1000);
    const bty = Math.trunc(Position.y[tc]! / 1000);
    let dockSite: { x: number; y: number } | null = null;
    outer: for (let r = 4; r < 34; r += 2) {
      for (let a = 0; a < 12; a++) {
        const x = btx + Math.trunc(Math.cos((a / 12) * 6.283) * r);
        const y = bty + Math.trunc(Math.sin((a / 12) * 6.283) * r);
        let coastal = false;
        for (let dy = -2; dy <= 3 && !coastal; dy++) for (let dx = -2; dx <= 3; dx++) if (isWaterTile(sim, x + dx, y + dy)) { coastal = true; break; }
        if (coastal && !isWaterTile(sim, x, y)) { dockSite = { x, y }; break outer; }
      }
    }
    const builder = idleVillagers[0] ?? villagers[0];
    if (dockSite && builder !== undefined) {
      cmds.push({ type: "build", playerId: pid, eids: [builder], building: "dock", x: dockSite.x * 1000, y: dockSite.y * 1000 });
    }
  }
  {
    const dock = anyOf("dock")[0];
    const boats = myUnits.filter((e) => sim.unitStats(e).id === "fishing_boat");
    if (dock !== undefined && boats.length < 2 && p.woodMilli >= 100_000) {
      cmds.push({ type: "train", playerId: pid, buildingEid: dock, unit: "fishing_boat" });
    }
    // idle boats work the nearest fish school
    for (const boat of boats) {
      if (GatherTask.phase[boat] !== 0) continue;
      let best = -1;
      let bd = Number.MAX_SAFE_INTEGER;
      for (const n of query(sim.world, [sim.stores.ResourceNode])) {
        if (sim.stores.ResourceNode.resType[n] !== 6 || sim.stores.ResourceNode.amountMilli[n]! <= 0) continue;
        const dx = Position.x[n]! - Position.x[boat]!;
        const dy = Position.y[n]! - Position.y[boat]!;
        if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = n; }
      }
      if (best >= 0) cmds.push({ type: "gather", playerId: pid, eids: [boat], nodeEid: best });
    }
  }
  // expansion: claim a free settlement with a second town center when rich
  // never at the cost of the age ladder: expand only from a deep surplus
  if (p.age >= 2 && anyOf("town_center").length < 2 && underConstruction("town_center") === 0 &&
      p.woodMilli >= 800_000 && p.goldMilli >= 1_500_000 && p.foodMilli >= 1_500_000) {
    const taken = (st: { x: number; y: number }) =>
      Array.from(query(sim.world, [Building])).some((e) => {
        const bx = Math.trunc(Position.x[e]! / 1000);
        const by = Math.trunc(Position.y[e]! / 1000);
        return sim.buildingIdOf(e) === "town_center" && Math.abs(bx - st.x) <= 6 && Math.abs(by - st.y) <= 6;
      });
    const free = sim.settlements.find((st) => !taken(st));
    const builder = idleVillagers[0] ?? villagers[0];
    if (free && builder !== undefined) {
      cmds.push({ type: "build", playerId: pid, eids: [builder], building: "town_center", x: free.x * 1000, y: free.y * 1000 });
    }
  }
  // mythic endgame: a rich AI reaches for the wonder (second victory path)
  if (p.age >= 3 && anyOf("wonder").length === 0 && underConstruction("wonder") === 0 &&
      p.foodMilli >= 1_400_000 && p.woodMilli >= 1_400_000 && p.goldMilli >= 1_400_000) {
    const builder = idleVillagers[0] ?? villagers[0];
    if (builder !== undefined) cmds.push({ type: "build", playerId: pid, eids: [builder], building: "wonder", x: -1, y: -1 });
  }
  if (p.age >= 1) {
    buildIfMissing("barracks", 10);
    buildIfMissing("armory", 12);
    if (p.age >= 2) buildIfMissing("market", 14);
    // static defense scales with ambition: medium keeps 1 tower, hard/titan 2 —
    // but the age ladder ALWAYS eats first (reserve the next age-up's cost)
    const nextAgeCost = p.age < 3 ? getTechStats(AGE_TECHS[p.age]!).cost : null;
    const surplusAfterAge = (foodNeed: number, goldNeed: number): boolean =>
      p.foodMilli >= foodNeed + (nextAgeCost ? nextAgeCost.food * 1000 : 0) &&
      p.goldMilli >= goldNeed + (nextAgeCost ? nextAgeCost.gold * 1000 : 0);
    const towerTarget = Math.min(2, Math.trunc(knobs.armyTarget / 10));
    if (towerTarget > 0 && anyOf("tower").length < towerTarget && underConstruction("tower") === 0 &&
        p.woodMilli >= 250_000 && surplusAfterAge(0, 180_000)) {
      const builder = idleVillagers[0] ?? villagers[0];
      if (builder !== undefined) cmds.push({ type: "build", playerId: pid, eids: [builder], building: "tower", x: -1, y: -1 });
    }
    // armory line upgrades from what's left AFTER the age reserve
    if (active("armory").length > 0 && p.researchQueue.length === 0 && surplusAfterAge(450_000, 350_000)) {
      const line = p.age >= 2 ? ["bronze_weapons", "bronze_mail", "iron_weapons", "iron_mail"] : ["bronze_weapons", "bronze_mail"];
      const next = line.find((t) => !p.researchedTechs.includes(t));
      if (next) cmds.push({ type: "research", playerId: pid, tech: next });
    }
  }
  // a hero on relic duty: train one, walk it from relic to relic, bank at the temple
  {
    const heroes = myUnits.filter((e) => sim.unitStats(e).unitClass === "hero");
    const temple = active("temple")[0];
    if (heroes.length === 0 && p.age >= 1 && villagers.length >= 12 && temple !== undefined &&
        canAffordMilli(p, getUnitStats(HERO_OF[p.pantheon] ?? "sky_herald").cost) &&
        (sim.trainQueues.get(temple)?.length ?? 0) === 0) {
      cmds.push({ type: "train", playerId: pid, buildingEid: temple, unit: HERO_OF[p.pantheon] ?? "sky_herald" });
    }
    const hero = heroes[0];
    if (hero !== undefined && !sim.garrisonOf.has(hero)) {
      if (sim.relicHolder.get(hero)) {
        if (temple !== undefined) cmds.push({ type: "move", playerId: pid, eids: [hero], x: Position.x[temple]!, y: Position.y[temple]! });
      } else {
        const { ResourceNode } = sim.stores;
        let relic = -1;
        let rd = Number.MAX_SAFE_INTEGER;
        for (const n of Array.from(query(sim.world, [ResourceNode])).sort((a, b) => a - b)) {
          if (ResourceNode.resType[n] !== 4 || ResourceNode.amountMilli[n]! <= 0) continue;
          const dx = Position.x[n]! - Position.x[hero]!;
          const dy = Position.y[n]! - Position.y[hero]!;
          if (dx * dx + dy * dy < rd) { rd = dx * dx + dy * dy; relic = n; }
        }
        if (relic >= 0 && MoveState.active[hero] !== 1) {
          cmds.push({ type: "move", playerId: pid, eids: [hero], x: Position.x[relic]!, y: Position.y[relic]! });
        }
      }
    }
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
  // land path ⇒ march; no land path (archipelago/island) ⇒ ferry the wave across
  const enemyTc = sim.players.map((pp, i) => ({ pp, i })).find(({ pp, i }) => i !== pid && pp.townCenterEid >= 0);
  const warTime = sim.tick >= (knobs.firstWaveMin ?? 0) * 900;
  if (enemyTc && warTime) {
    const target = enemyTc.pp.townCenterEid;
    if (landReachable(sim, ai, tc, target)) {
      if (military.length >= knobs.waveSize && sim.tick - ai.lastWaveTick > 15 * 60) {
        cmds.push({ type: "move", playerId: pid, eids: military, x: Position.x[target]!, y: Position.y[target]! });
        ai.lastWaveTick = sim.tick;
        ai.attacking = true;
      }
    } else {
      const barges = myUnits.filter((e) => sim.unitStats(e).id === "transport_barge");
      const dock = active("dock")[0];
      // invasion force scales with ambition: enough barges to lift the wave (max 2)
      const bargeTarget = Math.min(2, Math.max(1, Math.ceil(Math.min(knobs.waveSize, 12) / 6)));
      ai.invasionShips = ai.invasionShips.filter((s) => myUnits.includes(s));
      if (ai.invasionPhase !== 0 && ai.invasionShips.length === 0) {
        ai.invasionPhase = 0; // the flotilla sank — start over
      }
      if (ai.invasionPhase === 0) {
        if (barges.length < bargeTarget) {
          if (dock !== undefined && p.woodMilli >= 100_000 && (sim.trainQueues.get(dock)?.length ?? 0) === 0) {
            cmds.push({ type: "train", playerId: pid, buildingEid: dock, unit: "transport_barge" });
          }
        } else if (military.length >= Math.min(knobs.waveSize, 6 * bargeTarget) && sim.tick - ai.lastWaveTick > 15 * 60) {
          const free = military.filter((e) => !sim.garrisonOf.has(e));
          const ships = barges.slice(0, bargeTarget);
          let boarded = 0;
          for (const ship of ships) {
            const squad = free.slice(boarded, boarded + 6);
            if (squad.length === 0) break;
            cmds.push({ type: "garrison", playerId: pid, eids: squad, buildingEid: ship });
            boarded += squad.length;
          }
          if (boarded > 0) {
            ai.invasionPhase = 1;
            ai.invasionShips = ships;
            ai.invasionSince = sim.tick;
          }
        }
      } else if (ai.invasionPhase === 1) {
        const aboard = ai.invasionShips.reduce((n, s) => n + (sim.garrisons.get(s)?.length ?? 0), 0);
        const capacity = 6 * ai.invasionShips.length;
        const full = aboard >= Math.min(capacity, military.length + aboard);
        const waited = sim.tick - ai.invasionSince > 15 * 90;
        if (full || (waited && aboard > 0)) {
          const shore = nearestWaterTile(sim, Math.trunc(Position.x[target]! / 1000), Math.trunc(Position.y[target]! / 1000));
          if (shore) {
            cmds.push({ type: "move", playerId: pid, eids: [...ai.invasionShips], x: shore.x * 1000 + 500, y: shore.y * 1000 + 500 });
            ai.invasionPhase = 2;
            ai.invasionSince = sim.tick;
          }
        } else if (waited) {
          ai.invasionPhase = 0; // nobody made it aboard — re-plan
          ai.invasionShips = [];
        }
      } else {
        // each barge unloads as IT arrives; the wave regroups on the beach
        const landed: number[] = [];
        let cargo = 0;
        for (const ship of ai.invasionShips) {
          const troops = sim.garrisons.get(ship) ?? [];
          cargo += troops.length;
          const dx = Position.x[ship]! - Position.x[target]!;
          const dy = Position.y[ship]! - Position.y[target]!;
          if (dx * dx + dy * dy < 10_000 * 10_000 && troops.length > 0) {
            landed.push(...troops);
            cmds.push({ type: "ungarrison", playerId: pid, buildingEid: ship });
          }
        }
        if (landed.length > 0) {
          cmds.push({ type: "attack_move", playerId: pid, eids: landed, x: Position.x[target]!, y: Position.y[target]! });
          ai.lastWaveTick = sim.tick;
          ai.attacking = true;
        }
        if (cargo === 0 || sim.tick - ai.invasionSince > 15 * 240) {
          ai.invasionPhase = 0; // delivered (or lost) — plan the next lift
          ai.invasionShips = [];
        }
      }
    }
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
