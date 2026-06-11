/**
 * Deterministic simulation core: fixed timestep 15 Hz, integer-only state,
 * bitECS world with per-sim component stores (so multiple sims — replays,
 * determinism tests, future lockstep verification — never share memory).
 */
import { addComponent, addEntity, createWorld, hasComponent, query } from "bitecs";
import { Checksum } from "./checksum";
import type { Command } from "./commands";
import { fpFromInt, isqrt } from "./fixed";
import { Prng } from "./prng";
import { DEFAULT_TERRAIN_CONFIG, generateTerrain, type Terrain, type TerrainConfig } from "./terrain";
import { buildNavGrid, isPassable, type NavGrid } from "./path/grid";
import { computeFlowField, flowDirAt, flowDistAt, UNREACHABLE, type FlowField } from "./path/flowfield";
import { getUnitStats, getUnitStatsByIndex, type UnitStats } from "./unitdata";
import { getBuildingStatsByIndex } from "./buildingdata";
// eslint-disable-next-line import/no-cycle -- runtime-safe: functions called post-init
import {
  createPlayers,
  spawnBuilding,
  spawnResourceNode,
  economySystem,
  handleEconomyCommand,
  hashEconomy,
  recomputePop,
  setupSkirmish,
  type PlayerState,
  type TrainEntry,
} from "./economy";
// eslint-disable-next-line import/no-cycle -- runtime-safe: functions called post-init
import { combatSystem, emptyEvents, handleCombatCommand, hashCombat, targetAliveAndValid, type SimEvents } from "./combat";
// eslint-disable-next-line import/no-cycle -- runtime-safe: functions called post-init
import { effectiveGatherMicroPerTick, handleResearchCommand, hashResearch, researchSystem } from "./research";
// eslint-disable-next-line import/no-cycle -- runtime-safe: functions called post-init
import { getPower, handlePowerCommand, hashPowers, powerSystem, type ActiveEffect } from "./powers";
// eslint-disable-next-line import/no-cycle -- runtime-safe
import { visibilitySystem } from "./visibility";
// eslint-disable-next-line import/no-cycle -- runtime-safe
import { hashVictory, victorySystem } from "./victory";

export { TICK_RATE } from "./fixed";
import { TICK_RATE } from "./fixed";
export const MS_PER_TICK = 1000 / TICK_RATE; // render-side pacing only; sim counts ticks
export const MAX_ENTITIES = 4096;

/** Terrain gets its own PRNG stream so worldgen never perturbs gameplay rolls. */
const TERRAIN_SEED_SALT = 0x9e3779b9;

/** Phase 0 debug wander speed: up to ±133 millitiles/tick ≈ 2 tiles/s at 15 Hz. */
const WANDER_SPREAD = 267;
const WANDER_HALF = 133;

const ARRIVE_RADIUS_FP = 700;
/** Crowd stop: stalled this many ticks while flow-distance ≤ threshold ⇒ arrived. */
const STALL_TICKS_TO_ARRIVE = 20;
const CROWD_STOP_FLOW_DIST = 100; // octile ×10 ⇒ ≈10 tiles
const SEPARATION_MARGIN_PCT = 110;

interface Stores {
  Position: { x: Int32Array; y: Int32Array };
  Velocity: { x: Int32Array; y: Int32Array };
  Owner: { playerId: Int32Array };
  /** Marks real game units; typeIndex indexes the sorted unit-id list. */
  UnitRef: { typeIndex: Int32Array };
  MoveState: {
    active: Int32Array;
    targetX: Int32Array;
    targetY: Int32Array;
    fieldKey: Int32Array;
    stallTicks: Int32Array;
  };
  ResourceNode: { resType: Int32Array; amountMilli: Int32Array };
  Building: {
    typeIndex: Int32Array;
    progress: Int32Array;
    total: Int32Array;
    active: Int32Array;
    tileX: Int32Array;
    tileY: Int32Array;
    rallyX: Int32Array;
    rallyY: Int32Array;
  };
  GatherTask: {
    phase: Int32Array;
    nodeEid: Int32Array;
    dropEid: Int32Array;
    carriedMilli: Int32Array;
    carriedType: Int32Array;
    carryMicro: Int32Array;
  };
  Health: { hp100: Int32Array };
  CombatState: { targetEid: Int32Array; cooldown: Int32Array; aggressive: Int32Array };
}

