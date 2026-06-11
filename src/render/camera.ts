/**
 * RTS camera rig: WASD/arrow pan, mouse edge-scroll, wheel zoom,
 * Q/E (or middle-drag) rotate. The ArcRotate target glides over the map;
 * tilt eases in as you zoom out. No default Babylon camera inputs.
 */
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

const EDGE_PX = 12;
const PAN_SPEED = 0.55; // tiles per frame at reference radius
const ROT_SPEED = 0.035;
const MIN_RADIUS = 14;
const MAX_RADIUS = 110;

export interface RtsCamera {
  camera: ArcRotateCamera;
  update: (groundHeightAt: (x: number, z: number) => number) => void;
}

export function createRtsCamera(scene: Scene, canvas: HTMLCanvasElement, mapSize: number): RtsCamera {
  const camera = new ArcRotateCamera("rtsCam", -Math.PI / 2, Math.PI / 3.6, 55, new Vector3(mapSize / 2, 0, mapSize / 2), scene);
  camera.lowerRadiusLimit = MIN_RADIUS;
  camera.upperRadiusLimit = MAX_RADIUS;
  camera.minZ = 1;
  camera.maxZ = 600;

  const keys = new Set<string>();
  let mouseX = -1;
  let mouseY = -1;
  let rotating = false;

  // ── touch: one-finger drag pans, two-finger pinch zooms ──
  const touches = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const [a, b] = Array.from(touches.values());
      pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
    const prev = touches.get(e.pointerId)!;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 1) {
      // pan in camera space; scale with zoom so it feels 1:1 with the ground
      const worldPerPx = (camera.radius * 1.35) / canvas.clientHeight;
      const dx = (e.clientX - prev.x) * worldPerPx;
      const dz = (e.clientY - prev.y) * worldPerPx;
      const fx = -Math.cos(camera.alpha);
      const fz = -Math.sin(camera.alpha);
      const rx = -Math.sin(camera.alpha);
      const rz = Math.cos(camera.alpha);
      camera.target.x -= rx * dx + fx * -dz;
      camera.target.z -= rz * dx + fz * -dz;
      camera.target.x = Math.min(Math.max(camera.target.x, 0), mapSize);
      camera.target.z = Math.min(Math.max(camera.target.z, 0), mapSize);
    } else if (touches.size === 2) {
      const [a, b] = Array.from(touches.values());
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchDist > 0) {
        camera.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, camera.radius * (pinchDist / d)));
      }
      pinchDist = d;
    }
  });
  const endTouch = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.delete(e.pointerId);
    pinchDist = 0;
  };
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", endTouch);

  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
  canvas.addEventListener("pointermove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (rotating) camera.alpha -= e.movementX * 0.008;
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 1) {
      rotating = true;
      e.preventDefault();
    }
  });
  window.addEventListener("pointerup", (e) => {
    if (e.button === 1) rotating = false;
  });
  canvas.addEventListener("pointerleave", () => {
    mouseX = -1;
    mouseY = -1;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      camera.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, camera.radius + Math.sign(e.deltaY) * camera.radius * 0.12));
      e.preventDefault();
    },
    { passive: false },
  );

  // Debug handle for headless gate probes.
  (globalThis as unknown as Record<string, unknown>).__keys = keys;

  const update: RtsCamera["update"] = (groundHeightAt) => {
    const g = globalThis as unknown as Record<string, number>;
    g.__camFrames = (g.__camFrames ?? 0) + 1;
    const speed = PAN_SPEED * (camera.radius / 55);
    let dx = 0;
    let dz = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp") || (mouseY >= 0 && mouseY < EDGE_PX)) dz += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown") || (mouseY >= 0 && mouseY > canvas.clientHeight - EDGE_PX)) dz -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft") || (mouseX >= 0 && mouseX < EDGE_PX)) dx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight") || (mouseX >= 0 && mouseX > canvas.clientWidth - EDGE_PX)) dx += 1;
    if (keys.has("KeyQ")) camera.alpha += ROT_SPEED;
    if (keys.has("KeyE")) camera.alpha -= ROT_SPEED;

    if (dx !== 0 || dz !== 0) {
      // ArcRotate sits at target + r(cosα, sinα) in xz, so view-forward is -(cosα, sinα).
      const fx = -Math.cos(camera.alpha);
      const fz = -Math.sin(camera.alpha);
      const rx = -Math.sin(camera.alpha);
      const rz = Math.cos(camera.alpha);
      camera.target.x += (fx * dz + rx * dx) * speed;
      camera.target.z += (fz * dz + rz * dx) * speed;
      camera.target.x = Math.min(Math.max(camera.target.x, 0), mapSize);
      camera.target.z = Math.min(Math.max(camera.target.z, 0), mapSize);
    }
    // glide the focal point along the terrain and ease tilt with zoom
    const targetY = groundHeightAt(camera.target.x, camera.target.z);
    camera.target.y += (targetY - camera.target.y) * 0.2;
    const zoomT = (camera.radius - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS);
    camera.beta = Math.PI / 3.1 - zoomT * 0.35;
  };

  return { camera, update };
}
