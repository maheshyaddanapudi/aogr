/**
 * Combat: target acquisition, chase, cooldown attacks, hack/pierce/crush/divine
 * damage with armor% and counter multipliers (all from data/units.json),
 * deaths with deterministic entity removal. Buildings fight back later (towers,
 * Phase 5+); they already take damage and die (footprint unblocks).
 */
import { entityExists, hasComponent, query, removeEntity } from "bitecs";
import type { Checksum } from "./checksum";
import type { Command } from "./commands";
import { isqrt } from "./fixed";
import { getBuildingStatsByIndex } from "./buildingdata";
import type { UnitStats } from "./unitdata";
// eslint-disable-next-line import/no-cycle -- runtime-safe: functions called post-init
import { releaseGarrison, type Sim } from "./sim";
// eslint-disable-next-line import/no-cycle -- runtime-safe
import { applyModifiers, effectiveArmor } from "./research";
// eslint-disable-next-line import/no-cycle -- runtime-safe
import { creditCombatFavor } from "./powers";

const MELEE_REACH_PAD_FP = 250;
/** chase re-acquisition scan interval is every tick but capped by LOS */

export interface SimEvents {
  fired: Array<{ from: number; to: number; fromX: number; fromY: number; toX: number; toY: number; ranged: boolean }>;
  hits: Array<{ x: number; y: number }>;
  deaths: Array<{ eid: number; x: number; y: number; playerId: number; unitClass: string | null; unitId: string | null }>;
  powerCasts: Array<{ power: string; playerId: number; x: number; y: number }>;
}

export function emptyEvents(): SimEvents {
  return { fired: [], hits: [], deaths: [], powerCasts: [] };
}

export function handleCombatCommand(sim: Sim, cmd: Command): boolean {
  if (cmd.type === "stance") {
    const { CombatState, Owner, UnitRef } = sim.stores;
    const stance = Math.max(0, Math.min(2, cmd.stance | 0));
    for (const eid of [...cmd.eids].sort((a, b) => a - b)) {
      if (Owner.playerId[eid] !== cmd.playerId || !hasComponent(sim.world, eid, UnitRef)) continue;
      if (!hasComponent(sim.world, eid, CombatState)) continue;
      CombatState.aggressive[eid] = stance;
      if (stance === 0) CombatState.targetEid[eid] = -1;
    }
    return true;
  }
  if (cmd.type !== "attack") return false;
  const { CombatState, Owner, UnitRef, MoveState } = sim.stores;
  const sorted = [...cmd.eids].sort((a, b) => a - b);
  for (const eid of sorted) {
    if (Owner.playerId[eid] !== cmd.playerId || !hasComponent(sim.world, eid, UnitRef)) continue;
    if (!hasComponent(sim.world, eid, CombatState)) continue;
    CombatState.aggressive[eid] = 1;
    CombatState.targetEid[eid] = cmd.targetEid;
    MoveState.active[eid] = 0; // combat steering takes over
  }
  return true;
}

function armorOf(sim: Sim, target: number): { hack: number; pierce: number; crush: number } {
  const { UnitRef, Building } = sim.stores;
  if (hasComponent(sim.world, target, Building)) {
    return getBuildingStatsByIndex(Building.typeIndex[target]!).armor;
  }
  void UnitRef;
  return sim.unitStats(target).armor;
}

function multiplierFor(stats: UnitStats, sim: Sim, target: number): number {
  const { Building } = sim.stores;
  if (hasComponent(sim.world, target, Building)) {
    const bid = getBuildingStatsByIndex(Building.typeIndex[target]!).id;
    return stats.multipliers1000[bid] ?? 1000;
  }
  const t = sim.unitStats(target);
  return stats.multipliers1000[t.id] ?? stats.multipliers1000[t.unitClass] ?? 1000;
}

