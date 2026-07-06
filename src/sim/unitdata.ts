/**
 * Loads data/units.json (human-readable, SOURCE OF TRUTH for balance) and
 * converts to fixed-point integer stats for the sim: HP ×100, damage ×100,
 * speed in millitiles/tick, times in ticks, multipliers ×1000.
 */
import unitsJson from "../../data/units.json";
import { TICK_RATE } from "./sim";

interface RawUnit {
  name: string;
  class: string;
  pantheon: string;
  age: string;
  hp: number;
  speed: number;
  los: number;
  pop: number;
  trainTime: number;
  cost: { food: number; wood: number; gold: number; favor: number };
  armor: { hack: number; pierce: number; crush: number };
  attack?: { type: string; damage: number; crushDamage?: number; range: number; minRange?: number; splashRadius?: number; cooldown: number };
  multipliers?: Record<string, number>;
  flying?: boolean;
  tradeGoldPerTile?: number;
  specialCombat?: { splashRadius?: number; splashPercent?: number; regenPerSec?: number; lifestealPercent?: number; stunSeconds?: number };
  gatherRates?: {
    huntFoodPerSec?: number;
    forageFoodPerSec?: number;
    farmFoodPerSec?: number;
    fishFoodPerSec?: number;
    woodPerSec?: number;
    goldPerSec?: number;
  };
}

export interface UnitStats {
  id: string;
  typeIndex: number;
  name: string;
  unitClass: string;
  pantheon: string;
  age: string;
  hp100: number;
  speedFpPerTick: number;
  losFp: number;
  radiusFp: number;
  pop: number;
  trainTicks: number;
  cost: { food: number; wood: number; gold: number; favor: number };
  /** armor as % damage reduction, integers 0–99 */
  armor: { hack: number; pierce: number; crush: number };
  attack: {
    type: "hack" | "pierce" | "crush" | "divine";
    damage100: number;
    crushDamage100: number;
    rangeFp: number;
    cooldownTicks: number;
  } | null;
  multipliers1000: Record<string, number>;
  flying: boolean;
  /** micro-resource per tick by node kind index (0 food/forage, 1 wood, 2 gold); null = can't gather */
  gatherMicroPerTick: [number, number, number, number] | null;
  /** micro-resource per SECOND (modifiers apply here, then ÷ TICK_RATE) */
  gatherMicroPerSec: [number, number, number, number] | null;
  /** caravans: gold (milli) earned per tile of one-way route distance */
  tradeGoldMilliPerTile: number;
  special: { splashRadiusFp: number; splashPermille: number; regenPer15T100: number; lifestealPermille: number; stunTicks: number } | null;
  naval: boolean;
}

const RADIUS_BY_CLASS: Record<string, number> = {
  villager: 280,
  scout: 320,
  caravan: 350,
  infantry: 300,
  archer: 300,
  cavalry: 400,
  siege: 500,
  hero: 320,
  myth: 450,
  ship: 500,
};

let cache: Map<string, UnitStats> | null = null;
let idList: string[] | null = null;

function load(): Map<string, UnitStats> {
  if (cache) return cache;
  cache = new Map();
  const entries = Object.entries(unitsJson.units as Record<string, RawUnit>);
  idList = entries.map(([id]) => id).sort();
  for (const [id, raw] of entries) {
    const typeIndex = idList.indexOf(id);
    cache.set(id, {
      id,
      typeIndex,
      name: raw.name,
      unitClass: raw.class,
      pantheon: raw.pantheon,
      age: raw.age,
      hp100: Math.round(raw.hp * 100),
      speedFpPerTick: Math.round((raw.speed * 1000) / TICK_RATE),
      losFp: Math.round(raw.los * 1000),
      radiusFp: RADIUS_BY_CLASS[raw.class] ?? 300,
      pop: raw.pop,
      trainTicks: Math.round(raw.trainTime * TICK_RATE),
      cost: { ...raw.cost },
      armor: { ...raw.armor },
      attack: raw.attack
        ? {
            type: raw.attack.type as "hack" | "pierce" | "crush" | "divine",
            damage100: Math.round(raw.attack.damage * 100),
            crushDamage100: Math.round((raw.attack.crushDamage ?? 0) * 100),
            rangeFp: Math.round(raw.attack.range * 1000),
            cooldownTicks: Math.max(1, Math.round(raw.attack.cooldown * TICK_RATE)),
          }
        : null,
      multipliers1000: Object.fromEntries(
        Object.entries(raw.multipliers ?? {}).map(([k, v]) => [k, Math.round(v * 1000)]),
      ),
      flying: raw.flying ?? false,
      gatherMicroPerTick: raw.gatherRates
        ? [
            Math.trunc((((raw.class === "ship" ? raw.gatherRates.fishFoodPerSec : raw.gatherRates.forageFoodPerSec) ?? 0) * 1_000_000) / TICK_RATE),
            Math.trunc(((raw.gatherRates.woodPerSec ?? 0) * 1_000_000) / TICK_RATE),
            Math.trunc(((raw.gatherRates.goldPerSec ?? 0) * 1_000_000) / TICK_RATE),
            Math.trunc(((raw.gatherRates.huntFoodPerSec ?? 0) * 1_000_000) / TICK_RATE),
          ]
        : null,
      gatherMicroPerSec: raw.gatherRates
        ? [
            Math.round(((raw.class === "ship" ? raw.gatherRates.fishFoodPerSec : raw.gatherRates.forageFoodPerSec) ?? 0) * 1_000_000),
            Math.round((raw.gatherRates.woodPerSec ?? 0) * 1_000_000),
            Math.round((raw.gatherRates.goldPerSec ?? 0) * 1_000_000),
            Math.round((raw.gatherRates.huntFoodPerSec ?? 0) * 1_000_000),
          ]
        : null,
      tradeGoldMilliPerTile: Math.round((raw.tradeGoldPerTile ?? 0) * 1000),
      naval: raw.class === "ship",
      special: raw.specialCombat
        ? {
            splashRadiusFp: Math.round((raw.specialCombat.splashRadius ?? 0) * 1000),
            splashPermille: Math.round((raw.specialCombat.splashPercent ?? 0) * 10),
            regenPer15T100: Math.round((raw.specialCombat.regenPerSec ?? 0) * 100),
            lifestealPermille: Math.round((raw.specialCombat.lifestealPercent ?? 0) * 10),
            stunTicks: Math.round((raw.specialCombat.stunSeconds ?? 0) * TICK_RATE),
          }
        : null,
    });
  }
  return cache;
}

export function getUnitStats(id: string): UnitStats {
  const s = load().get(id);
  if (!s) throw new Error(`unknown unit id: ${id}`);
  return s;
}

export function getUnitStatsByIndex(typeIndex: number): UnitStats {
  load();
  const id = idList![typeIndex];
  if (id === undefined) throw new Error(`unknown unit type index: ${typeIndex}`);
  return getUnitStats(id);
}

export function listUnitIds(): string[] {
  load();
  return [...idList!];
}
