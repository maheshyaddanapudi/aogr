---
name: deep-research
description: "[STUB — see ORIGIN below] Deep research harness: fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report."
---

# deep-research [stub]

**This is a redistribution stub per KICKOFF §11.1** — the upstream skill is an
Anthropic-managed plugin available in the Claude Code environment; its full
content is not present on disk in this container and is not redistributable
from here, so only this summary is vendored.

## Origin

- **Skill:** deep-research (Anthropic plugin skill)
- **Source:** Claude Code harness skill registry (no on-disk path in this environment)
- **Date stubbed:** 2026-06-11 (Session 1 / Phase 0)
- **Ledger status:** `[stub]`

## What it does

Given a research question, it: (1) fans out parallel web searches across
subtopics, (2) fetches and reads primary sources, (3) adversarially
cross-checks claims between sources, and (4) synthesizes a single report with
inline citations. Invoked via the Skill tool with the refined question as args.

## Role in this repository

KICKOFF §11.2 seeds a provenance row for the **pre-repo design phase**: the
architecture and pantheon research behind KICKOFF.md (Babylon vs alternatives,
bitECS, lockstep determinism patterns, Petra-style AI, AoM mechanics anchors)
was produced with Anthropic deep research. That output is distilled into
KICKOFF.md itself; no artifact of the raw research lives in this repo.
