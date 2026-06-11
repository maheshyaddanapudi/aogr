/**
 * RTS selection + orders: left-click single select, left-drag marquee
 * (screen-space box over own units), right-click move order. Commands enter
 * the sim exclusively through the CommandQueue (KICKOFF §3.5).
 */
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { CommandQueue } from "../sim";
import { FP_ONE } from "../sim";

export interface SelectionDeps {
  scene: Scene;
  canvas: HTMLCanvasElement;
  camera: Camera;
  queue: CommandQueue;
  localPlayerId: number;
  currentTick: () => number;
  /** live view of own units: eid -> world position */
  unitPositions: () => ReadonlyArray<{ eid: number; x: number; z: number; playerId: number }>;
  isUnitMesh: (mesh: AbstractMesh) => number | null;
  /** resource-node hit test: right-clicking a node issues a gather order */
  isNodeMesh?: (mesh: AbstractMesh) => number | null;
  groundHeightAt: (x: number, z: number) => number;
  /** notify platform a move target was chosen (flow-field prewarm) */
  onMoveOrder?: (tileX: number, tileY: number) => void;
}

export interface Selection {
  readonly selected: ReadonlySet<number>;
}

const DRAG_THRESHOLD_PX = 6;

export function setupSelection(deps: SelectionDeps): Selection {
  const { scene, canvas, queue } = deps;
  const selected = new Set<number>();

  const marquee = document.createElement("div");
  marquee.className = "marquee";
  marquee.style.display = "none";
  document.body.appendChild(marquee);

  let dragStart: { x: number; y: number } | null = null;
  let dragging = false;

  const screenPos = (wx: number, wy: number, wz: number) => {
    const engine = scene.getEngine();
    const p = Vector3.Project(
      new Vector3(wx, wy, wz),
      Matrix.IdentityReadOnly,
      scene.getTransformMatrix(),
      deps.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    return { x: p.x, y: p.y };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 0) {
      dragStart = { x: e.clientX, y: e.clientY };
      dragging = false;
    } else if (e.button === 2 && selected.size > 0) {
      // resource node? → gather order
      const nodePick = scene.pick(e.clientX, e.clientY);
      const nodeEid = nodePick?.pickedMesh && deps.isNodeMesh ? deps.isNodeMesh(nodePick.pickedMesh) : null;
      if (nodeEid !== null) {
        queue.enqueue(deps.currentTick() + 1, {
          type: "gather",
          playerId: deps.localPlayerId,
          eids: Array.from(selected),
          nodeEid,
        });
        return;
      }
      const pick = scene.pick(e.clientX, e.clientY, (m) => m.name === "terrain");
      if (pick?.pickedPoint) {
        const x = Math.round(pick.pickedPoint.x * FP_ONE);
        const y = Math.round(pick.pickedPoint.z * FP_ONE);
        deps.onMoveOrder?.(Math.trunc(pick.pickedPoint.x), Math.trunc(pick.pickedPoint.z));
        queue.enqueue(deps.currentTick() + 1, {
          type: "move",
          playerId: deps.localPlayerId,
          eids: Array.from(selected),
          x,
          y,
        });
      }
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragStart) return;
    if (!dragging && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > DRAG_THRESHOLD_PX) {
      dragging = true;
      marquee.style.display = "block";
    }
    if (dragging) {
      const x0 = Math.min(dragStart.x, e.clientX);
      const y0 = Math.min(dragStart.y, e.clientY);
      marquee.style.left = `${x0}px`;
      marquee.style.top = `${y0}px`;
      marquee.style.width = `${Math.abs(e.clientX - dragStart.x)}px`;
      marquee.style.height = `${Math.abs(e.clientY - dragStart.y)}px`;
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (e.button !== 0 || !dragStart) return;
    if (dragging) {
      const x0 = Math.min(dragStart.x, e.clientX);
      const x1 = Math.max(dragStart.x, e.clientX);
      const y0 = Math.min(dragStart.y, e.clientY);
      const y1 = Math.max(dragStart.y, e.clientY);
      if (new URLSearchParams(location.search).has("seldebug")) {
        console.log(`[seldebug] rect ${x0},${y0} → ${x1},${y1}; units=${deps.unitPositions().length}`);
      }
      if (!e.shiftKey) selected.clear();
      for (const u of deps.unitPositions()) {
        if (u.playerId !== deps.localPlayerId) continue;
        const sp = screenPos(u.x, deps.groundHeightAt(u.x, u.z) + 0.5, u.z);
        if (sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1) selected.add(u.eid);
      }
      marquee.style.display = "none";
    } else {
      const pick = scene.pick(e.clientX, e.clientY);
      const eid = pick?.pickedMesh ? deps.isUnitMesh(pick.pickedMesh) : null;
      if (!e.shiftKey) selected.clear();
      if (eid !== null) selected.add(eid);
    }
    dragStart = null;
    dragging = false;
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  return { selected };
}
