/**
 * Animated unit rendering for crowds: two skinned "pools" (idle, walk) loaded
 * as independent models; every unit is a set of InstancedMeshes parented to a
 * per-unit TransformNode. Instances share their pool's skeleton, so an entire
 * marching army GPU-skins from one animation — the standard crowd trade-off
 * (per-unit phase offset arrives with VAT later if needed).
 */
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";

const TEAM_COLORS = [new Color3(0.93, 0.72, 0.18), new Color3(0.16, 0.65, 0.7)];
const UNIT_HEIGHT = 1.15; // tiles

interface Pool {
  meshes: Mesh[];
  root: TransformNode;
  loadedAlbedo: unknown;
}

interface UnitVisual {
  node: TransformNode;
  parts: InstancedMesh[][]; // [poolIndex][meshIndex]
  ring: InstancedMesh;
  pool: number;
  lastX: number;
  lastZ: number;
}

export interface UnitRenderer {
  /** Sync visuals to sim unit states. */
  update: (
    units: ReadonlyArray<{ eid: number; x: number; z: number; vx: number; vz: number; playerId: number; moving: boolean }>,
    groundHeightAt: (x: number, z: number) => number,
    selected: ReadonlySet<number>,
  ) => void;
  /** All pickable unit meshes (for click selection). */
  isUnitMesh: (mesh: AbstractMesh) => number | null;
}

async function loadPool(scene: Scene, animMatch: RegExp, shadows: CascadedShadowGenerator, teamMats: PBRMaterial[]): Promise<Pool[]> {
  // one pool per team so team tint bakes into the pool materials
  const pools: Pool[] = [];
  for (let team = 0; team < TEAM_COLORS.length; team++) {
    const result = await SceneLoader.ImportMeshAsync("", `${import.meta.env.BASE_URL}models/`, "knight.glb", scene);
    const root = result.meshes[0]! as Mesh;
    const bounds = root.getHierarchyBoundingVectors();
    const scale = UNIT_HEIGHT / Math.max(0.001, bounds.max.y - bounds.min.y);
    root.scaling.setAll(scale);
    root.name = `pool_${animMatch.source}_${team}`;
    const group = result.animationGroups.find((g) => animMatch.test(g.name)) ?? result.animationGroups[0];
    for (const g of result.animationGroups) g.stop();
    group?.start(true, 1.0);
    // The pack ships weapon/shield VARIANTS in one file — keep a single loadout.
    const LOADOUT = /^(Knight_(Arm|Body|Head|Leg|Helmet|Cape).*|1H_Sword|Round_Shield)$/;
    const meshes = result.meshes.filter((m): m is Mesh => m.getTotalVertices() > 0 && LOADOUT.test(m.name)) as Mesh[];
    for (const m of result.meshes) {
      if (m.getTotalVertices() > 0 && !LOADOUT.test(m.name)) m.setEnabled(false);
    }
    // capture the GLTF's texture BEFORE overriding materials
    const loadedMat = meshes.map((m) => m.material).find((mat) => mat instanceof PBRMaterial) as PBRMaterial | undefined;
    const loadedAlbedo = loadedMat?.albedoTexture ?? null;
    for (const m of meshes) {
      m.isVisible = false;
      m.material = teamMats[team]!;
      shadows.addShadowCaster(m);
    }
    pools.push({ meshes, root, loadedAlbedo });
  }
  return pools;
}

export async function createUnitRenderer(scene: Scene, shadows: CascadedShadowGenerator): Promise<UnitRenderer> {
  const teamMats = TEAM_COLORS.map((c, i) => {
    const m = new PBRMaterial(`teamMat${i}`, scene);
    m.metallic = 0.25;
    m.roughness = 0.6;
    m.albedoColor = Color3.White();
    return m;
  });

  const [idlePools, walkPools] = await Promise.all([
    loadPool(scene, /idle/i, shadows, teamMats),
    loadPool(scene, /walking_a|walk|run/i, shadows, teamMats),
  ]);
  // adopt the loaded texture, then tint per team
  for (let t = 0; t < TEAM_COLORS.length; t++) {
    const albedo = (idlePools[t]!.loadedAlbedo ?? walkPools[t]!.loadedAlbedo) as PBRMaterial["albedoTexture"];
    teamMats[t]!.albedoTexture = albedo;
    teamMats[t]!.albedoColor = Color3.White().scale(0.6).add(TEAM_COLORS[t]!.scale(0.4));
  }

  // selection ring prototype
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
        const node = new TransformNode(`unit${u.eid}`, scene);
        const team = u.playerId % TEAM_COLORS.length;
        const parts: InstancedMesh[][] = [idlePools, walkPools].map((pools, pi) =>
          pools[team]!.meshes.map((m, mi) => {
            const inst = m.createInstance(`u${u.eid}_${pi}_${mi}`);
            inst.parent = node;
            inst.scaling = pools[team]!.root.scaling.clone();
            inst.rotationQuaternion = null;
            inst.rotation = new Vector3(0, 0, 0);
            inst.isVisible = pi === 0;
            meshToEid.set(inst, u.eid);
            return inst;
          }),
        );
        const ring = ringProto.createInstance(`ring${u.eid}`);
        ring.parent = node;
        ring.position.y = 0.12;
        ring.isVisible = false;
        v = { node, parts, ring, pool: 0, lastX: u.x, lastZ: u.z };
        visuals.set(u.eid, v);
      }
      v.node.position.set(u.x, groundHeightAt(u.x, u.z), u.z);
      const moving = u.moving && (Math.abs(u.vx) > 0.001 || Math.abs(u.vz) > 0.001);
      const pool = moving ? 1 : 0;
      if (pool !== v.pool) {
        v.pool = pool;
        v.parts[0]!.forEach((m) => (m.isVisible = pool === 0));
        v.parts[1]!.forEach((m) => (m.isVisible = pool === 1));
      }
      if (moving) {
        v.node.rotation.y = Math.atan2(u.vx, u.vz);
      }
      v.ring.isVisible = selected.has(u.eid);
      v.lastX = u.x;
      v.lastZ = u.z;
    }
  };

  return {
    update,
    isUnitMesh: (mesh) => meshToEid.get(mesh) ?? null,
  };
}
