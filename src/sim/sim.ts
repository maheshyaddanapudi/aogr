/**
 * Deterministic simulation core: fixed timestep 15 Hz, integer-only state,
 * bitECS world with per-sim component stores (so multiple sims — replays,
 * determinism tests, future lockstep verification — never share memory).
 */
import { addComponent, addEntity, createWorld, query } from "bitecs";
import { Checksum } from "./checksum";
import type { Command } from "./commands";
import { fpFromInt } from "./fixed";
import { Prng } from "./prng";
import { DEFAULT_TERRAIN_CONFIG, generateTerrain, type Terrain, type TerrainConfig } from "./terrain";

export const TICK_RATE = 15;
export const MS_PER_TICK = 1000 / TICK_RATE; // render-side pacing only; sim counts ticks
export const MAX_ENTITIES = 4096;

/** Terrain gets its own PRNG stream so worldgen never perturbs gameplay rolls. */
const TERRAIN_SEED_SALT = 0x9e3779b9;

/** Phase 0 debug wander speed: up to ±133 millitiles/tick ≈ 2 tiles/s at 15 Hz. */
const WANDER_SPREAD = 267;
const WANDER_HALF = 133;

interface Stores {
  Position: { x: Int32Array; y: Int32Array };
  Velocity: { x: Int32Array; y: Int32Array };
  Owner: { playerId: Int32Array };
}

function createStores(): Stores {
  return {
    Position: { x: new Int32Array(MAX_ENTITIES), y: new Int32Array(MAX_ENTITIES) },
    Velocity: { x: new Int32Array(MAX_ENTITIES), y: new Int32Array(MAX_ENTITIES) },
    Owner: { playerId: new Int32Array(MAX_ENTITIES) },
  };
}

export interface Sim {
  readonly world: ReturnType<typeof createWorld>;
  readonly stores: Stores;
  readonly prng: Prng;
  readonly seed: number;
  readonly terrain: Terrain;
  tick: number;
}

export function createSim(seed: number, terrainConfig: TerrainConfig = DEFAULT_TERRAIN_CONFIG): Sim {
  return {
    world: createWorld(),
    stores: createStores(),
    prng: new Prng(seed),
    seed: seed >>> 0,
    terrain: generateTerrain(new Prng((seed ^ TERRAIN_SEED_SALT) >>> 0), terrainConfig),
    tick: 0,
  };
}

function spawnEntity(sim: Sim, playerId: number, x: number, y: number, vx: number, vy: number): void {
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
}

function applyCommand(sim: Sim, cmd: Command): void {
  switch (cmd.type) {
    case "noop":
      return;
    case "debug_spawn": {
      const vx = sim.prng.nextInt(WANDER_SPREAD) - WANDER_HALF;
      const vy = sim.prng.nextInt(WANDER_SPREAD) - WANDER_HALF;
      spawnEntity(sim, cmd.playerId, cmd.x, cmd.y, vx, vy);
      return;
    }
  }
}

/** Phase 0 system: integer wander with edge bounce, exercising ECS + PRNG state. */
function movementSystem(sim: Sim): void {
  const MAP_EDGE_FP = fpFromInt(sim.terrain.size);
  const { Position, Velocity } = sim.stores;
  for (const eid of query(sim.world, [Position, Velocity])) {
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

/** Advance exactly one tick. Commands must already be deterministically ordered. */
export function stepSim(sim: Sim, commands: readonly Command[]): void {
  for (const cmd of commands) applyCommand(sim, cmd);
  movementSystem(sim);
  sim.tick++;
}

/**
 * State checksum: tick + PRNG state + every component lane of every entity,
 * visited in ascending entity order. Entity ids themselves are NOT hashed so
 * a deserialized sim (fresh id sequence) checksums equal to its source.
 */
export function simChecksum(sim: Sim): number {
  const c = new Checksum();
  c.addU32(sim.tick);
  c.addU32(sim.prng.getState());
  c.addU32(sim.terrain.checksum);
  const { Position, Velocity, Owner } = sim.stores;
  const eids = Array.from(query(sim.world, [Position, Velocity, Owner])).sort((a, b) => a - b);
  for (const eid of eids) {
    c.addI32(Position.x[eid]!);
    c.addI32(Position.y[eid]!);
    c.addI32(Velocity.x[eid]!);
    c.addI32(Velocity.y[eid]!);
    c.addI32(Owner.playerId[eid]!);
  }
  return c.digest();
}

interface EntitySnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  playerId: number;
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
  const { Position, Velocity, Owner } = sim.stores;
  const eids = Array.from(query(sim.world, [Position, Velocity, Owner])).sort((a, b) => a - b);
  const snapshot: SimSnapshot = {
    version: 1,
    seed: sim.seed,
    tick: sim.tick,
    prngState: sim.prng.getState(),
    terrainConfig: sim.terrain.config,
    entities: eids.map((eid) => ({
      x: Position.x[eid]!,
      y: Position.y[eid]!,
      vx: Velocity.x[eid]!,
      vy: Velocity.y[eid]!,
      playerId: Owner.playerId[eid]!,
    })),
  };
  return JSON.stringify(snapshot);
}

export function deserializeSim(json: string): Sim {
  const snapshot = JSON.parse(json) as SimSnapshot;
  const sim = createSim(snapshot.seed, snapshot.terrainConfig);
  sim.tick = snapshot.tick;
  sim.prng.setState(snapshot.prngState);
  for (const e of snapshot.entities) {
    spawnEntity(sim, e.playerId, e.x, e.y, e.vx, e.vy);
  }
  return sim;
}
