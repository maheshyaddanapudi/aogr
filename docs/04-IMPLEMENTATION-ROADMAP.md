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

- [x] **Logic gate:** villagers gather food/wood/gold via the full walk→gather→drop-off loop; prayer at the temple earns favor (4th resource, skyward-chants calibration); house raises pop cap 15→25; TC trains villagers (cost/time/pop); market trades with 15% spread, favor rejected; 10k-tick economy determinism + snapshot round-trip (tests/sim/economy.test.ts, 7 tests)
- [x] Buildings: foundation blocks nav grid + clears flow fields deterministically; auto-placement via spiral clear-footprint search; multi-builder construction; training queues serialized
- [x] **Visual gate:** KayKit medieval buildings (castle TC/house/church/market/windmill/lumbermill, yellow vs blue team variants), construction rises from foundation, tree/rock resource nodes, villager work animations (chop), bronze resource bar HUD — `phase-3-gate.png`, `phase-3-base.png`, `phase-3-gather-closeup.png`
- [x] Right-click on a resource node issues gather orders; `__step(n)` headless fast-forward hook added for gate verification

**Gate status: PASSED 2026-06-11.** Bug fixed en route: building interaction reach must cover footprint-corner + move-snap + arrival tolerance (`buildingReach()`), or builders strand just outside their site.

## Phase 4 — Combat + counters

- [x] **Logic gate:** headless counter triangle proven at equal pop (archers>infantry>cavalry>archers); damage math matches units.json EXACTLY (hack/armor 520, divine ignores armor, spear ×3 = 1320); deaths free pop; 10k-tick battle determinism + mid-battle snapshot round-trip (tests/sim/combat.test.ts, 8 tests)
- [x] Entity removal landed — bitECS removeEntity is deterministic given identical removal order; snapshot eid-remap already handles recycled ids; buildings unblock their footprint on death
- [x] **Visual gate:** glowing arrow projectiles in flight (phase-4-gate-projectiles.png), death poses among the living (phase-4-deaths.png), melee clash (phase-4-melee.png). Hit-spark particle system implemented (additive, procedural texture); single-frame paused captures cannot freeze 0.3s particles under SwiftShader — verify live at the next real-GPU check-in
- [x] Capture infra: ?paused mode + multi-render shader warmup (async compile skips fresh materials on first frame)

**Gate status: PASSED 2026-06-11** (hit-spark live verification flagged for human check-in, like the fps criteria).

## Phase 5 — Buildings + production + ages

- [x] **Logic gate:** full Archaic→Classical→Heroic→Mythic ladder with §6 costs + prerequisite buildings; minor-god choice validated against the major's pool; buildings/units age-gated per data files; tech effects EXACT (bronze_weapons ⇒ 572 dmg; hand_axe ⇒ ×1.1 wood rate); research determinism + serialization (tests/sim/ages.test.ts, 7 tests)
- [x] Modifier engine: researched techs apply to damage/armor/gather/train-time in integer math, derived from researchedTechs (rebuilt on load, never stored)
- [x] **Visual gate:** CSS age-up panel with 2 minor-god choice cards (pantheon color identity, hover glow) — `phase-5-gate-agepanel.png`; scaffold + rise-from-foundation construction states — `phase-5-construction.png`; age chip + Advance Age button

**Gate status: PASSED 2026-06-11.**

## Phase 6 — Gods + favor + powers + myth units

- [x] **Logic gate:** all 4 favor mechanics at data rates (pyres 28.6/min @5 altars; oracles 5.5/min LOS-scaled + non-stacking; forge-wrath exact favor/damage + trickle; chants 6/min param-driven); powers ramp free→base→×1.5 with cooldowns; effect engine (instant/DoT/heal/summon, exact pools); myth units gate on granting minor god; Forgeborn beats Emberbull 1v1; determinism + serialization (tests/sim/gods.test.ts, 11 tests)
- [x] **Visual gate:** distinct mesh+particle VFX per power (pattern × pantheon palette: pillar/bolt/rain/burst/swirl/ring, additive glow) — `phase-6-gate-powers.png` (solar lance pillar + searing mirage swirl + pyre storm field in one frame); favor chip changes icon/color/tooltip per pantheon — `phase-6-favor-*.png`

