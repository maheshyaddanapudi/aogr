/**
 * Animated unit crowds, v3: every unit TYPE gets its own model/animations/
 * tint (KayKit humanoids + skeletons, Quaternius animals — all CC0). Pools of
 * skinned meshes per (config × team × animation) load LAZILY on first sight,
 * so a match only pays for the rosters actually fielded. Instances share
 * their pool's skeleton (one GPU-skinned animation per crowd).
 */
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";

export const TEAM_COLORS = [new Color3(0.93, 0.72, 0.18), new Color3(0.16, 0.55, 0.78)];
const PANTHEON_TINTS: Record<string, Color3> = {
  auryan_dawn: new Color3(1.0, 0.72, 0.25),
  verdant_deep: new Color3(0.2, 0.85, 0.7),
  ashen_forge: new Color3(1.0, 0.35, 0.2),
  storm_concord: new Color3(0.45, 0.55, 1.0),
};

export type UnitAnimState = "idle" | "walk" | "work";

export interface ModelCfg {
  file: string;
  height: number; // tiles
  /** keep only matching meshes (packs bundle loadout variants); null = all */
  loadout: RegExp | null;
  anims: [RegExp, RegExp, RegExp]; // idle, walk, work/attack
  death: RegExp;
  /** these submeshes get a SOLID team-color material (banner/shield read) */
  teamSolidParts: RegExp | null;
  /** pantheon-tinted + glowing (myth/heroes) */
  mythTint: boolean;
}

const HUMANOID = {
  idle: /^Idle$/,
  walk: /^Walking_A$/,
  death: /^Death_A$/,
};
const ANIMAL = {
  idle: /^Idle$/,
  walk: /^Gallop$|^Walk$/,
  death: /^Death$/,
};

const cfg = (
  file: string,
  height: number,
  work: RegExp,
  opts: Partial<ModelCfg> & { animal?: boolean } = {},
): ModelCfg => ({
  file,
  height,
  loadout: opts.loadout ?? null,
  anims: [opts.animal ? ANIMAL.idle : HUMANOID.idle, opts.animal ? ANIMAL.walk : HUMANOID.walk, work],
  death: opts.animal ? ANIMAL.death : HUMANOID.death,
  teamSolidParts: opts.teamSolidParts ?? null,
  mythTint: opts.mythTint ?? false,
});

const MELEE = /1H_Melee_Attack_Slice_Diagonal/;
const CHOP = /^1H_Melee_Attack_Chop$/;
const TWOHAND = /^2H_Melee_Attack_Slice$/;
const SHOOT = /^2H_Ranged_Shooting$/;
const CAST = /^Spellcasting$/;
const BITE = /^Attack$|^Attack_Headbutt$|^Attack_Kick$/;

