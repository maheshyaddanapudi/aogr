import { describe, expect, it } from "vitest";
import { CommandQueue } from "../../src/sim/commands";
import { createSim, simChecksum, stepSim } from "../../src/sim/sim";

describe("command queue (the only door into the sim)", () => {
  it("delivers commands at their scheduled tick, in deterministic order", () => {
    const q = new CommandQueue();
    q.enqueue(5, { type: "debug_spawn", playerId: 1, x: 1, y: 1 });
    q.enqueue(5, { type: "debug_spawn", playerId: 0, x: 2, y: 2 });
    q.enqueue(3, { type: "noop", playerId: 0 });
    expect(q.drain(0)).toEqual([]);
    expect(q.drain(3)).toEqual([{ type: "noop", playerId: 0 }]);
    const atFive = q.drain(5);
    // Sorted by playerId then enqueue sequence — never by insertion timing.
    expect(atFive.map((c) => c.playerId)).toEqual([0, 1]);
    expect(q.drain(5)).toEqual([]);
  });

  it("orders same-player commands by enqueue sequence", () => {
    const q = new CommandQueue();
    q.enqueue(1, { type: "debug_spawn", playerId: 0, x: 10, y: 0 });
    q.enqueue(1, { type: "debug_spawn", playerId: 0, x: 20, y: 0 });
    const cmds = q.drain(1);
    expect(cmds.map((c) => (c.type === "debug_spawn" ? c.x : -1))).toEqual([10, 20]);
  });

  it("identical command stream through the queue yields identical sim checksums", () => {
    const build = () => {
      const q = new CommandQueue();
      q.enqueue(2, { type: "debug_spawn", playerId: 1, x: 4000, y: 4000 });
      q.enqueue(2, { type: "debug_spawn", playerId: 0, x: 8000, y: 8000 });
      q.enqueue(7, { type: "debug_spawn", playerId: 0, x: 1000, y: 9000 });
      return q;
    };
    const runWith = (q: CommandQueue) => {
      const sim = createSim(2026);
      for (let t = 0; t < 500; t++) stepSim(sim, q.drain(t));
      return simChecksum(sim);
    };
    expect(runWith(build())).toBe(runWith(build()));
  });
});
