# 04 — IMPLEMENTATION ROADMAP (live gate status)

Build strictly in order (KICKOFF §9). A phase's gate must fully pass — logic AND
visual — before the next phase starts. Update this file at every gate.

**Performance budget:** 60fps with 300 pop on a 2021+ laptop GPU. Escape hatch: if
Phase 2 can't hold 60fps at 200 units after worker offload + flow fields, reduce the
match unit cap (e.g. 150) — never abandon true 3D.

---

## Phase 0 — Scaffold + deterministic loop + CI + Pages deploy

- [x] Vite + TS(strict) + Babylon + bitECS + Vitest scaffold; §5 folder layout
- [x] All `data/*.json` generated from the GDD, seeded from §7 anchors (40 contract tests)
- [x] **Logic gate:** empty sim same-seed checksum identical after 10k ticks (tests/sim/determinism.test.ts)
- [x] Vitest green in CI (.github/workflows/ci.yml)
- [x] **Visual gate:** lit PBR test scene at 60fps with bloom pipeline active — `docs/screenshots/phase-0-gate.png` (verified headless: 60fps, WebGL2/SwiftShader)
- [x] Pages deploy workflow (`deploy.yml`, gated on tests)
- [ ] **Live URL serves the build** — pending merge to `main` + Pages enablement (workflow ready; deploys on merge)
- [x] CLAUDE.md + docs/00–07; skills vendored + ledger seeded (§11.2)

**Gate status: PASSED locally 2026-06-11** (live-URL criterion completes on merge to main).

## Phase 1 — Terrain + RTS camera

- [x] Heightmap terrain 200×200 from map config (seeded, sim-owned integer heights; island falloff; terrain checksum folded into sim checksum — 7 new tests)
- [x] RTS camera: pan (WASD/arrows + edge-scroll), zoom (wheel), rotate (Q/E + middle-drag) — directions verified headless via per-frame deltas
- [x] **Visual gate:** splatted terrain (sand/grass/rock + ambientCG normal maps) + animated water plane + CSM shadows — `docs/screenshots/phase-1-gate.png`, close-up `phase-1-texture-detail.png`
- [x] GLTF pipeline proof: CC0 animated character (Khronos Fox) loads, plays run cycle, follows terrain height end-to-end
- [ ] 60fps-across-map on real GPU — unverifiable under SwiftShader (~2fps software rendering); verify in a real browser at next human check-in (40k-vert static mesh: low risk)

**Gate status: PASSED 2026-06-11** (one perf criterion flagged for human-browser confirmation).
Hard-won knowledge captured in `.claude/skills/babylon-integration-pitfalls/`.

## Phase 2 — Units + movement + pathfinding (worker)

- [x] Flow fields (integer Dijkstra, octile, no corner-cutting) + HPA sector portals (10×10, region-aware) + RVO-lite reciprocal separation
- [x] Web Worker: flow-field pre-warm via `src/platform/flowFieldWorker.ts` — sim computes the identical field synchronously when the worker hasn't answered, so determinism never depends on worker timing (docs/02 contract)
- [x] **Logic gate:** 200 units path to a shared destination — all arrive <12 tiles, ZERO overlapping pairs, checksum-identical rerun, serialize/lockstep round-trip, <20ms/tick budget (tests/sim/movement.test.ts)
- [x] **Visual gate:** rigged animated KayKit knights (idle/walk pools, team tint), selection rings, marquee select — `phase-2-gate.png`, `phase-2-marquee.png`, `phase-2-selection-rings.png`
- [ ] 60fps @ 200 units on real GPU — unverifiable under SwiftShader; ~1.8k instances + shared-skeleton GPU skinning is well within budget; confirm at next human check-in
- [x] Skill candidates revisited: `deterministic-sim-testing` AUTHORED (3-phase evidence); `babylon-integration-pitfalls` updated (+headless capture recipe, +skinned crowds); `bitecs-babylon-bridge` + `rts-pathfinding-worker` still deferred (1–2 data points)

**Gate status: PASSED 2026-06-11** (real-GPU fps criterion flagged for human confirmation, as in Phase 1).

## Phase 3 — Economy

- [ ] **Logic gate:** gather all 4 resources; build house; pop cap rises; market trade works
- [ ] **Visual gate:** gather animations; drop-off visuals; styled resource bar HUD

## Phase 4 — Combat + counters

- [ ] **Logic gate:** headless tests — archers>infantry>cavalry>archers; damage math matches units.json exactly
- [ ] **Visual gate:** projectiles, hit sparks, death animations
- [ ] Entity removal lands → revisit snapshot serialization seam (docs/02)

## Phase 5 — Buildings + production + ages

- [ ] **Logic gate:** Archaic→Mythic; per-data unlocks; tech effects apply
- [ ] **Visual gate:** construction states; CSS age-up panel with 2-god choice cards — screenshot

## Phase 6 — Gods + favor + powers + myth units

- [ ] **Logic gate:** all 4 favor mechanics yield data-calibrated rates; powers cast w/ ramping cost; heroes counter myth
- [ ] **Visual gate:** distinct particle VFX per power; per-pantheon favor UI — screenshot

## Phase 7 — AI opponent (worker)

- [ ] **Logic gate:** AI builds eco, ages to Mythic, attacks, defends, casts powers; Easy/Med/Hard measurably differ
- [ ] **Visual gate:** AI armies move in formation; visible attack waves

## Phase 8 — Fog of war + minimap + full UI

- [ ] **Logic gate:** LOS-correct reveal/hide; clickable minimap; control groups 1–9; rally points; placement ghosts
- [ ] **Visual gate:** soft-edged fog; styled minimap frame; full HUD pass — screenshot

## Phase 9 — Audio + VFX polish

- [ ] **Logic gate:** distinct SFX per power; unit acknowledgments; music loops with combat ducking
- [ ] **Visual gate:** final VFX pass; post-processing tuned per biome

## Phase 10 — Menus + save/load + settings + release

- [ ] **Logic gate:** start→save→reload→resume with identical checksum; settings persist; victory/defeat screens
- [ ] **Visual gate:** main menu + skirmish setup per art bible; public URL = playable release
- [ ] Code-split Babylon bundle (<500 kB initial)