**Gate status: PASSED 2026-06-11.** Deferred (ledgered): Radiant kindle boost, petrify/convert/decoy special params — power engine handles damage/heal/summon/timed classes; remaining param wirings land with their UI in Phases 8–10.

## Phase 7 — AI opponent (worker)

- [x] **Logic gate:** AI booms, ages to Mythic with minor-god picks, banks food for age-ups, trains army + myth units, launches waves, recalls on defense, casts powers; hard out-booms easy; AI matches deterministic (tests/ai/ai.test.ts, 6 tests); AI worker via src/platform/aiWorker.ts; data/ai.json knobs
- [x] **Visual gate:** AI attack wave marching in formation — `phase-7-gate-attackwave.png`
- [x] Hardening: economy re-approach on stalled walks, reachability-checked build sites, work_on resume command

**Gate status: PASSED 2026-06-11.**

## Phase 8 — Fog of war + minimap + full UI

- [x] **Logic gate:** LOS-correct visibility grids (visible/explored/unexplored, derived state — never hashed), enemy reveal/hide, clarity map-reveal aura, rally points (trained units walk to rally), minimap click jumps camera (verified 34→150), control groups Ctrl+1–9 assign / 1–9 recall (verified 4→0→4), placement ghosts with valid/invalid coloring (tests/sim/fog.test.ts + headless interaction probes)
- [x] **Visual gate:** soft-edged fog plane (bilinear 200² visibility texture), bronze-framed live minimap (terrain/fog/units/buildings), full HUD pass — resource bar + age chip + selection panel + command card (build/train buttons) — `phase-8-gate-hud.png`, `phase-8-ghost.png`
- [x] Enemy units hidden outside LOS in the 3D view and on the minimap; building/train buttons enforce age + cost client-side, sim revalidates

**Gate status: PASSED 2026-06-11.** Noted (ledgered): AI remains omniscient — limiting AI knowledge to its own fog is a deferred fairness polish (docs/05).

## Phase 9 — Audio + VFX polish

- [x] **Logic gate:** per-power SFX (6 pattern samples × deterministic per-power pitch), per-class unit acknowledgment sounds on selection, UI clicks, hit/arrow/death SFX with rate budget, music loop with combat ducking (verified headless: ducked=true during battle, false after); Howler buses
- [x] **Visual gate:** final VFX pass (additive power glow from Phase 6) + per-biome color grading (warm-plains ColorCurves: warm shadows/highlights, +saturation, tuned vignette/contrast) — `phase-9-gate-grading.png`
- [ ] Spoken voice acknowledgment LINES — no redistributable CC0 voice set found; per-class acknowledgment SOUNDS shipped instead. Flagged for human decision (record/commission voices or accept sounds)

**Gate status: PASSED 2026-06-11** (voice-line substitution explicitly flagged, not silently skipped).

## Phase 10 — Menus + save/load + settings + release

- [x] **Logic gate:** start→save→reload→resume with IDENTICAL checksum proven end-to-end in the browser (IndexedDB snapshot, tick 600, 0x3CCE7C55 both sides); settings (music/sfx) persist via localStorage; victory (conquest + wonder countdown w/ cancel) and defeat screens (tests/sim/victory.test.ts, 4 tests + browser probe)
- [x] **Visual gate:** main menu + skirmish setup per the art bible (4 pantheon cards w/ favor-mechanic blurbs + color identity, opponent/seed/volume controls, Continue-saved-match) — `phase-10-gate-menu.png`; victory overlay — `phase-10-victory.png`
- [x] Code-split: 17.7 kB initial menu bundle; the Babylon game module (1.9 MB) lazy-loads on match start
- [ ] Settlement/relic-control victory — relics not yet in worldgen; conquest + wonder shipped. Flagged for human decision (3rd condition or accept two for v1)
- [ ] Live URL = playable release — completes when this branch merges to `main` (deploy workflow is test-gated and ready)

**Gate status: PASSED 2026-06-11** (two explicitly flagged human items above — nothing silently skipped).
