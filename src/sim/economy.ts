/**
 * Economy: players, resource nodes, buildings, gathering, construction,
 * prayer (favor), training, and market trade. All integer math; milli-units
 * for stocks (1 food = 1000) with micro-accumulators for sub-milli rates.
 */
import { addComponent, addEntity, hasComponent, query } from "bitecs";
import type { Checksum } from "./checksum";
import type { Command } from "./commands";
import { isqrt } from "./fixed";
import { isPassable } from "./path/grid";
import { computeFlowField, flowDistAt, UNREACHABLE } from "./path/flowfield";
import { getBuildingStats, getBuildingStatsByIndex, type BuildingStats } from "./buildingdata";
import { getUnitStats } from "./unitdata";
// eslint-disable-next-line import/no-cycle -- runtime-safe: functions called post-init
import { isWaterTile, nearestPassableTile, nearestWaterTile, nudgeOutOfFootprint, setMoveTarget, spawnUnitEntity, waterRegionAt, type Sim } from "./sim";
// eslint-disable-next-line import/no-cycle -- runtime-safe
import { AGE_INDEX, effectiveGatherMicroPerTick, effectiveTrainTicks, type ResearchEntry } from "./research";

export const POP_CAP_ABSOLUTE = 300;
export const CARRY_CAPACITY_MILLI = 10_000;
const GATHER_REACH_FP = 1700;
const PRAY_REACH_FP = 3000;

export type ResourceKind = "food" | "wood" | "gold" | "game" | "relic" | "herd" | "fish";
const RES_INDEX: Record<ResourceKind, number> = { food: 0, wood: 1, gold: 2, game: 3, relic: 4, herd: 5, fish: 6 };
// index 3 (wild game) banks as food and drops off at food depots
const RES_BY_INDEX: ResourceKind[] = ["food", "wood", "gold", "food", "relic", "food", "food"];

export interface PlayerState {
  foodMilli: number;
  woodMilli: number;
  goldMilli: number;
  favorMilli: number;
  favorMicroAccum: number;
  popCap: number;
  popUsed: number;
  townCenterEid: number;
  pantheon: string;
  age: number;
  majorGod: string;
  minorGods: string[];
  researchedTechs: string[];
  researchQueue: ResearchEntry[];
  castCounts: Record<string, number>;
  powerReadyTick: Record<string, number>;
  relicsStored: number;
  tradeDriftPermille: number;
}

export interface TrainEntry {
  typeIndex: number;
  unitId: string;
  ticksLeft: number;
}

export function createPlayers(count: number): PlayerState[] {
  return Array.from({ length: count }, () => ({
    foodMilli: 200_000,
    woodMilli: 200_000,
    goldMilli: 100_000,
    favorMilli: 0,
    favorMicroAccum: 0,
    popCap: 0,
    popUsed: 0,
    townCenterEid: -1,
    pantheon: "storm_concord",
    age: 0,
    majorGod: "indravan",
    minorGods: [],
    researchedTechs: [],
    researchQueue: [],
    castCounts: {},
    powerReadyTick: {},
    relicsStored: 0,
    tradeDriftPermille: 0,
  }));
}

export function getPlayer(sim: Sim, playerId: number): PlayerState {
  const p = sim.players[playerId];
  if (!p) throw new Error(`unknown player ${playerId}`);
  return p;
}

function stockGet(p: PlayerState, kind: ResourceKind): number {
  return kind === "food" ? p.foodMilli : kind === "wood" ? p.woodMilli : p.goldMilli;
}

function stockAdd(p: PlayerState, kind: ResourceKind, deltaMilli: number): void {
  if (kind === "food") p.foodMilli += deltaMilli;
  else if (kind === "wood") p.woodMilli += deltaMilli;
  else p.goldMilli += deltaMilli;
}

export function canAfford(p: PlayerState, cost: { food: number; wood: number; gold: number; favor: number }): boolean {
  return (
    p.foodMilli >= cost.food * 1000 &&
    p.woodMilli >= cost.wood * 1000 &&
    p.goldMilli >= cost.gold * 1000 &&
    p.favorMilli >= cost.favor * 1000
  );
}

export function payCost(p: PlayerState, cost: { food: number; wood: number; gold: number; favor: number }): void {
  p.foodMilli -= cost.food * 1000;
  p.woodMilli -= cost.wood * 1000;
  p.goldMilli -= cost.gold * 1000;
  p.favorMilli -= cost.favor * 1000;
}

/* ───────────────────────── entity helpers ───────────────────────── */

export function spawnResourceNode(sim: Sim, kind: ResourceKind, tileX: number, tileY: number, amountMilli: number): number {
  const { Position, ResourceNode } = sim.stores;
  const eid = addEntity(sim.world);
  addComponent(sim.world, eid, Position);
  addComponent(sim.world, eid, ResourceNode);
  Position.x[eid] = tileX * 1000 + 500;
  Position.y[eid] = tileY * 1000 + 500;
  ResourceNode.resType[eid] = RES_INDEX[kind];
  ResourceNode.amountMilli[eid] = amountMilli;
  return eid;
}

export function spawnBuilding(sim: Sim, playerId: number, buildingId: string, tileX: number, tileY: number, completed: boolean): number {
  const stats = getBuildingStats(buildingId);
  const { Position, Owner, Building } = sim.stores;
  const eid = addEntity(sim.world);
  addComponent(sim.world, eid, Position);
  addComponent(sim.world, eid, Owner);
  addComponent(sim.world, eid, Building);
  Position.x[eid] = tileX * 1000 + (stats.size * 1000) / 2;
  Position.y[eid] = tileY * 1000 + (stats.size * 1000) / 2;
  Owner.playerId[eid] = playerId;
  Building.typeIndex[eid] = stats.typeIndex;
  Building.progress[eid] = completed ? stats.buildTicks : 0;
  Building.total[eid] = stats.buildTicks;
  Building.active[eid] = completed ? 1 : 0;
  Building.tileX[eid] = tileX;
  Building.tileY[eid] = tileY;
  addComponent(sim.world, eid, sim.stores.Health);
  sim.stores.Health.hp100[eid] = stats.hp100;
  if (!stats.passable) blockFootprint(sim, tileX, tileY, stats.size);
  return eid;
}

