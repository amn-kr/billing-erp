#!/usr/bin/env bash
# What does this run test? Writes to $GITHUB_OUTPUT:
#   tree=<git file tree of the checked-out commit>
#   docs_only=true       only when every changed file is under docs/ or ends in .md (never reference/)
#   visual_needed=false  only when every changed file is one that cannot change a picture: docs/, .md
#                        (never reference/), the API's own tests (apps/api/test/, vitest.config.ts) and
#                        the two API command-line tools the picture tests never run. All other API files
#                        stay out: the pictures show real data from the API and its seed scripts.
#   approved_changed=true|false  whether an approved picture (apps/web/e2e/approved/) changed
# On any doubt (no base commit, empty or unreadable list) none of the last three is written and every
# test runs, at every picture width.
# Base: on a pull request the checkout is GitHub's merge commit, whose first parent is the target
# branch (needs fetch-depth: 2); on a push it is the commit before the push ($BEFORE).
set -u
out="${GITHUB_OUTPUT:-/dev/stdout}"
echo "tree=$(git rev-parse 'HEAD^{tree}')" >> "$out"

if [ "${EVENT:-}" = pull_request ]; then
  base=$(git rev-parse -q --verify 'HEAD^1') || base=""
else
  base="${BEFORE:-}"
  if [ -n "$base" ] && ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    git fetch -q --depth=1 origin "$base" 2>/dev/null || base=""
  fi
fi
[ -n "$base" ] || { echo "No base commit to compare with: every test runs."; exit 0; }

# --no-renames: a moved file is listed at its old and its new path, so moving a file out of apps/web/ counts
files=$(git diff --no-renames --name-only "$base" HEAD) || { echo "Could not list changed files: every test runs."; exit 0; }
[ -n "$files" ] || { echo "No changed files found: every test runs."; exit 0; }
echo "Changed files:"; echo "$files"
docs_only=true; visual_needed=false; approved_changed=false
while IFS= read -r f; do
  case "$f" in
    apps/web/e2e/approved/*) approved_changed=true ;;
  esac
  case "$f" in
    reference/*) docs_only=false; visual_needed=true; echo "Prototype changed ($f): every test runs." ;;
    docs/*|*.md) ;;
    apps/api/test/*|apps/api/vitest.config.ts|apps/api/scripts/support-reset.ts|apps/api/scripts/import-backup.ts)
      docs_only=false ;;
    *) docs_only=false; visual_needed=true; echo "Code changed ($f): every test runs." ;;
  esac
done <<<"$files"
echo "approved_changed=$approved_changed" >> "$out"
if [ "$docs_only" = true ]; then
  echo "docs_only=true" >> "$out"
  echo "Only docs/ or .md files changed."
fi
if [ "$visual_needed" = false ]; then
  echo "visual_needed=false" >> "$out"
  echo "No changed file can change a picture: picture tests are skipped."
fi
