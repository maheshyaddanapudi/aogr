/**
 * AI worker: runs the Petra-style brain over a deserialized sim snapshot,
 * off the main thread. Commands return to the main thread and enter the sim
 * through the command queue like any player's — worker timing can delay a
 * decision by a tick, never fork state (docs/02 worker contract).
 */
import { deserializeSim } from "../sim/sim";
import { decideAi, type AiState } from "../ai/brain";
import type { Command } from "../sim/commands";

export interface AiRequest {
  snapshot: string;
  aiState: AiState;
}

export interface AiResponse {
  commands: Command[];
  aiState: AiState;
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const sim = deserializeSim(e.data.snapshot);
  const aiState = e.data.aiState;
  const commands = decideAi(sim, aiState);
  const response: AiResponse = { commands, aiState };
  (self as unknown as Worker).postMessage(response);
};
