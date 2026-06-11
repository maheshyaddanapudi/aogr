/**
 * Builds the render mesh + splat material for a sim Terrain, plus the water
 * plane. Splat weights (sand low / grass mid / rock high+steep) are computed
 * into a RawTexture mix map — render side, floats welcome.
 */
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { TerrainMaterial } from "@babylonjs/materials/terrain/terrainMaterial";
import { WaterMaterial } from "@babylonjs/materials/water/waterMaterial";
import type { Terrain } from "../sim";
import { FP_ONE } from "../sim";

const tex = (scene: Scene, file: string): Texture => new Texture(`${import.meta.env.BASE_URL}textures/${file}`, scene);

/** Bilinear height sample at fractional tile coords (render-side helper). */
export function sampleHeight(terrain: Terrain, x: number, z: number): number {
  const s = terrain.size;
  const cx = Math.min(Math.max(x, 0), s - 0.001);
  const cz = Math.min(Math.max(z, 0), s - 0.001);
  const x0 = Math.floor(cx);
  const z0 = Math.floor(cz);
  const fx = cx - x0;
  const fz = cz - z0;
  const verts = s + 1;
  const h = (vx: number, vz: number) => terrain.heights[vz * verts + vx]! / FP_ONE;
  const top = h(x0, z0) * (1 - fx) + h(x0 + 1, z0) * fx;
  const bot = h(x0, z0 + 1) * (1 - fx) + h(x0 + 1, z0 + 1) * fx;
  return top * (1 - fz) + bot * fz;
}

export interface TerrainView {
  ground: Mesh;
  water: Mesh;
  waterMaterial: WaterMaterial;
}

export function buildTerrainMesh(scene: Scene, terrain: Terrain): TerrainView {
  const s = terrain.size;
  const verts = s + 1;
  const waterY = terrain.waterLevelFp / FP_ONE;

  const positions = new Float32Array(verts * verts * 3);
  const uvs = new Float32Array(verts * verts * 2);
  const indices = new Uint32Array(s * s * 6);
  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      const i = z * verts + x;
      positions[i * 3] = x;
      positions[i * 3 + 1] = terrain.heights[i]! / FP_ONE;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = x / s;
      uvs[i * 2 + 1] = z / s;
    }
  }
  let k = 0;
  for (let z = 0; z < s; z++) {
    for (let x = 0; x < s; x++) {
      const i = z * verts + x;
      indices[k++] = i;
      indices[k++] = i + 1;
      indices[k++] = i + verts;
      indices[k++] = i + 1;
      indices[k++] = i + verts + 1;
      indices[k++] = i + verts;
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const ground = new Mesh("terrain", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.applyToMesh(ground);
  ground.receiveShadows = true;

  // Splat mix map: R=sand (shoreline), G=grass (midlands), B=rock (peaks/steep).
  // RGBA — plain RGB raw textures are unreliable on WebGL2/SwiftShader.
  const mix = new Uint8Array(verts * verts * 4);
  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      const i = z * verts + x;
      const h = terrain.heights[i]! / FP_ONE;
      const hx = terrain.heights[z * verts + Math.min(x + 1, s)]! / FP_ONE;
      const hz = terrain.heights[Math.min(z + 1, s) * verts + x]! / FP_ONE;
      const slope = Math.max(Math.abs(hx - h), Math.abs(hz - h));
      let sand = Math.max(0, 1 - Math.max(0, (h - waterY) / 0.45));
      let rock = Math.min(1, Math.max(0, (h - 1.3) / 0.8) + Math.max(0, (slope - 0.35) / 0.3));
      let grass = Math.max(0, 1 - sand - rock);
      const sum = sand + grass + rock || 1;
      sand /= sum;
      grass /= sum;
      rock /= sum;
      mix[i * 4] = Math.round(sand * 255);
      mix[i * 4 + 1] = Math.round(grass * 255);
      mix[i * 4 + 2] = Math.round(rock * 255);
      mix[i * 4 + 3] = 255;
    }
  }
  const mixTexture = new RawTexture(mix, verts, verts, Engine.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);

  const debugMat = new URLSearchParams(globalThis.location?.search ?? "").get("mat");
  if (debugMat === "std") {
    const std = new StandardMaterial("terrainStd", scene);
    std.diffuseColor = new Color3(0.3, 0.6, 0.25);
    ground.material = std;
  } else if (debugMat === "pbr") {
    const pbr = new PBRMaterial("terrainPbr", scene);
    pbr.albedoColor = new Color3(0.3, 0.6, 0.25);
    pbr.metallic = 0;
    pbr.roughness = 0.9;
    ground.material = pbr;
  }

  const mat = new TerrainMaterial("terrainMat", scene);
  mat.mixTexture = mixTexture;
  mat.diffuseTexture1 = tex(scene, "sand_color.jpg");
  mat.bumpTexture1 = tex(scene, "sand_normal.jpg");
  mat.diffuseTexture2 = tex(scene, "grass_color.jpg");
  mat.bumpTexture2 = tex(scene, "grass_normal.jpg");
  mat.diffuseTexture3 = tex(scene, "rock_color.jpg");
  mat.bumpTexture3 = tex(scene, "rock_normal.jpg");
  const repeats = s / 4;
  for (const t of [mat.diffuseTexture1, mat.diffuseTexture2, mat.diffuseTexture3, mat.bumpTexture1, mat.bumpTexture2, mat.bumpTexture3]) {
    t.uScale = repeats;
    t.vScale = repeats;
  }
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  if (!debugMat) ground.material = mat;

  // Water plane (reflective/refractive animated).
  const water = MeshBuilder.CreateGround("water", { width: s * 1.2, height: s * 1.2, subdivisions: 32 }, scene);
  water.position = new Vector3(s / 2, waterY, s / 2);
  const waterMaterial = new WaterMaterial("waterMat", scene);
  waterMaterial.bumpTexture = tex(scene, "waterbump.png");
  waterMaterial.windForce = -4;
  waterMaterial.waveHeight = 0.04;
  waterMaterial.bumpHeight = 0.25;
  waterMaterial.waveLength = 0.15;
  waterMaterial.waterColor = new Color3(0.12, 0.32, 0.42);
  waterMaterial.colorBlendFactor = 0.35;
  waterMaterial.addToRenderList(ground);
  water.material = waterMaterial;

  return { ground, water, waterMaterial };
}