/** Per unit-id config; UNIT_CLASS_MODELS covers the rest. */
const UNIT_MODELS: Record<string, ModelCfg> = {
  villager: cfg("villager.glb", 1.05, CHOP),
  scout: cfg("horse_white.gltf", 1.35, BITE, { animal: true }),
  caravan: cfg("donkey.gltf", 1.4, BITE, { animal: true }),
  infantry_base: cfg("knight.glb", 1.15, MELEE, {
    loadout: /^(Knight_(Arm|Body|Head|Leg|Helmet|Cape).*|1H_Sword|Round_Shield)$/,
    teamSolidParts: /Cape|Round_Shield/,
  }),
  spearman: cfg("barbarian.glb", 1.2, TWOHAND, { teamSolidParts: /Cape|Cloak/ }),
  archer_base: cfg("rogue_hooded.glb", 1.1, SHOOT, { teamSolidParts: /Hood|Cape/ }),
  skirmisher: cfg("rogue_hooded.glb", 1.0, SHOOT, { teamSolidParts: /Hood|Cape/ }),
  cavalry_base: cfg("horse.gltf", 1.6, BITE, { animal: true }),
  raider_cavalry: cfg("horse.gltf", 1.45, BITE, { animal: true }),
  // heroes — casters/champions with pantheon glow
  radiant_champion: cfg("knight.glb", 1.3, MELEE, {
    loadout: /^(Knight_(Arm|Body|Head|Leg|Helmet|Cape).*|1H_Sword|Round_Shield)$/,
    mythTint: true,
  }),
  tide_seer: cfg("mage.glb", 1.25, CAST, { mythTint: true }),
  forgeborn: cfg("barbarian.glb", 1.3, TWOHAND, { mythTint: true }),
  sky_herald: cfg("mage.glb", 1.25, CAST, { mythTint: true }),
  // myth units — distinct silhouettes, pantheon-tinted glow
  sunhawk: cfg("fox.glb", 1.1, BITE, { animal: true, mythTint: true }),
  sandlion: cfg("wolf.gltf", 1.4, BITE, { animal: true, mythTint: true }),
  emberbull: cfg("bull.gltf", 1.8, BITE, { animal: true, mythTint: true }),
  ashen_phoenix: cfg("stag.gltf", 1.9, BITE, { animal: true, mythTint: true }),
  rivermaw: cfg("wolf.gltf", 1.5, BITE, { animal: true, mythTint: true }),
  stormserpent: cfg("stag.gltf", 1.7, BITE, { animal: true, mythTint: true }),
  deepcaller_naiad: cfg("skeleton_mage.glb", 1.4, CAST, { mythTint: true }),
  coral_golem: cfg("skeleton_warrior.glb", 2.0, MELEE, { mythTint: true }),
  forgehound: cfg("wolf.gltf", 1.4, BITE, { animal: true, mythTint: true }),
  cyclorn: cfg("skeleton_warrior.glb", 2.0, MELEE, { mythTint: true }),
  thunder_jotun: cfg("barbarian.glb", 2.2, TWOHAND, { mythTint: true }),
  bronze_colossus: cfg("skeleton_warrior.glb", 2.6, MELEE, { mythTint: true }),
  garuhawk: cfg("fox.glb", 1.2, BITE, { animal: true, mythTint: true }),
  wind_djinn: cfg("skeleton_mage.glb", 1.6, CAST, { mythTint: true }),
  stonegaze_naga: cfg("skeleton_rogue.glb", 1.5, SHOOT, { mythTint: true }),
  sky_manticore: cfg("stag.gltf", 2.0, BITE, { animal: true, mythTint: true }),
};

const CLASS_MODELS: Record<string, ModelCfg> = {
  villager: UNIT_MODELS.villager!,
  scout: UNIT_MODELS.scout!,
  caravan: UNIT_MODELS.caravan!,
  infantry: UNIT_MODELS.infantry_base!,
  archer: UNIT_MODELS.archer_base!,
  cavalry: UNIT_MODELS.cavalry_base!,
  siege: cfg("barbarian.glb", 1.6, TWOHAND),
  hero: UNIT_MODELS.forgeborn!,
  myth: UNIT_MODELS.coral_golem!,
  ship: UNIT_MODELS.caravan!,
};

export function resolveModelCfg(unitId: string, unitClass: string): { key: string; cfg: ModelCfg } {
  const byId = UNIT_MODELS[unitId];
  if (byId) return { key: unitId, cfg: byId };
  return { key: `class_${unitClass}`, cfg: CLASS_MODELS[unitClass] ?? CLASS_MODELS.infantry! };
}

/** kept for combatFx compatibility */
export function modelKeyForClass(unitClass: string): string {
  return unitClass === "villager" || unitClass === "scout" || unitClass === "caravan" ? "villager" : "knight";
}

interface Pool {
  meshes: Mesh[];
  scaling: Vector3;
}

interface UnitVisual {
  node: TransformNode;
  parts: InstancedMesh[][];
  ring: InstancedMesh;
  anim: number;
}

