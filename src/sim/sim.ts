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

export const TICK_RATE = 15;
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
  };
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
  tick: number;
  unitRadiusFp(eid: number): number;
  unitStats(eid: number): UnitStats;
}

export function createSim(seed: number, terrainConfig: TerrainConfig = DEFAULT_TERRAIN_CONFIG): Sim {
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
    tick: 0,
    unitRadiusFp(eid: number): number {
      return getUnitStatsByIndex(stores.UnitRef.typeIndex[eid]!).radiusFp;
    },
    unitStats(eid: number): UnitStats {
      return getUnitStatsByIndex(stores.UnitRef.typeIndex[eid]!);
    },
  };
  return sim;
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

/** Deterministic spiral search for the nearest passable tile. */
function nearestPassableTile(sim: Sim, tx: number, ty: number): { x: number; y: number } {
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
  const { UnitRef, MoveState } = sim.stores;
  const eid = spawnDebugEntity(sim, playerId, x, y, 0, 0);
  addComponent(sim.world, eid, UnitRef);
  addComponent(sim.world, eid, MoveState);
  UnitRef.typeIndex[eid] = stats.typeIndex;
  MoveState.active[eid] = 0;
  MoveState.targetX[eid] = x | 0;
  MoveState.targetY[eid] = y | 0;
  MoveState.fieldKey[eid] = -1;
  MoveState.stallTicks[eid] = 0;
  return eid;
}

function applyCommand(sim: Sim, cmd: Command): void {
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
  for (const eid of units) {
    let vx = 0;
    let vy = 0;
    if (MoveState.active[eid] === 1) {
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
  for (const cmd of commands) applyCommand(sim, cmd);
  unitMovementSystem(sim);
  wanderSystem(sim);
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
  return c.digest();
}

interface EntitySnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  playerId: number;
  unit?: {
    typeIndex: number;
    active: number;
    targetX: number;
    targetY: number;
    fieldKey: number;
    stallTicks: number;
  };
}

interface SimSnapshot {
  version: 1;
  seed: number;
  tick: number;
  prngState: number;
  terrainConfig: TerrainConfig;
  entities: EntitySnapshot[];
}

export function serializeSim(sim: Sim): string {
  const { Position, Velocity, Owner, UnitRef, MoveState } = sim.stores;
  const eids = Array.from(query(sim.world, [Position, Velocity, Owner])).sort((a, b) => a - b);
  const units = new Set(query(sim.world, [UnitRef]));
  const snapshot: SimSnapshot = {
    version: 1,
    seed: sim.seed,
    tick: sim.tick,
    prngState: sim.prng.getState(),
    terrainConfig: sim.terrain.config,
    entities: eids.map((eid) => {
      const e: EntitySnapshot = {
        x: Position.x[eid]!,
        y: Position.y[eid]!,
        vx: Velocity.x[eid]!,
        vy: Velocity.y[eid]!,
        playerId: Owner.playerId[eid]!,
      };
      if (units.has(eid)) {
        e.unit = {
          typeIndex: UnitRef.typeIndex[eid]!,
          active: MoveState.active[eid]!,
          targetX: MoveState.targetX[eid]!,
          targetY: MoveState.targetY[eid]!,
          fieldKey: MoveState.fieldKey[eid]!,
          stallTicks: MoveState.stallTicks[eid]!,
        };
      }
      return e;
    }),
  };
  return JSON.stringify(snapshot);
}

export function deserializeSim(json: string): Sim {
  const snapshot = JSON.parse(json) as SimSnapshot;
  const sim = createSim(snapshot.seed, snapshot.terrainConfig);
  sim.tick = snapshot.tick;
  sim.prng.setState(snapshot.prngState);
  const { Position, Velocity, UnitRef, MoveState } = sim.stores;
  for (const e of snapshot.entities) {
    if (e.unit) {
      const eid = spawnUnitEntity(sim, e.playerId, getUnitStatsByIndex(e.unit.typeIndex).id, e.x, e.y);
      Position.x[eid] = e.x;
      Position.y[eid] = e.y;
      Velocity.x[eid] = e.vx;
      Velocity.y[eid] = e.vy;
      UnitRef.typeIndex[eid] = e.unit.typeIndex;
      MoveState.active[eid] = e.unit.active;
      MoveState.targetX[eid] = e.unit.targetX;
      MoveState.targetY[eid] = e.unit.targetY;
      MoveState.fieldKey[eid] = e.unit.fieldKey;
      MoveState.stallTicks[eid] = e.unit.stallTicks;
    } else {
      spawnDebugEntity(sim, e.playerId, e.x, e.y, e.vx, e.vy);
    }
  }
  return sim;
}
