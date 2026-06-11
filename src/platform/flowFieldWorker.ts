/**
 * Pathfinding worker: computes flow fields off the main thread. The sim can
 * always compute the identical field synchronously (same pure function, same
 * inputs) — this worker only pre-warms the cache, so determinism never
 * depends on worker timing (KICKOFF §3 / docs/02 worker contract).
 */
import { computeFlowField } from "../sim/path/flowfield";
import type { NavGrid } from "../sim/path/grid";

export interface FlowFieldRequest {
  requestKey: number;
  size: number;
  passable: Uint8Array;
  targetX: number;
  targetY: number;
}

export interface FlowFieldResponse {
  requestKey: number;
  targetX: number;
  targetY: number;
  size: number;
  dist: Int32Array;
  dirs: Uint8Array;
}

self.onmessage = (e: MessageEvent<FlowFieldRequest>) => {
  const { requestKey, size, passable, targetX, targetY } = e.data;
  const grid: NavGrid = { size, passable, checksum: 0 };
  const field = computeFlowField(grid, targetX, targetY);
  const response: FlowFieldResponse = {
    requestKey,
    targetX,
    targetY,
    size,
    dist: field.dist,
    dirs: field.dirs,
  };
  (self as unknown as Worker).postMessage(response, [field.dist.buffer, field.dirs.buffer]);
};