function createStores(): Stores {
  return {
    Position: { x: new Int32Array(MAX_ENTITIES), y: new Int32Array(MAX_ENTITIES) },
    Velocity: { x: new Int32Array(MAX_ENTITIES), y: new Int32Array(MAX_ENTITIES) },
    Owner: { playerId: new Int32Array(MAX_ENTITIES) },
    UnitRef: { typeIndex: new Int32Array(MAX_ENTITIES) },
    MoveState: {
      active: new Int32Array(MAX_ENTITIES),
      targetX: new Int32Array(MAX_ENTITIES),
      targetY: new Int32Array(MAX_ENTITIES),
      fieldKey: new Int32Array(MAX_ENTITIES),
      stallTicks: new Int32Array(MAX_ENTITIES),
    },
    ResourceNode: { resType: new Int32Array(MAX_ENTITIES), amountMilli: new Int32Array(MAX_ENTITIES) },
    Building: {
      typeIndex: new Int32Array(MAX_ENTITIES),
      progress: new Int32Array(MAX_ENTITIES),
      total: new Int32Array(MAX_ENTITIES),
      active: new Int32Array(MAX_ENTITIES),
      tileX: new Int32Array(MAX_ENTITIES),
      tileY: new Int32Array(MAX_ENTITIES),
      rallyX: new Int32Array(MAX_ENTITIES),
      rallyY: new Int32Array(MAX_ENTITIES),
    },
    GatherTask: {
      phase: new Int32Array(MAX_ENTITIES),
      nodeEid: new Int32Array(MAX_ENTITIES),
      dropEid: new Int32Array(MAX_ENTITIES),
      carriedMilli: new Int32Array(MAX_ENTITIES),
      carriedType: new Int32Array(MAX_ENTITIES),
      carryMicro: new Int32Array(MAX_ENTITIES),
    },
    Health: { hp100: new Int32Array(MAX_ENTITIES) },
    CombatState: {
      targetEid: new Int32Array(MAX_ENTITIES),
      cooldown: new Int32Array(MAX_ENTITIES),
      aggressive: new Int32Array(MAX_ENTITIES),
    },
  };
}

export interface MatchOptions {
  players: number;
  skirmish: boolean;
}

export interface Sim {
  readonly world: ReturnType<typeof createWorld>;
  readonly stores: Stores;
  readonly prng: Prng;
  readonly seed: number;
  readonly terrain: Terrain;
  readonly navGrid: NavGrid;
  /** Flow fields cached by target tile key; derived data, never serialized. */
  readonly flowFields: Map<number, FlowField>;
  readonly players: PlayerState[];
  readonly trainQueues: Map<number, TrainEntry[]>;
  readonly matchOptions: MatchOptions;
  /** transient per-tick outputs for the render layer; never hashed/serialized */
  events: SimEvents;
  readonly activeEffects: ActiveEffect[];
  /** per-player fog grids — DERIVED, never hashed/serialized */
  readonly visibility: Uint8Array[];
  /** -1 while the match runs; winning playerId once decided */
  winner: number;
  /** per-player wonder countdown (ticks remaining; 0 = no countdown) */
  readonly wonderTicksLeft: number[];
  tick: number;
  unitRadiusFp(eid: number): number;
  unitStats(eid: number): UnitStats;
  effectiveGatherMicroPerTick(eid: number, resType: number): number;
  buildingIdOf(eid: number): string;
}

function isSummonPower(powerId: string): boolean {
  try {
    return typeof (getPower(powerId).params as { summons?: unknown }).summons === "string";
  } catch {
    return false;
  }
}

const DEFAULT_MATCH: MatchOptions = { players: 2, skirmish: false };

export function createSim(
  seed: number,
  terrainConfig: TerrainConfig = DEFAULT_TERRAIN_CONFIG,
  matchOptions: MatchOptions = DEFAULT_MATCH,
): Sim {
  const terrain = generateTerrain(new Prng((seed ^ TERRAIN_SEED_SALT) >>> 0), terrainConfig);
  const stores = createStores();
  const sim: Sim = {
    world: createWorld(),
    stores,
    prng: new Prng(seed),
    seed: seed >>> 0,
    terrain,
    navGrid: buildNavGrid(terrain),
    flowFields: new Map(),
    players: createPlayers(matchOptions.players),
    trainQueues: new Map(),
    matchOptions,
    events: emptyEvents(),
    activeEffects: [],
    visibility: [],
    winner: -1,
    wonderTicksLeft: Array.from({ length: matchOptions.players }, () => 0),
    tick: 0,
    unitRadiusFp(eid: number): number {
      return getUnitStatsByIndex(stores.UnitRef.typeIndex[eid]!).radiusFp;
    },
    unitStats(eid: number): UnitStats {
      return getUnitStatsByIndex(stores.UnitRef.typeIndex[eid]!);
    },
    effectiveGatherMicroPerTick(eid: number, resType: number): number {
      return effectiveGatherMicroPerTick(sim, eid, resType);
    },
    buildingIdOf(eid: number): string {
      return getBuildingStatsByIndex(stores.Building.typeIndex[eid]!).id;
    },
  };
  if (matchOptions.skirmish) {
    setupSkirmish(sim);
    recomputePop(sim);
  }
  return sim;
}

