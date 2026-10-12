#!/usr/bin/env bash
# After a merge to main: did a finished, green CI run on a pull request already test exactly these
# files (the same git file tree)? Each such run leaves a tiny artifact named tested-tree-<tree>.
# Writes run=<id> and url=<link> to $GITHUB_OUTPUT only on a clear yes. It never fails: if anything
# is missing or unclear it says so and writes nothing, and the full check runs.
set -u
workflow="${EXPECT_WORKFLOW:-.github/workflows/ci.yml}"
event="${EXPECT_EVENT:-pull_request}"
out="${GITHUB_OUTPUT:-/dev/stdout}"

full() { echo "Full check will run: $1"; exit 0; }

tree=$(git rev-parse 'HEAD^{tree}' 2>/dev/null) || full "could not read the file tree"
echo "File tree of this commit: $tree"
ids=$(gh api "repos/$GITHUB_REPOSITORY/actions/artifacts?name=tested-tree-$tree&per_page=50" \
  --jq '.artifacts[] | select(.expired == false) | .workflow_run.id' 2>&1) || full "could not list artifacts ($ids)"
[ -n "$ids" ] || full "no PR run has tested these exact files"

for id in $ids; do
  info=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id" \
    --jq '[.path, .event, .status, .conclusion, .html_url, .display_title] | @tsv' 2>/dev/null) || continue
  IFS=$'\t' read -r path ev status conclusion url title <<<"$info"
  echo "Found run $id: $path, $ev, $status, $conclusion"
  if [ "$path" = "$workflow" ] && [ "$ev" = "$event" ] && [ "$status" = completed ] && [ "$conclusion" = success ]; then
    { echo "run=$id"; echo "url=$url"; } >> "$out"
    echo "These exact files already passed the full check on the PR \"$title\": $url"
    exit 0
  fi
done
full "no finished, green PR run of $workflow tested these exact files"
