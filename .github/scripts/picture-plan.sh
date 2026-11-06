#!/usr/bin/env bash
# Which browser and picture tests run, from what changed (changes.sh) and whether a PR already
# tested these exact files (already-tested.sh). Writes to $GITHUB_OUTPUT:
#   run_e2e=true|false     whether the 4 parts run any test at all
#   quick_checks=true|false
#   widths=<list>          picture widths for e2e/setup.ts (PICTURE_WIDTHS); empty = all three
#   pictures_only=1        after a merge that already passed on the PR: only the picture tests run
#   skip_visual=1          only files that cannot change a picture changed: picture tests skipped
# and one plain sentence about it to the step summary.
# Reads: EVENT, ALREADY_TESTED_RUN, DOCS_ONLY, VISUAL_NEEDED, APPROVED_CHANGED (empty = not known).
set -u
out="${GITHUB_OUTPUT:-/dev/stdout}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
run_e2e=true; quick=true; widths=""; pictures_only=""; skip_visual=""

if [ -n "${ALREADY_TESTED_RUN:-}" ]; then
  # after a merge: the quick checks, the flow tests and the 1366 px pictures already passed on the PR
  quick=false; pictures_only=1; widths=1280,1920
fi

if [ "${DOCS_ONLY:-}" = true ]; then
  run_e2e=false
  note="Browser and picture tests skipped - only docs/ or .md files changed"
elif [ "${VISUAL_NEEDED:-}" = false ]; then
  skip_visual=1
  note="Picture tests skipped – only API/docs files changed"
  # nothing is left to run when the flow tests already passed on the PR
  [ -n "$pictures_only" ] && { run_e2e=false; note="$note (the flow tests already passed on the PR)"; }
elif [ -n "$pictures_only" ]; then
  note="After the merge: picture tests at 1280 and 1920 px (1366 px, the flow tests and the quick checks already passed on the PR)"
elif [ "${EVENT:-}" = pull_request ] && [ "${APPROVED_CHANGED:-}" = false ]; then
  widths=1366
  note="Picture tests at 1366 px only on this pull request; 1280 and 1920 px run after the merge"
elif [ "${EVENT:-}" = pull_request ] && [ "${APPROVED_CHANGED:-}" = true ]; then
  note="Picture tests at 1280, 1366 and 1920 px - this pull request changes approved pictures"
else
  note="Picture tests at 1280, 1366 and 1920 px"
fi

{
  echo "run_e2e=$run_e2e"
  echo "quick_checks=$quick"
  echo "widths=$widths"
  echo "pictures_only=$pictures_only"
  echo "skip_visual=$skip_visual"
} >> "$out"
echo "$note" | tee -a "$summary"
