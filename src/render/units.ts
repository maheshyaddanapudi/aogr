/**
 * Animated unit crowds: per (model × animation × team) skinned "pools";
 * each unit is a set of InstancedMeshes parented to a TransformNode and
 * swaps pools (idle/walk/work) by visibility. Instances share their pool's
 * skeleton, so whole crowds GPU-skin from one animation.
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

export type UnitAnimState = "idle" | "walk" | "work";
const ANIM_INDEX: Record<UnitAnimState, number> = { idle: 0, walk: 1, work: 2 };

interface ModelConfig {
  file: string;
  height: number; // tiles
  /** keep only matching meshes (packs bundle loadout variants); null = all */
  loadout: RegExp | null;
  anims: [RegExp, RegExp, RegExp]; // idle, walk, work
}

const MODELS: Record<string, ModelConfig> = {
  villager: {
    file: "villager.glb",
    height: 1.05,
    loadout: null,
    anims: [/^Idle$/, /^Walking_A$/, /Melee_Attack_Chop/],
  },
  knight: {
    file: "knight.glb",
    height: 1.15,
    loadout: /^(Knight_(Arm|Body|Head|Leg|Helmet|Cape).*|1H_Sword|Round_Shield)$/,
    anims: [/^Idle$/, /^Walking_A$/, /1H_Melee_Attack_Slice_Diagonal/],
  },
};

export function modelKeyForClass(unitClass: string): string {
  return unitClass === "villager" || unitClass === "scout" || unitClass === "caravan" ? "villager" : "knight";
}

interface Pool {
  meshes: Mesh[];
  scaling: Vector3;
}

interface UnitVisual {
  node: TransformNode;
  parts: InstancedMesh[][]; // [animIndex][meshIndex]
  ring: InstancedMesh;
  anim: number;
}

export interface UnitRenderer {
  update: (
    units: ReadonlyArray<{
      eid: number;
      x: number;
      z: number;
      vx: number;
      vz: number;
      playerId: number;
      unitClass: string;
      anim: UnitAnimState;
    }>,
    groundHeightAt: (x: number, z: number) => number,
    selected: ReadonlySet<number>,
  ) => void;
  isUnitMesh: (mesh: AbstractMesh) => number | null;
}

async function loadPool(
  scene: Scene,
  cfg: ModelConfig,
  animMatch: RegExp,
  team: number,
  shadows: CascadedShadowGenerator,
  teamMat: PBRMaterial,
): Promise<Pool> {
  const result = await SceneLoader.ImportMeshAsync("", `${import.meta.env.BASE_URL}models/`, cfg.file, scene);
  const root = result.meshes[0]!;
  const bounds = root.getHierarchyBoundingVectors();
  const scale = cfg.height / Math.max(0.001, bounds.max.y - bounds.min.y);
  root.scaling.setAll(scale);
  const group = result.animationGroups.find((g) => animMatch.test(g.name)) ?? result.animationGroups[0];
  for (const g of result.animationGroups) g.stop();
  group?.start(true, 1.0);
  const meshes = result.meshes.filter(
    (m): m is Mesh => m.getTotalVertices() > 0 && (!cfg.loadout || cfg.loadout.test(m.name)),
  ) as Mesh[];
  for (const m of result.meshes) {
    if (m.getTotalVertices() > 0 && cfg.loadout && !cfg.loadout.test(m.name)) m.setEnabled(false);
  }
  // adopt the pack texture once, then tint
  if (!teamMat.albedoTexture) {
    const loaded = meshes.map((m) => m.material).find((mat) => mat instanceof PBRMaterial) as PBRMaterial | undefined;
    teamMat.albedoTexture = loaded?.albedoTexture ?? null;
    teamMat.albedoColor = Color3.White().scale(0.6).add(TEAM_COLORS[team]!.scale(0.4));
  }
  for (const m of meshes) {
    m.isVisible = false;
    m.material = teamMat;
    shadows.addShadowCaster(m);
  }
  return { meshes, scaling: new Vector3(scale, scale, scale) };
}

export async function createUnitRenderer(scene: Scene, shadows: CascadedShadowGenerator): Promise<UnitRenderer> {
  // pools[modelKey][team][animIndex]
  const pools = new Map<string, Pool[][]>();
  const teamMats = new Map<string, PBRMaterial[]>();
  for (const [key, cfg] of Object.entries(MODELS)) {
    const mats = TEAM_COLORS.map((_, i) => {
      const m = new PBRMaterial(`unitMat_${key}_${i}`, scene);
      m.metallic = 0.2;
      m.roughness = 0.65;
      return m;
    });
    teamMats.set(key, mats);
    const perTeam: Pool[][] = [];
    for (let team = 0; team < TEAM_COLORS.length; team++) {
      const anims = await Promise.all(cfg.anims.map((re) => loadPool(scene, cfg, re, team, shadows, mats[team]!)));
      perTeam.push(anims);
    }
    pools.set(key, perTeam);
  }

  const ringProto = MeshBuilder.CreateTorus("selRing", { diameter: 1.3, thickness: 0.07, tessellation: 28 }, scene);
  const ringMat = new StandardMaterial("selRingMat", scene);
  ringMat.emissiveColor = new Color3(0.45, 0.95, 0.45);
  ringMat.disableLighting = true;
  ringProto.material = ringMat;
  ringProto.isVisible = false;
  ringProto.isPickable = false;

  const visuals = new Map<number, UnitVisual>();
  const meshToEid = new Map<AbstractMesh, number>();

  const update: UnitRenderer["update"] = (units, groundHeightAt, selected) => {
    for (const u of units) {
      let v = visuals.get(u.eid);
      if (!v) {
        const key = modelKeyForClass(u.unitClass);
        const team = u.playerId % TEAM_COLORS.length;
        const modelPools = pools.get(key)![team]!;
        const node = new TransformNode(`unit${u.eid}`, scene);
        const parts: InstancedMesh[][] = modelPools.map((pool, pi) =>
          pool.meshes.map((m, mi) => {
            const inst = m.createInstance(`u${u.eid}_${pi}_${mi}`);
            inst.parent = node;
            inst.scaling = pool.scaling.clone();
            inst.rotationQuaternion = null;
            inst.isVisible = pi === 0;
            meshToEid.set(inst, u.eid);
            return inst;
          }),
        );
        const ring = ringProto.createInstance(`ring${u.eid}`);
        ring.parent = node;
        ring.position.y = 0.12;
        ring.isVisible = false;
        v = { node, parts, ring, anim: 0 };
        visuals.set(u.eid, v);
      }
      v.node.position.set(u.x, groundHeightAt(u.x, u.z), u.z);
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
  };

  return {
    update,
    isUnitMesh: (mesh) => meshToEid.get(mesh) ?? null,
  };
}
