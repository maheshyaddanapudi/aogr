/**
 * Loads data/buildings.json (SOURCE OF TRUTH) into fixed-point sim stats:
 * HP ×100, build times in ticks, footprint sizes in tiles.
 */
import buildingsJson from "../../data/buildings.json";
import { TICK_RATE } from "./sim";

interface RawBuilding {
  passable?: boolean;
  name: string;
  hp: number;
  buildTime: number;
  age: string;
  cost: { food: number; wood: number; gold: number; favor: number };
  armor: { hack: number; pierce: number; crush: number };
  popProvided?: number;
  buildLimit?: number;
  dropoff?: string[];
  trains?: string[];
  attack?: { type: string; damage: number; range: number; cooldown: number };
  los?: number;
  size: number;
  trade?: { resources: string[]; favorTradeable: boolean; baseRate: number; spreadPercent: number };
  provides?: string;
  placement?: string;
}

export interface BuildingStats {
  id: string;
  typeIndex: number;
  name: string;
  age: string;
  hp100: number;
  buildTicks: number;
  cost: { food: number; wood: number; gold: number; favor: number };
  armor: { hack: number; pierce: number; crush: number };
  popProvided: number;
  buildLimit: number;
  dropoff: string[];
  trains: string[];
  size: number;
  losFp: number;
  attack: { type: string; damage100: number; rangeFp: number; cooldownTicks: number } | null;
  trade: { spreadPercent: number } | null;
  isFarm: boolean;
  /** gates: footprint never blocks the nav grid */
  passable: boolean;
}

let cache: Map<string, BuildingStats> | null = null;
let idList: string[] | null = null;

function load(): Map<string, BuildingStats> {
  if (cache) return cache;
  cache = new Map();
  const entries = Object.entries(buildingsJson.buildings as Record<string, RawBuilding>);
  idList = entries.map(([id]) => id).sort();
  for (const [id, raw] of entries) {
    cache.set(id, {
      id,
      typeIndex: idList.indexOf(id),
      name: raw.name,
      age: raw.age,
      hp100: Math.round(raw.hp * 100),
      buildTicks: Math.max(1, Math.round(raw.buildTime * TICK_RATE)),
      cost: { ...raw.cost },
      armor: { ...raw.armor },
      popProvided: raw.popProvided ?? 0,
      buildLimit: raw.buildLimit ?? 0,
      dropoff: raw.dropoff ?? [],
      trains: raw.trains ?? [],
      size: raw.size,
      losFp: Math.round((raw.los ?? 8) * 1000),
      attack: raw.attack
        ? {
            type: raw.attack.type,
            damage100: Math.round(raw.attack.damage * 100),
            rangeFp: Math.round(raw.attack.range * 1000),
            cooldownTicks: Math.max(1, Math.round(raw.attack.cooldown * TICK_RATE)),
          }
        : null,
      trade: raw.trade ? { spreadPercent: raw.trade.spreadPercent } : null,
      isFarm: raw.provides === "infinite_farm_food",
      passable: raw.passable === true,
    });
  }
  return cache;
}

export function getBuildingStats(id: string): BuildingStats {
  const s = load().get(id);
  if (!s) throw new Error(`unknown building id: ${id}`);
  return s;
}

export function getBuildingStatsByIndex(typeIndex: number): BuildingStats {
  load();
  const id = idList![typeIndex];
  if (id === undefined) throw new Error(`unknown building type index: ${typeIndex}`);
  return getBuildingStats(id);
}

export function listBuildingIds(): string[] {
  load();
  return [...idList!];
}
