/**
 * Buildings + resource nodes: KayKit Medieval Hexagon models (CC0), cloned
 * per building (few of them), team color via yellow/blue pack variants.
 * Construction visual: the building rises from its foundation with progress.
 * Resource nodes are instanced trees/rocks; depleted nodes disappear.
 */
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";

const TEAM_VARIANT = ["yellow", "blue"];

const BUILDING_MODEL: Record<string, string> = {
  town_center: "castle",
  house: "home_A",
  temple: "church",
  market: "market",
  granary: "windmill",
  storehouse: "lumbermill",
  barracks: "barracks",
  archery_range: "archeryrange",
  armory: "blacksmith",
  stable: "tavern",
  tower: "tower_A",
};

const NODE_MODEL: Record<number, string> = {
  0: "nature/tree_single_B", // food groves
  1: "nature/tree_single_A", // wood forest
  2: "nature/rock_single_A", // gold outcrop
};

interface BuildingVisual {
  node: TransformNode;
  height: number;
  scaffold: TransformNode | null;
}

export interface WorldObjectsRenderer {
  update: (
    buildings: ReadonlyArray<{ eid: number; buildingId: string; playerId: number; x: number; z: number; size: number; progress: number; total: number; active: boolean }>,
    nodes: ReadonlyArray<{ eid: number; resType: number; x: number; z: number; depleted: boolean }>,
    groundHeightAt: (x: number, z: number) => number,
  ) => void;
  isNodeMesh: (mesh: AbstractMesh) => number | null;
  isBuildingMesh: (mesh: AbstractMesh) => number | null;
  /** placement ghost: show/hide a footprint box that follows the cursor */
  showGhost: (size: number, x: number, z: number, ok: boolean, groundY: number) => void;
  hideGhost: () => void;
}

