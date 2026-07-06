/**
 * Loads data/pantheons.json (SOURCE OF TRUTH): majors, minor-god pools per
 * age-up, minor-god grants, and favor-mechanic parameters.
 */
import pantheonsJson from "../../data/pantheons.json";

interface RawMinor {
  id: string;
  name: string;
  title: string;
  age: string;
  grants: { mythUnits: string[]; techs: string[]; power: string };
}

interface RawMajor {
  id: string;
  name: string;
  title: string;
  domain: string;
  passives: string[];
  minorPool: { classical: string[]; heroic: string[]; mythic: string[] };
}

interface RawPantheon {
  name: string;
  theme: string;
  colorIdentity: string;
  favorMechanic: Record<string, unknown> & { type: string };
  hero: string;
  favorBuilding: string | null;
  majors: RawMajor[];
  minors: RawMinor[];
}

const pantheons = pantheonsJson.pantheons as unknown as Record<string, RawPantheon>;

export function getPantheon(id: string): RawPantheon {
  const p = pantheons[id];
  if (!p) throw new Error(`unknown pantheon: ${id}`);
  return p;
}

export function listPantheonIds(): string[] {
  return Object.keys(pantheons);
}

export function getMajor(pantheonId: string, majorId: string): RawMajor {
  const m = getPantheon(pantheonId).majors.find((x) => x.id === majorId);
  if (!m) throw new Error(`unknown major god ${majorId} in ${pantheonId}`);
  return m;
}

export function getMinor(pantheonId: string, minorId: string): RawMinor {
  const m = getPantheon(pantheonId).minors.find((x) => x.id === minorId);
  if (!m) throw new Error(`unknown minor god ${minorId} in ${pantheonId}`);
  return m;
}

/** The 2 minor-god choices a major offers for an age-up tier. */
export function getMinorPool(pantheonId: string, majorId: string, age: "classical" | "heroic" | "mythic"): string[] {
  return [...getMajor(pantheonId, majorId).minorPool[age]];
}


/** Major-god passive bonuses as tech-effect-shaped modifiers (cached). */
export interface MajorEffect { target: string; stat: string; op: "add" | "mul"; value1000: number }
const majorFxCache = new Map<string, MajorEffect[]>();
export function getMajorEffects(pantheonId: string, majorId: string): MajorEffect[] {
  const key = `${pantheonId}/${majorId}`;
  let fx = majorFxCache.get(key);
  if (fx) return fx;
  fx = [];
  try {
    const major = getPantheon(pantheonId).majors.find((m) => m.id === majorId) as unknown as {
      bonuses?: Array<{ appliesTo: string[]; stat: string; multiplier?: number; add?: number }>;
    };
    for (const b of major?.bonuses ?? []) {
      for (const t of b.appliesTo) {
        if (b.multiplier !== undefined) fx.push({ target: t, stat: b.stat, op: "mul", value1000: Math.round(b.multiplier * 1000) });
        if (b.add !== undefined) fx.push({ target: t, stat: b.stat, op: "add", value1000: b.add });
      }
    }
  } catch {
    /* unknown pantheon/major: no bonuses */
  }
  majorFxCache.set(key, fx);
  return fx;
}
