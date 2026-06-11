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
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import type { Sim, Terrain } from "../sim";
import { FP_ONE } from "../sim";
import { VIS_EXPLORED, VIS_VISIBLE } from "../sim/visibility";

export interface FogRenderer {
  refresh: (sim: Sim, playerId: number) => void;
  isTileVisible: (sim: Sim, playerId: number, x: number, z: number) => boolean;
}

export function createFogRenderer(scene: Scene, mapSize: number, terrain?: Terrain): FogRenderer {
  const data = new Uint8Array(mapSize * mapSize * 4);
  data.fill(0);
  for (let i = 0; i < mapSize * mapSize; i++) data[i * 4 + 3] = 235;
  const tex = new RawTexture(data, mapSize, mapSize, Engine.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.hasAlpha = true;

  // drape the fog over the terrain itself (no floating-plane artifact on hills)
  const plane = new Mesh("fog", scene);
  {
    const step = 4; // 51×51 grid is plenty for a soft overlay
    const verts = Math.floor(mapSize / step) + 1;
    const positions = new Float32Array(verts * verts * 3);
    const uvs = new Float32Array(verts * verts * 2);
    const indices = new Uint32Array((verts - 1) * (verts - 1) * 6);
    const hAt = (x: number, z: number): number => {
      if (!terrain) return 4.2;
      const s = terrain.size;
      const cx = Math.max(0, Math.min(s, x));
      const cz = Math.max(0, Math.min(s, z));
      return terrain.heights[Math.round(cz) * (s + 1) + Math.round(cx)]! / FP_ONE;
    };
    for (let zi = 0; zi < verts; zi++) {
      for (let xi = 0; xi < verts; xi++) {
        const i = zi * verts + xi;
        const wx = xi * step;
        const wz = zi * step;
        positions[i * 3] = wx;
        positions[i * 3 + 1] = hAt(wx, wz) + 0.9;
        positions[i * 3 + 2] = wz;
        uvs[i * 2] = wx / mapSize;
        uvs[i * 2 + 1] = wz / mapSize;
      }
    }
    let k = 0;
    for (let zi = 0; zi < verts - 1; zi++) {
      for (let xi = 0; xi < verts - 1; xi++) {
        const i = zi * verts + xi;
        indices[k++] = i;
        indices[k++] = i + 1;
        indices[k++] = i + verts;
        indices[k++] = i + 1;
        indices[k++] = i + verts + 1;
        indices[k++] = i + verts;
      }
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.uvs = uvs;
    vd.applyToMesh(plane);
  }
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