/** Point a unit's MoveState at a world position (commands & economy use this). */
export function setMoveTarget(sim: Sim, eid: number, xFp: number, yFp: number): void {
  const { MoveState } = sim.stores;
  const tile = nearestPassableTile(sim, Math.trunc(xFp / 1000), Math.trunc(yFp / 1000));
  MoveState.active[eid] = 1;
  MoveState.targetX[eid] = tile.x * 1000 + 500;
  MoveState.targetY[eid] = tile.y * 1000 + 500;
  MoveState.fieldKey[eid] = tile.y * sim.navGrid.size + tile.x;
  MoveState.stallTicks[eid] = 0;
}

function tileKey(sim: Sim, tx: number, ty: number): number {
  return ty * sim.navGrid.size + tx;
}

function getFlowField(sim: Sim, key: number): FlowField {
  let f = sim.flowFields.get(key);
  if (!f) {
    const size = sim.navGrid.size;
    f = computeFlowField(sim.navGrid, key % size, Math.trunc(key / size));
    sim.flowFields.set(key, f);
  }
  return f;
}

/** Deterministic spiral search for the nearest passable tile (move targets snap here). */
export function nearestPassableTile(sim: Sim, tx: number, ty: number): { x: number; y: number } {
  if (isPassable(sim.navGrid, tx, ty)) return { x: tx, y: ty };
  for (let r = 1; r < sim.navGrid.size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isPassable(sim.navGrid, tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy };
      }
    }
  }
  return { x: tx, y: ty };
}

function spawnDebugEntity(sim: Sim, playerId: number, x: number, y: number, vx: number, vy: number): number {
  const { Position, Velocity, Owner } = sim.stores;
  const eid = addEntity(sim.world);
  addComponent(sim.world, eid, Position);
  addComponent(sim.world, eid, Velocity);
  addComponent(sim.world, eid, Owner);
  Position.x[eid] = x | 0;
  Position.y[eid] = y | 0;
  Velocity.x[eid] = vx | 0;
  Velocity.y[eid] = vy | 0;
  Owner.playerId[eid] = playerId | 0;
  return eid;
}

export function spawnUnitEntity(sim: Sim, playerId: number, unitId: string, x: number, y: number): number {
  const stats = getUnitStats(unitId);
  const { UnitRef, MoveState, GatherTask } = sim.stores;
  const eid = spawnDebugEntity(sim, playerId, x, y, 0, 0);
  addComponent(sim.world, eid, UnitRef);
  addComponent(sim.world, eid, MoveState);
  UnitRef.typeIndex[eid] = stats.typeIndex;
  MoveState.active[eid] = 0;
  MoveState.targetX[eid] = x | 0;
  MoveState.targetY[eid] = y | 0;
  MoveState.fieldKey[eid] = -1;
  MoveState.stallTicks[eid] = 0;
  const { Health, CombatState } = sim.stores;
  addComponent(sim.world, eid, Health);
  Health.hp100[eid] = stats.hp100;
  if (stats.attack) {
    addComponent(sim.world, eid, CombatState);
    CombatState.targetEid[eid] = -1;
    CombatState.cooldown[eid] = 0;
    const passive = stats.unitClass === "villager" || stats.unitClass === "scout" || stats.unitClass === "caravan" || stats.unitClass === "ship";
    CombatState.aggressive[eid] = passive ? 0 : 1;
  }
  if (stats.gatherMicroPerTick) {
    addComponent(sim.world, eid, GatherTask);
    GatherTask.phase[eid] = 0;
    GatherTask.nodeEid[eid] = -1;
    GatherTask.dropEid[eid] = -1;
    GatherTask.carriedMilli[eid] = 0;
    GatherTask.carriedType[eid] = 0;
    GatherTask.carryMicro[eid] = 0;
  }
  return eid;
}

