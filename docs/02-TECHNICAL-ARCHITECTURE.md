# 02 — TECHNICAL ARCHITECTURE

## Layering (the one diagram that matters)

```
            commands in                state out (read-only)
 UI/input ──────────────▶ ┌──────────┐ ──────────────▶ render (Babylon, 60fps interp)
 AI worker ─────────────▶ │ src/sim/ │ ──────────────▶ HUD (DOM/CSS)
 (future net peers) ────▶ │  15 Hz   │ ──────────────▶ checksum / save
                          └──────────┘
```

- **`src/sim/`** — deterministic core. bitECS world + integer-only state. No imports
  from render/UI/Babylon/DOM/Howler, no `Math.random`, no wall-clock
  (hook + CI + test enforced by `scripts/check-sim-purity.mjs`).
- **`src/render/`** — Babylon scene (WebGPU, WebGL2 fallback). Reads sim state every
  frame, interpolates positions between ticks. Owns all floats, materials, particles.
- **`src/ui/`** — DOM/CSS HUD over the canvas (bronze/parchment; Cinzel + Alegreya Sans).
- **`src/platform/`** — fixed-timestep loop, browser glue, worker spawning, IndexedDB.
- **`src/pathfinding/`** *(Phase 2)* — hierarchical A* + flow fields + RVO in a Web
  Worker. Deterministic: the worker computes *plans* from sim-snapshot inputs; results
  re-enter the sim as data on a known tick (request/response keyed to tick numbers).
- **`src/ai/`** *(Phase 7)* — Petra-style HQ in a Web Worker; emits only Commands.

## Determinism contract

- Fixed timestep **15 Hz** (`TICK_RATE`); render interpolates with an accumulator
  (`src/platform/loop.ts`, frame delta clamped at 250ms).
- State = bitECS component arrays (Int32Array) + tick + PRNG state + (later) resource
  stocks/tech flags. **Fixed-point:** positions in millitiles (`FP_ONE=1000`),
  HP/damage ×100, truncate-toward-zero math (`src/sim/fixed.ts`).
- PRNG: mulberry32 (`src/sim/prng.ts`), single u32 state, serialized in saves.
- Checksum: FNV-1a 32-bit over tick + PRNG + component lanes in ascending-entity
  order; **entity ids are not hashed** so a deserialized sim checksums equal.
- Commands: `CommandQueue.enqueue(tick, cmd)` → `drain(tick)` sorted by
  `(playerId, seq)` — arrival timing never affects order.
- Save/load: JSON snapshot (seed, tick, prngState, entities) → IndexedDB (Phase 10).
  Round-trip must be checksum-equal and stay in lockstep (already tested).

## bitECS 0.4 facts (hard-won, do not rediscover)

- npm `bitecs@0.4.0` ships the **new API**: no `defineComponent`/`Types`. Components
  are user-owned SoA stores; `addComponent(world, eid, store)`; `query(world, [stores])`.
- Entity ids start at 1 and are per-world, **but stores are whatever you make them** —
  we create stores per sim instance (`createStores()`) so parallel sims (tests,
  replays, lockstep verify) never share memory.
- Entity removal recycles ids — when removal lands (Phase 4 deaths), snapshot
  serialization must be revisited (currently relies on no removals; noted seam).

## Babylon facts

- Tree-shaken `@babylonjs/core/...` imports require explicit **side-effect imports**:
  `postProcessRenderPipelineManagerSceneComponent` (for DefaultRenderingPipeline),
  `Meshes/instancedMesh`, `Lights/Shadows/shadowGeneratorSceneComponent`,
  prePass/geometryBuffer components (for SSAO2). Missing ones fail at runtime, not
  compile time.
- Engine: try `WebGPUEngine.IsSupportedAsync`, fall back to `Engine` (WebGL2).
- Post pipeline: `DefaultRenderingPipeline` (bloom on, FXAA, ACES tone mapping,
  vignette) + `SSAO2RenderingPipeline` in try/catch (WebGL1 lacks it).
- Bundle is ~1.7 MB minified — code-split before Phase 10 (dynamic import the engine).

## Workers (Phases 2 & 7 seams)

Workers never own truth. Pathfinding worker: sim posts {tick, grid delta, requests},
worker returns {tick, paths/flow fields}; sim applies results on receipt-tick,
deterministically. AI worker: receives throttled sim snapshots, returns Commands via
the same queue as the human player. A stalled worker delays decisions, never forks state.

## Repository layout

Per KICKOFF §5. Tests in `tests/` (Vitest, node env). CI (`.github/workflows/ci.yml`):
purity guard → tests → typecheck+build on every push/PR. Deploy
(`deploy.yml`): on `main`, gate (purity+tests) → build → GitHub Pages
(`vite.config.ts` base `/aogr/`). Visual gates: Playwright + SwiftShader headless
screenshots into `docs/screenshots/`.

## Phase 1 addenda (hard-won facts — full detail in .claude/skills/babylon-integration-pitfalls)

- `scene.pick` needs `import "@babylonjs/core/Culling/ray"` or it silently misses.
- SSAO2 must use `forceGeometryBuffer=true`; its prepass path breaks Standard-family shaders.
- Custom ground grids: triangles `(i, i+1, i+verts)` / `(i+1, i+verts+1, i+verts)` — reversed winding = downward normals = invisible mesh.
- RawTexture: always RGBA.
- Headless SwiftShader runs the full scene at ~2fps while `getFps()` claims 60 — assert per-frame deltas, never wall-clock behavior; probe only via `window.__scene` (importing core in-page creates a second Babylon instance with fake shader errors).
- Terrain textures: ambientCG 1K JPGs vendored in `public/textures/` (CC0, see ATTRIBUTION.md); Fox GLTF from Khronos sample models (CC0) proves the animation pipeline until KayKit units land in Phase 2.

## Determinism scope note (pre-multiplayer)

The sim is bit-deterministic over `{seed + ordered commands}` — that is the
replay/network contract, and `tests/sim/determinism.test.ts` enforces it.
A LIVE single-player match is *not* run-to-run reproducible from its seed
alone: the AI worker's decisions are injected on whatever tick the worker
answers, which varies with wall-clock scheduling. Replays are exact because
they record commands *with their ticks*. Lockstep multiplayer must therefore
ship AI decisions through the same tick-stamped command channel as human
input (already the case via CommandQueue) — never let a peer run its own
worker off-schedule.