function blockFootprint(sim: Sim, tileX: number, tileY: number, size: number): void {
  const g = sim.navGrid;
  for (let y = tileY; y < tileY + size; y++) {
    for (let x = tileX; x < tileX + size; x++) {
      if (x >= 0 && y >= 0 && x < g.size && y < g.size) g.passable[y * g.size + x] = 0;
    }
  }
  sim.flowFields.clear();
  // nudge any unit standing inside the footprint to open ground on ITS side
  const { Position, UnitRef } = sim.stores;
  const units = Array.from(query(sim.world, [Position, UnitRef])).sort((a, b) => a - b);
  for (const eid of units) {
    const tx = Math.trunc(Position.x[eid]! / 1000);
    const ty = Math.trunc(Position.y[eid]! / 1000);
    if (tx >= tileX && tx < tileX + size && ty >= tileY && ty < tileY + size) {
      nudgeOutOfFootprint(sim, eid, tileX, tileY, size);
    }
  }
}

/** Clear-footprint check against the live nav grid. */
function footprintClear(sim: Sim, tileX: number, tileY: number, size: number): boolean {
  for (let y = tileY - 1; y < tileY + size + 1; y++) {
    for (let x = tileX - 1; x < tileX + size + 1; x++) {
      if (!isPassable(sim.navGrid, x, y)) return false;
    }
  }
  return true;
}

/** Coastal variant: nearest clear footprint that touches water (docks). */
export function findCoastalSite(sim: Sim, nearX: number, nearY: number, size: number): { x: number; y: number } | null {
  // pass 1 wants the MAIN ocean — a dock on a landlocked lagoon can never
  // sail to the war (round-9 cell-16 autopsy). Pass 2 falls back to any coast.
  for (const requireMainSea of [true, false]) {
    for (let r = 2; r < 60; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = nearX + dx;
          const y = nearY + dy;
          if (!footprintClear(sim, x, y, size)) continue;
          let coastal = false;
          for (let yy = -2; yy <= size + 1 && !coastal; yy++) {
            for (let xx = -2; xx <= size + 1; xx++) {
              if (!isWaterTile(sim, x + xx, y + yy)) continue;
              if (requireMainSea && waterRegionAt(sim, x + xx, y + yy) !== sim.mainWaterRegion) continue;
              coastal = true;
              break;
            }
          }
          if (coastal) return { x, y };
        }
      }
    }
  }
  return null;
}

/** Deterministic spiral search for a clear building site near a tile,
 * restricted to tiles REACHABLE from the anchor (no across-the-river sites). */
export function findBuildSite(sim: Sim, nearX: number, nearY: number, size: number): { x: number; y: number } | null {
  const anchor = nearestPassableTile(sim, nearX, nearY);
  const key = anchor.y * sim.navGrid.size + anchor.x;
  let field = sim.flowFields.get(key);
  if (!field) {
    field = computeFlowField(sim.navGrid, anchor.x, anchor.y);
    sim.flowFields.set(key, field);
  }
  for (let r = 2; r < 40; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = nearX + dx;
        const y = nearY + dy;
        if (!footprintClear(sim, x, y, size)) continue;
        // a tile just outside the footprint must be reachable from the anchor
        if (flowDistAt(field, x - 1, y - 1) >= UNREACHABLE) continue;
        return { x, y };
      }
    }
  }
  return null;
}

export function findResourceNodes(sim: Sim, kind: ResourceKind): number[] {
  const { ResourceNode } = sim.stores;
  return Array.from(query(sim.world, [ResourceNode]))
    .filter(
      (e) =>
        (ResourceNode.resType[e] === RES_INDEX[kind] || (kind === "food" && ResourceNode.resType[e] === RES_INDEX.game)) &&
        ResourceNode.amountMilli[e]! > 0,
    )
    .sort((a, b) => a - b);
}

function buildingsOf(sim: Sim, playerId: number, predicate: (s: BuildingStats) => boolean, activeOnly = true): number[] {
  const { Owner, Building } = sim.stores;
  return Array.from(query(sim.world, [Building]))
    .filter(
      (e) =>
        Owner.playerId[e] === playerId &&
        (!activeOnly || Building.active[e] === 1) &&
        predicate(getBuildingStatsByIndex(Building.typeIndex[e]!)),
    )
    .sort((a, b) => a - b);
}

function nearestEid(sim: Sim, fromX: number, fromY: number, eids: number[]): number {
  const { Position } = sim.stores;
  let best = -1;
  let bestD = Number.MAX_SAFE_INTEGER;
  for (const e of eids) {
    const dx = Position.x[e]! - fromX;
    const dy = Position.y[e]! - fromY;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/* ───────────────────────── worldgen ───────────────────────── */

/** Bounded flood-fill: how many connected passable tiles surround (x,y)?
 * Stops counting at `cap` — placement only needs "big enough", not exact. */
function openRegionSize(sim: Sim, x: number, y: number, cap: number): number {
  const g = sim.navGrid;
  if (!isPassable(g, x, y)) return 0;
  const seen = new Set<number>([y * g.size + x]);
  const qx = [x];
  const qy = [y];
  let head = 0;
  while (head < qx.length && seen.size < cap) {
    const cx = qx[head]!;
    const cy = qy[head]!;
    head++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.size || ny >= g.size) continue;
      const k = ny * g.size + nx;
      if (seen.has(k) || !g.passable[k]) continue;
      seen.add(k);
      qx.push(nx);
      qy.push(ny);
    }
  }
  return seen.size;
}

/** A start needs ROOM: the first TC-buildable site whose walkable region can
 * actually hold a town (≥150 tiles). Terrain pockets trap the whole player —
 * villagers can't leave, nothing can be built (round-7 finding F5). */
const START_REGION_MIN = 150;
function findViableStart(sim: Sim, sx: number, sy: number, tcSize: number): { x: number; y: number } | null {
  for (let r = 0; r < 50; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (!isPassable(sim.navGrid, x, y)) continue;
        if (openRegionSize(sim, x, y, START_REGION_MIN) < START_REGION_MIN) continue;
        const site = findBuildSite(sim, x, y, tcSize);
        if (site) return site;
      }
    }
  }
  return null;
}

