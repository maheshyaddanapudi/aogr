---
description: Validate data/*.json balance tables against anchors and cross-references
---

Run `npx vitest run tests/data/data-integrity.test.ts` and report.

Rules (KICKOFF §7 + closing note):
- Balance questions are answered by changing `data/*.json`, never code.
- §7 anchors are fixed reference points — tune FROM them, never mix versions.
- Any new unit/tech/power must pass the cross-reference tests (pantheon grants resolve, multiplier targets exist, costs non-negative).
- From Phase 4 onward, also run the headless counter-triangle tests (archers>infantry>cavalry>archers) after any units.json change.
