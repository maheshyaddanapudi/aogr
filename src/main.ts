/**
 * Boot: deterministic sim (15 Hz) + Babylon world scene (60 fps interpolated)
 * + bronze HUD. Phase 2 demo: 200 infantry spawn on the western plain and can
 * be marquee-selected and ordered around; a scripted march eastward starts a
 * few seconds in so the gate scenario is always visible.
 */
import {
  CommandQueue,
  createSim,
  simChecksum,
  stepSim,
  nearestPassableTile,
  isPassable,
  FP_ONE,
} from "./sim";
import { hasComponent, query } from "bitecs";
import { createEngine, createWorldScene } from "./render/scene";
import { createUnitRenderer } from "./render/units";
import { setupSelection } from "./render/selection";
import { createPathService } from "./platform/pathService";
import { startLoop } from "./platform/loop";
import { createHud } from "./ui/hud";

const DEFAULT_SEED = 20260611;
const ARMY_SIZE = 200;

function passableNear(sim: ReturnType<typeof createSim>, px: number, py: number): { x: number; y: number } {
  return nearestPassableTile(sim, px, py);
}

async function boot(): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const hudRoot = document.getElementById("hud-root")!;

  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") ?? DEFAULT_SEED) >>> 0;
  const armySize = Number(params.get("army") ?? ARMY_SIZE);

  const sim = createSim(seed);
  const queue = new CommandQueue();

  // Phase 2 demo army: a column of infantry on the western plain.
  const origin = passableNear(sim, 60, 95);
  let placed = 0;
  const side = Math.ceil(Math.sqrt(armySize));
  for (let gy = 0; gy < side && placed < armySize; gy++) {
    for (let gx = 0; gx < side && placed < armySize; gx++) {
      const t = passableNear(sim, origin.x + gx * 2, origin.y + gy * 2);
      if (!isPassable(sim.navGrid, t.x, t.y)) continue;
      queue.enqueue(0, { type: "spawn_unit", playerId: 0, unit: "infantry_base", x: t.x * FP_ONE + 500, y: t.y * FP_ONE + 500 });
      placed++;
    }
  }

  const engine = await createEngine(canvas);
  const world = createWorldScene(engine, canvas, sim.terrain);
  const unitRenderer = await createUnitRenderer(world.scene, world.shadows);
  const pathService = createPathService(sim);
  const hud = createHud(hudRoot);
  const backend = engine.constructor.name === "WebGPUEngine" ? "WebGPU" : "WebGL2";

  const unitView: { eid: number; x: number; z: number; vx: number; vz: number; playerId: number; moving: boolean }[] = [];
  const refreshUnitView = () => {
    const { Position, Velocity, Owner, UnitRef, MoveState } = sim.stores;
    unitView.length = 0;
    for (const eid of query(sim.world, [Position, UnitRef])) {
      unitView.push({
        eid,
        x: Position.x[eid]! / FP_ONE,
        z: Position.y[eid]! / FP_ONE,
        vx: Velocity.x[eid]! / FP_ONE,
        vz: Velocity.y[eid]! / FP_ONE,
        playerId: Owner.playerId[eid]!,
        moving: MoveState.active[eid] === 1,
      });
    }
  };

  const selection = setupSelection({
    scene: world.scene,
    canvas,
    camera: world.rtsCamera.camera,
    queue,
    localPlayerId: 0,
    currentTick: () => sim.tick,
    unitPositions: () => unitView,
    isUnitMesh: (m) => unitRenderer.isUnitMesh(m),
    groundHeightAt: world.groundHeightAt,
    onMoveOrder: (tx, ty) => {
      const snapped = nearestPassableTile(sim, tx, ty);
      pathService.prewarm(snapped.x, snapped.y);
    },
  });

  // Scripted gate scenario: the army marches east after 3 seconds.
  const dest = passableNear(sim, 150, 110);
  pathService.prewarm(dest.x, dest.y);
  let marchIssued = params.has("nomarch");

  // Frame the action.
  world.rtsCamera.camera.target.x = origin.x + 10;
  world.rtsCamera.camera.target.z = origin.y + 8;
  world.rtsCamera.camera.radius = 60;

  let checksum = simChecksum(sim);

  startLoop({
    onTick: () => {
      if (!marchIssued && sim.tick === 45) {
        marchIssued = true;
        const { Position, UnitRef } = sim.stores;
        const eids = Array.from(query(sim.world, [Position, UnitRef])).filter((e) =>
          hasComponent(sim.world, e, UnitRef),
        );
        queue.enqueue(sim.tick + 1, { type: "move", playerId: 0, eids, x: dest.x * FP_ONE, y: dest.y * FP_ONE });
      }
      stepSim(sim, queue.drain(sim.tick));
      if (sim.tick % 15 === 0) checksum = simChecksum(sim); // re-seal once per second
    },
    onFrame: () => {
      refreshUnitView();
      unitRenderer.update(unitView, world.groundHeightAt, selection.selected);
      world.scene.render();
      hud.update({ tick: sim.tick, checksum, fps: engine.getFps(), seed, backend });
    },
  });

  window.addEventListener("resize", () => engine.resize());
  // Debug handle for headless gate probes (harmless in production).
  (window as unknown as Record<string, unknown>).__scene = world.scene;
  (window as unknown as Record<string, unknown>).__sim = sim;
  (window as unknown as Record<string, unknown>).__selection = selection;
  // Headless gates run ~0.3fps under SwiftShader; this renders one frame on demand.
  (window as unknown as Record<string, unknown>).__forceFrame = () => {
    refreshUnitView();
    unitRenderer.update(unitView, world.groundHeightAt, selection.selected);
    world.scene.render();
  };
}

void boot();
