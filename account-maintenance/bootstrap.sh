#!/usr/bin/env bash
#
# One-shot deployer for the account-wide maintenance kit (central model).
#
# Run this ONCE, on your own machine, where the GitHub CLI (`gh`) is logged in.
# It installs the scheduler into a single HOST repo and stores your token as a
# secret there. From then on, the scheduled Action maintains ALL your repos on
# its own — you never have to touch the other repos.
#
# Why you have to run it (not me): it needs YOUR GitHub credentials. I can't
# create a token on your account or push to your other repos from my session.
#
# Usage:
#   export GH_MAINTENANCE_TOKEN=github_pat_xxx      # fine-grained PAT,
#                                                   # Contents: read & write
#   ./bootstrap.sh [host-repo-name]                 # default: it-support-scripts
#
set -euo pipefail

HOST_REPO="${1:-it-support-scripts}"
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- preconditions --------------------------------------------------------- #
command -v gh >/dev/null 2>&1 || { echo "ERROR: install the GitHub CLI (gh) first."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: run 'gh auth login' first."; exit 1; }
: "${GH_MAINTENANCE_TOKEN:?ERROR: export GH_MAINTENANCE_TOKEN=<your fine-grained PAT>}"

OWNER="$(gh api user -q .login)"
FULL="$OWNER/$HOST_REPO"
AUTHOR_NAME="$(python3 -c "import json;print(json.load(open('$KIT_DIR/maintenance.config.json'))['author']['name'])")"
AUTHOR_EMAIL="$(python3 -c "import json;print(json.load(open('$KIT_DIR/maintenance.config.json'))['author']['email'])")"

echo ">> Host repo:        $FULL"
echo ">> Commit identity:  $AUTHOR_NAME <$AUTHOR_EMAIL>"
read -r -p ">> Proceed? [y/N] " ok; [ "$ok" = "y" ] || { echo "Aborted."; exit 0; }

# --- 1. install kit + workflow onto the host's default branch -------------- #
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
gh repo clone "$FULL" "$WORK/host" -- --depth 1 2>/dev/null || true
[ -d "$WORK/host/.git" ] || { mkdir -p "$WORK/host"; git -C "$WORK/host" init -q; \
  git -C "$WORK/host" remote add origin "https://github.com/$FULL.git"; }

BRANCH="$(gh repo view "$FULL" --json defaultBranchRef -q '.defaultBranchRef.name' 2>/dev/null || true)"
BRANCH="${BRANCH:-main}"
git -C "$WORK/host" checkout -B "$BRANCH" -q

mkdir -p "$WORK/host/account-maintenance/templates" "$WORK/host/.github/workflows"
cp "$KIT_DIR/maintain.py" "$KIT_DIR/maintenance.config.json" "$KIT_DIR/README.md" \
   "$WORK/host/account-maintenance/"
cp "$KIT_DIR/templates/dependabot.yml" "$WORK/host/account-maintenance/templates/"
cp "$KIT_DIR/account-maintenance.yml" "$WORK/host/.github/workflows/account-maintenance.yml"

git -C "$WORK/host" add -A
if git -C "$WORK/host" diff --cached --quiet; then
  echo ">> Kit already present on $FULL@$BRANCH (no change)."
else
  git -C "$WORK/host" \
    -c user.name="$AUTHOR_NAME" -c user.email="$AUTHOR_EMAIL" \
    commit -q -m "Add account-wide maintenance scheduler"
  git -C "$WORK/host" push -u origin "HEAD:$BRANCH"
  echo ">> Installed scheduler on $FULL@$BRANCH."
fi

# --- 2. store the token as a secret on the host --------------------------- #
gh secret set GH_MAINTENANCE_TOKEN --repo "$FULL" --body "$GH_MAINTENANCE_TOKEN"
echo ">> Stored GH_MAINTENANCE_TOKEN secret on $FULL."

# --- 3. kick off a DRY RUN so you can review before anything is committed --- #
for i in 1 2 3 4 5; do
  if gh workflow run account-maintenance.yml --repo "$FULL" -f dry_run=true 2>/dev/null; then
    echo ">> Triggered a dry run. Watch it:  gh run watch --repo $FULL"
    exit 0
  fi
  echo "   (waiting for GitHub to register the new workflow... $i)"; sleep 5
done
echo ">> Workflow installed but the dry-run trigger didn't take. Start it from"
echo "   the Actions tab: $FULL -> Actions -> account-maintenance -> Run workflow."
