# 00 — VISION

## What this is

**Pantheons: Age of the Reforged Gods** — a complete, browser-playable, single-player
real-time strategy game in the mold of Age of Mythology, built on four **original**
blended pantheons (no Microsoft IP: original names, original art, mechanically inspired
only), deployed to a public GitHub Pages URL anyone can play from a link.

## Pillars

1. **Myth is the spice, economy is the meal.** Classic gather→build→army RTS loop;
   gods, favor, myth units, and god powers bend it without replacing it.
2. **Determinism is sacred.** The sim is a pure function of seed + commands. Every
   feature is built inside that constraint from day one — it's what makes saves exact,
   tests honest, and future lockstep multiplayer possible.
3. **Readable beauty.** Stylized low-poly with modern lighting (PBR, bloom, shadows).
   Silhouette and team color read at a glance from RTS camera distance. Visuals are a
   gated requirement at every phase, not polish.
4. **Counters decide fights, micro tilts them.** Hack/pierce/crush/divine + the
   human⟷myth⟷hero triangle, all driven by `data/*.json` multipliers.
5. **A worthy opponent.** The AI booms, ages up, raids, defends, and casts powers —
   measurably different across three difficulties.

## Definition of done (v1 release = Phase 10 gate)

- All 4 pantheons playable: 3 majors each, 2-minor-god choice at every age-up, full
  rosters, 6 god powers per pantheon, per-pantheon favor mechanics.
- Archaic→Mythic progression with the §6 costs/prerequisites; full tech trees applied.
- 3 victory conditions: conquest, wonder countdown, settlement/relic control.
- AI opponent at Easy/Medium/Hard; random map generation; fog of war; full HUD,
  minimap, control groups, rally points, placement ghosts; audio + VFX; menus,
  settings, save/load with checksum-identical reload.
- 60fps with 300 pop on a 2021+ laptop GPU; public URL serves the release build.

## Non-goals (v1)

- **No multiplayer code** — only clean seams (deterministic sim + command queue).
- No campaign/scenario editor; skirmish vs AI only.
- No naval combat beyond fishing (boats gather; docks exist; no warships).
- No localization beyond English; no mobile/touch UI.
- No procedural animation, ragdolls, or terrain deformation.

## Source-of-truth order

`KICKOFF.md` → `docs/00–06` → code. Balance lives only in `data/*.json`.
