/**
 * Buildings + resource nodes: KayKit Medieval Hexagon models (CC0), cloned
 * per building (few of them), team color via yellow/blue pack variants.
 * Construction visual: the building rises from its foundation with progress.
 * Resource nodes are instanced trees/rocks; depleted nodes disappear.
 */
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
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

interface PuffFx {
  root: TransformNode;
  base: Vector3;
  puffs: Array<{ mesh: Mesh; phase: number; speed: number; fire: boolean }>;
}

interface BuildingVisual {
  node: TransformNode;
  height: number;
  scaffold: TransformNode | null;
  smoke: PuffFx | null;
  fire: PuffFx | null;
}

export interface WorldObjectsRenderer {
  update: (
    buildings: ReadonlyArray<{ eid: number; buildingId: string; playerId: number; x: number; z: number; size: number; progress: number; total: number; active: boolean; hpFrac: number }>,
    nodes: ReadonlyArray<{ eid: number; resType: number; x: number; z: number; depleted: boolean }>,
    groundHeightAt: (x: number, z: number) => number,
  ) => void;
  isNodeMesh: (mesh: AbstractMesh) => number | null;
  isBuildingMesh: (mesh: AbstractMesh) => number | null;
  scatter: (groundHeightAt: (x: number, z: number) => number, isOpen: (x: number, z: number) => boolean, mapSize: number, seed: number) => void;
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
  for (const extra of ["nature/rock_single_B", "nature/rock_single_C", "nature/rock_single_D", "nature/tree_single_A_cut"]) await loadProto(extra);

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

