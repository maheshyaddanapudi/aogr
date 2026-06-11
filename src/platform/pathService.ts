/**
 * Main-thread side of the pathfinding worker: pre-warms the sim's flow-field
 * cache when the player issues a move order. If the worker hasn't answered by
 * the time the sim needs the field, the sim computes it synchronously —
 * bit-identical results either way.
 */
import type { Sim } from "../sim";
import type { FlowFieldRequest, FlowFieldResponse } from "./flowFieldWorker";

export interface PathService {
  prewarm: (tileX: number, tileY: number) => void;
  dispose: () => void;
}

export function createPathService(sim: Sim): PathService {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./flowFieldWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<FlowFieldResponse>) => {
      const { requestKey, targetX, targetY, size, dist, dirs } = e.data;
      if (!sim.flowFields.has(requestKey)) {
        sim.flowFields.set(requestKey, { size, targetX, targetY, dist, dirs });
      }
    };
  } catch {
    worker = null; // no Worker support (tests/SSR) — sim computes synchronously
  }

  return {
    prewarm(tileX: number, tileY: number): void {
      if (!worker) return;
      const key = tileY * sim.navGrid.size + tileX;
      if (sim.flowFields.has(key)) return;
      const req: FlowFieldRequest = {
        requestKey: key,
        size: sim.navGrid.size,
        passable: new Uint8Array(sim.navGrid.passable), // copy — grid stays sim-owned
        targetX: tileX,
        targetY: tileY,
      };
      worker.postMessage(req, [req.passable.buffer]);
    },
    dispose(): void {
      worker?.terminate();
    },
  };
}
