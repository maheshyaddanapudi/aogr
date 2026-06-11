# Pantheons: Age of the Reforged Gods

A complete, browser-playable, single-player real-time strategy game in the mold of
Age of Mythology — four original blended pantheons, 4-age progression, god powers,
myth units, heroes, and a real AI opponent. Built with TypeScript, Babylon.js,
bitECS, and a fully deterministic 15 Hz simulation.

**Play:** https://maheshyaddanapudi.github.io/aogr/ *(deploys from `main`)*

## Develop

```bash
npm ci
npm run dev      # dev server
npm test         # Vitest incl. the determinism checksum gate
npm run build    # typecheck + production build
```

## Project authority

- `KICKOFF.md` — build charter, single source of authority
- `CLAUDE.md` — hard rules + doc map for Claude Code sessions
- `docs/00–07` — vision, GDD, architecture, art bible, roadmap (live gate status),
  AI spec, testing strategy, skills ledger
- `data/*.json` — the only source of truth for game balance

Built by Claude Code, phase-gated (logic + visual) per `docs/04-IMPLEMENTATION-ROADMAP.md`.
