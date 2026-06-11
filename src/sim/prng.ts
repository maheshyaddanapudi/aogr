/**
 * Seeded deterministic PRNG (mulberry32 core, integer-only output).
 * The ONLY source of randomness allowed inside src/sim (KICKOFF.md §3.2).
 * State is a single u32 so it serializes into save files and checksums.
 */
export class Prng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next unsigned 32-bit integer. */
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Integer in [0, maxExclusive). Modulo bias is acceptable for game logic. */
  nextInt(maxExclusive: number): number {
    return this.nextU32() % maxExclusive;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}
