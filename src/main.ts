/**
 * Boot: deterministic sim (15 Hz) + Babylon PBR scene (60 fps interpolated)
 * + bronze HUD. Seed comes from ?seed= so two browsers given the same seed
 * and commands display the same checksum — the Phase 0 proof, live.
 */
import { CommandQueue, createSim, simChecksum, stepSim, FP_ONE } from "./sim";
import { query } from "bitecs";
import { createEngine, createTestScene } from "./render/scene";
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
  // Scripted Phase 0 demo: two teams of wanderers spawn around the altar.
  for (let i = 0; i < 6; i++) {
    queue.enqueue(i * 15, { type: "debug_spawn", playerId: 0, x: (92 + i * 3) * FP_ONE, y: 94 * FP_ONE });
    queue.enqueue(i * 15 + 7, { type: "debug_spawn", playerId: 1, x: (92 + i * 3) * FP_ONE, y: 106 * FP_ONE });
  }

  const engine = await createEngine(canvas);
  const renderer = createTestScene(engine);
  const hud = createHud(hudRoot);
  const backend = engine.constructor.name === "WebGPUEngine" ? "WebGPU" : "WebGL2";

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
      renderer.updateUnits(unitView);
      renderer.scene.render();
      hud.update({ tick: sim.tick, checksum, fps: engine.getFps(), seed, backend });
    },
  });

  window.addEventListener("resize", () => engine.resize());
}

void boot();
