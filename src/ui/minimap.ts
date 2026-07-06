/**
 * Minimap: canvas in a bronze frame. Terrain painted once from sim heights;
 * fog, buildings, and units refresh a few times a second. Clicking jumps the
 * camera.
 */
import type { Sim } from "../sim";
import { FP_ONE } from "../sim";
import { VIS_EXPLORED, VIS_VISIBLE } from "../sim/visibility";
import { query } from "bitecs";

const SIZE = 176;
const TEAM = ["#e8c558", "#4d9fd6", "#c04890"];

export interface Minimap {
  refresh: (sim: Sim, playerId: number) => void;
  /** flash an attack warning ring at a world position */
  ping: (x: number, z: number) => void;
}

export function createMinimap(root: HTMLElement, sim: Sim, onJump: (x: number, z: number) => void): Minimap {
  const wrap = document.createElement("div");
  wrap.className = "minimap-frame";
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  wrap.appendChild(canvas);
  root.appendChild(wrap);
  const ctx = canvas.getContext("2d")!;
  const mapSize = sim.navGrid.size;
  const k = SIZE / mapSize;
  const pings: Array<{ x: number; z: number; at: number }> = [];

  // terrain base layer (once)
  const base = document.createElement("canvas");
  base.width = SIZE;
  base.height = SIZE;
  const bctx = base.getContext("2d")!;
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      const h = sim.terrain.heights[y * (mapSize + 1) + x]!;
      bctx.fillStyle = h <= sim.terrain.waterLevelFp ? "#1d4965" : h > 1300 ? "#7a8757" : "#5d7a3d";
      bctx.fillRect(x * k, y * k, k + 0.5, k + 0.5);
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect();
    onJump(((e.clientX - r.left) / r.width) * mapSize, ((e.clientY - r.top) / r.height) * mapSize);
  });

  return {
    refresh(simNow, playerId) {
      ctx.drawImage(base, 0, 0);
      const grid = simNow.visibility[playerId];
      const { Position, Owner, Building, UnitRef, ResourceNode } = simNow.stores;
      // resource nodes (explored only)
      ctx.fillStyle = "#caa64a";
      for (const eid of query(simNow.world, [ResourceNode])) {
        if (ResourceNode.amountMilli[eid]! <= 0) continue;
        const tx = Position.x[eid]! / FP_ONE;
        const tz = Position.y[eid]! / FP_ONE;
        if (grid && grid[Math.trunc(tz) * mapSize + Math.trunc(tx)] === 0) continue;
        ctx.fillRect(tx * k - 1, tz * k - 1, 2, 2);
      }
      // buildings
      for (const eid of query(simNow.world, [Building])) {
        const tx = Position.x[eid]! / FP_ONE;
        const tz = Position.y[eid]! / FP_ONE;
        const vis = grid ? grid[Math.trunc(tz) * mapSize + Math.trunc(tx)]! : VIS_VISIBLE;
        if (Owner.playerId[eid] !== playerId && vis < VIS_EXPLORED) continue;
        ctx.fillStyle = TEAM[Owner.playerId[eid]! % TEAM.length]!;
        ctx.fillRect(tx * k - 2, tz * k - 2, 4, 4);
      }
      // units (enemies only when visible)
      for (const eid of query(simNow.world, [UnitRef])) {
        const tx = Position.x[eid]! / FP_ONE;
        const tz = Position.y[eid]! / FP_ONE;
        const vis = grid ? grid[Math.trunc(tz) * mapSize + Math.trunc(tx)]! : VIS_VISIBLE;
        if (Owner.playerId[eid] !== playerId && vis !== VIS_VISIBLE) continue;
        ctx.fillStyle = TEAM[Owner.playerId[eid]! % TEAM.length]!;
        ctx.fillRect(tx * k - 1, tz * k - 1, 2.4, 2.4);
      }
      // fog dim pass
      if (grid) {
        ctx.fillStyle = "rgba(8, 10, 16, 0.55)";
        for (let y = 0; y < mapSize; y += 2) {
          for (let x = 0; x < mapSize; x += 2) {
            if (grid[y * mapSize + x] === 0) ctx.fillRect(x * k, y * k, k * 2, k * 2);
          }
        }
      }
      // attack pings: expanding red rings that fade over 3s
      const now = performance.now();
      for (let i = pings.length - 1; i >= 0; i--) {
        const age = (now - pings[i]!.at) / 3000;
        if (age >= 1) { pings.splice(i, 1); continue; }
        ctx.strokeStyle = `rgba(224, 70, 50, ${1 - age})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(pings[i]!.x * k, pings[i]!.z * k, 3 + age * 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
    ping(x, z) {
      // one live ping per neighborhood — don't strobe under sustained fire
      if (pings.some((p) => Math.hypot(p.x - x, p.z - z) < 12)) return;
      pings.push({ x, z, at: performance.now() });
    },
  };
}
