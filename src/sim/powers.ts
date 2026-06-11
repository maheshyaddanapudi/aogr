/**
 * God powers + the four favor mechanics, all parameterized by data files.
 * Powers are reusable: first cast free, then baseFavorCost ramping ×1.5 per
 * recast, independent cooldowns. Effects run as activeEffects entries
 * (serialized + hashed) processed each tick.
 */
import { hasComponent, query } from "bitecs";
import type { Checksum } from "./checksum";
import type { Command } from "./commands";
import godpowersJson from "../../data/godpowers.json";
import { getPantheon, getMinor } from "./pantheondata";
import { getPlayer } from "./economy";
import { applyModifiers } from "./research";
// eslint-disable-next-line import/no-cycle -- runtime-safe
import { spawnUnitEntity, type Sim } from "./sim";
import { TICK_RATE } from "./fixed";

interface RawPower {
  name: string;
  pantheon: string;
  grantedBy: string;
  type: string;
  firstCastFree: boolean;
  baseFavorCost: number;
  costRampPercent: number;
  cooldownSeconds: number;
  params: Record<string, number | string | boolean | string[]>;
}

const POWERS = (godpowersJson as unknown as { powers: Record<string, RawPower> }).powers;

export function getPower(id: string): RawPower {
  const p = POWERS[id];
  if (!p) throw new Error(`unknown power: ${id}`);
  return p;
}

export interface ActiveEffect {
  powerId: string;
  playerId: number;
  x: number;
  y: number;
  endTick: number;
  /** for DoT: damage100 per tick; for heals: negative; for summons: the summoned eid */
  data: number;
  /** remaining damage/heal pool (×100) so totals are exact; 0 for summons */
  pool: number;
}

/** favor cost of the next cast in milli-favor (first cast free, ramp ×1.5ⁿ). */
export function nextCastCostMilli(power: RawPower, castCount: number): number {
  if (castCount === 0 && power.firstCastFree) return 0;
  const paidCasts = power.firstCastFree ? castCount - 1 : castCount;
  let cost = power.baseFavorCost * 1000;
  for (let i = 0; i < paidCasts; i++) {
    cost = Math.trunc((cost * (100 + power.costRampPercent)) / 100);
  }
  return cost;
}

function playerGrantedPowers(sim: Sim, playerId: number): string[] {
  const p = getPlayer(sim, playerId);
  const granted: string[] = [];
  for (const minorId of p.minorGods) {
    try {
      granted.push(getMinor(p.pantheon, minorId).grants.power);
    } catch {
      /* minor from another pantheon: ignore */
    }
  }
  return granted;
}

function dealAreaDamage(sim: Sim, x: number, y: number, radiusFp: number, damage100: number, attackerPid: number): void {
  const { Position, Health, Owner, UnitRef } = sim.stores;
  const eids = Array.from(query(sim.world, [Position, Health, UnitRef])).sort((a, b) => a - b);
  for (const eid of eids) {
    if (Owner.playerId[eid] === attackerPid) continue;
    const dx = Position.x[eid]! - x;
    const dy = Position.y[eid]! - y;
    if (dx * dx + dy * dy <= radiusFp * radiusFp) {
      Health.hp100[eid] = Health.hp100[eid]! - damage100; // divine: ignores armor
      sim.events.hits.push({ x: Position.x[eid]!, y: Position.y[eid]! });
    }
  }
}

function healArea(sim: Sim, x: number, y: number, radiusFp: number, heal100: number, pid: number): void {
  const { Position, Health, Owner, UnitRef } = sim.stores;
  for (const eid of Array.from(query(sim.world, [Position, Health, UnitRef])).sort((a, b) => a - b)) {
    if (Owner.playerId[eid] !== pid) continue;
    const dx = Position.x[eid]! - x;
    const dy = Position.y[eid]! - y;
    if (dx * dx + dy * dy <= radiusFp * radiusFp) {
      const max = sim.unitStats(eid).hp100;
      Health.hp100[eid] = Math.min(max, Health.hp100[eid]! + heal100);
    }
  }
}

