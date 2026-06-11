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
