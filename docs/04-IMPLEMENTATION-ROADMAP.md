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


---

## Visual upgrade pass (post-Phase-10, target ≥8.5/10 per axis)

- [x] Distinct models for EVERY unit type: KayKit Barbarian/Mage/Rogue-Hooded/Skeletons + Quaternius Bull/Horse/Wolf/Stag/Donkey (all CC0) — cavalry ride horses, the Emberbull is a bull, all 16 myth units have unique silhouette × pantheon-tint × glow; lazy per-type pools (queued imports); team-solid cape/shield parts
- [x] World dressing: scatter rocks/stumps (seeded, clear of gameplay objects), low-frequency meadow variation in the splat map
- [x] Fog of war draped over the terrain mesh (floating-plane artifact gone)
- [x] Building damage states (charter §4): smoke <50% HP, fire <25% — mesh-based FX (ParticleSystem is dead on some GL stacks; see skill §11)
- [x] Real fletched arrow model for projectiles (KayKit, with glowing-bolt fallback)
- [x] Robustness: import queue + timed material re-specialization fix the per-session white-material race
- Captures: `v2-*` screenshots in docs/screenshots/

Verified: 111/111 tests green, sim purity clean, AI match runs 6 game-minutes headless with zero errors.

## Mobile + manual playtest pass (post-release hardening)

- [x] **Critical fix:** the Phase 3/4 demo script ran in EVERY game (menu-started matches included), commandeering the player's villagers, spending their resources, and spawning 12 free military units — demo is now opt-in via `?demo`
- [x] Click/tap selection forgiveness: slim GLB parts let exact-pixel rays slip between limbs; nearest-own-unit fallback within 14px (mouse) / 24px (touch); water plane made unpickable (it swallowed clicks near shores)
- [x] Responsive UI: portrait-phone menu (2×2 pantheon grid, stacked actions), landscape-phone menu + compact HUD (`max-height: 520px` query), loading overlay with spinner during the ~2MB game-chunk download
- [x] Touch controls: one-finger pan (camera-space, zoom-scaled), two-finger pinch zoom, tap-select
- [x] Gameplay is landscape-only on phones: full-screen "Rotate your device" overlay in portrait (`orientation: portrait` + `pointer: coarse`); desktop windows unaffected
- [x] White-material guard extended: per-pool-load remat passes (skill §12)
- Manually play-tested headless (desktop 1280×720 + phone 844×390/390×844): menu→boot, click-select, marquee, move/gather orders, TC select, train villager, rally point, build placement + completion, minimap pan, save button, touch pan/pinch/tap — all verified, zero console errors

Verified: 111/111 tests green, sim purity clean, build clean.

## Gap-fix pass (post-AoM-audit)

Closed every "unreachable" finding from the AoM capability audit except garrisoning:

- [x] Defensive buildings fire (TC/tower/fortress, data-driven; tick-phase cooldown — no new serialized state)
- [x] God-power casting UI (HUD bar: cost/cooldown per power, click-to-arm, click-map-to-cast)
- [x] Buildable fortress/walls/gates/wonder + per-pantheon favor buildings; ram/catapult trainable
- [x] Stances (aggressive/hold/passive), villager repair, caravan trade routes, wild-game hunting, rally-onto-resource auto-task, hero heal aura
- [x] Production queue UI with cancel+refund; building tech-research buttons; major-god menu choice (shapes minor pools)
- [x] Idle-villager finder, minimap attack pings, pause + 2× speed, end-of-match stats; AI builds a wonder at Mythic
- [ ] Descoped, still missing: garrison, myth-unit specials, formations, naval, herdables, settlements, relics, campaign, MP

Verified: 123/123 tests (10 new TDD tests in tests/sim/gaps.test.ts), sim purity clean, full end-to-end
playthrough re-run with all systems live — conquest victory at game-minute 27 vs the easy AI (defensive
fire makes sieges realistically slower than the pre-fix 16-minute win).


## Rounds 4–5 (finish-it-entirely pass)

