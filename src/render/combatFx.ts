/**
 * Combat FX (render-only, fed by sim.events): arrow projectiles, hit sparks
 * (GPU-friendly particle bursts), and death visuals (KayKit death pose that
 * sinks and fades). The sim already applied damage on the fire tick — these
 * are pure cosmetics, so flight time never affects determinism.
 */
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import "@babylonjs/core/Particles/particleSystemComponent";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import type { SimEvents } from "../sim/combat";
import { FP_ONE } from "../sim";
import { TEAM_COLORS, modelKeyForClass } from "./units";

const PROJECTILE_SPEED = 26; // tiles/sec, cosmetic
const DEATH_FADE_MS = 2200;

interface Projectile {
  mesh: InstancedMesh;
  from: Vector3;
  to: Vector3;
  t: number;
  durationMs: number;
}

interface DeathVisual {
  node: TransformNode;
  ageMs: number;
}

export interface CombatFx {
  /** call once per sim tick with that tick's events */
  collect: (events: SimEvents, groundHeightAt: (x: number, z: number) => number) => void;
  /** advance cosmetics by frame delta */
  update: (dtMs: number) => void;
}

export async function createCombatFx(scene: Scene): Promise<CombatFx> {
  // arrow prototype
  const arrowProto = MeshBuilder.CreateCylinder("arrowProto", { height: 1.3, diameter: 0.24, tessellation: 6 }, scene);
  const arrowMat = new StandardMaterial("arrowMat", scene);
  arrowMat.emissiveColor = new Color3(1.6, 1.3, 0.7); // >1 so the bloom pipeline catches it
  arrowMat.disableLighting = true;
  arrowProto.material = arrowMat;
  arrowProto.rotation.x = Math.PI / 2;
  arrowProto.bakeCurrentTransformIntoVertices();
  arrowProto.isVisible = false;
  arrowProto.isPickable = false;

  // spark particle texture: tiny radial dot (procedural, no asset needed)
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 230;
      data[i + 2] = 160;
      data[i + 3] = Math.round(a * a * 255);
    }
  }
  const sparkTex = new RawTexture(data, size, size, Engine.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);

  const sparks = new ParticleSystem("sparks", 400, scene);
  sparks.particleTexture = sparkTex;
  sparks.emitter = new Vector3(0, -100, 0);
  sparks.minSize = 0.14;
  sparks.maxSize = 0.34;
  sparks.minLifeTime = 0.15;
  sparks.maxLifeTime = 0.35;
  sparks.emitRate = 0;
  sparks.manualEmitCount = 0;
  sparks.minEmitPower = 2;
  sparks.maxEmitPower = 5;
  sparks.direction1 = new Vector3(-1, 1, -1);
  sparks.direction2 = new Vector3(1, 2, 1);
  sparks.gravity = new Vector3(0, -9, 0);
  sparks.color1 = new Color4(1, 0.85, 0.4, 1);
  sparks.color2 = new Color4(1, 0.55, 0.2, 1);
  sparks.colorDead = new Color4(0.6, 0.3, 0.1, 0);
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  sparks.start();

  // death pose pools per (model, team)
  const deathPools = new Map<string, Mesh[]>();
  const loadDeathPool = async (key: string, file: string, team: number): Promise<Mesh[]> => {
    const cacheKey = `${key}_${team}`;
    const cached = deathPools.get(cacheKey);
    if (cached) return cached;
    const result = await SceneLoader.ImportMeshAsync("", `${import.meta.env.BASE_URL}models/`, file, scene);
    const root = result.meshes[0]!;
    const bounds = root.getHierarchyBoundingVectors();
    root.scaling.setAll(1.1 / Math.max(0.001, bounds.max.y - bounds.min.y));
    const pose = result.animationGroups.find((g) => /Death_A$/.test(g.name)) ?? result.animationGroups[0];
    for (const g of result.animationGroups) g.stop();
    if (pose) {
      pose.start(false, 1.0);
      pose.goToFrame(pose.to); // freeze at the end of the death animation
      pose.pause();
    }
    const meshes = result.meshes.filter((m): m is Mesh => m.getTotalVertices() > 0) as Mesh[];
    for (const m of meshes) m.isVisible = false;
    deathPools.set(cacheKey, meshes);
    return meshes;
  };
  // preload both models × teams
  await loadDeathPool("villager", "villager.glb", 0);
  await loadDeathPool("villager", "villager.glb", 1);
  await loadDeathPool("knight", "knight.glb", 0);
  await loadDeathPool("knight", "knight.glb", 1);

  const projectiles: Projectile[] = [];
  const deaths: DeathVisual[] = [];

  const collect: CombatFx["collect"] = (events, groundHeightAt) => {
    for (const f of events.fired) {
      if (!f.ranged) continue;
      const fx = f.fromX / FP_ONE;
      const fz = f.fromY / FP_ONE;
      const tx = f.toX / FP_ONE;
      const tz = f.toY / FP_ONE;
      const from = new Vector3(fx, groundHeightAt(fx, fz) + 1.1, fz);
      const to = new Vector3(tx, groundHeightAt(tx, tz) + 0.8, tz);
      const mesh = arrowProto.clone(`arrow${projectiles.length}`) as unknown as InstancedMesh;
      (mesh as unknown as Mesh).isVisible = true;
      mesh.position.copyFrom(from);
      mesh.lookAt(to);
      const distTiles = Vector3.Distance(from, to);
      projectiles.push({ mesh, from, to, t: 0, durationMs: (distTiles / PROJECTILE_SPEED) * 1000 });
    }
    for (const h of events.hits) {
      const hx = h.x / FP_ONE;
      const hz = h.y / FP_ONE;
      (sparks.emitter as Vector3).set(hx, groundHeightAt(hx, hz) + 0.9, hz);
      sparks.manualEmitCount = sparks.manualEmitCount + 14;
    }
    for (const d of events.deaths) {
      if (!d.unitClass) continue;
      const team = d.playerId % TEAM_COLORS.length;
      const pool = deathPools.get(`${modelKeyForClass(d.unitClass)}_${team}`);
      if (!pool) continue;
      const node = new TransformNode(`death${deaths.length}`, scene);
      const dx = d.x / FP_ONE;
      const dz = d.y / FP_ONE;
      node.position.set(dx, groundHeightAt(dx, dz), dz);
      node.rotation.y = (d.eid * 2.39996) % (Math.PI * 2);
      for (const m of pool) {
        const inst = m.createInstance(`d${deaths.length}_${m.name}`);
        inst.parent = node;
        inst.scaling = m.parent ? (m.parent as TransformNode).scaling.clone() : inst.scaling;
        inst.isVisible = true;
        inst.isPickable = false;
      }
      deaths.push({ node, ageMs: 0 });
    }
  };

  const update: CombatFx["update"] = (dtMs) => {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i]!;
      p.t += dtMs;
      const k = Math.min(1, p.t / p.durationMs);
      Vector3.LerpToRef(p.from, p.to, k, p.mesh.position);
      p.mesh.position.y += Math.sin(k * Math.PI) * 0.8; // arc
      if (k >= 1) {
        p.mesh.dispose();
        projectiles.splice(i, 1);
      }
    }
    for (let i = deaths.length - 1; i >= 0; i--) {
      const d = deaths[i]!;
      d.ageMs += dtMs;
      if (d.ageMs > DEATH_FADE_MS * 0.5) {
        d.node.position.y -= (dtMs / 1000) * 0.45; // sink into the ground
      }
      if (d.ageMs >= DEATH_FADE_MS) {
        d.node.dispose();
        deaths.splice(i, 1);
      }
    }
  };

  return { collect, update };
}
