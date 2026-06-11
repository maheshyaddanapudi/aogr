/**
 * Fog-of-war overlay: a transparent plane above the terrain textured from the
 * player's visibility grid. Bilinear upsampling of the 200×200 grid gives the
 * soft edges the gate asks for.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { Sim } from "../sim";
import { VIS_EXPLORED, VIS_VISIBLE } from "../sim/visibility";

export interface FogRenderer {
  refresh: (sim: Sim, playerId: number) => void;
  isTileVisible: (sim: Sim, playerId: number, x: number, z: number) => boolean;
}

export function createFogRenderer(scene: Scene, mapSize: number): FogRenderer {
  const data = new Uint8Array(mapSize * mapSize * 4);
  data.fill(0);
  for (let i = 0; i < mapSize * mapSize; i++) data[i * 4 + 3] = 235;
  const tex = new RawTexture(data, mapSize, mapSize, Engine.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.hasAlpha = true;

  const plane = MeshBuilder.CreateGround("fog", { width: mapSize, height: mapSize, subdivisions: 1 }, scene);
  plane.position.set(mapSize / 2, 4.2, mapSize / 2);
  plane.isPickable = false;
  const mat = new StandardMaterial("fogMat", scene);
  mat.diffuseTexture = tex;
  mat.opacityTexture = tex;
  mat.emissiveColor = new Color3(0.02, 0.025, 0.04);
  mat.disableLighting = true;
  plane.material = mat;

  return {
    refresh(sim, playerId) {
      const grid = sim.visibility[playerId];
      if (!grid) return;
      for (let i = 0; i < grid.length; i++) {
        data[i * 4 + 3] = grid[i] === VIS_VISIBLE ? 0 : grid[i] === VIS_EXPLORED ? 120 : 235;
      }
      tex.update(data);
    },
    isTileVisible(sim, playerId, x, z) {
      const grid = sim.visibility[playerId];
      if (!grid) return true;
      const tx = Math.max(0, Math.min(mapSize - 1, Math.trunc(x)));
      const tz = Math.max(0, Math.min(mapSize - 1, Math.trunc(z)));
      return grid[tz * mapSize + tx] === VIS_VISIBLE;
    },
  };
}