function applyCommand(sim: Sim, cmd: Command): void {
  if (handleResearchCommand(sim, cmd)) return;
  if (handlePowerCommand(sim, cmd)) return;
  if (handleCombatCommand(sim, cmd)) return;
  if (handleEconomyCommand(sim, cmd)) return;
  switch (cmd.type) {
    case "noop":
      return;
    case "debug_spawn": {
      const vx = sim.prng.nextInt(WANDER_SPREAD) - WANDER_HALF;
      const vy = sim.prng.nextInt(WANDER_SPREAD) - WANDER_HALF;
      spawnDebugEntity(sim, cmd.playerId, cmd.x, cmd.y, vx, vy);
      return;
    }
    case "spawn_unit": {
      spawnUnitEntity(sim, cmd.playerId, cmd.unit, cmd.x, cmd.y);
      return;
    }
    case "move": {
      const { MoveState, Owner, UnitRef } = sim.stores;
      const tile = nearestPassableTile(
        sim,
        Math.trunc(cmd.x / fpFromInt(1)),
        Math.trunc(cmd.y / fpFromInt(1)),
      );
      const key = tileKey(sim, tile.x, tile.y);
      const targetX = tile.x * 1000 + 500;
      const targetY = tile.y * 1000 + 500;
      const sorted = [...cmd.eids].sort((a, b) => a - b);
      for (const eid of sorted) {
        if (Owner.playerId[eid] !== cmd.playerId) continue;
        if (!hasComponent(sim.world, eid, UnitRef)) continue;
        MoveState.active[eid] = 1;
        MoveState.targetX[eid] = targetX;
        MoveState.targetY[eid] = targetY;
        MoveState.fieldKey[eid] = key;
        MoveState.stallTicks[eid] = 0;
      }
      return;
    }
  }
}

/** Phase 0 system: integer wander with edge bounce for debug entities only. */
function wanderSystem(sim: Sim): void {
  const MAP_EDGE_FP = fpFromInt(sim.terrain.size);
  const { Position, Velocity, UnitRef } = sim.stores;
  for (const eid of query(sim.world, [Position, Velocity])) {
    if (hasComponent(sim.world, eid, UnitRef)) continue;
    let x = Position.x[eid]! + Velocity.x[eid]!;
    let y = Position.y[eid]! + Velocity.y[eid]!;
    if (x < 0) {
      x = -x;
      Velocity.x[eid] = -Velocity.x[eid]!;
    } else if (x > MAP_EDGE_FP) {
      x = 2 * MAP_EDGE_FP - x;
      Velocity.x[eid] = -Velocity.x[eid]!;
    }
    if (y < 0) {
      y = -y;
      Velocity.y[eid] = -Velocity.y[eid]!;
    } else if (y > MAP_EDGE_FP) {
      y = 2 * MAP_EDGE_FP - y;
      Velocity.y[eid] = -Velocity.y[eid]!;
    }
    Position.x[eid] = x;
    Position.y[eid] = y;
  }
}

/**
 * Group movement: flow-field descent + reciprocal separation (RVO-lite) +
 * tile passability guards + crowd-stop arrival. Integer math throughout.
 */
