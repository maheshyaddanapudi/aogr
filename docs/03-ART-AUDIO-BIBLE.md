# 03 — ART & AUDIO BIBLE

## Direction

**Stylized low-poly that reads like a modern remaster** — AoM's silhouette language
and color identity with 2026 lighting. Flat-ish albedo + PBR response; chunky
readable silhouettes; bold team color; restrained palette per biome. Never chase
realism; never ship programmer art past a gate.

## Scene standards (Babylon)

- 1 unit = 1 meter = 1 tile. GLTF only. Y-up, −Z forward on export.
- PBR everywhere. One directional sun + hemispheric ambient; cascaded shadow maps
  (2048, stabilized). `DefaultRenderingPipeline`: bloom (god powers glow), FXAA/TAA,
  SSAO2, ACES tone mapping, subtle per-biome color grading, light vignette.
- Terrain: multi-texture splatting (grass/dirt/sand/rock/snow) + normal maps
  (ambientCG), vertex-color biome tinting. Water: reflective/refractive animated.
- Units: rigged GLTF with blended idle/walk/attack/gather/death; **team color via
  shader mask** (albedo mask channel → player color multiply).
- Buildings: scaffold→partial→complete construction states; smoke <50% HP, fire <25%.
- VFX: GPU particles — lightning forks, meteor trails + impact decals, tornado
  funnels, healing motes, hit sparks, destruction debris + dust.

## Palette & UI identity

| Token | Hex | Use |
|-------|-----|-----|
| bronze-deep | `#2a1f12` | HUD panel base |
| bronze | `#8a6a35` | borders, frames |
| bronze-bright | `#d9a94e` | accents, checksums, glows |
| parchment | `#efe3c8` | primary text |
| parchment-dim | `#b9ab8a` | secondary text |
| Auryan | `#e8a83c` · Verdant `#2e8f7a` · Ashen `#b8472e` · Storm `#5a6fc7` | pantheon identity |

Typography: **Cinzel** (600/700) display — headers, age names, god names;
**Alegreya Sans** (400/500/700) body/UI. Google Fonts. No default browser fonts.
HUD: aged-bronze plaques over parchment text, GPU-accelerated CSS transitions,
micro-interactions (button press, panel slide, favor pulse). Reduced-motion respected.

## Asset sources (CC0-first) + pipeline

| Need | Source | License |
|------|--------|---------|
| Units/buildings | Quaternius, KayKit (Kay Lousberg), Kenney.nl | CC0 |
| Textures/normals | ambientCG, Poly Haven | CC0 |
| SFX | Kenney, OpenGameArt, Freesound (CC0 filters) | CC0 |
| Music | Kevin MacLeod (incompetech) | CC-BY (credit!) |

Rules: maintain `ATTRIBUTION.md` for every imported asset (file, source URL, license,
modifications). Shared texture-atlas convention: `atlas_<category>_<biome>.png`,
2048², units in one atlas per faction where possible. Naming:
`<category>_<id>_<variant>.gltf` (e.g. `unit_emberbull_a.gltf`).

**Prove the pipeline before bulk import (Phase 1–2):** ONE animated character +
ONE terrain texture end-to-end (export → GLTF → Babylon → animation blend → team
color). Only then import in bulk.

If CC0 can't cover the 16 myth units: STOP and flag the human for a Meshy/Tripo
paid-tier decision (commercial license required). Never embed free-tier AI assets.

## Audio (Phase 9)

Howler.js. Unit acknowledgments (2–3 variants), distinct SFX per god power, combat
ducking on the music bus, UI clicks from the same family. Volume buses: master /
music / SFX / UI in settings.
