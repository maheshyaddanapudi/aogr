# 06 — TESTING STRATEGY

**TDD is mandatory** for sim/combat/counter/determinism logic: failing tests first,
commit them, implement to green, never weaken a test to pass (KICKOFF §8.2).

## Test taxonomy

| Layer | Where | What |
|-------|-------|------|
| Unit | `tests/sim/*.test.ts` | PRNG, checksum, fixed-point, command queue |
| Determinism | `tests/sim/determinism.test.ts` | same seed+commands ⇒ identical checksum after 10k ticks; divergence on different seed/commands; save/load lockstep round-trip. **Run at every phase gate.** |
| Purity | `tests/sim/purity.test.ts` + `scripts/check-sim-purity.mjs` | src/sim free of render/UI/Babylon imports, Math.random, wall-clock, DOM |
| Data contracts | `tests/data/*.test.ts` | §7 anchors exact; schema validity; cross-references resolve (pantheon grants → real units/techs/powers); counter multipliers present |
| Headless gameplay (Phase 3+) | `tests/gameplay/` | scripted command lists through real sim: gather rates, build flows, combat outcomes (archers>infantry>cavalry>archers), age unlocks, favor rates, power costs ramp |
| AI (Phase 7) | `tests/ai/` | AI-vs-AI headless runs; difficulty separation; AI determinism replay |
| Perf (Phase 2+) | gate scripts | 200-unit pathing tick budget; fps sampling via Playwright at gates |
| Visual | Playwright + SwiftShader | screenshot per gate → `docs/screenshots/phase-<N>-gate.png`, judged vs KICKOFF §4 |

## Gameplay test doctrine (Phase 3 onward)

Tests never poke sim internals to set up state — they submit Commands and assert on
observed state/checksums, exactly like a player. Balance assertions read expected
values from `data/*.json` at test time (no hardcoded copies), so tuning data doesn't
break tests unless it breaks an anchor or a counter relationship.

## CI gates (.github/workflows/)

- `ci.yml` — every push/PR: purity guard → vitest → typecheck + build.
- `deploy.yml` — push to `main`: re-runs purity + tests as a deploy gate, builds,
  publishes to GitHub Pages. A red suite can never reach the live URL.

## Phase-gate ritual (`.claude/commands/phase-gate.md`)

1. purity → 2. full vitest → 3. build → 4. screenshot + visual judgment →
5. phase-specific criteria → 6. update docs/04 → 7. skills rollup in docs/07 →
8. report (never silently skip a failing gate).
