# 05 — AI OPPONENT SPEC (Petra-style, Phase 7)

The AI lives in a **Web Worker**, ticks throttled (every ~2s of game time), and acts
exclusively by submitting **Commands** to the same queue as the human. It never reads
private state it shouldn't (fog rules apply to its knowledge model from Phase 8).

## Architecture

```
worker: HQ (strategy) ─▶ queueManager (economy/production) ─▶ Commands
            │
            └─▶ defenseManager (threat response)  ─▶ Commands
            └─▶ attackManager (army comp, waves)  ─▶ Commands
```

- **HQ**: picks a strategy profile at start (boom / rush / balanced — weighted by
  difficulty + pantheon), tracks game phase, decides age-up timing and minor-god
  picks, allocates resource budgets to the managers, decides god-power usage windows.
- **queueManager**: priority queue of {unit/building/tech} wants with budgets;
  assigns villagers to resources by target ratios (e.g. 50/25/25 food/wood/gold
  Archaic, shifting per age and strategy); expands houses ahead of pop block; rebuilds
  lost eco; places buildings via simple scored placement (near TC, away from threat).
- **defenseManager**: threat heat map from sighted enemies; pulls villagers to TC /
  garrisons on raids; counter-builds (anti-cav vs cavalry raids, etc.); tower requests.
- **attackManager**: builds army comps that counter observed enemy comp (data-driven
  from units.json multipliers); stages at rally point; launches waves at
  strength thresholds; retreats below a health fraction; escorts siege at buildings.

## Build order skeleton (Archaic, balanced)

villagers → food (hunt) until 8 · house at pop 12 · temple by 4:00 · scout patrol ·
classical at ~5:30 · then barracks + 2nd house, military trickle + eco techs.

## Difficulty knobs (data-driven, `data/ai.json` to be created in Phase 7)

| Knob | Easy | Medium | Hard |
|------|------|--------|------|
| Decision interval | 4s | 2.5s | 1.5s |
| Villager target by 10:00 | 25 | 45 | 65 |
| Resource handicap | ×0.8 income | ×1.0 | ×1.0 |
| Attack wave threshold | large army only | medium | early + continuous pressure |
| God power usage | rarely, late | on cooldown in fights | optimal windows (eco powers on cooldown, combat powers at engagement start) |
| Micro (focus fire, retreat) | none | retreat at 30% | focus heroes on myth, kite with ranged |

"Measurably differ" gate test: Hard beats Medium beats Easy in headless AI-vs-AI
runs (≥70% win rate per step) and reach Mythic age at decreasing average times.

## Determinism

The worker is part of the sim's determinism envelope: it receives snapshots tagged
with tick N and must emit commands scheduled for a tick ≥ N + fixed latency. Same
seed + same snapshots ⇒ same commands (AI uses the sim PRNG stream via its own
seeded child PRNG). Headless tests run AI decisions synchronously to prove replay
equality.