  // soft-dot texture shared by smoke + fire
  const dsize = 16;
  const ddata = new Uint8Array(dsize * dsize * 4);
  for (let y = 0; y < dsize; y++) {
    for (let x = 0; x < dsize; x++) {
      const dx = x - dsize / 2 + 0.5;
      const dy = y - dsize / 2 + 0.5;
      const a = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (dsize / 2));
      const i = (y * dsize + x) * 4;
      ddata[i] = ddata[i + 1] = ddata[i + 2] = 255;
      ddata[i + 3] = Math.round(a * a * 255);
    }
  }
  const dotTex = new RawTexture(ddata, dsize, dsize, Engine.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);

  // billboarded puff planes — ParticleSystem renders nothing on some GL
  // stacks (skill §10), mesh sprites work everywhere
  const puffMatSmoke = new StandardMaterial("puffSmoke", scene);
  puffMatSmoke.emissiveColor = new Color3(0.16, 0.155, 0.15);
  puffMatSmoke.diffuseColor = new Color3(0, 0, 0);
  puffMatSmoke.disableLighting = true;
  puffMatSmoke.alpha = 0.55;
  const puffMatFire = new StandardMaterial("puffFire", scene);
  puffMatFire.emissiveColor = new Color3(1.3, 0.55, 0.12);
  puffMatFire.disableLighting = true;
  puffMatFire.alpha = 0.8;
  puffMatFire.alphaMode = Engine.ALPHA_ADD;

  const makePuffs = (pos: Vector3, size: number, fire: boolean): PuffFx => {
    // emissive spheres — the same mesh-FX pattern powerFx uses, which renders
    // reliably on every GL stack we've met (no textures, no billboards)
    const root = new TransformNode(fire ? "fireFx" : "smokeFx", scene);
    const puffs: PuffFx["puffs"] = [];
    const count = fire ? 3 : 4;
    for (let i = 0; i < count; i++) {
      const mesh = MeshBuilder.CreateSphere(`puff${i}`, { diameter: fire ? size * 0.28 : size * 0.4, segments: 8 }, scene);
      mesh.material = fire ? puffMatFire : puffMatSmoke;
      mesh.isPickable = false;
      puffs.push({ mesh, phase: i / count, speed: 0.5 + (i % 3) * 0.18, fire });
    }
    return { root, base: pos.clone(), puffs };
  };

  const animatePuffs = (fx: PuffFx, t: number, size: number): void => {
    for (const p of fx.puffs) {
      const k = (t * p.speed * 0.001 + p.phase) % 1;
      p.mesh.position.set(
        fx.base.x + Math.sin((p.phase + k) * 12.5) * size * 0.12,
        fx.base.y + k * (p.fire ? size * 0.4 : size * 1.1),
        fx.base.z + Math.cos((p.phase + k) * 9.7) * size * 0.12,
      );
      const fade = p.fire ? 1 - k : Math.sin(k * Math.PI);
      p.mesh.scaling.setAll(0.5 + k * (p.fire ? 0.4 : 0.9));
      p.mesh.visibility = Math.max(0, fade * (p.fire ? 0.75 : 0.45));
    }
  };

  const UNUSED_makeSmoke = (pos: Vector3, size: number): ParticleSystem => {
    const ps = new ParticleSystem("smoke", 80, scene);
    ps.particleTexture = dotTex;
    ps.emitter = pos.clone();
    ps.minEmitBox = new Vector3(-size * 0.25, 0, -size * 0.25);
    ps.maxEmitBox = new Vector3(size * 0.25, 0.4, size * 0.25);
    ps.color1 = new Color4(0.25, 0.24, 0.23, 0.5);
    ps.color2 = new Color4(0.4, 0.38, 0.36, 0.35);
    ps.colorDead = new Color4(0.45, 0.45, 0.45, 0);
    ps.minSize = 0.5;
    ps.maxSize = 1.4;
    ps.minLifeTime = 1.6;
    ps.maxLifeTime = 3.0;
    ps.emitRate = 14;
    ps.direction1 = new Vector3(-0.15, 1, -0.15);
    ps.direction2 = new Vector3(0.15, 1.6, 0.15);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1.1;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    return ps;
  };
  const UNUSED_makeFire = (pos: Vector3, size: number): ParticleSystem => {
    const ps = new ParticleSystem("fire", 120, scene);
    ps.particleTexture = dotTex;
    ps.emitter = pos.clone();
    ps.minEmitBox = new Vector3(-size * 0.3, 0, -size * 0.3);
    ps.maxEmitBox = new Vector3(size * 0.3, 0.3, size * 0.3);
    ps.color1 = new Color4(1.6, 0.8, 0.2, 1);
    ps.color2 = new Color4(1.3, 0.35, 0.1, 1);
    ps.colorDead = new Color4(0.5, 0.15, 0.05, 0);
    ps.minSize = 0.25;
    ps.maxSize = 0.7;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 0.9;
    ps.emitRate = 50;
    ps.direction1 = new Vector3(-0.1, 1, -0.1);
    ps.direction2 = new Vector3(0.1, 2.2, 0.1);
    ps.minEmitPower = 0.8;
    ps.maxEmitPower = 1.8;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    return ps;
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

  /** cosmetic scatter: small rocks + stumps on open land, seeded deterministically */
  const scatter = (groundHeightAt: (x: number, z: number) => number, isOpen: (x: number, z: number) => boolean, mapSize: number, seed: number) => {
    const protosAvail = ["nature/rock_single_B", "nature/rock_single_C", "nature/rock_single_D", "nature/tree_single_A_cut"];
    let s = seed >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 140; i++) {
      const x = 4 + rnd() * (mapSize - 8);
      const z = 4 + rnd() * (mapSize - 8);
      const which = protosAvail[Math.trunc(rnd() * protosAvail.length)]!;
      if (!isOpen(x, z)) continue;
      const proto = protoCache.get(which);
      if (!proto) continue;
      const c = cloneProto(which, "scatter" + i);
      const bounds = c.getHierarchyBoundingVectors();
      const h = Math.max(bounds.max.y - bounds.min.y, 0.001);
      c.scaling.setAll((0.25 + rnd() * 0.35) / Math.max(0.3, h / 2));
      c.position.set(x, groundHeightAt(x, z), z);
      c.rotation.y = rnd() * Math.PI * 2;
      for (const m of c.getChildMeshes()) m.isPickable = false;
    }
  };

  // farms are fields, not houses: tilled soil + crop rows (no pack model fits)
  let soilMat: StandardMaterial | null = null;
  let cropMat: StandardMaterial | null = null;
  const makeFarmField = (name: string, size: number): TransformNode => {
    if (!soilMat) {
      soilMat = new StandardMaterial("farmSoil", scene);
      soilMat.diffuseColor = new Color3(0.32, 0.21, 0.12);
      soilMat.specularColor = new Color3(0.02, 0.02, 0.02);
      cropMat = new StandardMaterial("farmCrop", scene);
      cropMat.diffuseColor = new Color3(0.78, 0.66, 0.22);
      cropMat.emissiveColor = new Color3(0.12, 0.1, 0.02);
      cropMat.specularColor = new Color3(0.02, 0.02, 0.02);
    }
    const root = new TransformNode(name, scene);
    const soil = MeshBuilder.CreateBox(`${name}_soil`, { width: size * 0.96, depth: size * 0.96, height: 0.14 }, scene);
    soil.material = soilMat;
    soil.parent = root;
    soil.position.y = 0.07;
    for (let r = 0; r < 4; r++) {
      const row = MeshBuilder.CreateBox(`${name}_row${r}`, { width: size * 0.84, depth: size * 0.12, height: 0.16 }, scene);
      row.material = cropMat;
      row.parent = root;
      row.position.set(0, 0.2, (r - 1.5) * size * 0.22);
    }
    return root;
  };

  const update: WorldObjectsRenderer["update"] = (buildings, nodes, groundHeightAt) => {
    for (const b of buildings) {
      let v = buildingVisuals.get(b.eid);
      if (!v) {
        let node: TransformNode;
        let height: number;
        if (b.buildingId === "farm") {
          node = makeFarmField(`building${b.eid}`, b.size);
          height = 0.3;
        } else {
          const model = BUILDING_MODEL[b.buildingId] ?? "home_A";
          const variant = TEAM_VARIANT[b.playerId % TEAM_VARIANT.length]!;
          node = cloneProto(`buildings/building_${model}_${variant}`, `building${b.eid}`);
          // normalize to footprint size
          const bounds = node.getHierarchyBoundingVectors();
          const w = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 0.001);
          const s = (b.size * 0.95) / w;
          node.scaling.setAll(s);
          height = (bounds.max.y - bounds.min.y) * s;
        }
        v = { node, height, scaffold: b.active ? null : makeScaffold(b.size), smoke: null, fire: null };
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
      // damage states (KICKOFF §4): smoke under 50% HP, fire under 25%
      if (b.active) {
        const wantSmoke = b.hpFrac < 0.5;
        const wantFire = b.hpFrac < 0.25;
        if (wantSmoke && !v.smoke) v.smoke = makePuffs(new Vector3(b.x, ground + v.height * 0.55, b.z), b.size, false);
        if (!wantSmoke && v.smoke) {
          v.smoke.puffs.forEach((p) => p.mesh.dispose());
          v.smoke.root.dispose();
          v.smoke = null;
        }
        if (wantFire && !v.fire) v.fire = makePuffs(new Vector3(b.x, ground + v.height * 0.25, b.z), b.size, true);
        if (!wantFire && v.fire) {
          v.fire.puffs.forEach((p) => p.mesh.dispose());
          v.fire.root.dispose();
          v.fire = null;
        }
        const tNow = performance.now();
        if (v.smoke) animatePuffs(v.smoke, tNow, b.size);
        if (v.fire) animatePuffs(v.fire, tNow + 333, b.size);
      }
    }
    if (buildingVisuals.size > buildings.length) {
      const alive = new Set(buildings.map((x) => x.eid));
      for (const [eid, v] of buildingVisuals) {
        if (!alive.has(eid)) {
          v.smoke?.puffs.forEach((p) => p.mesh.dispose());
          v.fire?.puffs.forEach((p) => p.mesh.dispose());
          v.smoke?.root.dispose();
          v.fire?.root.dispose();
          v.scaffold?.dispose();
          v.node.dispose();
          buildingVisuals.delete(eid);
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
    scatter,
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