/** Per-hit damage in hp100 units — the exact formula documented in docs/01 §3. */
export function computeDamage100(sim: Sim, attacker: number, target: number): number {
  const stats = sim.unitStats(attacker);
  const atk = stats.attack!;
  const { Building, Owner } = sim.stores;
  const isBuildingTarget = hasComponent(sim.world, target, Building);
  const baseArmor = armorOf(sim, target);
  // researched modifiers: attacker damage, defender armor (units only)
  const attackerPid = Owner.playerId[attacker]!;
  const damage100 = applyModifiers(sim, attackerPid, [stats.unitClass, stats.id], "attack.damage", atk.damage100);
  const armor = isBuildingTarget
    ? baseArmor
    : {
        hack: effectiveArmor(sim, target, "hack", baseArmor.hack),
        pierce: effectiveArmor(sim, target, "pierce", baseArmor.pierce),
        crush: effectiveArmor(sim, target, "crush", baseArmor.crush),
      };
  const mult = multiplierFor(stats, sim, target);
  const mainRed = atk.type === "divine" ? 0 : armor[atk.type];
  let dmg = Math.trunc((Math.trunc((damage100 * mult) / 1000) * (100 - mainRed)) / 100);
  if (atk.crushDamage100 > 0) {
    const crush100 = applyModifiers(sim, attackerPid, [stats.unitClass, stats.id], "attack.crushDamage", atk.crushDamage100);
    dmg += Math.trunc((Math.trunc((crush100 * mult) / 1000) * (100 - armor.crush)) / 100);
  }
  return Math.max(1, dmg);
}

function reachFp(sim: Sim, attacker: number, target: number): number {
  const stats = sim.unitStats(attacker);
  const { Building } = sim.stores;
  const targetRadius = hasComponent(sim.world, target, Building)
    ? (getBuildingStatsByIndex(Building.typeIndex[target]!).size * 710)
    : sim.unitRadiusFp(target);
  const base = stats.radiusFp + targetRadius + MELEE_REACH_PAD_FP;
  return stats.attack!.rangeFp > 0 ? stats.attack!.rangeFp + targetRadius : base;
}

export function targetAliveAndValid(sim: Sim, target: number): boolean {
  if (target < 0 || !entityExists(sim.world, target)) return false;
  if (sim.garrisonOf.has(target)) return false; // sheltered inside a building
  const { Health } = sim.stores;
  return hasComponent(sim.world, target, Health) && Health.hp100[target]! > 0;
}

function acquireTarget(sim: Sim, eid: number): number {
  const { Position, Owner, UnitRef, Health } = sim.stores;
  const stats = sim.unitStats(eid);
  const los = stats.losFp;
  const px = Position.x[eid]!;
  const py = Position.y[eid]!;
  const me = Owner.playerId[eid]!;
  let best = -1;
  let bestD = Number.MAX_SAFE_INTEGER;
  // nearest enemy unit first; buildings only if no unit found
  for (const other of query(sim.world, [UnitRef, Health])) {
    if (Owner.playerId[other] === me || Health.hp100[other]! <= 0 || sim.garrisonOf.has(other)) continue;
    const dx = Position.x[other]! - px;
    const dy = Position.y[other]! - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = other;
    }
  }
  if (best >= 0 && bestD <= los * los) return best;
  // no enemy unit in sight: siege the nearest enemy building — this is what
  // lets attack waves (AI and human) actually win by conquest
  const { Building } = sim.stores;
  best = -1;
  bestD = Number.MAX_SAFE_INTEGER;
  for (const other of query(sim.world, [Building, Health])) {
    if (Owner.playerId[other] === me || Health.hp100[other]! <= 0) continue;
    const dx = Position.x[other]! - px;
    const dy = Position.y[other]! - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = other;
    }
  }
  if (best >= 0 && bestD <= los * los) return best;
  return -1;
}