export async function createWorldObjectsRenderer(
  scene: Scene,
  shadows: CascadedShadowGenerator,
): Promise<WorldObjectsRenderer> {
  const protoCache = new Map<string, TransformNode>();

  const loadProto = async (path: string): Promise<TransformNode> => {
    let proto = protoCache.get(path);
    if (proto) return proto;
    const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/") + 1) : "";
    const file = path.substring(path.lastIndexOf("/") + 1);
    const result = await SceneLoader.ImportMeshAsync("", `${import.meta.env.BASE_URL}models/${dir}`, `${file}.gltf`, scene);
    proto = new TransformNode(`proto_${path}`, scene);
    for (const m of result.meshes) {
      if (m.getTotalVertices() > 0) {
        m.setParent(proto);
        m.isVisible = false;
        shadows.addShadowCaster(m);
      } else if (m.parent === null && m !== proto) {
        m.setParent(proto);
      }
    }
    proto.setEnabled(false);
    protoCache.set(path, proto);
    return proto;
  };

  // preload everything we may need this phase (deterministic order, cached)
  for (const variant of TEAM_VARIANT) {
    for (const model of Object.values(BUILDING_MODEL)) {
      await loadProto(`buildings/building_${model}_${variant}`);
    }
  }
  for (const model of Object.values(NODE_MODEL)) await loadProto(model);

  const cloneProto = (path: string, name: string): TransformNode => {
    const proto = protoCache.get(path)!;
    const clone = proto.clone(name, null)! as TransformNode;
    clone.setEnabled(true);
    for (const m of clone.getChildMeshes()) {
      m.isVisible = true;
      shadows.addShadowCaster(m);
    }
    return clone;
  };

  const scaffoldMat = new StandardMaterial("scaffoldMat", scene);
  scaffoldMat.diffuseColor = new Color3(0.45, 0.33, 0.18);
  scaffoldMat.emissiveColor = new Color3(0.12, 0.09, 0.05);

  const makeScaffold = (size: number): TransformNode => {
    const node = new TransformNode("scaffold", scene);
    const h = size * 0.9;
    const half = size / 2;
    for (const [sx, sz] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
      const post = MeshBuilder.CreateCylinder("post", { height: h, diameter: 0.12 }, scene);
      post.material = scaffoldMat;
      post.position.set(sx, h / 2, sz);
      post.parent = node;
    }
    for (const [rx, rz, len, rot] of [[0, -half, size, 0], [0, half, size, 0], [-half, 0, size, Math.PI / 2], [half, 0, size, Math.PI / 2]] as const) {
      const rail = MeshBuilder.CreateBox("rail", { width: len, height: 0.08, depth: 0.08 }, scene);
      rail.material = scaffoldMat;
      rail.position.set(rx, h * 0.92, rz);
      rail.rotation.y = rot;
      rail.parent = node;
    }
    return node;
  };

  const buildingVisuals = new Map<number, BuildingVisual>();
  const nodeVisuals = new Map<number, TransformNode>();
  const nodeMeshToEid = new Map<AbstractMesh, number>();
  const buildingMeshToEid = new Map<AbstractMesh, number>();

  // placement ghost
  const ghost = MeshBuilder.CreateBox("ghost", { width: 1, depth: 1, height: 0.6 }, scene);
  const ghostMat = new StandardMaterial("ghostMat", scene);
  ghostMat.alpha = 0.6;
  ghostMat.disableLighting = true;
  ghost.material = ghostMat;
  ghost.isPickable = false;
  ghost.setEnabled(false);

  const update: WorldObjectsRenderer["update"] = (buildings, nodes, groundHeightAt) => {
    for (const b of buildings) {
      let v = buildingVisuals.get(b.eid);
      if (!v) {
        const model = BUILDING_MODEL[b.buildingId] ?? "home_A";
        const variant = TEAM_VARIANT[b.playerId % TEAM_VARIANT.length]!;
        const node = cloneProto(`buildings/building_${model}_${variant}`, `building${b.eid}`);
        // normalize to footprint size
        const bounds = node.getHierarchyBoundingVectors();
        const w = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 0.001);
        const s = (b.size * 0.95) / w;
        node.scaling.setAll(s);
        v = { node, height: (bounds.max.y - bounds.min.y) * s, scaffold: b.active ? null : makeScaffold(b.size) };
        buildingVisuals.set(b.eid, v);
        for (const m of node.getChildMeshes()) buildingMeshToEid.set(m, b.eid);
      }
      const ground = groundHeightAt(b.x, b.z);
      const t = b.active ? 1 : Math.min(1, b.progress / Math.max(1, b.total));
      // rise from the foundation as construction progresses
      v.node.position.set(b.x, ground - v.height * (1 - t), b.z);
      if (v.scaffold) {
        v.scaffold.position.set(b.x, ground, b.z);
        if (b.active) {
          v.scaffold.dispose();
          v.scaffold = null;
        }
      }
    }
    for (const n of nodes) {
      let v = nodeVisuals.get(n.eid);
      if (!v && !n.depleted) {
        v = cloneProto(NODE_MODEL[n.resType]!, `node${n.eid}`);
        const bounds = v.getHierarchyBoundingVectors();
        const h = Math.max(bounds.max.y - bounds.min.y, 0.001);
        const target = n.resType === 2 ? 0.9 : 2.2;
        v.scaling.setAll(target / h);
        v.position.set(n.x, groundHeightAt(n.x, n.z), n.z);
        // deterministic-ish variety from eid (render-side, floats fine)
        v.rotation.y = (n.eid * 2.39996) % (Math.PI * 2);
        for (const m of v.getChildMeshes()) nodeMeshToEid.set(m, n.eid);
        nodeVisuals.set(n.eid, v);
      }
      if (v && n.depleted) {
        v.setEnabled(false);
      }
    }
  };

  return {
    update,
    isNodeMesh: (mesh) => nodeMeshToEid.get(mesh) ?? null,
    isBuildingMesh: (mesh) => buildingMeshToEid.get(mesh) ?? null,
    showGhost(size, x, z, ok, groundY) {
      ghost.setEnabled(true);
      ghost.scaling.set(size, 1, size);
      ghost.position.set(x, groundY + 0.3, z);
      ghostMat.emissiveColor = ok ? new Color3(0.3, 1.6, 0.5) : new Color3(1.8, 0.3, 0.25);
    },
    hideGhost() {
      ghost.setEnabled(false);
    },
  };
}
