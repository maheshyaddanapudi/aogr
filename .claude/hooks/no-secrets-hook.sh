#!/usr/bin/env bash
# PostToolUse hook: block obvious secrets from entering the repo (KICKOFF §8.7).
cd "$(dirname "$0")/../.." || exit 0
PATTERNS='(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|sk-[A-Za-z0-9]{20,}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,})'
HITS=$(git diff --cached --name-only 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; git diff --name-only 2>/dev/null)
HITS=$(echo "$HITS" | sort -u | grep -v '^$' || true)
for f in $HITS; do
  [ -f "$f" ] || continue
  if grep -qE "$PATTERNS" "$f" 2>/dev/null; then
    echo "Edit rejected: '$f' appears to contain a credential. Never commit secrets (KICKOFF §8.7)." 1>&2
    exit 2
  fi
done
exit 0
