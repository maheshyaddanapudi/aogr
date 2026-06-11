---
name: babylon-integration-pitfalls
description: Checklist of Babylon.js tree-shaking, shader, and headless-testing traps for this repo. Consult whenever adding a Babylon feature (post-processing, picking, shadows, materials-library materials, custom meshes) or when a mesh renders black/invisible, an effect fails to compile, scene.pick returns nothing, or headless Playwright behavior contradicts the fps counter.
---

# Babylon.js integration pitfalls (earned in Phases 0–1)

## 1. Tree-shaken side-effect imports (hit 3×: Phase 0 ×2, Phase 1 ×1)

`@babylonjs/core/...` granular imports fail AT RUNTIME (not compile time) without
their side-effect registrations:

| Feature | Required side-effect import | Failure mode |
|---|---|---|
| DefaultRenderingPipeline | `@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent` | "…is not a constructor" |
| `createInstance()` | `@babylonjs/core/Meshes/instancedMesh` | "InstancedMesh needs to be imported before" — thrown mid-frame, kills the rAF loop |
| `scene.pick()` | `@babylonjs/core/Culling/ray` | **silently** returns no hit |
| Shadows | `@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent` | shadows never appear |
| SSAO2 | prePass + geometryBuffer scene components | pipeline ctor throws |
| GLTF loading | `@babylonjs/loaders/glTF` | "no loader for .glb" |

**Procedure:** when adding a Babylon feature, search its Babylon source for
`RegisterClass`/SceneComponent registration and import that module for side
effects in `src/render/scene.ts`.

## 2. SSAO2 + Standard-family materials (TerrainMaterial, WaterMaterial…)

SSAO2's default **PREPASS** path injects defines that fail to compile for
StandardMaterial-family shaders on strict GLSL stacks (SwiftShader/ANGLE):
`VERTEX SHADER ERROR: '<' : syntax error`. Fix: construct with
`new SSAO2RenderingPipeline(name, scene, ratio, cameras, /*forceGeometryBuffer*/ true)`.

## 3. Custom mesh winding (Phase 1 terrain invisible)

Babylon is left-handed; front faces are counter-clockwise as seen from the
front. For a ground grid with rows along +z, the correct triangles are
`(i, i+1, i+verts)` and `(i+1, i+verts+1, i+verts)`. The reversed order makes
`ComputeNormals` point DOWN → mesh is back-face-culled (invisible) or lit black.
**Verify:** read back `getVerticesData("normal")` — y must be ≈ +1 on flat areas.

## 4. RawTexture formats

Use `TEXTUREFORMAT_RGBA` — plain RGB raw textures are unreliable on WebGL2.

## 5. Headless gate testing (SwiftShader)

- Software rendering of a full scene runs ~2 fps; `engine.getFps()` still
  reports ~60. **Never** judge perf or per-frame input handling by wall-clock in
  headless — assert per-frame deltas (e.g., camera moved by exactly
  `speed × framesRendered`).
- In-page probes must NOT `import('/node_modules/@babylonjs/core/...')` — that
  creates a second Babylon instance with its own ShaderStore and produces fake
  shader-compile failures. Probe only through `window.__scene` instance methods.
- Visual gates: build + `vite preview`, screenshot via Playwright Chromium with
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

## 6. Vite dev-server dep re-optimization

Installing a new dependency mid-session invalidates `.vite/deps` hashed URLs —
in-flight pages mass-fail module requests. Restart `vite` (optionally `--force`)
after any `npm install`, and prefer testing the production build via preview.

## 7. Headless gate-capture recipe (added Phase 2)

Composition races make naive Playwright captures lie: the rAF loop keeps
ticking the sim (armies march away mid-screenshot) while frames render at
seconds-per-frame. The reliable pattern:

1. Expose `window.__forceFrame = () => { refreshViews(); renderer.update(...); scene.render(); }`
   and a `?nomarch`-style flag to freeze scripted scenarios.
2. In ONE `evaluate`: position the camera, then `__forceFrame()` twice.
3. Drive input (marquee drags etc.) with Playwright mouse, `__forceFrame()`,
   THEN screenshot (`timeout: 120000` — SwiftShader frames are slow).
4. Assert counts via probes (`window.__sim`, selection sets, mesh visibility),
   never by eyeballing alone — and remember elapsed wall-time advances the sim.

## 8. Skinned crowds (added Phase 2)

