# KICKOFF.md — Pantheons: Age of the Reforged Gods

> **This file is the build charter and single source of authority for this repository.**
> Claude Code: read this file in full at the start of every session. Where any other
> document conflicts with this file, this file wins. Where this file is silent,
> docs/00–06 win. Code is never the source of truth for game balance — `data/*.json` is.

-----

## 1. MISSION

Build a **complete, browser-playable, single-player real-time strategy game** in the
mold of Age of Mythology, with **original renamed/remixed mythologies** (no Microsoft
IP — original names, original art, mechanically inspired only).

Full scope, no vertical slice:

- 4 original blended pantheons, each with 3 major gods and minor-god choices per age
- Full tech trees, 4-age progression (Archaic → Classical → Heroic → Mythic)
- Economy: food / wood / gold / favor, with a **unique favor mechanic per pantheon**
- Human / hero / myth three-way unit class triangle + hack/pierce/crush/divine counters
- God powers (reusable, ramping favor cost), myth units, heroes
- Buildings, walls, towers, wonders; random map generation; fog of war
- A real AI opponent (3 difficulties) that booms, ages up, attacks, defends, casts powers
- Victory conditions: conquest, wonder countdown, settlement/relic control
- Full UI (HUD, minimap, control groups, rally points, placement ghosts)
- Audio, VFX, menus, settings, save/load
- **Deployed to a public URL** (GitHub Pages via Actions) — playable by anyone with a link

Single-player only in v1. Architect clean seams for future lockstep multiplayer
(deterministic sim + command queue), but build zero multiplayer code.

-----

## 2. TECH STACK (LOCKED — never change without an explicit human decision)

|Layer      |Choice                                              |Notes                                                |
|-----------|----------------------------------------------------|-----------------------------------------------------|
|Language   |TypeScript (strict)                                 |`"strict": true`, no `any` in `src/sim/`             |
|Build      |Vite                                                |Static output, fast HMR                              |
|Rendering  |**Babylon.js** (WebGPU, WebGL2 fallback)            |Instancing for units; Babylon Inspector for profiling|
|ECS        |**bitECS**                                          |SoA, Float32Array-backed components                  |
|Simulation |Deterministic, fixed timestep **15 Hz**             |See §3. Render interpolates to 60fps                 |
|Pathfinding|Hierarchical A* (sector portals) + flow fields + RVO|Runs in a **Web Worker**                             |
|AI opponent|Petra-style HQ + queueManager + defenseManager      |Runs in a **Web Worker**, throttled tick             |
|Audio      |Howler.js                                           |                                                     |
|Persistence|IndexedDB (serialized sim state)                    |                                                     |
|Tests      |Vitest                                              |Headless sim tests + determinism checksums in CI     |
|Hosting    |**GitHub Pages via GitHub Actions**                 |Auto-deploy on push to `main` from Phase 0 onward    |

-----

## 3. DETERMINISM RULES (non-negotiable — enforce via `.claude/hooks/`, not prose)

1. All simulation logic is quarantined in `src/sim/`. `src/sim/` **must not import**
   from `src/render/`, `src/ui/`, Babylon, or the DOM. A hook rejects violating commits.
1. **No `Math.random` anywhere in sim.** Only the seeded deterministic PRNG.
1. **No floats in sim state.** Fixed-point integers (e.g., position in millitiles,
   HP ×100). Floats are allowed only in the render/UI layer.
1. Same `{seed + ordered command list}` ⇒ **identical state checksum** after N ticks.
   A test proves this at **every** phase gate.
1. All player and AI actions enter the sim only through the **command queue**.
1. Save/load = serialize/deserialize sim state; reload must produce a checksum-equal sim.

-----

## 4. VISUAL QUALITY BAR (graphics are a gated requirement, not polish)

Target: **a cohesive stylized-low-poly 3D look that reads like a modern remaster** —
AoM’s silhouette language, readability, and color identity, rendered with 2026-era
lighting. Do not chase 2002 pixel-parity; beat it.

**3D scene (Babylon):**

- PBR materials throughout; one directional sun + hemispheric ambient; cascaded shadow maps.
- `DefaultRenderingPipeline`: bloom (god powers must *glow*), FXAA or TAA, SSAO2,
  tone mapping + subtle color grading per-map-biome.
- Terrain: multi-texture splatting (grass/dirt/sand/rock/snow) with normal maps from
  ambientCG; gentle vertex-color tinting for biome variation.
