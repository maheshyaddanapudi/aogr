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
  isBuildingMesh?: (mesh: AbstractMesh) => number | null;
  groundHeightAt: (x: number, z: number) => number;
  /** placement support */
  canPlace?: (buildingId: string, tileX: number, tileY: number) => boolean;
  onGhost?: (size: number, x: number, z: number, ok: boolean) => void;
  onGhostEnd?: () => void;
  /** notify platform a move target was chosen (flow-field prewarm) */
  onMoveOrder?: (tileX: number, tileY: number) => void;
}

export interface Selection {
  readonly selected: ReadonlySet<number>;
  readonly selectedBuilding: () => number | null;
  /** enter placement mode for a building id; clicks place it, Esc cancels */
  enterPlacement: (buildingId: string, size: number) => void;
}

const DRAG_THRESHOLD_PX = 6;

export function setupSelection(deps: SelectionDeps): Selection {
  const { scene, canvas, queue } = deps;
  const selected = new Set<number>();
  let selectedBuilding: number | null = null;
  const groups = new Map<number, number[]>();
  let placement: { buildingId: string; size: number } | null = null;

  // touch taps: only treat as select when the finger barely moved AND the tap
  // began on the canvas — taps on HUD buttons must never clear the selection
  // (a build order with the crew cleared mid-tap places a site nobody builds)
  let touchDownAt: { x: number; y: number; t: number } | null = null;
  let placementConsumedTap = false;
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    touchDownAt = e.target === canvas ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  });
  const touchTapOk = (e: PointerEvent): boolean =>
    !!touchDownAt && Math.hypot(e.clientX - touchDownAt.x, e.clientY - touchDownAt.y) < 12 && performance.now() - touchDownAt.t < 450;

  const marquee = document.createElement("div");
  marquee.className = "marquee";
  marquee.style.display = "none";
  document.body.appendChild(marquee);

  let dragStart: { x: number; y: number } | null = null;
  let dragging = false;

  // Project returns render-BUFFER pixels; events arrive in CSS pixels. On
  // high-DPI screens (adaptToDeviceRatio) the two differ by the hardware
  // scaling level — convert so marquee/tap math always compares CSS to CSS.
  const screenPos = (wx: number, wy: number, wz: number) => {
    const engine = scene.getEngine();
    const p = Vector3.Project(
      new Vector3(wx, wy, wz),
      Matrix.IdentityReadOnly,
      scene.getTransformMatrix(),
      deps.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    const lvl = engine.getHardwareScalingLevel();
    return { x: p.x * lvl, y: p.y * lvl };
  };

  // Unit models are slim — an exact-pixel ray often slips between limbs.
  // Classic RTS forgiveness: fall back to the nearest own unit within a
  // small screen radius around the click/tap.
  const pickUnitNear = (cx: number, cy: number, radiusPx: number): number | null => {
    const pick = scene.pick(cx, cy);
    const direct = pick?.pickedMesh ? deps.isUnitMesh(pick.pickedMesh) : null;
    if (direct !== null) return direct;
    let best: number | null = null;
    let bestD = radiusPx;
    for (const u of deps.unitPositions()) {
      if (u.playerId !== deps.localPlayerId) continue;
      const sp = screenPos(u.x, deps.groundHeightAt(u.x, u.z) + 0.8, u.z);
      const d = Math.hypot(sp.x - cx, sp.y - cy);
      if (d < bestD) {
        bestD = d;
        best = u.eid;
      }
    }
    return best;
  };

  // Snap a picked ground point to a placeable footprint corner. round (not
  // trunc) so sub-tile pick noise can't shift the footprint a whole tile;
  // when the exact tile ring is blocked, nudge to the nearest neighbor —
  // taps have no hover-ghost warning, silent rejection feels broken.
  const snapPlacement = (px: number, pz: number, p: { buildingId: string; size: number }): { tx: number; ty: number } | null => {
    const bx = Math.round(px - p.size / 2);
    const by = Math.round(pz - p.size / 2);
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      if (!deps.canPlace || deps.canPlace(p.buildingId, bx + ox, by + oy)) return { tx: bx + ox, ty: by + oy };
    }
    return null;
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (placement && e.button === 0) {
      placementConsumedTap = e.pointerType === "touch";
      const pick = scene.pick(e.clientX, e.clientY, (m) => m.name === "terrain");
      if (pick?.pickedPoint) {
        const snapped = snapPlacement(pick.pickedPoint.x, pick.pickedPoint.z, placement);
        if (snapped) {
          queue.enqueue(deps.currentTick() + 1, {
            type: "build",
            playerId: deps.localPlayerId,
            eids: Array.from(selected),
            building: placement.buildingId,
            x: snapped.tx * FP_ONE,
            y: snapped.ty * FP_ONE,
          });
          placement = null;
          deps.onGhostEnd?.();
        }
      }
      return;
    }
    if (e.button === 0) {
      if (e.pointerType === "touch") return; // touch drags pan the camera; taps select via pointerup
      dragStart = { x: e.clientX, y: e.clientY };
      dragging = false;
    } else if (e.button === 2 && selectedBuilding !== null) {
      const pick = scene.pick(e.clientX, e.clientY, (m) => m.name === "terrain");
      if (pick?.pickedPoint) {
        queue.enqueue(deps.currentTick() + 1, {
          type: "rally",
          playerId: deps.localPlayerId,
          buildingEid: selectedBuilding,
          x: Math.round(pick.pickedPoint.x * FP_ONE),
          y: Math.round(pick.pickedPoint.z * FP_ONE),
        });
      }
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
    // touch tap = click-select (no marquee path)
    if (e.pointerType === "touch" && placementConsumedTap) {
      placementConsumedTap = false; // the tap placed a building; keep the crew selected
      return;
    }
    if (e.pointerType === "touch" && e.button === 0 && touchTapOk(e)) {
      const eid = pickUnitNear(e.clientX, e.clientY, 24);
      const pick = eid === null ? scene.pick(e.clientX, e.clientY) : null;
      const beid = eid === null && pick?.pickedMesh && deps.isBuildingMesh ? deps.isBuildingMesh(pick.pickedMesh) : null;
      selected.clear();
      selectedBuilding = null;
      if (eid !== null) selected.add(eid);
      else if (beid !== null) selectedBuilding = beid;
      return;
    }
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
      const eid = pickUnitNear(e.clientX, e.clientY, 14);
      const pick = eid === null ? scene.pick(e.clientX, e.clientY) : null;
      const beid = eid === null && pick?.pickedMesh && deps.isBuildingMesh ? deps.isBuildingMesh(pick.pickedMesh) : null;
      if (!e.shiftKey) selected.clear();
      selectedBuilding = null;
      if (eid !== null) selected.add(eid);
      else if (beid !== null) selectedBuilding = beid;
    }
    dragStart = null;
    dragging = false;
  });

  // placement ghost follows the cursor (same snap+nudge as the click)
  canvas.addEventListener("pointermove", (e) => {
    if (!placement) return;
    const pick = scene.pick(e.clientX, e.clientY, (m) => m.name === "terrain");
    if (pick?.pickedPoint) {
      const snapped = snapPlacement(pick.pickedPoint.x, pick.pickedPoint.z, placement);
      const tx = snapped?.tx ?? Math.round(pick.pickedPoint.x - placement.size / 2);
      const ty = snapped?.ty ?? Math.round(pick.pickedPoint.z - placement.size / 2);
      deps.onGhost?.(placement.size, tx + placement.size / 2, ty + placement.size / 2, snapped !== null);
    }
  });

  // control groups: Ctrl+1..9 assign, 1..9 recall; Esc cancels placement
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && placement) {
      placement = null;
      deps.onGhostEnd?.();
      return;
    }
    const digit = e.code.startsWith("Digit") ? Number(e.code.slice(5)) : NaN;
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
    if (e.ctrlKey || e.metaKey) {
      groups.set(digit, Array.from(selected));
      e.preventDefault();
    } else {
      const g = groups.get(digit);
      if (g && g.length > 0) {
        selected.clear();
        for (const eid of g) selected.add(eid);
      }
    }
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  return {
    selected,
    selectedBuilding: () => selectedBuilding,
    enterPlacement(buildingId, size) {
      placement = { buildingId, size };
    },
  };
}
