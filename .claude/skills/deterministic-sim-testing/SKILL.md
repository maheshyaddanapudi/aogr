---
name: deterministic-sim-testing
description: Procedure for writing and debugging determinism tests for the fixed-point lockstep sim — checksum gates, command-script harnesses, serialize/lockstep round-trips, and the usual nondeterminism leaks. Consult at EVERY phase gate, when adding any sim system, or when two same-seed runs diverge.
---

# Deterministic sim testing (earned in Phases 0–2)

## The gate harness (copy this shape)

```ts
const run = (seed) => {
  const sim = createSim(seed);
  for (let t = 0; t < N; t++) stepSim(sim, script.get(t) ?? []);
  return sim;
};
expect(simChecksum(run(S))).toBe(simChecksum(run(S)));          // reproducibility
expect(simChecksum(run(S1))).not.toBe(simChecksum(run(S2)));    // seed sensitivity
// serialize mid-run, then advance BOTH and compare — catches derived-state leaks:
const restored = deserializeSim(serializeSim(sim));
advanceBoth(sim, restored, 300);
expect(simChecksum(restored)).toBe(simChecksum(sim));
```

Every phase gate re-runs the 10k-tick test plus a phase-specific scenario
(Phase 2: 200-unit march → arrival + zero overlapping pairs + identical rerun).

## Design rules that make the tests pass

- All quantities integer: positions millitiles (FP_ONE=1000), HP/damage ×100,
  multipliers ×1000, times in ticks. `Math.trunc` division; **isqrt without
  bit-shifts** (`>>` truncates to int32 — squared millitile distances overflow).
- One seeded PRNG stream for gameplay; SALTED separate streams for worldgen
  (`seed ^ 0x9e3779b9`) so map generation never perturbs gameplay rolls.
- Iterate entities in ascending-eid order EVERYWHERE state is mutated or hashed
  (`Array.from(query(...)).sort((a,b)=>a-b)`); spatial-hash buckets fill in
  ascending order; pair interactions visit `(i, j>i)` once, applied symmetrically.
- Checksum: tick + PRNG state + every component lane, ascending entities;
  **never hash entity ids** — a deserialized sim has fresh ids and must
  checksum equal.
- Derived data (flow fields, nav grids) is NEVER serialized — recompute from
  inputs on demand; cache keys must be pure functions of sim state.
- Commands sort by `(playerId, enqueue-seq)`, never arrival time. Targets snap
  via deterministic spiral search before use.
- Float-free: `Math.sqrt`/trig banned in sim. Diagonal normalize via ×707/1000.

## When same-seed runs diverge, check in order

1. `Math.random` / `Date.now` / `performance.now` (purity guard catches these).
2. Unordered iteration: `Map`/`Set`/object-key order over entities; bitECS query
   order after removals.
3. Stale caches keyed by non-sim state, or worker results mutating sim state
   directly instead of arriving as commands/identical pure values.
4. Accidental float creep: any `/` without `Math.trunc`, `**0.5`, lerp helpers.
5. Module-level mutable state shared between two sims (per-sim stores exist for
   exactly this reason).

## Test-speed notes

10k ticks of an empty sim ≈ ms; 1800 ticks × 200 moving units ≈ seconds — set
test timeout 60–120s. Add a tick-budget test (`< 20ms/tick` for 200 units) so
perf regressions fail loudly in CI rather than at the visual gate.

## Play the game before declaring it done

Unit/system tests prove mechanics in isolation; they do NOT prove the game's
core loop closes. This repo shipped 113 green tests while conquest victory was
unreachable in actual play: units never auto-acquired buildings (a comment
claimed they did), the AI's "attack waves" were bare move orders, and no UI
path could issue an attack command — each gap invisible to its own test
because tests injected raw `attack` commands. The gate that catches this class
of failure is a scripted END-TO-END PLAYTHROUGH through the production command
queue: a macro "human" that gathers, builds, ages up, trains, defends, and
attacks, run against the live AI until `sim.winner` resolves — in BOTH
directions (win and lose). Keep it as a repeatable script; rerun it whenever
combat, AI, or victory logic changes.
