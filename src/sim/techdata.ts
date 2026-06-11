/**
 * Loads data/techs.json (SOURCE OF TRUTH): costs, research times in ticks,
 * structured effects with fixed-point values (mul ×1000).
 */
import techsJson from "../../data/techs.json";
import { TICK_RATE } from "./sim";

interface RawTech {
  name: string;
  age: string;
  researchedAt: string;
  researchTime: number;
  cost: { food: number; wood: number; gold: number; favor: number };
  requiresBuilding?: string;
  prerequisites?: string[];
  effects?: Array<{ target: string; stat: string; op: "add" | "mul" | "set"; value: number }>;
  pantheon?: string;
  grantedBy?: string;
}

export interface TechEffect {
  target: string;
  stat: string;
  op: "add" | "mul" | "set";
  /** add/set: integer value as-is; mul: ×1000 fixed point */
  value1000: number;
}

export interface TechStats {
  id: string;
  name: string;
  age: number;
  researchedAt: string;
  researchTicks: number;
  cost: { food: number; wood: number; gold: number; favor: number };
  requiresBuilding: string | null;
  prerequisites: string[];
  effects: TechEffect[];
  pantheon: string | null;
  grantedBy: string | null;
  isAgeTech: boolean;
}

export const AGE_INDEX: Record<string, number> = { archaic: 0, classical: 1, heroic: 2, mythic: 3 };

let cache: Map<string, TechStats> | null = null;

function load(): Map<string, TechStats> {
  if (cache) return cache;
  cache = new Map();
  for (const [id, raw] of Object.entries(techsJson.techs as Record<string, RawTech>)) {
    cache.set(id, {
      id,
      name: raw.name,
      age: AGE_INDEX[raw.age] ?? 0,
      researchedAt: raw.researchedAt,
      researchTicks: Math.max(1, Math.round(raw.researchTime * TICK_RATE)),
      cost: { ...raw.cost },
      requiresBuilding: raw.requiresBuilding ?? null,
      prerequisites: raw.prerequisites ?? [],
      effects: (raw.effects ?? []).map((e) => ({
        target: e.target,
        stat: e.stat,
        op: e.op,
        value1000: e.op === "mul" ? Math.round(e.value * 1000) : Math.round(e.value),
      })),
      pantheon: raw.pantheon ?? null,
      grantedBy: raw.grantedBy ?? null,
      isAgeTech: id.startsWith("age_"),
    });
  }
  return cache;
}

export function getTechStats(id: string): TechStats {
  const t = load().get(id);
  if (!t) throw new Error(`unknown tech id: ${id}`);
  return t;
}

export function listTechIds(): string[] {
  return Array.from(load().keys()).sort();
}
