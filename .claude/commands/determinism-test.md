---
description: Run the determinism checksum proof (same seed + commands ⇒ identical state)
---

Run `npx vitest run tests/sim/determinism.test.ts tests/sim/purity.test.ts` and report the results.

If any test fails:
1. Do NOT alter the tests.
2. Find the nondeterminism source — usual suspects: Math.random, floats in sim state, iteration over unordered collections (object keys, Sets/Maps with nondeterministic insertion), wall-clock reads, command ordering by arrival time, uninitialized typed-array slots after entity removal.
3. Fix the sim, re-run, and report what leaked and how it was fixed (ledger it if it's the 2nd+ occurrence — skill candidate `deterministic-sim-testing`).
