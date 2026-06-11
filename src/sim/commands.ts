/**
 * The command queue is the ONLY door into the simulation (KICKOFF.md §3.5).
 * Player input, AI decisions, and (later) network peers all become Commands
 * scheduled for a tick. Execution order within a tick is deterministic:
 * sorted by playerId, then by enqueue sequence — never by wall-clock timing.
 */
export type Command =
  | { type: "noop"; playerId: number }
  | { type: "debug_spawn"; playerId: number; x: number; y: number }
  | { type: "spawn_unit"; playerId: number; unit: string; x: number; y: number }
  | { type: "move"; playerId: number; eids: number[]; x: number; y: number }
  | { type: "gather"; playerId: number; eids: number[]; nodeEid: number }
  | { type: "build"; playerId: number; eids: number[]; building: string; x: number; y: number }
  | { type: "train"; playerId: number; buildingEid: number; unit: string }
  | { type: "trade"; playerId: number; sell: string; buy: string; amountMilli: number }
  | { type: "pray"; playerId: number; eids: number[] }
  | { type: "attack"; playerId: number; eids: number[]; targetEid: number }
  | { type: "research"; playerId: number; tech: string; minorGod?: string };

interface Pending {
  tick: number;
  seq: number;
  cmd: Command;
}

export class CommandQueue {
  private pending: Pending[] = [];
  private seq = 0;

  enqueue(tick: number, cmd: Command): void {
    this.pending.push({ tick, seq: this.seq++, cmd });
  }

  /** Remove and return all commands scheduled for `tick`, deterministically ordered. */
  drain(tick: number): Command[] {
    const due: Pending[] = [];
    const rest: Pending[] = [];
    for (const p of this.pending) (p.tick === tick ? due : rest).push(p);
    this.pending = rest;
    due.sort((a, b) => a.cmd.playerId - b.cmd.playerId || a.seq - b.seq);
    return due.map((p) => p.cmd);
  }
}