- Water: reflective/refractive animated water material (rivers, shores, fishing zones).
- Units: rigged GLTF (KayKit/Quaternius/Kenney) with animation blending
  (idle/walk/attack/gather/death); **team-color tinting via shader mask**.
- VFX: GPU particle systems — lightning forks, meteor fire trails + impact decals,
  tornado funnels, healing motes, hit sparks, building-destruction debris + dust.
- Buildings: construction-progress visual states (scaffold → partial → complete);
  damage states (smoke at <50%, fire at <25%).

**UI (HTML/CSS over the canvas — this is where CSS does wonders):**

- Aged-bronze/parchment HUD aesthetic: resource bar, age indicator, selection panel,
  command card, minimap frame — all CSS, GPU-accelerated transitions.
- God portrait cards (age-up choice screen) with hover glow and pantheon color identity.
- Fonts via Google Fonts (display font with classical character for headers, e.g.,
  Cinzel; clean sans for body). No default browser fonts anywhere.
- Smooth micro-interactions: button presses, panel slide-ins, favor-counter pulse on gain.

**Visual gates:** every phase gate below includes a screenshot checkpoint. If a phase’s
visuals look like a programmer-art prototype, the gate **fails** even if logic passes.

-----

## 5. DOCUMENTATION SYSTEM (Claude Code generates these in Phase 0)

```
CLAUDE.md                        # Lean (<200 lines): hard rules, build/test commands, doc map
docs/00-VISION.md                # Pillars, scope, definition of done, non-goals (no MP in v1)
docs/01-GAME-DESIGN-DOCUMENT.md  # Full pantheons, units, buildings, techs, powers, victory
docs/02-TECHNICAL-ARCHITECTURE.md# Babylon+bitECS layering, folder map, determinism, workers
docs/03-ART-AUDIO-BIBLE.md       # Style guide, CC0 sources, naming/atlas conventions, ATTRIBUTION
docs/04-IMPLEMENTATION-ROADMAP.md# The 11 phases below, with live checkbox status per gate
docs/05-AI-OPPONENT-SPEC.md      # HQ/queue/defense design, build orders, difficulty knobs
docs/06-TESTING-STRATEGY.md      # Unit/headless/determinism/perf tests, CI gates
docs/07-SKILLS-LEDGER.md         # Append-only ledger: skills vendored, used, authored (§11)
data/units.json                  # SOURCE OF TRUTH: HP, attacks, armor %, multipliers, cost, pop
data/buildings.json
data/techs.json
data/godpowers.json
data/pantheons.json              # gods, favor-mechanic params, age unlock tables
data/maps/                       # random-map generation configs
.claude/hooks/                   # determinism enforcement, no-secrets, sim-import guard
.claude/commands/                # /phase-gate, /determinism-test, /balance-check
.claude/skills/                  # VENDORED copies of all skills used + skills AUTHORED in-repo (§11)
src/sim/  src/render/  src/ai/  src/pathfinding/  src/ui/  src/platform/
```

-----

## 6. GAME DESIGN SUMMARY (expand fully into docs/01)

**Resources:** food, wood, gold, favor. Favor is never tradeable. Market trades the
other three.

**Ages & age-up costs:** Classical 400 food (+Temple built); Heroic 800 food + 500 gold
(+Armory); Mythic 1000 food + 1000 gold (+Market). Each age-up presents a **choice of 2
minor gods** from the chosen major god’s pool; each minor god grants myth units, techs,
and a god power.

