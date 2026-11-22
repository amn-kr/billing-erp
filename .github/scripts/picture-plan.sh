#!/usr/bin/env bash
# Which browser and picture tests run, from what changed (changes.sh) and whether a PR already
# tested these exact files (already-tested.sh). Writes to $GITHUB_OUTPUT:
#   run_e2e=true|false     whether the 4 parts run any test at all
#   quick_checks=true|false
#   widths=<list>          picture widths for e2e/setup.ts (PICTURE_WIDTHS); empty = 1366, the only one
#   pictures_only=1        only the picture tests run (not used since 22 Nov 2026: nothing runs after a merge)
#   skip_visual=1          only files that cannot change a picture changed: picture tests skipped
# and one plain sentence about it to the step summary.
# Reads: EVENT, ALREADY_TESTED_RUN, DOCS_ONLY, WEB_UNCHANGED, VISUAL_NEEDED, APPROVED_CHANGED (empty = not known).
set -u
out="${GITHUB_OUTPUT:-/dev/stdout}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
run_e2e=true; quick=true; widths=""; pictures_only=""; skip_visual=""

if [ -n "${ALREADY_TESTED_RUN:-}" ]; then
  # after a merge: the quick checks, the flow tests, the pictures (1366 px, the only width since 22 Nov 2026)
  # and the fit checks already passed on the PR for these exact files, so nothing is left to run
  quick=false; run_e2e=false
  note="After the merge: nothing to run - these exact files already passed every check on the PR"
elif [ "${DOCS_ONLY:-}" = true ]; then
  run_e2e=false
  note="Browser and picture tests skipped - only docs/ or .md files changed"
elif [ "${WEB_UNCHANGED:-}" = true ]; then
  # the Windows app has its own job (Windows app tests); the quick checks still run
  run_e2e=false
  note="Browser and picture tests skipped - only Windows-app or docs files changed since they last passed"
elif [ "${VISUAL_NEEDED:-}" = false ]; then
  skip_visual=1
  note="Picture tests skipped – only API/docs files changed"
else
  note="Picture tests at 1366 px, with fit checks at 1280, 1366, 1440, 1536, 1600 and 1920 px"
fi

{
  echo "run_e2e=$run_e2e"
  echo "quick_checks=$quick"
  echo "widths=$widths"
  echo "pictures_only=$pictures_only"
  echo "skip_visual=$skip_visual"
} >> "$out"
echo "$note" | tee -a "$summary"
