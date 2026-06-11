/**
 * FNV-1a 32-bit checksum over a stream of 32-bit lanes.
 * Used to prove sim determinism at every phase gate (KICKOFF.md §3.4).
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export class Checksum {
  private h = FNV_OFFSET;

  /** Hash a signed 32-bit value (negative values are two's-complement wrapped). */
  addI32(value: number): void {
    this.addU32(value | 0);
  }

  /** Hash an unsigned 32-bit value byte by byte. */
  addU32(value: number): void {
    const u = value >>> 0;
    let h = this.h;
    h = Math.imul(h ^ (u & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((u >>> 8) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((u >>> 16) & 0xff), FNV_PRIME);
    h = Math.imul(h ^ ((u >>> 24) & 0xff), FNV_PRIME);
    this.h = h;
  }

  digest(): number {
    return this.h >>> 0;
  }
}
