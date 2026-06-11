import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const load = (rel: string) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const units = load("data/units.json");
const buildings = load("data/buildings.json");
const techs = load("data/techs.json");
const godpowers = load("data/godpowers.json");
const pantheons = load("data/pantheons.json");

const PANTHEON_IDS = ["auryan_dawn", "verdant_deep", "ashen_forge", "storm_concord"];
const DAMAGE_TYPES = ["hack", "pierce", "crush", "divine"];
const UNIT_CLASSES = [
  "villager",
  "scout",
  "caravan",
  "infantry",
  "archer",
  "cavalry",
  "siege",
  "hero",
  "myth",
  "ship",
];

describe("data/units.json — source of truth", () => {
  it("every unit has valid core stats", () => {
    for (const [id, u] of Object.entries<any>(units.units)) {
      expect(u.hp, `${id}.hp`).toBeGreaterThan(0);
      expect(UNIT_CLASSES, `${id}.class`).toContain(u.class);
      expect(u.pop, `${id}.pop`).toBeGreaterThanOrEqual(0);
      expect(u.speed, `${id}.speed`).toBeGreaterThan(0);
      expect(u.trainTime, `${id}.trainTime`).toBeGreaterThan(0);
      for (const r of ["food", "wood", "gold", "favor"]) {
        expect(u.cost[r], `${id}.cost.${r}`).toBeGreaterThanOrEqual(0);
      }
      for (const d of ["hack", "pierce", "crush"]) {
        expect(u.armor[d], `${id}.armor.${d}`).toBeGreaterThanOrEqual(0);
        expect(u.armor[d], `${id}.armor.${d}`).toBeLessThanOrEqual(99);
      }
      if (u.attack) {
        expect(DAMAGE_TYPES, `${id}.attack.type`).toContain(u.attack.type);
        expect(u.attack.damage, `${id}.attack.damage`).toBeGreaterThan(0);
      }
      for (const target of Object.keys(u.multipliers ?? {})) {
        const valid = UNIT_CLASSES.includes(target) || target in units.units;
        expect(valid, `${id} multiplier target '${target}' must be a class or unit id`).toBe(true);
      }
    }
  });

  it("matches the §7 balance anchors exactly", () => {
    const v = units.units.villager;
    expect(v.hp).toBe(65);
    expect(v.cost.food).toBe(50);
    expect(v.trainTime).toBe(14);

    const inf = units.units.infantry_base;
    expect(inf.hp).toBe(115);
    expect(inf.attack.damage).toBe(8);
    expect(inf.attack.type).toBe("hack");
    expect(inf.armor).toMatchObject({ hack: 35, pierce: 15, crush: 99 });
    expect(inf.speed).toBe(4.2);
    expect(inf.pop).toBe(2);
    expect(inf.cost).toMatchObject({ food: 50, gold: 40 });
    expect(inf.trainTime).toBe(14);

    const arc = units.units.archer_base;
    expect(arc.hp).toBe(60);
    expect(arc.attack.damage).toBe(6.5);
    expect(arc.attack.type).toBe("pierce");
    expect(arc.cost).toMatchObject({ wood: 55, gold: 25 });
    expect(arc.pop).toBe(2);
    expect(arc.trainTime).toBe(15);

    const cav = units.units.cavalry_base;
    expect(cav.hp).toBe(150);
    expect(cav.attack.damage).toBe(10);
    expect(cav.multipliers.archer).toBe(1.25);
    expect(cav.cost).toMatchObject({ food: 40, gold: 80 });
    expect(cav.pop).toBe(3);
    expect(cav.trainTime).toBe(20);

    const myth = units.units.emberbull; // minotaur-analog anchor
    expect(myth.hp).toBe(300);
    expect(myth.attack.damage).toBe(15);
    expect(myth.attack.type).toBe("hack");
    expect(myth.attack.crushDamage).toBe(10);
    expect(myth.multipliers.myth).toBe(3);
    expect(myth.cost).toMatchObject({ food: 200, favor: 16 });
    expect(myth.pop).toBe(4);
    expect(myth.trainTime).toBe(20);
  });

  it("counter-triangle multipliers exist (spear ×3 vs cavalry, skirmisher ×4 vs archers)", () => {
    expect(units.units.spearman.multipliers.cavalry).toBe(3);
    expect(units.units.skirmisher.multipliers.archer).toBe(4);
  });

  it("ships 16 myth units, 4 per pantheon", () => {
    const myth = Object.values<any>(units.units).filter((u) => u.class === "myth");
    expect(myth.length).toBe(16);
    for (const p of PANTHEON_IDS) {
      expect(myth.filter((u) => u.pantheon === p).length, p).toBe(4);
    }
  });

  it("heroes carry the anti-myth ×2 multiplier", () => {
    const heroes = Object.values<any>(units.units).filter((u) => u.class === "hero");
    expect(heroes.length).toBeGreaterThanOrEqual(4);
    for (const h of heroes) expect(h.multipliers.myth).toBeGreaterThanOrEqual(2);
  });
});

