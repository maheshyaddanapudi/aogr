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
