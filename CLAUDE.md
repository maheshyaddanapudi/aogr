# CLAUDE.md — Pantheons: Age of the Reforged Gods

**Read `KICKOFF.md` in full at the start of every session.** It is the build charter and
single source of authority. Where docs conflict, KICKOFF.md wins; where it is silent,
`docs/00–06` win. Game balance lives in `data/*.json`, never in code.

## Hard rules (hook/CI-enforced — do not negotiate in code review)

1. **Sim purity:** `src/sim/` never imports from `src/render/`, `src/ui/`, Babylon,
   Howler, or touches DOM/wall-clock. Guard: `scripts/check-sim-purity.mjs`
   (runs as `npm run check:determinism-rules`, in CI, in `tests/sim/purity.test.ts`,
   and via `.claude/hooks/` once `settings.json.template` is activated by a human).
2. **No `Math.random` in sim** — only `src/sim/prng.ts` (seeded, serializable).
3. **No floats in sim state** — fixed-point integers: positions in millitiles
   (`FP_ONE = 1000`), HP/damage ×100. Floats allowed in render/UI only.
   `data/*.json` is human-readable (HP 115, speed 4.2); the loader converts to ints.
4. **Determinism:** same `{seed + ordered commands}` ⇒ identical checksum. Proven by
   `tests/sim/determinism.test.ts` (10k ticks) at **every** phase gate.
5. **Command queue is the only door into the sim** (player, AI, and future network).
6. **TDD** for all sim/combat/counter/determinism logic: failing tests first, commit
   them, implement to green. **Never alter tests to pass.**
7. Phase N+1 never starts before phase N's gate passes (logic AND visual —
   programmer-art visuals fail the gate). Update `docs/04` checkboxes at every gate.
8. Deploy on every push to `main` (GitHub Pages). Conventional commits. No secrets.

## Build & test commands

```
npm run dev                       # Vite dev server
npm test                          # Vitest (incl. determinism gate)
npm run build                     # tsc --noEmit && vite build
npm run check:determinism-rules   # sim purity guard
npx vite preview --port 4173      # serve dist/ (Playwright screenshots use this)
```

Headless screenshots (visual gates): Playwright Chromium with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, viewport 1280×720,
save to `docs/screenshots/phase-<N>-gate.png`.

## Architecture in one breath

15 Hz deterministic sim (`src/sim/`, bitECS with **per-sim component stores**,
integer-only) ⟶ command queue in ⟶ checksum out; render (`src/render/`, Babylon
WebGPU/WebGL2 + bloom pipeline) interpolates to 60fps; HUD is DOM/CSS (`src/ui/`,
bronze/parchment, Cinzel + Alegreya Sans); `src/platform/` owns the fixed-timestep
loop and (later) workers for pathfinding + AI. Full map: `docs/02`.

Known integration facts: bitECS 0.4 uses the new API (no `defineComponent`/`Types` —
user-owned SoA stores, `query(world, [Comp])`, eids start at 1 per world). Babylon
tree-shaken imports need side-effect modules (pipeline manager, InstancedMesh,
shadow component) — see `src/render/scene.ts` imports.

## Doc map

- `docs/00-VISION.md` — pillars, definition of done, non-goals
- `docs/01-GAME-DESIGN-DOCUMENT.md` — full GDD (pantheons/units/techs/powers/victory)
- `docs/02-TECHNICAL-ARCHITECTURE.md` — layering, folders, determinism, workers
- `docs/03-ART-AUDIO-BIBLE.md` — style guide, CC0 sources, ATTRIBUTION rules
- `docs/04-IMPLEMENTATION-ROADMAP.md` — 11 phases, live gate checkboxes
- `docs/05-AI-OPPONENT-SPEC.md` — HQ/queue/defense AI design
- `docs/06-TESTING-STRATEGY.md` — test taxonomy + CI gates
- `docs/07-SKILLS-LEDGER.md` — append-only skill ledger (§11)

## Skill duties (KICKOFF §11 — survives compaction; mandatory every session)

- **Vendor:** the moment ANY skill is consulted or invoked (project/personal/plugin/
  marketplace), copy its full folder verbatim into `.claude/skills/<name>/` with an
  `ORIGIN.md` (source path, date, version/hash, license). Non-redistributable skills
  get a `[stub]` SKILL.md. `.claude/skills/` is committed, never gitignored.
- **Log:** append a row to `docs/07-SKILLS-LEDGER.md` **at invocation time** — including
  "consulted, not applicable". Same skill+purpose+session = one row with use-count.
- **Rollup:** every phase-gate report includes "Skills used this phase" + library delta.
- **Author:** when a pattern is solved ≥2–3 times or a phase yields hard-won knowledge,
  draft `.claude/skills/<new-skill>/SKILL.md` (trigger-rich description; distilled
  procedure, pitfalls, verification). Ledger it with the evidence (commits/phases/bugs).
  Thin evidence ⇒ ledger "deferred — insufficient evidence" and move on. Use authored
  skills in later phases and log those uses; refine + ledger updates when reuse reveals gaps.
  Current deferred candidates: `deterministic-sim-testing`, `bitecs-babylon-bridge`.

## Session protocol

Read this file + `docs/04`, report current phase/gate/blockers, continue from there,
stop at the gate. Never silently skip a failing gate — report and propose a fix plan.
Balance questions ⇒ change `data/*.json`, not code. When in doubt, ask the human.
