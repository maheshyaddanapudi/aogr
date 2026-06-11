#!/usr/bin/env bash
# PostToolUse hook (KICKOFF §3): rejects edits that violate sim purity.
# Exit code 2 = blocking feedback to Claude.
cd "$(dirname "$0")/../.." || exit 0
if ! node scripts/check-sim-purity.mjs 1>&2; then
  echo "Edit rejected: src/sim must stay deterministic (no render/UI/Babylon imports, no Math.random, no wall-clock, no DOM)." 1>&2
  exit 2
fi
exit 0