- [x] Naval complete: fishing, war galleys, transport barges + amphibious ops (drowning on sink), coastal docks, AI navies
- [x] Campaign "The Reforging": 6 missions, story interludes, 4 objective types, sequential unlock, saved progress
- [x] Mythic-tongue procedural voice lines (per-pantheon dialects) + wind/birds/shore ambience + death animations
- [x] 3-player FFA, herd wander/capture, menders, attack-move, patrol UI, gate toggles, battle order, chain-bolt/consume/stun myth actives, replays, stats graph, 3 map types, 5 difficulties, live in-game settings, richer major passives, tier display names
- [x] Automated balance gate (tests/balance): hard dominates easiest, real combat, all pantheons viable
- [x] CRITICAL: removed game.ts module-level auto-boot that ran a hidden second sim + render loop behind every menu match

Verified: 153/153 tests, purity clean, headless smoke of every new control path.


## Manual play-matrix (round 6): 10 full matches, human-side vs live AI

| Cell | Mode | Difficulty | Map | Pantheon | Result | Game min |
|------|------|-----------|-----|----------|--------|----------|
| 0 | 1v1 | easiest | island | ashen_forge | **WIN** | 16 |
| 1 | 1v1 | easy | inland | verdant_deep | loss | 16 |
| 2 | 1v1 | medium | island | auryan_dawn | loss | 20 |
| 3 | 1v1 | hard | archipelago | storm_concord | loss | 10 |
| 4 | 1v1 | titan | island | ashen_forge | loss | 11 |
| 5 | FFA | easiest | inland | storm_concord | **WIN** | 28 |
| 6 | FFA | easy | island | auryan_dawn | loss | 33 |
| 7 | FFA | medium | island | verdant_deep | loss | 23 |
| 8 | FFA | hard | inland | ashen_forge | loss | 15 |
| 9 | FFA | titan | island | storm_concord | loss | 19 |

Scripted-average-player baseline: beats easiest in both modes, loses upward — the
difficulty gradient is monotone (harder AIs end the game faster). Zero invariant
violations across all 10 matches (resources finite/non-negative, ships afloat,
garrison maps consistent, herds leashed, no hangs); all AIs verified active by
minute 6 in every match.

**Bugs captured by playing (all fixed, TDD):**
- Inland/Archipelago map types crashed boot — partial terrain config missing octaves
  (the map-type menu options had never actually been played off-island)
- Auto-sited docks could be founded inland; ships then spawned on grass
- The round-5 "ships launch onto water" patch had silently targeted the wrong file
- Google Fonts CDN dependency (now self-hosted via fontsource)
- Matrix-runner corrections: age-up requires a minor-god pick; AI liveness judged
  mid-game, not from post-defeat rubble

Runner: `scripts/play-matrix.mjs` (committed, reusable for future regressions).


## Discovery round (round 7): strategy sweep + campaign + soak + 11 probes

18 additional played matches (8 strategy-diverse + campaign attempts + soaks) and
three probe batches. Confirmed findings cataloged below — documented as it.fails
tests in tests/probes/ where sim-reproducible; FIXES PENDING (list-first round).

| # | Finding | Class | Evidence |
|---|---------|-------|----------|
| F1 | Defected herds keep feeding their old owner (ownership checked only at order time) | sim bug | probe P3 (it.fails) |
| F2 | Boats ordered to open water sail to the nearest beach (move targets snap to land) | sim bug | probe P4 (it.fails) |
| F3 | Population cap overflows via queued training (cap checked at queue, not completion) | sim bug | probe P6 (it.fails) |
| F4 | Closing a gate traps units standing on it inside an impassable tile | sim bug | probe P7 (it.fails) |
| F5 | One archipelago seed produced a fully inactive AI (starts look resourced — suspect reachability) | worldgen/AI | matrix cell 17 |
| F6 | The AI never crosses water — no transport usage; split-island maps are human-invasion-only | AI gap | cells 16/17 |
| F7 | Scripted naval invasion stalled in real-match conditions (barge flow never launched) | needs trace | cell 16 |
| F8 | Campaign missions hard-stall the economy ~min 10; identical params via direct boot WIN @15 | campaign bug | M1 ×2 vs cell 18 |
| F9 | Difficulty curve steep: only *easiest* beatable by an average scripted player, all strategies | balance | 18 matches |
| F10 | Titan AI never reaches Mythic even unopposed (hard does in 22 min) — synthesized knobs regress development | AI/data bug | probe P11 (it.fails) |
| F11 | Material count grows unbounded under sustained combat (+~2.5/min); wall-time degraded 40× in headless soak | render leak | soak v3 |
| F12 | Saving mid-campaign-mission drops the mission — Continue resumes as objective-less skirmish | design gap | code-read |
| F13 | Corpse visuals accumulate when frame rate is very low (cleanup is frame-driven) | render edge | soak v3 |
| F14 | Browser replay round-trip (record → download → watch) never verified end-to-end | untested path | — |

