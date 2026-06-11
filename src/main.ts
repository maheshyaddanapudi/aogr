/**
 * Boot: deterministic skirmish sim (15 Hz) + Babylon world scene + bronze HUD.
 * Phase 3 demo: a real economy — villagers gather food/wood/gold, a house goes
 * up, a villager trains at the TC, and (once a temple stands) villagers pray.
 */
import {
  CommandQueue,
  createSim,
  simChecksum,
  stepSim,
  nearestPassableTile,
  FP_ONE,
} from "./sim";
import { findResourceNodes, getPlayer } from "./sim/economy";
import { getBuildingStatsByIndex } from "./sim/buildingdata";
import { query } from "bitecs";
import { createEngine, createWorldScene } from "./render/scene";
import { createUnitRenderer, type UnitAnimState } from "./render/units";
import { createWorldObjectsRenderer } from "./render/buildings";
import { setupSelection } from "./render/selection";
import { createPathService } from "./platform/pathService";
import { startLoop } from "./platform/loop";
import { createHud } from "./ui/hud";

const DEFAULT_SEED = 20260611;

async function boot(): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const hudRoot = document.getElementById("hud-root")!;

  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") ?? DEFAULT_SEED) >>> 0;
  const demo = !params.has("nodemo");

  const sim = createSim(seed, undefined, { players: 2, skirmish: true });
  const queue = new CommandQueue();

  // Phase 3 demo script: task the starting villagers, expand, train.
  if (demo) {
    const vills = Array.from(query(sim.world, [sim.stores.UnitRef]))
      .filter((e) => sim.stores.Owner.playerId[e] === 0 && sim.unitStats(e).id === "villager")
      .sort((a, b) => a - b);
    const tc = getPlayer(sim, 0).townCenterEid;
    const near = (eids: number[], kind: "food" | "wood" | "gold") => {
      const nodes = findResourceNodes(sim, kind);
      const { Position } = sim.stores;
      let best = nodes[0]!;
      let bestD = Number.MAX_SAFE_INTEGER;
      for (const n of nodes) {
        const dx = Position.x[n]! - Position.x[tc]!;
        const dy = Position.y[n]! - Position.y[tc]!;
        if (dx * dx + dy * dy < bestD) {
          bestD = dx * dx + dy * dy;
          best = n;
        }
      }
      return { type: "gather" as const, playerId: 0, eids, nodeEid: best };
    };
    queue.enqueue(1, near([vills[0]!, vills[1]!], "food"));
    queue.enqueue(1, near([vills[2]!], "wood"));
    queue.enqueue(2, near([vills[3]!], "gold"));
    queue.enqueue(30, { type: "train", playerId: 0, buildingEid: tc, unit: "villager" });
    queue.enqueue(300, { type: "build", playerId: 0, eids: [vills[3]!], building: "house", x: -1, y: -1 });
    queue.enqueue(900, { type: "build", playerId: 0, eids: [vills[2]!], building: "temple", x: -1, y: -1 });
    queue.enqueue(2200, { type: "pray", playerId: 0, eids: [vills[2]!, vills[3]!] });
  }

  const engine = await createEngine(canvas);
  const world = createWorldScene(engine, canvas, sim.terrain);
  const unitRenderer = await createUnitRenderer(world.scene, world.shadows);
  const objects = await createWorldObjectsRenderer(world.scene, world.shadows);
  const pathService = createPathService(sim);
  const hud = createHud(hudRoot);
  const backend = engine.constructor.name === "WebGPUEngine" ? "WebGPU" : "WebGL2";

  type UnitView = {
    eid: number;
    x: number;
    z: number;
    vx: number;
    vz: number;
    playerId: number;
    unitClass: string;
    anim: UnitAnimState;
  };
  const unitView: UnitView[] = [];
  const buildingView: {
    eid: number;
    buildingId: string;
    playerId: number;
    x: number;
    z: number;
    size: number;
    progress: number;
    total: number;
    active: boolean;
  }[] = [];
  const nodeView: { eid: number; resType: number; x: number; z: number; depleted: boolean }[] = [];

  const refreshViews = () => {
    const { Position, Velocity, Owner, UnitRef, MoveState, GatherTask, Building, ResourceNode } = sim.stores;
    unitView.length = 0;
    for (const eid of query(sim.world, [Position, UnitRef])) {
      const phase = GatherTask.phase[eid] ?? 0;
      const anim: UnitAnimState =
        phase === 2 || phase === 4 || phase === 5 ? "work" : MoveState.active[eid] === 1 ? "walk" : "idle";
      unitView.push({
        eid,
        x: Position.x[eid]! / FP_ONE,
        z: Position.y[eid]! / FP_ONE,
        vx: Velocity.x[eid]! / FP_ONE,
        vz: Velocity.y[eid]! / FP_ONE,
        playerId: Owner.playerId[eid]!,
        unitClass: sim.unitStats(eid).unitClass,
        anim,
      });
    }
    buildingView.length = 0;
    for (const eid of query(sim.world, [Building])) {
      const stats = getBuildingStatsByIndex(Building.typeIndex[eid]!);
      buildingView.push({
        eid,
        buildingId: stats.id,
        playerId: Owner.playerId[eid]!,
        x: Position.x[eid]! / FP_ONE,
        z: Position.y[eid]! / FP_ONE,
        size: stats.size,
        progress: Building.progress[eid]!,
        total: Building.total[eid]!,
        active: Building.active[eid] === 1,
      });
    }
    nodeView.length = 0;
    for (const eid of query(sim.world, [ResourceNode])) {
      nodeView.push({
        eid,
        resType: ResourceNode.resType[eid]!,
        x: Position.x[eid]! / FP_ONE,
        z: Position.y[eid]! / FP_ONE,
        depleted: ResourceNode.amountMilli[eid]! <= 0,
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
    isNodeMesh: (m) => objects.isNodeMesh(m),
    groundHeightAt: world.groundHeightAt,
    onMoveOrder: (tx, ty) => {
      const snapped = nearestPassableTile(sim, tx, ty);
      pathService.prewarm(snapped.x, snapped.y);
    },
  });

  // frame the player base
  const tcEid = getPlayer(sim, 0).townCenterEid;
  world.rtsCamera.camera.target.x = sim.stores.Position.x[tcEid]! / FP_ONE;
  world.rtsCamera.camera.target.z = sim.stores.Position.y[tcEid]! / FP_ONE + 6;
  world.rtsCamera.camera.radius = 42;

  let checksum = simChecksum(sim);

  const renderFrame = () => {
    refreshViews();
    unitRenderer.update(unitView, world.groundHeightAt, selection.selected);
    objects.update(buildingView, nodeView, world.groundHeightAt);
    world.scene.render();
    const p = getPlayer(sim, 0);
    hud.update({ tick: sim.tick, checksum, fps: engine.getFps(), seed, backend });
    hud.updateResources({
      food: Math.trunc(p.foodMilli / 1000),
      wood: Math.trunc(p.woodMilli / 1000),
      gold: Math.trunc(p.goldMilli / 1000),
      favor: Math.trunc(p.favorMilli / 1000),
      pop: p.popUsed,
      popCap: p.popCap,
    });
  };

  startLoop({
    onTick: () => {
      stepSim(sim, queue.drain(sim.tick));
      if (sim.tick % 15 === 0) checksum = simChecksum(sim);
    },
    onFrame: renderFrame,
  });

  window.addEventListener("resize", () => engine.resize());
  // Debug handles for headless gate probes (harmless in production).
  (window as unknown as Record<string, unknown>).__scene = world.scene;
  (window as unknown as Record<string, unknown>).__sim = sim;
  (window as unknown as Record<string, unknown>).__selection = selection;
  (window as unknown as Record<string, unknown>).__forceFrame = renderFrame;
  (window as unknown as Record<string, unknown>).__step = (n: number) => {
    for (let i = 0; i < n; i++) {
      stepSim(sim, queue.drain(sim.tick));
    }
    checksum = simChecksum(sim);
  };
}

void boot();