export function handlePowerCommand(sim: Sim, cmd: Command): boolean {
  if (cmd.type !== "cast_power") return false;
  const p = getPlayer(sim, cmd.playerId);
  let power: RawPower;
  try {
    power = getPower(cmd.power);
  } catch {
    return true;
  }
  if (!playerGrantedPowers(sim, cmd.playerId).includes(cmd.power)) return true;
  if ((p.powerReadyTick[cmd.power] ?? 0) > sim.tick) return true;
  const castCount = p.castCounts[cmd.power] ?? 0;
  const cost = nextCastCostMilli(power, castCount);
  if (p.favorMilli < cost) return true;
  p.favorMilli -= cost;
  p.castCounts[cmd.power] = castCount + 1;
  p.powerReadyTick[cmd.power] = sim.tick + Math.round(power.cooldownSeconds * TICK_RATE);
  sim.events.powerCasts.push({ power: cmd.power, playerId: cmd.playerId, x: cmd.x, y: cmd.y });

  const prm = power.params;
  const radiusFp = Math.round(((prm.radius as number) ?? 2) * 1000);
  // instant damage component
  if (typeof prm.damage === "number") {
    dealAreaDamage(sim, cmd.x, cmd.y, radiusFp, prm.damage * 100, cmd.playerId);
  }
  // damage-over-time component
  if (typeof prm.damagePerSecond === "number" && typeof prm.durationSeconds === "number") {
    sim.activeEffects.push({
      powerId: cmd.power,
      playerId: cmd.playerId,
      x: cmd.x,
      y: cmd.y,
      endTick: sim.tick + Math.round(prm.durationSeconds * TICK_RATE),
      data: Math.trunc((prm.damagePerSecond * 100) / TICK_RATE),
      pool: Math.round(prm.damagePerSecond * prm.durationSeconds * 100),
    });
  }
  // heal-over-time component
  if (typeof prm.healPerSecond === "number" && typeof prm.durationSeconds === "number") {
    sim.activeEffects.push({
      powerId: cmd.power,
      playerId: cmd.playerId,
      x: cmd.x,
      y: cmd.y,
      endTick: sim.tick + Math.round(prm.durationSeconds * TICK_RATE),
      data: -Math.trunc((prm.healPerSecond * 100) / TICK_RATE),
      pool: Math.round(prm.healPerSecond * prm.durationSeconds * 100),
    });
  }
  // summon component
  if (typeof prm.summons === "string") {
    const eid = spawnUnitEntity(sim, cmd.playerId, prm.summons, cmd.x, cmd.y);
    if (typeof prm.durationSeconds === "number") {
      sim.activeEffects.push({
        powerId: cmd.power,
        playerId: cmd.playerId,
        x: cmd.x,
        y: cmd.y,
        endTick: sim.tick + Math.round(prm.durationSeconds * TICK_RATE),
        data: eid,
        pool: 0,
      });
    }
  }
  return true;
}

export function powerSystem(sim: Sim): void {
  for (let i = sim.activeEffects.length - 1; i >= 0; i--) {
    const fx = sim.activeEffects[i]!;
    const power = getPower(fx.powerId);
    const radiusFp = Math.round((((power.params.radius as number) ?? 2) * 1000));
    if (fx.pool > 0 && fx.data > 0 && typeof power.params.damagePerSecond === "number") {
      const amount = Math.min(fx.data, fx.pool);
      dealAreaDamage(sim, fx.x, fx.y, radiusFp, amount, fx.playerId);
      fx.pool -= amount;
    } else if (fx.pool > 0 && fx.data < 0) {
      const amount = Math.min(-fx.data, fx.pool);
      healArea(sim, fx.x, fx.y, radiusFp, amount, fx.playerId);
      fx.pool -= amount;
    }
    if (sim.tick >= fx.endTick || (fx.pool <= 0 && typeof power.params.summons !== "string")) {
      // summons with a duration expire
      if (typeof power.params.summons === "string" && fx.data > 0) {
        const { Health } = sim.stores;
        if (hasComponent(sim.world, fx.data, Health)) Health.hp100[fx.data] = 0;
      }
      sim.activeEffects.splice(i, 1);
    }
  }
}

/* ───────────────── the four favor mechanics ───────────────── */

interface FavorParams {
  type: string;
  [k: string]: unknown;
}

function addFavorMicro(p: ReturnType<typeof getPlayer>, micro: number): void {
  const total = p.favorMicroAccum + micro;
  p.favorMilli += Math.trunc(total / 1000);
  p.favorMicroAccum = total % 1000;
}

const TICKS_PER_MIN = TICK_RATE * 60;

