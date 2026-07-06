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
  buildingOwner?: (eid: number) => number;
  buildingActive?: (eid: number) => boolean;
  /** the harvestable food node sitting on a farm, if the building is one */
  farmFoodNode?: (eid: number) => number | null;
  garrisonCapacity?: (eid: number) => number;
  /** unit id lookup for double-click select-all-of-type */
  unitTypeOf?: (eid: number) => string | null;
  formation?: () => number;
  /** transport capacity of a UNIT (0 for non-ships) — boarding orders */
  unitTransportCapacity?: (eid: number) => number;
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
  /** drop the current selection (mobile has no empty-ground deselect tap) */
  clear: () => void;
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
      // resource node → gather; enemy unit/building → attack; ground → move
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
      const unitHit = nodePick?.pickedMesh ? deps.isUnitMesh(nodePick.pickedMesh) : null;
      const buildingHit = nodePick?.pickedMesh && deps.isBuildingMesh ? deps.isBuildingMesh(nodePick.pickedMesh) : null;
      const enemyUnit = unitHit !== null && deps.unitPositions().find((u) => u.eid === unitHit)?.playerId !== deps.localPlayerId;
      if (unitHit !== null && !enemyUnit && (deps.unitTransportCapacity?.(unitHit) ?? 0) > 0 && !selected.has(unitHit)) {
        queue.enqueue(deps.currentTick() + 1, { type: "garrison", playerId: deps.localPlayerId, eids: Array.from(selected), buildingEid: unitHit });
        return;
      }
      const enemyBuilding = buildingHit !== null && deps.buildingOwner?.(buildingHit) !== deps.localPlayerId;
      if (buildingHit !== null && !enemyBuilding) {
        const farmNode = deps.farmFoodNode?.(buildingHit) ?? null;
        if (farmNode !== null) {
          // own farm → work the field
          queue.enqueue(deps.currentTick() + 1, { type: "gather", playerId: deps.localPlayerId, eids: Array.from(selected), nodeEid: farmNode });
          return;
        }
        if ((deps.garrisonCapacity?.(buildingHit) ?? 0) > 0) {
          queue.enqueue(deps.currentTick() + 1, { type: "garrison", playerId: deps.localPlayerId, eids: Array.from(selected), buildingEid: buildingHit });
          return;
        }
      }
      if ((unitHit !== null && enemyUnit) || (buildingHit !== null && enemyBuilding)) {
        queue.enqueue(deps.currentTick() + 1, {
          type: "attack",
          playerId: deps.localPlayerId,
          eids: Array.from(selected),
          targetEid: unitHit !== null && enemyUnit ? unitHit : buildingHit!,
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
          formation: deps.formation?.() ?? 0,
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
    // touch tap = select OR contextual order (mobile has no right-click)
    if (e.pointerType === "touch" && placementConsumedTap) {
      placementConsumedTap = false; // the tap placed a building; keep the crew selected
      return;
    }
    if (e.pointerType === "touch" && e.button === 0 && touchTapOk(e)) {
      const eid = pickUnitNear(e.clientX, e.clientY, 24);
      const unitOwner = (id: number) => deps.unitPositions().find((u) => u.eid === id)?.playerId ?? -1;
      // tap on an own unit → board it (transport, with a crew selected) or (re)select
      if (eid !== null && unitOwner(eid) === deps.localPlayerId) {
        if (selected.size > 0 && !selected.has(eid) && (deps.unitTransportCapacity?.(eid) ?? 0) > 0) {
          queue.enqueue(deps.currentTick() + 1, { type: "garrison", playerId: deps.localPlayerId, eids: Array.from(selected), buildingEid: eid });
          return;
        }
        selected.clear();
        selectedBuilding = null;
        selected.add(eid);
        return;
      }
      const pick = scene.pick(e.clientX, e.clientY);
      const nodeEid = pick?.pickedMesh && deps.isNodeMesh ? deps.isNodeMesh(pick.pickedMesh) : null;
      const beid = pick?.pickedMesh && deps.isBuildingMesh ? deps.isBuildingMesh(pick.pickedMesh) : null;
      const ownBuilding = beid !== null && deps.buildingOwner?.(beid) === deps.localPlayerId;
      if (selected.size > 0) {
        // units selected: the tap IS the order
        if (nodeEid !== null) {
          queue.enqueue(deps.currentTick() + 1, { type: "gather", playerId: deps.localPlayerId, eids: Array.from(selected), nodeEid });
          return;
        }
        if (ownBuilding && deps.buildingActive && !deps.buildingActive(beid)) {
          // unfinished own site → put the crew on it
          queue.enqueue(deps.currentTick() + 1, { type: "work_on", playerId: deps.localPlayerId, eids: Array.from(selected), buildingEid: beid });
          return;
        }
        const farmNode = ownBuilding ? (deps.farmFoodNode?.(beid!) ?? null) : null;
        if (farmNode !== null) {
          // own farm → put the crew to work in the field
          queue.enqueue(deps.currentTick() + 1, { type: "gather", playerId: deps.localPlayerId, eids: Array.from(selected), nodeEid: farmNode });
          return;
        }
        if (ownBuilding && (deps.garrisonCapacity?.(beid!) ?? 0) > 0) {
          queue.enqueue(deps.currentTick() + 1, { type: "garrison", playerId: deps.localPlayerId, eids: Array.from(selected), buildingEid: beid! });
          return;
        }
        if (ownBuilding) {
          selected.clear();
          selectedBuilding = beid; // switch to the finished building
          return;
        }
        if (eid !== null || beid !== null) {
          // enemy unit or enemy building → attack it
          queue.enqueue(deps.currentTick() + 1, {
            type: "attack",
            playerId: deps.localPlayerId,
            eids: Array.from(selected),
            targetEid: eid ?? beid!,
          });
          return;
        }
        const ground = scene.pick(e.clientX, e.clientY, (m) => m.name === "terrain");
        if (ground?.pickedPoint) {
          // open ground (or toward an enemy — military auto-acquires)
          const x = Math.round(ground.pickedPoint.x * FP_ONE);
          const y = Math.round(ground.pickedPoint.z * FP_ONE);
          deps.onMoveOrder?.(Math.trunc(ground.pickedPoint.x), Math.trunc(ground.pickedPoint.z));
          queue.enqueue(deps.currentTick() + 1, { type: "move", playerId: deps.localPlayerId, eids: Array.from(selected), x, y, formation: deps.formation?.() ?? 0 });
        }
        return;
      }
      if (selectedBuilding !== null && beid === null && nodeEid === null && eid === null) {
        // own production building selected: tap on ground sets its rally
        const ground = scene.pick(e.clientX, e.clientY, (m) => m.name === "terrain");
        if (ground?.pickedPoint) {
          queue.enqueue(deps.currentTick() + 1, {
            type: "rally",
            playerId: deps.localPlayerId,
            buildingEid: selectedBuilding,
            x: Math.round(ground.pickedPoint.x * FP_ONE),
            y: Math.round(ground.pickedPoint.z * FP_ONE),
          });
        }
        return;
      }
      // nothing selected: plain select (any unit for info, or a building)
      selected.clear();
      selectedBuilding = beid;
      if (eid !== null) {
        selectedBuilding = null;
        selected.add(eid);
      }
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

  canvas.addEventListener("dblclick", (e) => {
    const eid = pickUnitNear(e.clientX, e.clientY, 14);
    if (eid === null) return;
    const typeId = deps.unitTypeOf?.(eid);
    if (!typeId) return;
    selected.clear();
    selectedBuilding = null;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const u of deps.unitPositions()) {
      if (u.playerId !== deps.localPlayerId || deps.unitTypeOf?.(u.eid) !== typeId) continue;
      const sp = screenPos(u.x, deps.groundHeightAt(u.x, u.z) + 0.5, u.z);
      if (sp.x >= 0 && sp.x <= w && sp.y >= 0 && sp.y <= h) selected.add(u.eid);
    }
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  return {
    selected,
    selectedBuilding: () => selectedBuilding,
    enterPlacement(buildingId, size) {
      placement = { buildingId, size };
    },
    clear() {
      selected.clear();
      selectedBuilding = null;
      placement = null;
      deps.onGhostEnd?.();
    },
  };
}