describe("data/buildings.json", () => {
  it("has the §6 core buildings with valid stats", () => {
    for (const id of [
      "town_center",
      "house",
      "temple",
      "barracks",
      "archery_range",
      "stable",
      "armory",
      "tower",
      "wall",
      "gate",
      "fortress",
      "market",
      "granary",
      "storehouse",
      "wonder",
      "dock",
      "sun_altar",
      "sky_temple",
    ]) {
      const b = buildings.buildings[id];
      expect(b, `building ${id} missing`).toBeDefined();
      expect(b.hp, `${id}.hp`).toBeGreaterThan(0);
      expect(b.buildTime, `${id}.buildTime`).toBeGreaterThan(0);
    }
  });

  it("town center grants 15 pop, house grants 10 with cap 10", () => {
    expect(buildings.buildings.town_center.popProvided).toBe(15);
    expect(buildings.buildings.house.popProvided).toBe(10);
    expect(buildings.buildings.house.buildLimit).toBe(10);
  });

  it("buildings have ~5% crush armor (units have 99%)", () => {
    for (const [id, b] of Object.entries<any>(buildings.buildings)) {
      if (id === "wall" || id === "gate") continue; // fortifications may differ
      expect(b.armor.crush, `${id}.armor.crush`).toBeLessThanOrEqual(10);
    }
  });
});

describe("data/techs.json", () => {
  it("age-up costs match §6 and require the right buildings", () => {
    const classical = techs.techs.age_classical;
    expect(classical.cost).toMatchObject({ food: 400 });
    expect(classical.requiresBuilding).toBe("temple");
    const heroic = techs.techs.age_heroic;
    expect(heroic.cost).toMatchObject({ food: 800, gold: 500 });
    expect(heroic.requiresBuilding).toBe("armory");
    const mythic = techs.techs.age_mythic;
    expect(mythic.cost).toMatchObject({ food: 1000, gold: 1000 });
    expect(mythic.requiresBuilding).toBe("market");
  });

  it("every tech effect uses the structured modifier schema", () => {
    for (const [id, t] of Object.entries<any>(techs.techs)) {
      for (const e of t.effects ?? []) {
        expect(typeof e.target, `${id} effect target`).toBe("string");
        expect(typeof e.stat, `${id} effect stat`).toBe("string");
        expect(["add", "mul", "set"], `${id} effect op`).toContain(e.op);
        expect(typeof e.value, `${id} effect value`).toBe("number");
      }
    }
  });
});

describe("data/godpowers.json", () => {
  it("has 6 powers per pantheon, all with ramping reusable costs", () => {
    const powers = Object.values<any>(godpowers.powers);
    for (const p of PANTHEON_IDS) {
      expect(powers.filter((gp) => gp.pantheon === p).length, p).toBe(6);
    }
    for (const gp of powers) {
      expect(gp.firstCastFree).toBe(true);
      expect(gp.baseFavorCost).toBeGreaterThan(0);
      expect(gp.costRampPercent).toBeGreaterThan(0);
    }
  });
});

describe("data/pantheons.json — cross-references", () => {
  it("has 4 pantheons, each with 3 majors and 6 minors (2 per age-up)", () => {
    expect(Object.keys(pantheons.pantheons)).toEqual(PANTHEON_IDS);
    for (const [pid, p] of Object.entries<any>(pantheons.pantheons)) {
      expect(p.majors.length, `${pid} majors`).toBe(3);
      expect(p.minors.length, `${pid} minors`).toBe(6);
      for (const age of ["classical", "heroic", "mythic"]) {
        const tier = p.minors.filter((m: any) => m.age === age);
        expect(tier.length, `${pid} ${age} minor choices`).toBe(2);
      }
    }
  });

  it("every major offers exactly 2 valid minor choices per age-up", () => {
    for (const [pid, p] of Object.entries<any>(pantheons.pantheons)) {
      const minorIds = new Set(p.minors.map((m: any) => m.id));
      for (const major of p.majors) {
        for (const age of ["classical", "heroic", "mythic"]) {
          const pool = major.minorPool[age];
          expect(pool.length, `${pid}/${major.id}/${age}`).toBe(2);
          for (const m of pool) expect(minorIds.has(m), `${pid}/${major.id} → ${m}`).toBe(true);
        }
      }
    }
  });

  it("every minor god's grants resolve to real units, techs, and powers", () => {
    for (const p of Object.values<any>(pantheons.pantheons)) {
      for (const minor of p.minors) {
        expect(minor.grants.power in godpowers.powers, `power ${minor.grants.power}`).toBe(true);
        for (const u of minor.grants.mythUnits ?? []) {
          expect(u in units.units, `myth unit ${u}`).toBe(true);
        }
        for (const t of minor.grants.techs ?? []) {
          expect(t in techs.techs, `tech ${t}`).toBe(true);
        }
      }
    }
  });

  it("favor mechanics are calibrated per §7", () => {
    const auryan = pantheons.pantheons.auryan_dawn.favorMechanic;
    expect(auryan.type).toBe("devotion_pyres");
    expect(auryan.maxAltars).toBe(5);
    expect(auryan.ratePerMinuteAllBuilt).toBeCloseTo(28.6, 1);
    const storm = pantheons.pantheons.storm_concord.favorMechanic;
    expect(storm.type).toBe("skyward_chants");
    expect(storm.firstVillagerRatePerMinute).toBe(6);
  });
});

describe("data/maps", () => {
  it("skirmish map config defines pop cap 300 and 4 villagers + 1 scout start", () => {
    const map = load("data/maps/skirmish_plains.json");
    expect(map.popCap).toBe(300);
    expect(map.startUnits.villager).toBe(4);
    expect(map.startUnits.scout).toBe(1);
    expect(map.size).toBeGreaterThanOrEqual(200);
  });
});