export function favorSystem(sim: Sim, prayingByPlayer: Map<number, number>): void {
  const { Owner, Building, UnitRef, Velocity, Position } = sim.stores;
  for (let pid = 0; pid < sim.players.length; pid++) {
    const p = sim.players[pid]!;
    const mech = getPantheon(p.pantheon).favorMechanic as FavorParams;
    if (mech.type === "skyward_chants") {
      const n = prayingByPlayer.get(pid) ?? 0;
      if (n === 0) continue;
      const first = Math.round((mech.firstVillagerRatePerMinute as number) * 1000);
      const dim = Math.round((mech.diminishingFactor as number) * 100);
      const max = (mech.maxWorshippers as number) ?? 10;
      let rate = first;
      let totalMilliPerMin = 0;
      for (let i = 0; i < Math.min(n, max); i++) {
        totalMilliPerMin += rate;
        rate = Math.trunc((rate * dim) / 100);
      }
      addFavorMicro(p, Math.trunc((totalMilliPerMin * 1000) / TICKS_PER_MIN));
    } else if (mech.type === "devotion_pyres") {
      const rates = mech.ratesPerAltarPerMinute as number[];
      const maxAltars = (mech.maxAltars as number) ?? 5;
      let altars = 0;
      for (const eid of query(sim.world, [Building])) {
        if (Owner.playerId[eid] !== pid || Building.active[eid] !== 1) continue;
        // sun_altar via building stats name check is slow; use typeIndex via data once
        if (sim.buildingIdOf(eid) === "sun_altar") altars++;
      }
      altars = Math.min(altars, maxAltars);
      let totalMilliPerMin = 0;
      for (let i = 0; i < altars; i++) totalMilliPerMin += Math.round((rates[i] ?? 0) * 1000);
      if (totalMilliPerMin > 0) addFavorMicro(p, Math.trunc((totalMilliPerMin * 1000) / TICKS_PER_MIN));
    } else if (mech.type === "tidal_oracles") {
      const baseRate = Math.round((mech.ratePerMinuteAtBaseLos as number) * 1000);
      const baseLosFp = ((mech.baseLosRadius as number) ?? 18) * 1000;
      const accepted: number[] = [];
      const seers = Array.from(query(sim.world, [UnitRef]))
        .filter((e) => Owner.playerId[e] === pid && sim.unitStats(e).id === "tide_seer")
        .sort((a, b) => a - b);
      let totalMilliPerMin = 0;
      for (const eid of seers) {
        if (Velocity.x[eid] !== 0 || Velocity.y[eid] !== 0) continue; // must be stationary
        const losFp = sim.unitStats(eid).losFp;
        let overlaps = false;
        for (const other of accepted) {
          const dx = Position.x[eid]! - Position.x[other]!;
          const dy = Position.y[eid]! - Position.y[other]!;
          const r = losFp + sim.unitStats(other).losFp;
          if (dx * dx + dy * dy < r * r) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        accepted.push(eid);
        totalMilliPerMin += Math.trunc((baseRate * losFp) / baseLosFp);
      }
      if (totalMilliPerMin > 0) addFavorMicro(p, Math.trunc((totalMilliPerMin * 1000) / TICKS_PER_MIN));
    } else if (mech.type === "forge_wrath") {
      // combat favor is credited in creditCombatFavor; here: forgeborn trickle
      const trickle = Math.round(((mech.forgebornTricklePerMinute as number) ?? 0) * 1000);
      let heroes = 0;
      for (const eid of query(sim.world, [UnitRef])) {
        if (Owner.playerId[eid] === pid && sim.unitStats(eid).id === "forgeborn") heroes++;
      }
      if (heroes > 0 && trickle > 0) {
        addFavorMicro(p, Math.trunc((trickle * heroes * 1000) / TICKS_PER_MIN));
      }
    }
  }
}

/** Called by combat when damage lands: Forge-Wrath favor from damage dealt. */
export function creditCombatFavor(sim: Sim, attackerPid: number, damage100: number): void {
  const p = sim.players[attackerPid];
  if (!p) return;
  const mech = getPantheon(p.pantheon).favorMechanic as FavorParams;
  if (mech.type !== "forge_wrath") return;
  const microPerPoint = Math.round(((mech.favorPerDamage as number) ?? 0) * 1_000_000); // favor/point → micro
  let micro = Math.trunc((damage100 * microPerPoint) / 100);
  const mult = applyModifiers(sim, attackerPid, ["player"], "favorMechanic.combatFavorMultiplier", 1);
  micro *= mult;
  addFavorMicro(p, micro);
}

export function hashPowers(sim: Sim, c: Checksum): void {
  for (const p of sim.players) {
    for (const k of Object.keys(p.castCounts).sort()) {
      c.addString(k);
      c.addI32(p.castCounts[k]!);
      c.addI32(p.powerReadyTick[k] ?? 0);
    }
  }
  for (const fx of sim.activeEffects) {
    c.addString(fx.powerId);
    c.addI32(fx.playerId);
    c.addI32(fx.x);
    c.addI32(fx.y);
    c.addI32(fx.endTick);
    c.addI32(fx.data);
    c.addI32(fx.pool);
  }
}