export function setupSkirmish(sim: Sim): void {
  const starts = [
    { x: 48, y: 100 },
    { x: 152, y: 100 },
    { x: 100, y: 152 },
  ];
  for (let pid = 0; pid < sim.players.length; pid++) {
    const start = starts[pid] ?? starts[0]!;
    const tcSize = getBuildingStats("town_center").size;
    const near = nearestPassableTile(sim, start.x, start.y);
    const site = findViableStart(sim, near.x, near.y, tcSize) ?? findBuildSite(sim, near.x, near.y, tcSize) ?? { x: near.x, y: near.y };
    const tc = spawnBuilding(sim, pid, "town_center", site.x, site.y, true);
    getPlayer(sim, pid).townCenterEid = tc;
    // villagers + scout around the TC
    for (let i = 0; i < 4; i++) {
      const t = nearestPassableTile(sim, site.x - 2 + i * 2, site.y + tcSize + 1);
      spawnUnitEntity(sim, pid, "villager", t.x * 1000 + 500, t.y * 1000 + 500);
    }
    const ts = nearestPassableTile(sim, site.x + tcSize + 2, site.y);
    spawnUnitEntity(sim, pid, "scout", ts.x * 1000 + 500, ts.y * 1000 + 500);
    // resource clusters
    const place = (kind: ResourceKind, ox: number, oy: number, count: number, each: number, spread: number) => {
      for (let i = 0; i < count; i++) {
        const t = nearestPassableTile(sim, site.x + ox + (i % spread), site.y + oy + Math.trunc(i / spread));
        spawnResourceNode(sim, kind, t.x, t.y, each);
      }
    };
    place("food", 7, 5, 8, 500_000, 4);
    place("food", -10, 8, 6, 500_000, 3);
    place("wood", -9, -7, 12, 200_000, 4);
    place("gold", 9, -8, 3, 1_500_000, 3);
    place("game", 14, 12, 4, 400_000, 2);
    place("game", -14, -12, 3, 400_000, 3);
  }
  // herdables: fattening animals near each base
  for (let pid = 0; pid < sim.players.length; pid++) {
    const start = starts[pid] ?? starts[0]!;
    for (let i = 0; i < 3; i++) {
      const t = nearestPassableTile(sim, start.x + 16 + i, start.y - 14);
      spawnResourceNode(sim, "herd", t.x, t.y, 60_000);
    }
  }
  // fish schools: open-water tiles (all neighbors wet)
  {
    let placed = 0;
    const g = sim.navGrid.size;
    for (let y = 8; y < g - 8 && placed < 10; y += 7) {
      for (let x = 8; x < g - 8 && placed < 10; x += 7) {
        let wet = true;
        for (let dy = -1; dy <= 1 && wet; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWaterTile(sim, x + dx, y + dy)) { wet = false; break; }
        if (wet) {
          spawnResourceNode(sim, "fish", x, y, 800_000);
          placed++;
        }
      }
    }
  }

  // relics: contested ground between the bases
  const mid = Math.trunc(sim.navGrid.size / 2);
  for (const [rx, ry] of [[mid, mid - 20], [mid, mid + 20], [mid - 12, mid], [mid + 12, mid]] as const) {
    const t = nearestPassableTile(sim, rx, ry);
    spawnResourceNode(sim, "relic", t.x, t.y, 1);
  }
}

/* ───────────────────────── command handlers ───────────────────────── */