export function combatSystem(sim: Sim): void {
  const { Position, Health, CombatState, MoveState } = sim.stores;
  const fighters = Array.from(query(sim.world, [CombatState])).sort((a, b) => a - b);

  for (const eid of fighters) {
    if (Health.hp100[eid]! <= 0 || sim.garrisonOf.has(eid)) continue;
    if ((sim.stunnedUntil.get(eid) ?? 0) > sim.tick) continue; // petrified
    if (CombatState.cooldown[eid]! > 0) CombatState.cooldown[eid] = CombatState.cooldown[eid]! - 1;
    if (CombatState.aggressive[eid] === 0) continue; // 1 aggressive, 2 hold-ground

    let target = CombatState.targetEid[eid]!;
    if (!targetAliveAndValid(sim, target)) {
      target = acquireTarget(sim, eid);
      CombatState.targetEid[eid] = target;
    }
    if (target < 0) continue;

    const dx = Position.x[target]! - Position.x[eid]!;
    const dy = Position.y[target]! - Position.y[eid]!;
    const d = isqrt(dx * dx + dy * dy);
    const reach = reachFp(sim, eid, target);
    if (d <= reach) {
      MoveState.active[eid] = 0;
      if (CombatState.cooldown[eid] === 0) {
        const stats = sim.unitStats(eid);
        CombatState.cooldown[eid] = stats.attack!.cooldownTicks;
        const dmg = computeDamage100(sim, eid, target);
        Health.hp100[target] = Health.hp100[target]! - dmg;
        creditCombatFavor(sim, sim.stores.Owner.playerId[eid]!, dmg);
        const special = stats.special;
        if (special) {
          if (special.executePermille > 0 && Health.hp100[target]! > 0 && Health.hp100[target]! * 1000 < sim.unitStats(target).hp100 * special.executePermille && hasComponent(sim.world, target, sim.stores.UnitRef)) {
            Health.hp100[target] = 0; // devoured whole
          }
          if (special.stunTicks > 0 && Math.trunc(sim.tick / stats.attack!.cooldownTicks) % 4 === 0) {
            sim.stunnedUntil.set(target, sim.tick + special.stunTicks);
          }
          if (special.lifestealPermille > 0) {
            Health.hp100[eid] = Math.min(stats.hp100, Health.hp100[eid]! + Math.trunc((dmg * special.lifestealPermille) / 1000));
          }
          if (special.splashRadiusFp > 0) {
            const { Owner: Own, UnitRef: UR, Position: Pos } = sim.stores;
            const me = Own.playerId[eid]!;
            const splash = Math.trunc((dmg * special.splashPermille) / 1000);
            for (const other of Array.from(query(sim.world, [UR, Health])).sort((a, b) => a - b)) {
              if (other === target || Own.playerId[other] === me || Health.hp100[other]! <= 0 || sim.garrisonOf.has(other)) continue;
              const sdx = Pos.x[other]! - Pos.x[target]!;
              const sdy = Pos.y[other]! - Pos.y[target]!;
              if (sdx * sdx + sdy * sdy <= special.splashRadiusFp * special.splashRadiusFp) {
                Health.hp100[other] = Health.hp100[other]! - splash;
              }
            }
          }
        }
        sim.events.fired.push({
          from: eid,
          to: target,
          fromX: Position.x[eid]!,
          fromY: Position.y[eid]!,
          toX: Position.x[target]!,
          toY: Position.y[target]!,
          ranged: stats.attack!.rangeFp > 0,
        });
        sim.events.hits.push({ x: Position.x[target]!, y: Position.y[target]! });
      }
    }
    // out of reach: chase steering happens in the movement system (state-derived)
  }

  // defensive buildings fire (tick-phase cooldown — no extra serialized state)
  {
    const { Position, Owner, UnitRef, Building } = sim.stores;
    const bldgs = Array.from(query(sim.world, [Building, Health])).sort((a, b) => a - b);
    for (const b of bldgs) {
      if (Building.active[b] !== 1 || Health.hp100[b]! <= 0) continue;
      const bstats = getBuildingStatsByIndex(Building.typeIndex[b]!);
      const atk = bstats.attack;
      if (!atk) continue;
      if (sim.tick % atk.cooldownTicks !== b % atk.cooldownTicks) continue;
      const me = Owner.playerId[b]!;
      let best = -1;
      let bestD = Number.MAX_SAFE_INTEGER;
      for (const u of query(sim.world, [UnitRef, Health])) {
        if (Owner.playerId[u] === me || Health.hp100[u]! <= 0 || sim.garrisonOf.has(u)) continue;
        const dx = Position.x[u]! - Position.x[b]!;
        const dy = Position.y[u]! - Position.y[b]!;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; best = u; }
      }
      if (best < 0 || bestD > atk.rangeFp * atk.rangeFp) continue;
      const armor = sim.unitStats(best).armor;
      const reduce = atk.type === "pierce" ? armor.pierce : atk.type === "crush" ? armor.crush : armor.hack;
      // every garrisoned occupant adds arrows (+15% damage each)
      const occupants = (sim.garrisons.get(b) ?? []).length;
      const dmg = Math.max(100, Math.trunc((Math.trunc((atk.damage100 * (100 + 15 * occupants)) / 100) * (100 - reduce)) / 100));
      Health.hp100[best] = Health.hp100[best]! - dmg;
      sim.events.fired.push({ from: b, to: best, fromX: Position.x[b]!, fromY: Position.y[b]!, toX: Position.x[best]!, toY: Position.y[best]!, ranged: true });
      sim.events.hits.push({ x: Position.x[best]!, y: Position.y[best]! });
    }
  }

  if (sim.tick % 15 === 0) {
    for (const [k, until] of Array.from(sim.stunnedUntil.entries()).sort((a, b) => a[0] - b[0])) {
      if (until <= sim.tick) sim.stunnedUntil.delete(k);
    }
  }
  // hero heal aura + myth regeneration: every second
  if (sim.tick % 15 === 0) {
    const { Position, Owner, UnitRef } = sim.stores;
    const all = Array.from(query(sim.world, [UnitRef, Health])).sort((a, b) => a - b);
    for (const u of all) {
      const sp = sim.unitStats(u).special;
      if (sp && sp.regenPer15T100 > 0 && Health.hp100[u]! > 0) {
        Health.hp100[u] = Math.min(sim.unitStats(u).hp100, Health.hp100[u]! + sp.regenPer15T100);
      }
    }
    for (const h of all) {
      if (Health.hp100[h]! <= 0 || sim.unitStats(h).unitClass !== "hero") continue;
      for (const u of all) {
        if (u === h || Owner.playerId[u] !== Owner.playerId[h] || Health.hp100[u]! <= 0) continue;
        const max = sim.unitStats(u).hp100;
        if (Health.hp100[u]! >= max) continue;
        const dx = Position.x[u]! - Position.x[h]!;
        const dy = Position.y[u]! - Position.y[h]!;
        if (dx * dx + dy * dy > 6000 * 6000) continue;
        Health.hp100[u] = Math.min(max, Health.hp100[u]! + 200);
      }
    }
  }

  // deaths after all attacks, ascending order
  const dead: number[] = [];
  for (const eid of query(sim.world, [Health])) {
    if (Health.hp100[eid]! <= 0) dead.push(eid);
  }
  dead.sort((a, b) => a - b);
  for (const eid of dead) {
    // razed building: occupants step out; sunk transport: passengers drown
    if (sim.garrisons.has(eid)) {
      if (hasComponent(sim.world, eid, sim.stores.UnitRef)) {
        for (const m of [...(sim.garrisons.get(eid) ?? [])].sort((a, b) => a - b)) {
          if (Health.hp100[m]! > 0) {
            Health.hp100[m] = 0;
            dead.push(m);
          }
        }
        sim.garrisons.delete(eid);
      } else {
        releaseGarrison(sim, eid);
      }
    }
    // dead unit: drop out of any garrison bookkeeping + patrols + relics
    const home = sim.garrisonOf.get(eid);
    if (home !== undefined) {
      sim.garrisonOf.delete(eid);
      sim.garrisons.set(home, (sim.garrisons.get(home) ?? []).filter((m) => m !== eid));
    }
    sim.garrisonIntent.delete(eid);
    sim.patrols.delete(eid);
    sim.relicHolder.delete(eid);
    killEntity(sim, eid);
  }
}

