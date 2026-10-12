#!/usr/bin/env bash
# What does this run test? Writes to $GITHUB_OUTPUT:
#   tree=<git file tree of the checked-out commit>
#   docs_only=true  only when every changed file is under docs/ or ends in .md (never reference/);
#                   on any doubt (no base commit, empty or unreadable list) nothing is written and
#                   every test runs.
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

files=$(git diff --name-only "$base" HEAD) || { echo "Could not list changed files: every test runs."; exit 0; }
[ -n "$files" ] || { echo "No changed files found: every test runs."; exit 0; }
echo "Changed files:"; echo "$files"
while IFS= read -r f; do
  case "$f" in
    reference/*) echo "Code or prototype changed ($f): every test runs."; exit 0 ;;
    docs/*|*.md) ;;
    *) echo "Code changed ($f): every test runs."; exit 0 ;;
  esac
done <<<"$files"
echo "docs_only=true" >> "$out"
echo "Only docs/ or .md files changed."