export function handleEconomyCommand(sim: Sim, cmd: Command): boolean {
  const { GatherTask, ResourceNode, Building, Owner, UnitRef, Position } = sim.stores;
  switch (cmd.type) {
    case "gather": {
      if (!hasComponent(sim.world, cmd.nodeEid, ResourceNode)) return true;
      if (ResourceNode.resType[cmd.nodeEid] === RES_INDEX.relic) return true;
      if (ResourceNode.resType[cmd.nodeEid] === RES_INDEX.herd) {
        const owner = sim.herdOwner.get(cmd.nodeEid);
        if (owner !== undefined && owner !== cmd.playerId) return true;
      }
      const sorted = [...cmd.eids].sort((a, b) => a - b);
      for (const eid of sorted) {
        if (Owner.playerId[eid] !== cmd.playerId || !hasComponent(sim.world, eid, UnitRef)) continue;
        if (!hasComponent(sim.world, eid, GatherTask)) continue;
        GatherTask.phase[eid] = 1;
        GatherTask.nodeEid[eid] = cmd.nodeEid;
        GatherTask.carriedMilli[eid] = 0;
        GatherTask.carryMicro[eid] = 0;
        GatherTask.carriedType[eid] = ResourceNode.resType[cmd.nodeEid]!;
        setMoveTarget(sim, eid, Position.x[cmd.nodeEid]!, Position.y[cmd.nodeEid]!);
      }
      return true;
    }
    case "build": {
      const p = getPlayer(sim, cmd.playerId);
      const stats = getBuildingStats(cmd.building);
      if ((AGE_INDEX[stats.age] ?? 0) > p.age) return true;
      if (!canAfford(p, stats.cost)) return true;
      if (stats.buildLimit > 0) {
        const existing = buildingsOf(sim, cmd.playerId, (s) => s.id === stats.id, false).length;
        if (existing >= stats.buildLimit) return true;
      }
      // town centers only rise on neutral settlement sites (AoM rule)
      if (stats.id === "town_center" && cmd.x >= 0) {
        const tx = Math.trunc(cmd.x / 1000);
        const ty = Math.trunc(cmd.y / 1000);
        const near = sim.settlements.some((st) => Math.abs(st.x - tx) <= 4 && Math.abs(st.y - ty) <= 4);
        if (!near) return true;
      }
      // docks must touch the coast
      if (stats.id === "dock" && cmd.x >= 0) {
        const tx = Math.trunc(cmd.x / 1000);
        const ty = Math.trunc(cmd.y / 1000);
        let coastal = false;
        for (let dy = -2; dy <= stats.size + 1 && !coastal; dy++) for (let dx = -2; dx <= stats.size + 1; dx++) {
          if (isWaterTile(sim, tx + dx, ty + dy)) { coastal = true; break; }
        }
        if (!coastal) return true;
      }
      // a site without builders would never rise — ignore crewless orders
      const builders = [...cmd.eids]
        .sort((a, b) => a - b)
        .filter((eid) => Owner.playerId[eid] === cmd.playerId && hasComponent(sim.world, eid, GatherTask));
      if (builders.length === 0) return true;
      let site: { x: number; y: number } | null;
      if (cmd.x < 0 || cmd.y < 0) {
        const tc = p.townCenterEid;
        const nx = tc >= 0 ? Math.trunc(Position.x[tc]! / 1000) : 100;
        const ny = tc >= 0 ? Math.trunc(Position.y[tc]! / 1000) : 100;
        site = stats.id === "dock" ? findCoastalSite(sim, nx, ny, stats.size) : findBuildSite(sim, nx, ny, stats.size);
      } else {
        const tx = Math.trunc(cmd.x / 1000);
        const ty = Math.trunc(cmd.y / 1000);
        site = footprintClear(sim, tx, ty, stats.size) ? { x: tx, y: ty } : findBuildSite(sim, tx, ty, stats.size);
      }
      if (!site) return true;
      payCost(p, stats.cost);
      const beid = spawnBuilding(sim, cmd.playerId, cmd.building, site.x, site.y, false);
      for (const eid of builders) {
        GatherTask.phase[eid] = 4;
        GatherTask.nodeEid[eid] = beid;
        setMoveTarget(sim, eid, Position.x[beid]!, Position.y[beid]!);
      }
      return true;
    }
    case "train": {
      const p = getPlayer(sim, cmd.playerId);
      const beid = cmd.buildingEid;
      if (!hasComponent(sim.world, beid, Building) || Owner.playerId[beid] !== cmd.playerId) return true;
      if (Building.active[beid] !== 1) return true;
      const ustats = getUnitStats(cmd.unit);
      if ((AGE_INDEX[ustats.age] ?? 0) > p.age) return true;
      const bstats = getBuildingStatsByIndex(Building.typeIndex[beid]!);
      const trainable =
        bstats.trains.includes(ustats.id) ||
        (bstats.trains.includes("heroes") && ustats.unitClass === "hero") ||
        (bstats.trains.includes("myth_units") && ustats.unitClass === "myth");
      if (!trainable) return true;
      if (ustats.unitClass === "myth") {
        if (ustats.pantheon !== p.pantheon) return true;
        const granted = p.minorGods.some((g) => {
          try {
            return getMinorOf(p.pantheon, g).grants.mythUnits.includes(ustats.id);
          } catch {
            return false;
          }
        });
        if (!granted) return true;
      }
      if (ustats.unitClass === "hero" && ustats.pantheon !== "all" && ustats.pantheon !== p.pantheon) return true;
      if (!canAfford(p, ustats.cost) || p.popUsed + ustats.pop > Math.min(p.popCap, POP_CAP_ABSOLUTE)) return true;
      payCost(p, ustats.cost);
      const q = sim.trainQueues.get(beid) ?? [];
      q.push({ typeIndex: ustats.typeIndex, unitId: ustats.id, ticksLeft: effectiveTrainTicks(sim, cmd.playerId, ustats.unitClass, ustats.id, ustats.trainTicks) });
      sim.trainQueues.set(beid, q);
      return true;
    }
    case "trade": {
      const p = getPlayer(sim, cmd.playerId);
      if (cmd.sell === "favor" || cmd.buy === "favor") return true; // never tradeable
      const sell = cmd.sell as ResourceKind;
      const buy = cmd.buy as ResourceKind;
      if (!(sell in RES_INDEX) || !(buy in RES_INDEX) || sell === buy) return true;
      const market = buildingsOf(sim, cmd.playerId, (s) => s.trade !== null)[0];
      if (market === undefined) return true;
      const spread = getBuildingStatsByIndex(Building.typeIndex[market]!).trade!.spreadPercent;
      const amount = Math.min(cmd.amountMilli, stockGet(p, sell));
      if (amount <= 0) return true;
      stockAdd(p, sell, -amount);
      // supply pressure: heavy trading worsens the rate; it decays over time
      const drift = Math.min(500, p.tradeDriftPermille);
      stockAdd(p, buy, Math.trunc((Math.trunc((amount * (100 - spread)) / 100) * (1000 - drift)) / 1000));
      p.tradeDriftPermille = Math.min(900, p.tradeDriftPermille + Math.max(10, Math.trunc(amount / 4000)));
      return true;
    }
    case "repair": {
      const beid = cmd.buildingEid;
      if (!hasComponent(sim.world, beid, Building) || Owner.playerId[beid] !== cmd.playerId) return true;
      if (Building.active[beid] !== 1) return true;
      for (const eid of [...cmd.eids].sort((a, b) => a - b)) {
        if (Owner.playerId[eid] !== cmd.playerId || !hasComponent(sim.world, eid, GatherTask)) continue;
        GatherTask.phase[eid] = 6;
        GatherTask.nodeEid[eid] = beid;
        setMoveTarget(sim, eid, Position.x[beid]!, Position.y[beid]!);
      }
      return true;
    }
    case "trade_route": {
      const beid = cmd.buildingEid;
      if (!hasComponent(sim.world, beid, Building) || Owner.playerId[beid] !== cmd.playerId) return true;
      if (Building.active[beid] !== 1 || getBuildingStatsByIndex(Building.typeIndex[beid]!).trade === null) return true;
      for (const eid of [...cmd.eids].sort((a, b) => a - b)) {
        if (Owner.playerId[eid] !== cmd.playerId || !hasComponent(sim.world, eid, GatherTask)) continue;
        if (getUnitStats(sim.unitStats(eid).id).tradeGoldMilliPerTile <= 0) continue;
        GatherTask.phase[eid] = 7; // leg 1: to the market
        GatherTask.nodeEid[eid] = beid;
        setMoveTarget(sim, eid, Position.x[beid]!, Position.y[beid]!);
      }
      return true;
    }
    case "cancel_train": {
      const beid = cmd.buildingEid;
      if (!hasComponent(sim.world, beid, Building) || Owner.playerId[beid] !== cmd.playerId) return true;
      const q = sim.trainQueues.get(beid);
      const entry = q?.[cmd.index];
      if (!q || !entry) return true;
      q.splice(cmd.index, 1);
      if (q.length === 0) sim.trainQueues.delete(beid);
      const cost = getUnitStats(entry.unitId).cost;
      const p = getPlayer(sim, cmd.playerId);
      p.foodMilli += cost.food * 1000;
      p.woodMilli += cost.wood * 1000;
      p.goldMilli += cost.gold * 1000;
      p.favorMilli += cost.favor * 1000;
      return true;
    }
    case "rally": {
      const beid = cmd.buildingEid;
      if (!hasComponent(sim.world, beid, Building) || Owner.playerId[beid] !== cmd.playerId) return true;
      Building.rallyX[beid] = cmd.x | 0;
      Building.rallyY[beid] = cmd.y | 0;
      return true;
    }
    case "work_on": {
      const beid = cmd.buildingEid;
      if (!hasComponent(sim.world, beid, Building) || Owner.playerId[beid] !== cmd.playerId) return true;
      if (Building.active[beid] === 1) return true;
      const sorted = [...cmd.eids].sort((a, b) => a - b);
      for (const eid of sorted) {
        if (Owner.playerId[eid] !== cmd.playerId || !hasComponent(sim.world, eid, GatherTask)) continue;
        GatherTask.phase[eid] = 4;
        GatherTask.nodeEid[eid] = beid;
        setMoveTarget(sim, eid, Position.x[beid]!, Position.y[beid]!);
      }
      return true;
    }
    case "pray": {
      const sorted = [...cmd.eids].sort((a, b) => a - b);
      const temple = buildingsOf(sim, cmd.playerId, (s) => s.id === "temple" || s.id === "sky_temple")[0];
      if (temple === undefined) return true;
      for (const eid of sorted) {
        if (Owner.playerId[eid] !== cmd.playerId || !hasComponent(sim.world, eid, GatherTask)) continue;
        GatherTask.phase[eid] = 5;
        GatherTask.nodeEid[eid] = temple;
        GatherTask.carriedMilli[eid] = 0;
        setMoveTarget(sim, eid, Position.x[temple]!, Position.y[temple]!);
      }
      return true;
    }
    default:
      return false;
  }
}