const ANIM_INDEX: Record<UnitAnimState, number> = { idle: 0, walk: 1, work: 2 };

export interface UnitView {
  eid: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  playerId: number;
  unitClass: string;
  unitId: string;
  pantheon: string;
  anim: UnitAnimState;
}

export interface UnitRenderer {
  update: (
    units: ReadonlyArray<UnitView>,
    groundHeightAt: (x: number, z: number) => number,
    selected: ReadonlySet<number>,
    isVisible?: (u: UnitView) => boolean,
  ) => void;
  isUnitMesh: (mesh: AbstractMesh) => number | null;
}

/** One GLB import at a time: parallel imports contend on texture decode
 * (white-material races on slow/headless stacks) and jank real browsers. */
let importChain: Promise<unknown> = Promise.resolve();
function queuedImport<T>(job: () => Promise<T>): Promise<T> {
  const next = importChain.then(job, job);
  importChain = next.catch(() => undefined);
  return next;
}

export async function createUnitRenderer(scene: Scene, shadows: CascadedShadowGenerator): Promise<UnitRenderer> {
  const pools = new Map<string, Pool[] | "loading">();
  const solidMats = TEAM_COLORS.map((c, i) => {
    const m = new PBRMaterial(`teamSolid${i}`, scene);
    m.albedoColor = c;
    m.metallic = 0.2;
    m.roughness = 0.55;
    return m;
  });

  /** Clone the part's OWN material (keeps textures AND per-part base colors —
   * Quaternius animals are colored via materials, not textures) and tint it. */
  const tintMaterial = (m: Mesh, poolKey: string, team: number, c: ModelCfg, pantheon: string): void => {
    if (!(m.material instanceof PBRMaterial)) return;
    const mm = m.material.clone(`${m.material.name}_${poolKey}`);
    if (c.mythTint) {
      const tint = PANTHEON_TINTS[pantheon] ?? TEAM_COLORS[team]!;
      mm.albedoColor = mm.albedoColor.multiply(Color3.White().scale(0.62).add(tint.scale(0.38)));
      mm.emissiveColor = tint.scale(0.2); // mythic glow
    } else {
      mm.albedoColor = mm.albedoColor.multiply(Color3.White().scale(0.74).add(TEAM_COLORS[team]!.scale(0.26)));
    }
    mm.metallicF0Factor = mm.metallicF0Factor; // keep loader settings as-is
    m.material = mm;
  };

  const loadPools = async (poolKey: string, c: ModelCfg, team: number, pantheon: string): Promise<void> => {
    const result: Pool[] = [];
    for (const animRe of c.anims) {
      const r = await queuedImport(() => SceneLoader.ImportMeshAsync("", `${import.meta.env.BASE_URL}models/`, c.file, scene));
      const root = r.meshes[0]!;
      const bounds = root.getHierarchyBoundingVectors();
      const scale = c.height / Math.max(0.001, bounds.max.y - bounds.min.y);
      root.scaling.setAll(scale);
      const group = r.animationGroups.find((g) => animRe.test(g.name)) ?? r.animationGroups.find((g) => /Idle/i.test(g.name)) ?? r.animationGroups[0];
      for (const g of r.animationGroups) g.stop();
      group?.start(true, 1.0);
      const meshes = r.meshes.filter((m): m is Mesh => m.getTotalVertices() > 0 && (!c.loadout || c.loadout.test(m.name))) as Mesh[];
      for (const m of r.meshes) {
        if (m.getTotalVertices() > 0 && c.loadout && !c.loadout.test(m.name)) m.setEnabled(false);
      }
      for (const m of meshes) {
        m.isVisible = false;
        if (c.teamSolidParts?.test(m.name)) m.material = solidMats[team]!;
        else tintMaterial(m, poolKey, team, c, pantheon);
        shadows.addShadowCaster(m);
      }
      result.push({ meshes, scaling: new Vector3(scale, scale, scale) });
    }
    pools.set(poolKey, result);
    // Each lazy pool load is a fresh texture-decode/effect-compile race
    // (skill §11) — re-specialize shortly after the textures settle.
    for (const t of [400, 2500]) {
      setTimeout(() => {
        for (const m of scene.materials) {
          try {
            m.markAsDirty(63);
          } catch {
            /* some material types don't support it */
          }
        }
      }, t);
    }
  };

  // pre-warm the universal starters so the first frame isn't empty
  const ringProto = MeshBuilder.CreateTorus("selRing", { diameter: 1.3, thickness: 0.07, tessellation: 28 }, scene);
  const ringMat = new StandardMaterial("selRingMat", scene);
  ringMat.emissiveColor = new Color3(0.45, 0.95, 0.45);
  ringMat.disableLighting = true;
  ringProto.material = ringMat;
  ringProto.isVisible = false;
  ringProto.isPickable = false;

  for (let team = 0; team < 2; team++) {
    await loadPools(`villager_${team}_x`, UNIT_MODELS.villager!, team, "x");
    await loadPools(`infantry_base_${team}_x`, UNIT_MODELS.infantry_base!, team, "x");
  }

  const visuals = new Map<number, UnitVisual>();
  const meshToEid = new Map<AbstractMesh, number>();

  const update: UnitRenderer["update"] = (units, groundHeightAt, selected, isVisible) => {
    for (const u of units) {
      let v = visuals.get(u.eid);
      if (!v) {
        const { key, cfg: c } = resolveModelCfg(u.unitId, u.unitClass);
        const team = u.playerId % TEAM_COLORS.length;
        const pantheonKey = c.mythTint ? u.pantheon : "x";
        const poolKey = `${key}_${team}_${pantheonKey}`;
        const pool = pools.get(poolKey);
        if (!pool) {
          pools.set(poolKey, "loading");
          void loadPools(poolKey, c, team, u.pantheon);
          continue;
        }
        if (pool === "loading") continue;
        const node = new TransformNode(`unit${u.eid}`, scene);
        const parts: InstancedMesh[][] = pool.map((p, pi) =>
          p.meshes.map((m, mi) => {
            const inst = m.createInstance(`u${u.eid}_${pi}_${mi}`);
            inst.parent = node;
            inst.scaling = p.scaling.clone();
            inst.rotationQuaternion = null;
            inst.isVisible = pi === 0;
            meshToEid.set(inst, u.eid);
            return inst;
          }),
        );
        const ring = ringProto.createInstance(`ring${u.eid}`);
        ring.parent = node;
        ring.position.y = 0.12;
        const ringScale = Math.max(1, c.height * 0.9);
        ring.scaling.set(ringScale, 1, ringScale);
        ring.isVisible = false;
        v = { node, parts, ring, anim: 0 };
        visuals.set(u.eid, v);
      }
      v.node.position.set(u.x, groundHeightAt(u.x, u.z), u.z);
      const show = !isVisible || isVisible(u);
      if (v.node.isEnabled() !== show) v.node.setEnabled(show);
      const anim = ANIM_INDEX[u.anim];
      if (anim !== v.anim) {
        v.parts[v.anim]!.forEach((m) => (m.isVisible = false));
        v.parts[anim]!.forEach((m) => (m.isVisible = true));
        v.anim = anim;
      }
      if (Math.abs(u.vx) > 0.001 || Math.abs(u.vz) > 0.001) {
        v.node.rotation.y = Math.atan2(u.vx, u.vz);
      }
      v.ring.isVisible = selected.has(u.eid);
    }
    // clean up visuals of dead entities
    if (visuals.size > units.length) {
      const alive = new Set(units.map((u) => u.eid));
      for (const [eid, v] of visuals) {
        if (!alive.has(eid)) {
          v.node.dispose();
          visuals.delete(eid);
        }
      }
    }
  };

  return {
    update,
    isUnitMesh: (mesh) => meshToEid.get(mesh) ?? null,
  };
}