**Combat:** damage types hack/pierce/crush/**divine** (divine ignores armor). Armor =
percentage damage reduction; armor upgrades reduce *vulnerability*. Counter triangle:
infantry → beaten by archers → beaten by cavalry → beaten by infantry. Siege deals
crush (buildings ~5% crush armor; units 99%). Hard counters are **multipliers in
units.json** (anti-cavalry spear ×3 vs cavalry; anti-archer skirmisher ×4 vs archers).
Three-way class triangle: human soldiers ⟷ **myth units** (strong vs humans) ⟷
**heroes** (~2× vs myth, immune to myth special attacks).

**God powers:** reusable; first cast free, then a favor cost that **ramps each cast**.

**Buildings:** Town Center (15 pop, age-up here), Houses (+10 pop, cap ~10), Temple
(favor + myth units), barracks/range/stable analogs, towers/walls, Fortress-type,
Market (trade + caravans), Wonder.

**Victory:** conquest (default), wonder countdown, settlement/relic control.

### The Four Pantheons (all names original — expand each into full rosters in docs/01)

**1. THE AURYAN DAWN** *(solar/order)*

- Favor — **Devotion Pyres**: up to 5 escalating Sun-Altars radiate favor passively;
  a Radiant hero can kindle one for a temporary boost.
- Majors: **Suryan**, **Khorath**, **Vaishtar**.
- Myth units: Sunhawk; Sandlion (tornado breath); Emberbull; Ashen Phoenix (resurrects once).
- Powers: Solar Lance; Golden Flood (food income); Pyre Storm; Risen Champion.

**2. THE VERDANT DEEP** *(water/storm/nature)*

- Favor — **Tidal Oracles**: stationary Tide-Seers generate favor scaling with
  line-of-sight radius; overlapping radii don’t stack.
- Majors: **Varendra**, **Oyandi**, **Oshara**.
- Myth units: Rivermaw (grows heads on kills); Stormserpent; Coral Golem;
  Deepcaller Naiad (ranged petrify).
- Powers: Lure of Tides; Floodsurge; Maelstrom; Cleansing Rain.

**3. THE ASHEN FORGE** *(fire/earth/craft/war)*

- Favor — **Forge-Wrath**: favor earned from combat damage dealt; a Forgeborn hero
  trickles favor passively and doubles combat favor when upgraded.
- Majors: **Ogarun**, **Shangor**, **Drauvik**.
- Myth units: Cyclorn (throws enemies); Forgehound; Thunder Jotun; Bronze Colossus
  (consumes trees/gold to heal).
- Powers: Vajra Bolt; Flaming Weapons; Forge-Quake; Call of the Last War
  (villagers → heroes).

**4. THE STORM CONCORD** *(sky/heavens/trickster)*

- Favor — **Skyward Chants**: villagers pray at Sky-Temples with diminishing returns.
- Majors: **Indravan**, **Vayuna**, **Eshura**.
- Myth units: Garuhawk; Wind Djinn (spread damage); Stonegaze Naga (petrify);
  Sky Manticore.
- Powers: Sovereign Bolt; Trickster’s Gift (convert enemy unit); Tempest; Clarity
  (map vision).

-----

## 7. BALANCE ANCHORS (seed `data/units.json` from these; tune from here, never mix versions)

- Villager: 65 HP · 50 food · ~14s train · hunt ~1 food/sec
- Base infantry (hoplite-analog): 115 HP · 8 hack · armor 35% hack / 15% pierce / 99% crush · speed 4.2 · 2 pop · 50f+40g · 14s
- Base archer (toxotes-analog): 60 HP · 6.5 pierce · 55w+25g · 2 pop · 15s
- Base cavalry (hippikon-analog): 150 HP · 10 hack (×1.25 vs archers) · 40f+80g · 3 pop · 20s
- Example myth unit (minotaur-analog): 300 HP · 15 hack + 10 crush (×3 vs myth) · 200f+16 favor · 4 pop · 20s
- Population cap 300. Start: 4 villagers + 1 scout.
- Favor calibration mirrors: prayer-style first villager ~6 favor/min with diminishing
  returns; monument-style ~28.6 favor/min with all 5 built.

-----

## 8. WORKFLOW RULES

1. **Plan mode first** for any non-trivial task. Present the plan; wait for approval.
1. **TDD** for all sim/combat/counter/determinism logic: write failing tests, commit
   them, implement to green. Never alter tests to pass.
1. **Phase by phase.** Do not start phase N+1 until phase N’s gate passes. Update
   checkbox status in docs/04 at every gate.
1. `src/sim/` stays free of rendering imports (hook-enforced). Profile at every gate.
1. Use subagents for research/parallel exploration; keep the main context clean.
1. **Deploy early, deploy always:** GitHub Actions deploys `main` to GitHub Pages from
   Phase 0. Every passed gate = a fresh public build at the live URL.
1. Commit at every green test suite; conventional commit messages; never commit secrets.

### Session protocol (multi-week build across many sessions)

- **Session 1:** human pastes the kickoff prompt; execute §10 FIRST ACTIONS; stop after Phase 0 report.
- **Every later session:** read `CLAUDE.md` + `docs/04-IMPLEMENTATION-ROADMAP.md`,
  report current phase + gate status + blockers, then continue. Stop at the gate.
- **Every session, both kinds:** vendor + log all skills used per §11; author new
  skills when the §11.3 evidence threshold is met.
- Never silently skip a failing gate. Report it and propose a fix plan.

-----

## 9. PHASE GATES (build in order; each gate must pass before the next phase)

|# |Phase                                                                                      |Gate (logic)                                                                                          |Gate (visual)                                                                         |
|--|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
|0 |Scaffold + deterministic loop + CI + Pages deploy. Generate ALL `data/*.json` from docs/01.|Empty sim: same-seed checksum identical after 10k ticks; Vitest green in CI; live URL serves the build|Lit PBR test scene at 60fps with bloom pipeline active                                |
|1 |Terrain + RTS camera                                                                       |Navigate a 200×200 heightmap at 60fps; pan/edge-scroll/zoom/rotate                                    |Splatted terrain w/ normal maps + water plane + shadows — screenshot                  |
|2 |Units + movement + pathfinding (worker)                                                    |200 units path to a shared destination without overlap at 60fps                                       |Animated rigged units w/ team colors; selection rings; marquee select — screenshot    |
|3 |Economy                                                                                    |Gather all 4 resources; build a house; pop cap rises; market trade works                              |Gather animations; drop-off visuals; resource bar HUD styled                          |
|4 |Combat + counters                                                                          |Headless tests: archers>infantry>cavalry>archers; damage math matches units.json exactly              |Projectiles, hit sparks, death animations                                             |
|5 |Buildings + production + ages                                                              |Advance Archaic→Mythic; each age unlocks per data files; tech research applies effects                |Construction states; CSS age-up panel with 2-god choice cards — screenshot            |
|6 |Gods + favor + powers + myth units                                                         |All 4 favor mechanics yield correct rates; powers cast w/ ramping cost; heroes counter myth           |Each god power has distinct particle VFX; favor UI per pantheon — screenshot          |
|7 |AI opponent (worker)                                                                       |AI builds eco, ages to Mythic, attacks, defends, casts powers; Easy/Med/Hard measurably differ        |AI armies move in formation; attack waves visible                                     |
|8 |Fog of war + minimap + full UI                                                             |LOS-correct reveal/hide; clickable minimap; control groups 1–9; rally points; placement ghosts        |Soft-edged fog; styled minimap frame; full HUD pass — screenshot                      |
|9 |Audio + VFX polish                                                                         |Powers have distinct SFX; unit acknowledgment lines; music loops with combat ducking                  |Final VFX pass; post-processing tuned per biome                                       |
|10|Menus + save/load + settings + release                                                     |Start→save→reload→resume with **identical checksum**; settings persist; victory/defeat screens        |Main menu + skirmish setup styled to the art bible; public URL is the playable release|

**Performance budget:** 60fps with 300 pop on a 2021+ laptop GPU. If Phase 2 can’t hold
60fps at 200 units after worker offload + flow fields, reduce match unit cap (e.g., 150)
— do not abandon true 3D.

-----

## 10. FIRST ACTIONS (Session 1 only)

1. Confirm understanding of this charter: summarize mission, stack, determinism rules,
   visual bar, skill-ledger duty, and phase list in ≤10 bullets. Wait for approval.
1. Scaffold: Vite + TS(strict) + Babylon + bitECS + Vitest; folder layout per §5;
   `.claude/hooks/` for determinism + no-secrets; GitHub Actions workflow for Pages.
1. Write `CLAUDE.md` and `docs/00–07`. Expand §6 into the full GDD (complete god
   rosters, tech trees, myth-unit rosters per pantheon, power lists with costs).
   Create `docs/07-SKILLS-LEDGER.md` seeded with the §11.2 provenance rows; vendor
   any skills consulted this session into `.claude/skills/` per §11.1; mirror the
   §11 duties in `CLAUDE.md` so they survive context compaction.
1. Generate all `data/*.json` stat tables from the GDD, seeded from §7 anchors.
1. Implement Phase 0 with TDD; prove the determinism checksum gate; deploy to Pages.
1. **STOP.** Report Phase 0 status, the live URL, skills used this session, and the
   Phase 1 plan. Await approval.

-----

## 11. SKILL LIBRARY: VENDOR, TRACK, AND AUTHOR (mandatory, every session)

This repository is **self-contained and self-improving** with respect to skills. The
Claude Code instance building this game must (a) keep a local copy of every skill it
uses, (b) log every use transparently, and (c) **write new skills** when the build
produces sufficient evidence that a reusable pattern exists.

### 11.1 Vendor a local copy of every skill used

- The moment any skill is consulted or invoked — project, personal (`~/.claude/skills/`),
  plugin, or marketplace — copy its full folder (SKILL.md + supporting files) into
  **`.claude/skills/<skill-name>/`** in this repo, preserving content verbatim.
- Add an origin header block to the vendored copy: source path, date vendored,
  version/hash if available, license/origin note.
- If a vendored skill’s upstream copy changes later, re-vendor and note the delta in
  the ledger. The repo’s copy is the copy this project runs on — anyone cloning the
  repo gets the exact skill set that built the game.
- If a skill cannot be redistributed (license/proprietary), vendor a **stub**:
  SKILL.md containing name, origin, version, and a summary of what it does — never
  the restricted content — and mark it `[stub]` in the ledger.

### 11.2 The ledger: `docs/07-SKILLS-LEDGER.md` (create in Phase 0)

Append-only table, logged **at invocation time, not retroactively**:

```
| Date | Session/Phase | Skill name | Vendored path | Origin | Why invoked | What it contributed | Artifacts touched |
```

- Log “consulted, not applicable” outcomes too — negative results are transparency.
- Every **phase gate report** includes a “Skills used this phase” rollup plus a
  “Skill library delta” (newly vendored / newly authored / updated).
- Same skill, same purpose, same session → one row with a use-count; new purpose →
  new row.
- Seed two provenance rows in Phase 0 for the pre-repo design phase: Anthropic
  deep-research (architecture/pantheon research behind this charter) and a `docx`
  SKILL.md consultation (routing check; not applicable — output was plain markdown).

### 11.3 Author NEW skills when evidence justifies them

The build itself is a skill-generation engine. **Evidence threshold:** a pattern has
been solved ≥2–3 times in this repo, or a phase produced hard-won, non-obvious
knowledge (a debugging saga, a performance fix, an integration quirk) that a fresh
Claude instance would otherwise re-derive.

- When the threshold is met, draft the skill in `.claude/skills/<new-skill-name>/`
  following the standard SKILL.md format (frontmatter: name + trigger-rich
  description; body: the distilled procedure, pitfalls, and verification steps).
- Candidates this build is expected to surface (author when evidence exists, not
  preemptively): `deterministic-sim-testing` (fixed-point + checksum harness),
  `bitecs-babylon-bridge` (ECS↔render sync pattern), `rts-pathfinding-worker`
  (flow fields + RVO in a Web Worker), `babylon-rts-vfx` (god-power particle
  recipes), `balance-data-tuning` (units.json change → headless counter-test loop),
  `petra-style-ai` (HQ/queue/defense opponent pattern).
- Each authored skill gets a ledger row (`Origin = authored in-repo`) citing the
  evidence: which commits/phases/bugs justified it.
- **Use authored skills in later phases** — e.g., `deterministic-sim-testing`
  (authored ~Phase 0–2) should be invoked at every subsequent gate. Log those uses
  like any other skill. Refine the skill when reuse reveals gaps; ledger the update.
- Propose, don’t gold-plate: if evidence is thin, note the candidate in the ledger
  as “deferred — insufficient evidence” and move on.

### 11.4 Wiring

- Mirror the §11 duties in `CLAUDE.md` (survives context compaction).
- `.claude/skills/` is committed to git — never gitignored.
- Skill authoring follows the same workflow rules as code: plan-mode for non-trivial
  skills, committed with conventional messages.

-----

## 12. ASSET PIPELINE (full detail in docs/03)

- One cohesive stylized-low-poly direction. CC0-first: **Quaternius**, **KayKit**
  (Kay Lousberg), **Kenney.nl** for models/UI; **ambientCG** + **Poly Haven** for
  textures; **OpenGameArt/Freesound/Kenney** (CC0) + Kevin MacLeod (CC-BY, credit
  required) for audio. Maintain `ATTRIBUTION.md`.
- Shared texture-atlas convention; consistent scale (1 unit = 1 meter); GLTF only.
- Prove the GLTF→Babylon pipeline end-to-end with ONE animated character + ONE terrain
  texture in Phase 1–2 before any bulk import.
- Only if CC0 can’t cover the ~16 myth units: flag to the human for a Meshy/Tripo
  paid-tier decision (commercial license required). Never embed free-tier AI assets.

-----

*Charter version 1.0 — owner: Mahesh. Claude Code: when in doubt, ask; when gates
fail, report; when balance questions arise, change `data/*.json`, not code.*