/* ───────────────────────── systems ───────────────────────── */

// eslint-disable-next-line import/no-cycle -- runtime-safe
import { favorSystem } from "./powers";
import { getMinor as getMinorOf } from "./pantheondata";

export function economySystem(sim: Sim): void {
  const { Position, GatherTask, ResourceNode, Building, Owner, MoveState } = sim.stores;
  const workers = Array.from(query(sim.world, [GatherTask])).sort((a, b) => a - b);
  const prayingByPlayer = new Map<number, number>();

  for (const eid of workers) {
    if (sim.garrisonOf.has(eid)) continue; // sheltered — tasks pause inside
    const phase = GatherTask.phase[eid]!;
    if (phase === 0) continue;
    const px = Position.x[eid]!;
    const py = Position.y[eid]!;
    const node = GatherTask.nodeEid[eid]!;

    // a herd that defected to another player stops feeding the old owner
    if ((phase === 1 || phase === 2) && ResourceNode.resType[node] === RES_INDEX.herd) {
      const herdOwner = sim.herdOwner.get(node);
      if (herdOwner !== undefined && herdOwner !== Owner.playerId[eid]) {
        GatherTask.phase[eid] = 0;
        MoveState.active[eid] = 0;
        continue;
      }
    }

    if (phase === 1) {
      // walking to node
      if (ResourceNode.amountMilli[node]! <= 0) {
        retargetNode(sim, eid);
        continue;
      }
      const d = dist(px, py, Position.x[node]!, Position.y[node]!);
      // congestion forgiveness (campaign-M4 autopsy): crowd-stop and blocked-
      // avoidance can park a walker just OUTSIDE strict reach — near enough is
      // work, otherwise a long hard stall means the approach is futile: retask
      const settled = MoveState.active[eid] !== 1;
      const jammed = MoveState.stallTicks[eid]! > 30;
      if (d <= GATHER_REACH_FP || ((settled || jammed) && d <= GATHER_REACH_FP * 2)) {
        GatherTask.phase[eid] = 2;
        MoveState.active[eid] = 0;
      } else if (jammed && MoveState.stallTicks[eid]! > 90) {
        retargetNode(sim, eid, node);
      } else if (settled) {
        setMoveTarget(sim, eid, Position.x[node]!, Position.y[node]!); // stalled short: re-approach
      }
    } else if (phase === 2) {
      // gathering
      if (ResourceNode.amountMilli[node]! <= 0) {
        if (GatherTask.carriedMilli[eid]! > 0) goDropoff(sim, eid);
        else retargetNode(sim, eid);
        continue;
      }
      const rate = effectiveGatherMicroPerTick(sim, eid, GatherTask.carriedType[eid]!);
      if (rate === 0) {
        GatherTask.phase[eid] = 0;
        continue;
      }
      let micro = GatherTask.carryMicro[eid]! + rate;
      const gainMilli = Math.min(Math.trunc(micro / 1000), ResourceNode.amountMilli[node]!);
      micro -= gainMilli * 1000;
      GatherTask.carryMicro[eid] = micro;
      GatherTask.carriedMilli[eid] = GatherTask.carriedMilli[eid]! + gainMilli;
      ResourceNode.amountMilli[node] = ResourceNode.amountMilli[node]! - gainMilli;
      if (GatherTask.carriedMilli[eid]! >= CARRY_CAPACITY_MILLI) goDropoff(sim, eid);
    } else if (phase === 3) {
      // walking to drop-off
      const drop = GatherTask.dropEid[eid]!;
      if (!hasComponent(sim.world, drop, Building) || Building.active[drop] !== 1) {
        goDropoff(sim, eid);
        continue;
      }
      const reach = buildingReach(getBuildingStatsByIndex(Building.typeIndex[drop]!).size);
      if (dist(px, py, Position.x[drop]!, Position.y[drop]!) > reach && MoveState.active[eid] !== 1) {
        setMoveTarget(sim, eid, Position.x[drop]!, Position.y[drop]!); // stalled short: re-approach
      }
      if (dist(px, py, Position.x[drop]!, Position.y[drop]!) <= reach) {
        const p = getPlayer(sim, Owner.playerId[eid]!);
        stockAdd(p, RES_BY_INDEX[GatherTask.carriedType[eid]!]!, GatherTask.carriedMilli[eid]!);
        GatherTask.carriedMilli[eid] = 0;
        if (ResourceNode.amountMilli[node]! > 0) {
          GatherTask.phase[eid] = 1;
          setMoveTarget(sim, eid, Position.x[node]!, Position.y[node]!);
        } else {
          retargetNode(sim, eid);
        }
      }
    } else if (phase === 4) {
      // construction
      const b = GatherTask.nodeEid[eid]!;
      if (!hasComponent(sim.world, b, Building) || Building.active[b] === 1) {
        GatherTask.phase[eid] = 0;
        MoveState.active[eid] = 0;
        continue;
      }
      const reach = buildingReach(getBuildingStatsByIndex(Building.typeIndex[b]!).size);
      if (dist(px, py, Position.x[b]!, Position.y[b]!) > reach && MoveState.active[eid] !== 1) {
        setMoveTarget(sim, eid, Position.x[b]!, Position.y[b]!); // stalled short: re-approach
      }
      if (dist(px, py, Position.x[b]!, Position.y[b]!) <= reach) {
        MoveState.active[eid] = 0;
        Building.progress[b] = Building.progress[b]! + 1;
        if (Building.progress[b]! >= Building.total[b]!) {
          Building.active[b] = 1;
          // farms provide a quasi-infinite food node at their center; the
          // crew that raised the farm starts working it right away (AoE-style)
          if (getBuildingStatsByIndex(Building.typeIndex[b]!).isFarm) {
            const fx = Math.trunc(Position.x[b]! / 1000);
            const fy = Math.trunc(Position.y[b]! / 1000);
            const farmNode = spawnResourceNode(sim, "food", fx, fy, 1_000_000_000);
            const crew = Array.from(query(sim.world, [sim.stores.UnitRef, GatherTask]))
              .filter((w) => GatherTask.phase[w] === 4 && GatherTask.nodeEid[w] === b)
              .sort((x, y) => x - y);
            for (const w of crew) {
              GatherTask.phase[w] = 1;
              GatherTask.nodeEid[w] = farmNode;
              setMoveTarget(sim, w, Position.x[farmNode]!, Position.y[farmNode]!);
            }
          }
        }
      }
    } else if (phase === 5) {
      // praying at temple
      const t = GatherTask.nodeEid[eid]!;
      if (!hasComponent(sim.world, t, Building) || Building.active[t] !== 1) {
        GatherTask.phase[eid] = 0;
        continue;
      }
      if (dist(px, py, Position.x[t]!, Position.y[t]!) > PRAY_REACH_FP + 1500 && MoveState.active[eid] !== 1) {
        setMoveTarget(sim, eid, Position.x[t]!, Position.y[t]!);
      }
      if (dist(px, py, Position.x[t]!, Position.y[t]!) <= PRAY_REACH_FP + 1500) {
        MoveState.active[eid] = 0;
        const pid = Owner.playerId[eid]!;
        prayingByPlayer.set(pid, (prayingByPlayer.get(pid) ?? 0) + 1);
      }
    } else if (phase === 6) {
      // repairing an own building
      const b = GatherTask.nodeEid[eid]!;
      if (!hasComponent(sim.world, b, Building) || Building.active[b] !== 1) {
        GatherTask.phase[eid] = 0;
        continue;
      }
      const bstats = getBuildingStatsByIndex(Building.typeIndex[b]!);
      if (sim.stores.Health.hp100[b]! >= bstats.hp100) {
        GatherTask.phase[eid] = 0;
        MoveState.active[eid] = 0;
        continue;
      }
      const reach = buildingReach(bstats.size);
      if (dist(px, py, Position.x[b]!, Position.y[b]!) > reach && MoveState.active[eid] !== 1) {
        setMoveTarget(sim, eid, Position.x[b]!, Position.y[b]!);
      }
      if (dist(px, py, Position.x[b]!, Position.y[b]!) <= reach) {
        MoveState.active[eid] = 0;
        sim.stores.Health.hp100[b] = Math.min(bstats.hp100, sim.stores.Health.hp100[b]! + Math.max(1, Math.trunc(bstats.hp100 / bstats.buildTicks)));
      }
    } else if (phase === 7 || phase === 8) {
      // caravan trade route: market (7) ↔ own town center (8)
      const market = GatherTask.nodeEid[eid]!;
      const pid = Owner.playerId[eid]!;
      const tcEid = getPlayer(sim, pid).townCenterEid;
      if (!hasComponent(sim.world, market, Building) || Building.active[market] !== 1 || tcEid < 0 || !hasComponent(sim.world, tcEid, Building)) {
        GatherTask.phase[eid] = 0;
        continue;
      }
      const dest = phase === 7 ? market : tcEid;
      const reach = buildingReach(getBuildingStatsByIndex(Building.typeIndex[dest]!).size);
      if (dist(px, py, Position.x[dest]!, Position.y[dest]!) > reach) {
        if (MoveState.active[eid] !== 1) setMoveTarget(sim, eid, Position.x[dest]!, Position.y[dest]!);
        continue;
      }
      MoveState.active[eid] = 0;
      if (phase === 7) {
        GatherTask.phase[eid] = 8; // loaded — head for the town center
      } else {
        const routeFp = dist(Position.x[market]!, Position.y[market]!, Position.x[tcEid]!, Position.y[tcEid]!);
        const rate = sim.unitStats(eid).tradeGoldMilliPerTile;
        getPlayer(sim, pid).goldMilli += Math.max(rate, Math.trunc((routeFp * rate) / 1000));
        GatherTask.phase[eid] = 7; // back to the market
      }
      setMoveTarget(sim, eid, Position.x[phase === 7 ? tcEid : market]!, Position.y[phase === 7 ? tcEid : market]!);
    }
  }

  // herdables fatten, wander near home, and defect to nearby grazers
  if (sim.tick % 15 === 0) {
    for (const n of Array.from(query(sim.world, [ResourceNode])).sort((a, b) => a - b)) {
      if (ResourceNode.resType[n] !== 5 || ResourceNode.amountMilli[n]! <= 0) continue;
      if (ResourceNode.amountMilli[n]! < 120_000) {
        ResourceNode.amountMilli[n] = Math.min(120_000, ResourceNode.amountMilli[n]! + 400);
      }
      let home = sim.herdHome.get(n);
      if (!home) {
        home = { x: Position.x[n]!, y: Position.y[n]! };
        sim.herdHome.set(n, home);
      }
      // deterministic drift, leashed to home
      const dx = sim.prng.nextInt(1601) - 800;
      const dy = sim.prng.nextInt(1601) - 800;
      const nx = Position.x[n]! + dx;
      const ny = Position.y[n]! + dy;
      if (Math.abs(nx - home.x) < 6000 && Math.abs(ny - home.y) < 6000 && isPassable(sim.navGrid, Math.trunc(nx / 1000), Math.trunc(ny / 1000))) {
        Position.x[n] = nx;
        Position.y[n] = ny;
      }
      // capture: nearest player unit within 2 tiles claims the herd
      let claimant = -1;
      let bestD = 2000 * 2000;
      for (const w of Array.from(query(sim.world, [sim.stores.UnitRef])).sort((a, b) => a - b)) {
        const ddx = Position.x[w]! - Position.x[n]!;
        const ddy = Position.y[w]! - Position.y[n]!;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD) { bestD = d2; claimant = sim.stores.Owner.playerId[w]!; }
      }
      if (claimant >= 0) sim.herdOwner.set(n, claimant);
    }
  }

  // trade drift decays back toward par
  if (sim.tick % 6 === 0) {
    for (const p of sim.players) p.tradeDriftPermille = Math.max(0, p.tradeDriftPermille - 1);
  }

  // relics: heroes scoop them up in passing and bank them at temples
  {
    const heroes = Array.from(query(sim.world, [sim.stores.UnitRef]))
      .filter((e) => sim.unitStats(e).unitClass === "hero" && !sim.garrisonOf.has(e))
      .sort((a, b) => a - b);
    for (const h of heroes) {
      const held = sim.relicHolder.get(h) ?? 0;
      if (held === 0) {
        for (const n of Array.from(query(sim.world, [ResourceNode])).sort((a, b) => a - b)) {
          if (ResourceNode.resType[n] !== RES_INDEX.relic || ResourceNode.amountMilli[n]! <= 0) continue;
          if (dist(Position.x[h]!, Position.y[h]!, Position.x[n]!, Position.y[n]!) <= 1600) {
            ResourceNode.amountMilli[n] = 0;
            sim.relicHolder.set(h, 1);
            break;
          }
        }
      } else {
        const temples = buildingsOf(sim, Owner.playerId[h]!, (s) => s.id === "temple" || s.id === "sky_temple");
        for (const t of temples) {
          if (dist(Position.x[h]!, Position.y[h]!, Position.x[t]!, Position.y[t]!) <= buildingReach(getBuildingStatsByIndex(Building.typeIndex[t]!).size)) {
            getPlayer(sim, Owner.playerId[h]!).relicsStored += held;
            sim.relicHolder.delete(h);
            break;
          }
        }
      }
    }
  }

  // favor income — all four pantheon mechanics, data-calibrated
  favorSystem(sim, prayingByPlayer);

  // training queues (ascending building eid)
  const qEids = Array.from(sim.trainQueues.keys()).sort((a, b) => a - b);
  for (const beid of qEids) {
    const q = sim.trainQueues.get(beid)!;
    const head = q[0];
    if (!head) {
      sim.trainQueues.delete(beid);
      continue;
    }
    head.ticksLeft--;
    if (head.ticksLeft <= 0) {
      // population gate at COMPLETION too: room may have filled while training —
      // hold the finished unit in the queue until space frees up (AoM behavior)
      const holder = getPlayer(sim, Owner.playerId[beid]!);
      if (holder.popUsed + getUnitStats(head.unitId).pop > Math.min(holder.popCap, POP_CAP_ABSOLUTE)) continue;
      q.shift();
      if (q.length === 0) sim.trainQueues.delete(beid);
      const bx = Math.trunc(Position.x[beid]! / 1000);
      const by = Math.trunc(Position.y[beid]! / 1000);
      const size = getBuildingStatsByIndex(Building.typeIndex[beid]!).size;
      const naval = getUnitStats(head.unitId).naval;
      let t: { x: number; y: number };
      if (naval) {
        const w = nearestWaterTile(sim, bx, by);
        if (!w || Math.max(Math.abs(w.x - bx), Math.abs(w.y - by)) > 6) {
          // landlocked dock: refund rather than beach a ship on grass
          const cost = getUnitStats(head.unitId).cost;
          const pl = getPlayer(sim, Owner.playerId[beid]!);
          pl.foodMilli += cost.food * 1000;
          pl.woodMilli += cost.wood * 1000;
          pl.goldMilli += cost.gold * 1000;
          pl.favorMilli += cost.favor * 1000;
          continue;
        }
        t = w;
      } else {
        t = nearestPassableTile(sim, bx, by + Math.trunc(size / 2) + 1);
      }
      const eid = spawnUnitEntity(sim, Owner.playerId[beid]!, head.unitId, t.x * 1000 + 500, t.y * 1000 + 500);
      holder.popUsed += getUnitStats(head.unitId).pop; // keep the gate honest within this tick (recomputed later)
      if (Building.rallyX[beid] !== 0 || Building.rallyY[beid] !== 0) {
        setMoveTarget(sim, eid, Building.rallyX[beid]!, Building.rallyY[beid]!);
        // rally on a resource: gatherers go straight to work
        if (hasComponent(sim.world, eid, GatherTask)) {
          let node = -1;
          for (const n of Array.from(query(sim.world, [ResourceNode])).sort((a, b) => a - b)) {
            if (ResourceNode.amountMilli[n]! <= 0) continue;
            if (ResourceNode.resType[n] === RES_INDEX.herd) {
              const o = sim.herdOwner.get(n);
              if (o !== undefined && o !== Owner.playerId[beid]) continue;
            }
            const dx = Position.x[n]! - Building.rallyX[beid]!;
            const dy = Position.y[n]! - Building.rallyY[beid]!;
            if (dx * dx + dy * dy <= 2000 * 2000) { node = n; break; }
          }
          if (node >= 0) {
            GatherTask.phase[eid] = 1;
            GatherTask.nodeEid[eid] = node;
            GatherTask.carriedMilli[eid] = 0;
            GatherTask.carryMicro[eid] = 0;
            GatherTask.carriedType[eid] = ResourceNode.resType[node]!;
            setMoveTarget(sim, eid, Position.x[node]!, Position.y[node]!);
          }
        }
      }
    }
  }

  // pop accounting (recomputed every tick — no drift)
  recomputePop(sim);
}