Clean under stress: kitchen-sink save/load lockstep, no dangling town-center refs,
out-of-bounds power casts harmless, ungarrison placement, player wonder victory,
archipelago start resourcing across 6 seeds, rush/boom/turtle matches with zero
invariant violations, heap flat across all soaks.

## Fix round (round 8): all round-7 findings closed

Every F1–F14 finding fixed (or root-caused to the test driver) plus F15, found
while triaging: the balance gate's 90s/180s wall-clock timeouts fired under
background CPU load — raised to 300s/600s (assertions are tick-based).

| # | Resolution | Verified by |
|---|-----------|-------------|
| F1 | Gather phases validate herd ownership every tick; retarget + rally skip foreign herds | P3 enforcing |
| F2 | Move targets split by domain (naval→water, land→ground); naval axis-slide coast steering | P4 enforcing |
| F3 | Pop gate re-checked at training COMPLETION; finished units hold in queue until room | P6 enforcing |
| F4 | Gate close nudges occupants to open ground (same nudge as construction) | P7 enforcing |
| F5 | Root cause: TC placed in a 19-tile terrain pocket — starts now require a ≥150-tile connected region (bounded flood-fill) | gaps7 F5 test |
| F6 | AI naval invasions: BFS land-reachability → train barge → board → sail → unload → attack-move | gaps7 invasion test + browser (medium AI sank a passive player min 15) |
| F7 | Root cause was DATA: dock trains listed only fishing_boat — war-galley/transport orders silently dropped for everyone | dock trains fixed; naval cells re-run (macro still times out on archipelago economy — driver skill, all orders now accepted) |
| F8 | Root cause was the CAMPAIGN TEST DRIVER: it re-issued a new house site every pulse (10 sites, one builder ping-ponging, popCap frozen 25) — matrix macro's under-construction guard added to the campaign macro; mission plumbing itself verified sound. Also fixed: campaign macro omitted the mandatory minor-god pick on heroic/mythic age-ups | instrumented M1 trace; full campaign playthrough |
| F9 | New data knob firstWaveMin (25/12/9/6/5) + softer easy/medium economy | browser: easy WIN@18, medium WIN@14, hard legitimate LOSS |
| F10 | Re-verified post-fixes: titan (and hard) WIN by conquest at min ~10 — the probe's 35-min Mythic wait was the match ending first; P11 rewritten to enforce win-or-Mythic | P11 enforcing |
| F11 | Root cause split: live-loop FX disposal was already correct; headless __step never aged FX (visuals accumulated forever — the soak's growth was largely this measurement artifact). __step now ages combatFx/powerFx by simulated time | soak re-run |
| F12 | Saves carry {aogrSave, mission, sim} envelope; mid-mission saves resume as the mission (legacy raw snapshots still load) | code + suite |
| F13 | Corpse sink wall-time-driven; corpse pool capped at 120 | soak re-run |
| F14 | scripts/verify-replay.mjs: record 4 game-min vs medium AI headlessly, feed the file through the real menu path, final checksums equal (4260508905, 46 command batches) | ✔ lockstep verified |
| F15 | Balance-gate timeouts 300s/600s | suite stable |

Also fixed while verifying: ship deaths crashed the GLB death-pose loader
(PROC_BOAT), transport_barge had no hull model (rendered as the caravan donkey),
depleted-then-regrown nodes (herds/fish) stayed invisible.

Suite after the round: **169 passed, 0 expected-fail** — every discovery probe now
enforces its fix.
