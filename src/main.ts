/**
 * Boot: deterministic sim (15 Hz) + Babylon world scene (60 fps interpolated)
 * + bronze HUD. Seed comes from ?seed= so two browsers given the same seed
 * and commands display the same checksum — the determinism proof, live.
 */
import { CommandQueue, createSim, simChecksum, stepSim, FP_ONE } from "./sim";
import { query } from "bitecs";
import { addShowcaseCharacter, createEngine, createWorldScene } from "./render/scene";
import { startLoop } from "./platform/loop";
import { createHud } from "./ui/hud";

const DEFAULT_SEED = 20260611;

async function boot(): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  const hudRoot = document.getElementById("hud-root")!;

  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") ?? DEFAULT_SEED) >>> 0;

  const sim = createSim(seed);
  const queue = new CommandQueue();
  const mid = Math.trunc(sim.terrain.size / 2);
  for (let i = 0; i < 6; i++) {
    queue.enqueue(i * 15, { type: "debug_spawn", playerId: 0, x: (mid - 8 + i * 3) * FP_ONE, y: (mid - 6) * FP_ONE });
    queue.enqueue(i * 15 + 7, { type: "debug_spawn", playerId: 1, x: (mid - 8 + i * 3) * FP_ONE, y: (mid + 6) * FP_ONE });
  }

  const engine = await createEngine(canvas);
  const world = createWorldScene(engine, canvas, sim.terrain);
  const hud = createHud(hudRoot);
  const backend = engine.constructor.name === "WebGPUEngine" ? "WebGPU" : "WebGL2";
  void addShowcaseCharacter(world, sim.terrain);

  let checksum = simChecksum(sim);
  const unitView: { x: number; y: number; playerId: number }[] = [];

  startLoop({
    onTick: () => {
      stepSim(sim, queue.drain(sim.tick));
      if (sim.tick % 15 === 0) checksum = simChecksum(sim); // re-seal once per second
    },
    onFrame: () => {
      const { Position, Owner } = sim.stores;
      unitView.length = 0;
      for (const eid of query(sim.world, [Position, Owner])) {
        unitView.push({
          x: Position.x[eid]! / FP_ONE,
          y: Position.y[eid]! / FP_ONE,
          playerId: Owner.playerId[eid]!,
        });
      }
      world.updateUnits(unitView);
      world.scene.render();
      hud.update({ tick: sim.tick, checksum, fps: engine.getFps(), seed, backend });
    },
  });

  window.addEventListener("resize", () => engine.resize());
  // Debug handle for headless gate probes (harmless in production).
  (window as unknown as Record<string, unknown>).__scene = world.scene;
}

void boot();
