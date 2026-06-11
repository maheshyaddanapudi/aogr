---
description: Run the full phase-gate checklist for the current phase
---

Run the phase gate for the current phase (see docs/04-IMPLEMENTATION-ROADMAP.md):

1. `npm run check:determinism-rules` — sim purity must pass.
2. `npm test` — full suite including the 10k-tick determinism checksum test must be green.
3. `npm run build` — typecheck + production build must succeed.
4. Launch the app (vite preview + Playwright headless) and capture a screenshot to `docs/screenshots/phase-<N>-gate.png`. Judge it against KICKOFF §4 — if it looks like programmer art, the gate FAILS even if logic passes.
5. Verify this phase's specific logic gate criteria from the KICKOFF §9 table.
6. Update the checkbox status in docs/04-IMPLEMENTATION-ROADMAP.md.
7. Append the "Skills used this phase" rollup + skill library delta to docs/07-SKILLS-LEDGER.md (KICKOFF §11).
8. Report: gate PASS/FAIL per criterion, screenshot, blockers. Never silently skip a failing gate.