InstancedMesh of a skinned mesh shares the source's skeleton + animation —
one pool per (animation × team), instances swap pools by visibility toggle.
Asset packs ship VARIANT submeshes in one GLB (4 shields, 3 swords…): filter
by name allowlist or every unit renders the whole armory (30 → 9 meshes/unit).
Capture the GLTF material's `albedoTexture` BEFORE overriding materials.

## 9. Asset vendoring + headless fast-forward (added Phase 3)

- gltf (non-GLB) files reference textures by relative URI — vendor the texture
  file BESIDE the .gltf/.bin pair or loads throw (and may kill boot).
- Anything added to `public/` needs `npm run build` before `vite preview`
  shows it — a stale dist 404s as an HTML blob that fails image decode.
- For sim-time-dependent gate captures, expose `window.__step(n)` that runs
  `stepSim` synchronously n times — never wait wall-clock for rAF-throttled
  sim progress.

## 10. Async shader compile vs single-frame captures (added Phase 4)

Materials/effects compile ASYNC (KHR_parallel_shader_compile): the first
render after creating a mesh with a never-rendered material SKIPS it from
active meshes. In paused capture mode (one render per `__forceFrame`), new
visuals are invisible. Recipe: render 3–5 times with ~250ms sleeps after
creating new visual types, THEN capture. Also: the rAF loop races slow
captures — a single background frame with multi-second dt disposes
short-lived FX before the screenshot compositor runs. Use `?paused` (never
start the loop) for ALL gate captures with transient FX.


## 11. White-material syndrome + dead ParticleSystems (added visual-upgrade pass)

- **Frozen-defines texture race:** a material's effect can compile BEFORE its
  texture finishes decoding and never re-specialize — mesh renders flat white
  while `material.isReady()`, `texture.isReady()`, and `loadingError:false`
  all look healthy. Per-session random. Fix: re-mark materials dirty a few
  times after boot (`material.markAsDirty(63)` at ~1.5s/4s/9s/16s) — cheap,
  no-op when already specialized. Also serialize concurrent GLB imports
  through a promise queue (parallel imports aggravate the race).
- **ParticleSystem emits nothing** on this GL stack (`getActiveCount()===0`
  forever, started + positioned correctly). All gameplay-critical FX must be
  MESH-based (emissive spheres/tori/cylinders, optional ALPHA_ADD) — the
  powerFx pattern. Keep particles only as progressive enhancement.
- Quaternius animal gltf files color via per-part MATERIALS (no textures):
  tint by CLONING each part's own material and multiplying albedo — replacing
  materials wholesale turns the model white.
- Billboarded textured quads can corrupt the frame on this stack; avoid for
  required visuals.

## 12. Picking pitfalls + per-pool remat (added mobile/playtest pass)

- **`scene.pickWithRay` needs a real `Ray` instance.** Passing a plain
  `{origin, direction, length}` object returns garbage intersections (points
  far outside the mesh's own bounding box) instead of throwing. In page-side
  probes, grab classes off live objects (`cam.position.constructor` → Vector3,
  `scene.getTransformMatrix().constructor` → Matrix) or use `scene.pick(x, y)`.
- **Large alpha-blended planes swallow pick rays.** The water plane was
  pickable and ate clicks that grazed past slim units near shores. Any
  full-map decorative plane (water, fog drape) must set `isPickable = false`.
- **Slim GLB parts make exact-pixel picking unreliable.** KayKit/Quaternius
  body parts have tiny, sometimes zero-extent bounding boxes; a ray through a
  unit's screen position often slips between limbs. Click/tap selection needs
  screen-space forgiveness: if the ray misses, select the nearest own unit
  within ~14px (mouse) / ~24px (touch) using the same projection as the
  marquee.
- **Building `Position` is the footprint CENTER** (`tile*1000 + size*1000/2`),
  not the corner — aim probes and tests at `b.x, b.z` directly.
- **White-material syndrome recurs per lazy pool load.** Boot-timed remats
  (§11) miss GLB pools loaded later; schedule extra `markAsDirty(63)` passes
  ~0.4s/2.5s after EACH pool import completes. Sessions can stay white even
  after manual remat under SwiftShader — never seen on real GPUs; verify
  questionable captures in a plain (non-touch-emulated) context before
  blaming the renderer, and never ship `engine.releaseEffects()` as a "fix"
  (async recompile leaves the scene black in paused captures).