function unitMovementSystem(sim: Sim): void {
  const { Position, Velocity, UnitRef, MoveState } = sim.stores;
  const units = Array.from(query(sim.world, [Position, UnitRef, MoveState])).sort((a, b) => a - b);
  if (units.length === 0) return;
  const size = sim.navGrid.size;

  // spatial hash by tile, insertion in ascending eid order
  const buckets = new Map<number, number[]>();
  for (const eid of units) {
    const k = Math.trunc(Position.y[eid]! / 1000) * size + Math.trunc(Position.x[eid]! / 1000);
    let b = buckets.get(k);
    if (!b) {
      b = [];
      buckets.set(k, b);
    }
    b.push(eid);
  }

  // desired velocities
  const desiredX = new Map<number, number>();
  const desiredY = new Map<number, number>();
  const { CombatState, Health } = sim.stores;
  for (const eid of units) {
    let vx = 0;
    let vy = 0;
    // combat chase: aggressive units with a live out-of-reach target steer directly
    let chasing = false;
    if (hasComponent(sim.world, eid, CombatState) && CombatState.aggressive[eid] === 1) {
      const target = CombatState.targetEid[eid]!;
      if (targetAliveAndValid(sim, target)) {
        const stats = getUnitStatsByIndex(UnitRef.typeIndex[eid]!);
        const dxT = Position.x[target]! - Position.x[eid]!;
        const dyT = Position.y[target]! - Position.y[eid]!;
        const dT = isqrt(dxT * dxT + dyT * dyT);
        const targetRadius = hasComponent(sim.world, target, sim.stores.Building)
          ? getBuildingStatsByIndex(sim.stores.Building.typeIndex[target]!).size * 710
          : getUnitStatsByIndex(UnitRef.typeIndex[target]!).radiusFp;
        const reach = stats.attack!.rangeFp > 0 ? stats.attack!.rangeFp + targetRadius : stats.radiusFp + targetRadius + 250;
        if (dT > reach) {
          chasing = true;
          vx = Math.trunc((dxT * stats.speedFpPerTick) / (dT || 1));
          vy = Math.trunc((dyT * stats.speedFpPerTick) / (dT || 1));
        }
      }
    }
    if (!chasing && MoveState.active[eid] === 1) {
      const stats = getUnitStatsByIndex(UnitRef.typeIndex[eid]!);
      const speed = stats.speedFpPerTick;
      const px = Position.x[eid]!;
      const py = Position.y[eid]!;
      const dxT = MoveState.targetX[eid]! - px;
      const dyT = MoveState.targetY[eid]! - py;
      const distT = isqrt(dxT * dxT + dyT * dyT);
      if (distT <= ARRIVE_RADIUS_FP) {
        MoveState.active[eid] = 0;
        MoveState.stallTicks[eid] = 0;
      } else {
        const tx = Math.trunc(px / 1000);
        const ty = Math.trunc(py / 1000);
        const field = getFlowField(sim, MoveState.fieldKey[eid]!);
        const fDist = flowDistAt(field, tx, ty);
        const sameTile = tx === field.targetX && ty === field.targetY;
        if (sameTile || fDist <= 14 || fDist >= UNREACHABLE) {
          // adjacent to (or on) the target tile, or no field info: steer direct
          vx = Math.trunc((dxT * speed) / (distT || 1));
          vy = Math.trunc((dyT * speed) / (distT || 1));
        } else {
          const dir = flowDirAt(field, tx, ty);
          if (dir.dx !== 0 && dir.dy !== 0) {
            vx = Math.trunc((dir.dx * speed * 707) / 1000);
            vy = Math.trunc((dir.dy * speed * 707) / 1000);
          } else {
            vx = dir.dx * speed;
            vy = dir.dy * speed;
          }
        }
      }
    }
    desiredX.set(eid, vx);
    desiredY.set(eid, vy);
    void Health;
  }

  // reciprocal separation (each overlapping pair pushes both members apart)
  const pushX = new Map<number, number>();
  const pushY = new Map<number, number>();
  for (const eid of units) {
    pushX.set(eid, 0);
    pushY.set(eid, 0);
  }
  for (const eid of units) {
    const px = Position.x[eid]!;
    const py = Position.y[eid]!;
    const ri = getUnitStatsByIndex(UnitRef.typeIndex[eid]!).radiusFp;
    const tx = Math.trunc(px / 1000);
    const ty = Math.trunc(py / 1000);
    for (let by = ty - 1; by <= ty + 1; by++) {
      for (let bx = tx - 1; bx <= tx + 1; bx++) {
        const bucket = buckets.get(by * size + bx);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other <= eid) continue;
          const rj = getUnitStatsByIndex(UnitRef.typeIndex[other]!).radiusFp;
          const minD = Math.trunc(((ri + rj) * SEPARATION_MARGIN_PCT) / 100);
          const dx = px - Position.x[other]!;
          const dy = py - Position.y[other]!;
          const d2 = dx * dx + dy * dy;
          if (d2 >= minD * minD) continue;
          const d = isqrt(d2);
          let ux: number;
          let uy: number;
          if (d === 0) {
            ux = (eid + other) % 2 === 0 ? 60 : -60;
            uy = (eid + other) % 2 === 0 ? -40 : 40;
          } else {
            const overlap = minD - d;
            ux = Math.trunc((dx * overlap) / (2 * d));
            uy = Math.trunc((dy * overlap) / (2 * d));
          }
          pushX.set(eid, pushX.get(eid)! + ux);
          pushY.set(eid, pushY.get(eid)! + uy);
          pushX.set(other, pushX.get(other)! - ux);
          pushY.set(other, pushY.get(other)! - uy);
        }
      }
    }
  }

  // integrate with passability guards + stall accounting
  for (const eid of units) {
    const stats = getUnitStatsByIndex(UnitRef.typeIndex[eid]!);
    const cap = Math.trunc((stats.speedFpPerTick * 130) / 100);
    let vx = desiredX.get(eid)! + pushX.get(eid)!;
    let vy = desiredY.get(eid)! + pushY.get(eid)!;
    const mag = isqrt(vx * vx + vy * vy);
    if (mag > cap) {
      vx = Math.trunc((vx * cap) / mag);
      vy = Math.trunc((vy * cap) / mag);
    }
    const px = Position.x[eid]!;
    const py = Position.y[eid]!;
    let nx = px + vx;
    let ny = py + vy;
    if (!isPassable(sim.navGrid, Math.trunc(nx / 1000), Math.trunc(ny / 1000))) {
      if (isPassable(sim.navGrid, Math.trunc(nx / 1000), Math.trunc(py / 1000))) {
        ny = py;
      } else if (isPassable(sim.navGrid, Math.trunc(px / 1000), Math.trunc(ny / 1000))) {
        nx = px;
      } else {
        nx = px;
        ny = py;
      }
    }
    const moved = isqrt((nx - px) * (nx - px) + (ny - py) * (ny - py));
    Position.x[eid] = nx;
    Position.y[eid] = ny;
    Velocity.x[eid] = nx - px;
    Velocity.y[eid] = ny - py;
    if (MoveState.active[eid] === 1) {
      if (moved < Math.trunc(stats.speedFpPerTick / 10)) {
        MoveState.stallTicks[eid] = MoveState.stallTicks[eid]! + 1;
        const field = getFlowField(sim, MoveState.fieldKey[eid]!);
        const fDist = flowDistAt(field, Math.trunc(nx / 1000), Math.trunc(ny / 1000));
        if (MoveState.stallTicks[eid]! >= STALL_TICKS_TO_ARRIVE && fDist <= CROWD_STOP_FLOW_DIST) {
          MoveState.active[eid] = 0; // crowd arrival: packed in around the target
        }
      } else {
        MoveState.stallTicks[eid] = 0;
      }
    }
  }
}