export function killEntity(sim: Sim, eid: number): void {
  const { Position, Owner, UnitRef, Building } = sim.stores;
  const isBuilding = hasComponent(sim.world, eid, Building);
  const isUnit = hasComponent(sim.world, eid, UnitRef);
  sim.events.deaths.push({
    eid,
    x: Position.x[eid]!,
    y: Position.y[eid]!,
    playerId: Owner.playerId[eid]!,
    unitClass: isUnit ? sim.unitStats(eid).unitClass : null,
    unitId: isUnit ? sim.unitStats(eid).id : null,
  });
  if (isBuilding) {
    // unblock the footprint
    const stats = getBuildingStatsByIndex(Building.typeIndex[eid]!);
    const g = sim.navGrid;
    for (let y = Building.tileY[eid]!; y < Building.tileY[eid]! + stats.size; y++) {
      for (let x = Building.tileX[eid]!; x < Building.tileX[eid]! + stats.size; x++) {
        if (x >= 0 && y >= 0 && x < g.size && y < g.size) g.passable[y * g.size + x] = 1;
      }
    }
    sim.flowFields.clear();
    sim.trainQueues.delete(eid);
    for (const p of sim.players) {
      if (p.townCenterEid === eid) p.townCenterEid = -1;
    }
  }
  removeEntity(sim.world, eid);
}

export function hashCombat(sim: Sim, c: Checksum): void {
  const { Health, CombatState } = sim.stores;
  for (const eid of Array.from(query(sim.world, [Health])).sort((a, b) => a - b)) {
    c.addI32(Health.hp100[eid]!);
  }
  for (const eid of Array.from(query(sim.world, [CombatState])).sort((a, b) => a - b)) {
    c.addI32(CombatState.targetEid[eid]!);
    c.addI32(CombatState.cooldown[eid]!);
    c.addI32(CombatState.aggressive[eid]!);
  }
}