/** Reach = footprint corner distance + working margin: move targets snap OUTSIDE
 * blocked footprints and arrival tolerance adds up to 0.7 tiles. */
function buildingReach(size: number): number {
  return size * 710 + 1900;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return isqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));
}

function goDropoff(sim: Sim, eid: number): void {
  const { Position, GatherTask, Owner, Building } = sim.stores;
  const kind = RES_BY_INDEX[GatherTask.carriedType[eid]!]!;
  const drops = buildingsOf(sim, Owner.playerId[eid]!, (s) => s.dropoff.includes(kind));
  if (drops.length === 0) {
    GatherTask.phase[eid] = 0;
    return;
  }
  const drop = nearestEid(sim, Position.x[eid]!, Position.y[eid]!, drops);
  GatherTask.phase[eid] = 3;
  GatherTask.dropEid[eid] = drop;
  setMoveTarget(sim, eid, Position.x[drop]!, Position.y[drop]!);
  void Building;
}

function retargetNode(sim: Sim, eid: number, excludeEid = -1): void {
  const { Position, GatherTask, MoveState, Owner } = sim.stores;
  const kind = RES_BY_INDEX[GatherTask.carriedType[eid]!]!;
  let nodes = findResourceNodes(sim, kind);
  if (excludeEid >= 0) nodes = nodes.filter((n) => n !== excludeEid);
  if (kind === "herd") {
    nodes = nodes.filter((n) => {
      const o = sim.herdOwner.get(n);
      return o === undefined || o === Owner.playerId[eid];
    });
  }
  if (nodes.length === 0) {
    GatherTask.phase[eid] = 0;
    MoveState.active[eid] = 0;
    return;
  }
  const node = nearestEid(sim, Position.x[eid]!, Position.y[eid]!, nodes);
  GatherTask.nodeEid[eid] = node;
  GatherTask.phase[eid] = 1;
  setMoveTarget(sim, eid, Position.x[node]!, Position.y[node]!);
}