/** Advance exactly one tick. Commands must already be deterministically ordered. */
export function stepSim(sim: Sim, commands: readonly Command[]): void {
  sim.events = emptyEvents();
  for (const cmd of commands) applyCommand(sim, cmd);
  combatSystem(sim);
  powerSystem(sim);
  researchSystem(sim);
  economySystem(sim);
  unitMovementSystem(sim);
  wanderSystem(sim);
  visibilitySystem(sim);
  victorySystem(sim);
  sim.tick++;
}

/**
 * State checksum: tick + PRNG + terrain + every component lane of every entity,
 * visited in ascending entity order. Entity ids themselves are NOT hashed so
 * a deserialized sim (fresh id sequence) checksums equal to its source.
 */
export function simChecksum(sim: Sim): number {
  const c = new Checksum();
  c.addU32(sim.tick);
  c.addU32(sim.prng.getState());
  c.addU32(sim.terrain.checksum);
  const { Position, Velocity, Owner, UnitRef, MoveState } = sim.stores;
  const eids = Array.from(query(sim.world, [Position, Velocity, Owner])).sort((a, b) => a - b);
  const units = new Set(query(sim.world, [UnitRef]));
  for (const eid of eids) {
    c.addI32(Position.x[eid]!);
    c.addI32(Position.y[eid]!);
    c.addI32(Velocity.x[eid]!);
    c.addI32(Velocity.y[eid]!);
    c.addI32(Owner.playerId[eid]!);
    if (units.has(eid)) {
      c.addI32(UnitRef.typeIndex[eid]!);
      c.addI32(MoveState.active[eid]!);
      c.addI32(MoveState.targetX[eid]!);
      c.addI32(MoveState.targetY[eid]!);
      c.addI32(MoveState.stallTicks[eid]!);
    }
  }
  hashEconomy(sim, c);
  hashCombat(sim, c);
  hashResearch(sim, c);
  hashPowers(sim, c);
  hashVictory(sim, c);
  return c.digest();
}

interface EntitySnapshot {
  eid: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  playerId?: number;
  unit?: {
    typeIndex: number;
    active: number;
    targetX: number;
    targetY: number;
    fieldKey: number;
    stallTicks: number;
  };
  gather?: {
    phase: number;
    nodeEid: number;
    dropEid: number;
    carriedMilli: number;
    carriedType: number;
    carryMicro: number;
  };
  node?: { resType: number; amountMilli: number };
  building?: { typeIndex: number; progress: number; total: number; active: number; tileX: number; tileY: number; hp100: number; rallyX?: number; rallyY?: number };
  hp100?: number;
  combat?: { targetEid: number; cooldown: number; aggressive: number };
}

