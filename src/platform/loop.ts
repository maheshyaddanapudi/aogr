/**
 * Fixed-timestep driver: sim advances at exactly TICK_RATE Hz regardless of
 * frame rate; rendering runs every animation frame and receives an
 * interpolation alpha in [0,1] for smooth 60fps visuals over 15 Hz state.
 */
import { MS_PER_TICK } from "../sim";

export interface LoopHooks {
  /** Advance the sim exactly one tick. */
  onTick: () => void;
  /** Render a frame. alpha = fraction of the next tick already elapsed. */
  onFrame: (alpha: number, frameDtMs: number) => void;
}

const MAX_FRAME_DT_MS = 250; // avoid spiral-of-death after tab switches

export function startLoop(hooks: LoopHooks): () => void {
  let last = performance.now();
  let accumulator = 0;
  let running = true;

  const frame = (now: number) => {
    if (!running) return;
    const dt = Math.min(now - last, MAX_FRAME_DT_MS);
    last = now;
    accumulator += dt;
    while (accumulator >= MS_PER_TICK) {
      hooks.onTick();
      accumulator -= MS_PER_TICK;
    }
    hooks.onFrame(accumulator / MS_PER_TICK, dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return () => {
    running = false;
  };
}