export function recomputePop(sim: Sim): void {
  const { Owner, UnitRef, Building } = sim.stores;
  for (const p of sim.players) {
    p.popCap = 0;
    p.popUsed = 0;
  }
  for (const eid of query(sim.world, [Building])) {
    if (Building.active[eid] !== 1) continue;
    const p = sim.players[Owner.playerId[eid]!];
    if (p) p.popCap += getBuildingStatsByIndex(Building.typeIndex[eid]!).popProvided;
  }
  for (const eid of query(sim.world, [UnitRef])) {
    const p = sim.players[Owner.playerId[eid]!];
    if (p) p.popUsed += sim.unitStats(eid).pop;
  }
  for (const p of sim.players) p.popCap = Math.min(p.popCap, POP_CAP_ABSOLUTE);
}

/* ───────────────── checksum + snapshot contributions ───────────────── */

export function hashEconomy(sim: Sim, c: Checksum): void {
  const { ResourceNode, Building, GatherTask, Owner } = sim.stores;
  for (const p of sim.players) {
    c.addI32(p.foodMilli);
    c.addI32(p.woodMilli);
    c.addI32(p.goldMilli);
    c.addI32(p.favorMilli);
    c.addI32(p.relicsStored);
    c.addI32(p.tradeDriftPermille);
    c.addI32(p.favorMicroAccum);
    c.addI32(p.popCap);
    c.addI32(p.popUsed);
  }
  for (const eid of Array.from(query(sim.world, [ResourceNode])).sort((a, b) => a - b)) {
    c.addI32(ResourceNode.resType[eid]!);
    c.addI32(ResourceNode.amountMilli[eid]!);
  }
  for (const eid of Array.from(query(sim.world, [Building])).sort((a, b) => a - b)) {
    c.addI32(Owner.playerId[eid]!);
    c.addI32(Building.typeIndex[eid]!);
    c.addI32(Building.progress[eid]!);
    c.addI32(Building.active[eid]!);
    c.addI32(Building.tileX[eid]!);
    c.addI32(Building.tileY[eid]!);
    c.addI32(Building.rallyX[eid]!);
    c.addI32(Building.rallyY[eid]!);
  }
  for (const eid of Array.from(query(sim.world, [GatherTask])).sort((a, b) => a - b)) {
    c.addI32(GatherTask.phase[eid]!);
    c.addI32(GatherTask.carriedMilli[eid]!);
    c.addI32(GatherTask.carriedType[eid]!);
    c.addI32(GatherTask.carryMicro[eid]!);
  }
  for (const beid of Array.from(sim.trainQueues.keys()).sort((a, b) => a - b)) {
    for (const e of sim.trainQueues.get(beid)!) {
      c.addI32(e.typeIndex);
      c.addI32(e.ticksLeft);
    }
  }
}