interface SimSnapshot {
  version: 2;
  seed: number;
  tick: number;
  prngState: number;
  terrainConfig: TerrainConfig;
  matchOptions: MatchOptions;
  players: PlayerState[];
  trainQueues: Array<[number, TrainEntry[]]>;
  activeEffects: ActiveEffect[];
  winner: number;
  wonderTicksLeft: number[];
  entities: EntitySnapshot[];
}

export function serializeSim(sim: Sim): string {
  const { Position, Velocity, Owner, UnitRef, MoveState, GatherTask, ResourceNode, Building } = sim.stores;
  const all = new Set<number>();
  for (const e of query(sim.world, [Position])) all.add(e);
  const eids = Array.from(all).sort((a, b) => a - b);
  const isUnit = new Set(query(sim.world, [UnitRef]));
  const isNode = new Set(query(sim.world, [ResourceNode]));
  const isBuilding = new Set(query(sim.world, [Building]));
  const hasGather = new Set(query(sim.world, [GatherTask]));
  const { Health, CombatState } = sim.stores;
  const hasHealth = new Set(query(sim.world, [Health]));
  const hasCombat = new Set(query(sim.world, [CombatState]));

  const snapshot: SimSnapshot = {
    version: 2,
    seed: sim.seed,
    tick: sim.tick,
    prngState: sim.prng.getState(),
    terrainConfig: sim.terrain.config,
    matchOptions: { ...sim.matchOptions, skirmish: false }, // content is in the snapshot
    players: sim.players.map((p) => ({ ...p })),
    trainQueues: Array.from(sim.trainQueues.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => [k, v.map((e) => ({ ...e }))]),
    activeEffects: sim.activeEffects.map((e) => ({ ...e })),
    winner: sim.winner,
    wonderTicksLeft: [...sim.wonderTicksLeft],
    entities: eids.map((eid) => {
      const e: EntitySnapshot = { eid, x: Position.x[eid]!, y: Position.y[eid]! };
      if (isNode.has(eid)) {
        e.node = { resType: ResourceNode.resType[eid]!, amountMilli: ResourceNode.amountMilli[eid]! };
        return e;
      }
      e.playerId = Owner.playerId[eid]!;
      if (isBuilding.has(eid)) {
        e.building = {
          typeIndex: Building.typeIndex[eid]!,
          progress: Building.progress[eid]!,
          total: Building.total[eid]!,
          active: Building.active[eid]!,
          tileX: Building.tileX[eid]!,
          tileY: Building.tileY[eid]!,
          hp100: Health.hp100[eid]!,
          rallyX: Building.rallyX[eid]!,
          rallyY: Building.rallyY[eid]!,
        };
        return e;
      }
      e.vx = Velocity.x[eid]!;
      e.vy = Velocity.y[eid]!;
      if (isUnit.has(eid)) {
        e.unit = {
          typeIndex: UnitRef.typeIndex[eid]!,
          active: MoveState.active[eid]!,
          targetX: MoveState.targetX[eid]!,
          targetY: MoveState.targetY[eid]!,
          fieldKey: MoveState.fieldKey[eid]!,
          stallTicks: MoveState.stallTicks[eid]!,
        };
        if (hasHealth.has(eid)) e.hp100 = Health.hp100[eid]!;
        if (hasCombat.has(eid)) {
          e.combat = {
            targetEid: CombatState.targetEid[eid]!,
            cooldown: CombatState.cooldown[eid]!,
            aggressive: CombatState.aggressive[eid]!,
          };
        }
        if (hasGather.has(eid)) {
          e.gather = {
            phase: GatherTask.phase[eid]!,
            nodeEid: GatherTask.nodeEid[eid]!,
            dropEid: GatherTask.dropEid[eid]!,
            carriedMilli: GatherTask.carriedMilli[eid]!,
            carriedType: GatherTask.carriedType[eid]!,
            carryMicro: GatherTask.carryMicro[eid]!,
          };
        }
      }
      return e;
    }),
  };
  return JSON.stringify(snapshot);
}

