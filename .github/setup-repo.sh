#!/usr/bin/env bash
#
# One-time repository setup for the single-branch CI/CD:
#   - creates the release labels
#   - protects the `master` branch
#
# Requirements: GitHub CLI (`gh`) authenticated with admin rights on the repo.
# Usage: ./.github/setup-repo.sh
set -euo pipefail

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
echo "Configuring ${REPO}"

# -----------------------------------------------------------------------------
# Labels
# -----------------------------------------------------------------------------
create_label() {
  local name="$1" color="$2" desc="$3"
  gh label create "$name" --color "$color" --description "$desc" --force >/dev/null
  echo "  label: $name"
}

echo "Creating labels..."
create_label "release:major" "B60205" "Breaking changes → major version bump"
create_label "release:minor" "0E8A16" "New features → minor version bump"
create_label "release:patch" "FBCA04" "Bug fixes → patch version bump"
create_label "release:skip"  "C5DEF5" "No release (docs, chore, internal)"
create_label "dependencies"  "5319E7" "Dependency updates"

# -----------------------------------------------------------------------------
# Branch protection
# -----------------------------------------------------------------------------
# master: PR + 1 review + CI (verify) + release label check, no force-push.
protect_master() {
  echo "Protecting master..."
  gh api -X PUT "repos/${REPO}/branches/master/protection" \
    --input - <<'JSON' >/dev/null
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["verify", "require-release-label"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
}

protect_master

echo
echo "Done. Remaining manual steps (see .github/CI.md):"
echo "  1. Create the 'release' GitHub Environment with yourself as required reviewer."
echo "  2. Add the NPM_PUBLISH_TOKEN secret (npm publish) — the only secret required."
