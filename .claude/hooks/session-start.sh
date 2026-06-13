#!/bin/bash
# SessionStart hook: attribute commits to the repo owner.
#
# In Claude Code on the web each session runs in a fresh, ephemeral container
# whose *global* git identity defaults to "Claude <noreply@anthropic.com>".
# GitHub attributes a commit to an account by its author email, so without this
# hook every commit shows up under the generic "claude" contributor.
#
# This re-applies a personal identity to the local repo config at the start of
# every session. It only runs in the remote (web) environment, so a local
# checkout keeps whatever git identity you already have configured there.
set -euo pipefail

# Only adjust identity inside Claude Code on the web; leave local checkouts alone.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

git config user.name  "Oluoshadare Olumide"
git config user.email "oluoshadare.olumide@gmail.com"

# The container's default signing key belongs to Claude, not you, so a signed
# commit would show as "Unverified" on GitHub. Disable signing unless/until you
# wire in your own key.
git config commit.gpgsign false

echo "git identity set to $(git config user.name) <$(git config user.email)>" >&2