export function deserializeSim(json: string): Sim {
  const snapshot = JSON.parse(json) as SimSnapshot;
  const sim = createSim(snapshot.seed, snapshot.terrainConfig, snapshot.matchOptions);
  sim.tick = snapshot.tick;
  sim.prng.setState(snapshot.prngState);
  const { Position, Velocity, UnitRef, MoveState, GatherTask } = sim.stores;

  // first pass: recreate entities in original ascending-eid order, build remap
  const remap = new Map<number, number>();
  for (const e of snapshot.entities) {
    if (e.node) {
      const eid = spawnResourceNode(sim, (["food", "wood", "gold"] as const)[e.node.resType]!, 0, 0, e.node.amountMilli);
      Position.x[eid] = e.x;
      Position.y[eid] = e.y;
      sim.stores.ResourceNode.resType[eid] = e.node.resType;
      remap.set(e.eid, eid);
    } else if (e.building) {
      const stats = getBuildingStatsByIndex(e.building.typeIndex);
      const eid = spawnBuilding(sim, e.playerId!, stats.id, e.building.tileX, e.building.tileY, e.building.active === 1);
      sim.stores.Building.progress[eid] = e.building.progress;
      sim.stores.Building.total[eid] = e.building.total;
      sim.stores.Building.active[eid] = e.building.active;
      sim.stores.Health.hp100[eid] = e.building.hp100;
      sim.stores.Building.rallyX[eid] = e.building.rallyX ?? 0;
      sim.stores.Building.rallyY[eid] = e.building.rallyY ?? 0;
      remap.set(e.eid, eid);
    } else if (e.unit) {
      const eid = spawnUnitEntity(sim, e.playerId!, getUnitStatsByIndex(e.unit.typeIndex).id, e.x, e.y);
      Position.x[eid] = e.x;
      Position.y[eid] = e.y;
      Velocity.x[eid] = e.vx!;
      Velocity.y[eid] = e.vy!;
      MoveState.active[eid] = e.unit.active;
      MoveState.targetX[eid] = e.unit.targetX;
      MoveState.targetY[eid] = e.unit.targetY;
      MoveState.fieldKey[eid] = e.unit.fieldKey;
      MoveState.stallTicks[eid] = e.unit.stallTicks;
      UnitRef.typeIndex[eid] = e.unit.typeIndex;
      if (e.hp100 !== undefined) sim.stores.Health.hp100[eid] = e.hp100;
      remap.set(e.eid, eid);
    } else {
      const eid = spawnDebugEntity(sim, e.playerId!, e.x, e.y, e.vx!, e.vy!);
      remap.set(e.eid, eid);
    }
  }

  // second pass: restore gather tasks + remap entity references
  const r = (old: number): number => (old < 0 ? old : (remap.get(old) ?? -1));
  for (const e of snapshot.entities) {
    if (e.combat) {
      const eid = remap.get(e.eid)!;
      sim.stores.CombatState.targetEid[eid] = r(e.combat.targetEid);
      sim.stores.CombatState.cooldown[eid] = e.combat.cooldown;
      sim.stores.CombatState.aggressive[eid] = e.combat.aggressive;
    }
    if (!e.gather) continue;
    const eid = remap.get(e.eid)!;
    GatherTask.phase[eid] = e.gather.phase;
    GatherTask.nodeEid[eid] = r(e.gather.nodeEid);
    GatherTask.dropEid[eid] = r(e.gather.dropEid);
    GatherTask.carriedMilli[eid] = e.gather.carriedMilli;
    GatherTask.carriedType[eid] = e.gather.carriedType;
    GatherTask.carryMicro[eid] = e.gather.carryMicro;
  }
  sim.players.length = 0;
  for (const p of snapshot.players) sim.players.push({ ...p, townCenterEid: r(p.townCenterEid) });
  sim.trainQueues.clear();
  for (const [k, v] of snapshot.trainQueues) sim.trainQueues.set(r(k), v.map((t) => ({ ...t })));
  sim.winner = snapshot.winner ?? -1;
  sim.wonderTicksLeft.length = 0;
  for (const w of snapshot.wonderTicksLeft ?? sim.players.map(() => 0)) sim.wonderTicksLeft.push(w);
  sim.activeEffects.length = 0;
  for (const fx of snapshot.activeEffects ?? []) {
    const power = fx.powerId;
    // summon-effect data refers to an eid; remap it
    sim.activeEffects.push({ ...fx, data: power && fx.data > 0 && typeof fx.data === "number" && isSummonPower(power) ? r(fx.data) : fx.data });
  }
  return sim;
}
