/**
 * Main-thread AI driver: every decision interval, ship a sim snapshot to the
 * AI worker; enqueue returned commands for the next tick. Falls back to a
 * synchronous decision when Workers are unavailable.
 */
import type { Sim } from "../sim/sim";
import type { CommandQueue } from "../sim/commands";
import { serializeSim } from "../sim/sim";
import { createAiState, decideAi, type AiDifficulty, type AiState } from "../ai/brain";
import type { AiRequest, AiResponse } from "./aiWorker";

export interface AiService {
  /** call once per sim tick (before stepping) */
  onTick: (sim: Sim, queue: CommandQueue) => void;
  /** synchronous decision (headless gate captures bypass the worker) */
  decideSyncNow: (sim: Sim, queue: CommandQueue) => void;
  dispose: () => void;
}

export function createAiService(playerId: number, difficulty: AiDifficulty, seed: number): AiService {
  const state: AiState = createAiState(playerId, difficulty, seed);
  let worker: Worker | null = null;
  let pending = false;
  let lastDecisionTick = -1;

  try {
    worker = new Worker(new URL("./aiWorker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }

  return {
    onTick(sim: Sim, queue: CommandQueue): void {
      if (sim.tick - lastDecisionTick < state.decisionIntervalTicks || pending) return;
      lastDecisionTick = sim.tick;
      if (worker) {
        pending = true;
        worker.onmessage = (e: MessageEvent<AiResponse>) => {
          pending = false;
          Object.assign(state, e.data.aiState);
          for (const cmd of e.data.commands) queue.enqueue(sim.tick + 1, cmd);
        };
        const req: AiRequest = { snapshot: serializeSim(sim), aiState: state };
        worker.postMessage(req);
      } else {
        for (const cmd of decideAi(sim, state)) queue.enqueue(sim.tick + 1, cmd);
      }
    },
    decideSyncNow(sim: Sim, queue: CommandQueue): void {
      if (sim.tick - lastDecisionTick < state.decisionIntervalTicks) return;
      lastDecisionTick = sim.tick;
      for (const cmd of decideAi(sim, state)) queue.enqueue(sim.tick + 1, cmd);
    },
    dispose(): void {
      worker?.terminate();
    },
  };
}
