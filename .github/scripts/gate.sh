#!/usr/bin/env bash
# The required check `test`: green only when every part of the check passed, or when the whole check
# was skipped on purpose (after a merge: these exact files already passed on the PR). Any part that
# failed, was cancelled or was skipped for another reason makes it red.
# Reads (results of the jobs it waits for: success, failure, cancelled or skipped):
#   ALREADY_TESTED_RUN, ALREADY_TESTED_URL  outputs of the already-tested job
#   CHANGES, QUICK, E2E                     results of the changes, quick-checks and e2e (4 parts) jobs
set -u
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ -n "${ALREADY_TESTED_RUN:-}" ]; then
  echo "Full check skipped: these exact files already passed on the PR: ${ALREADY_TESTED_URL:-}" | tee -a "$summary"
  exit 0
fi

check() {
  if [ "$2" = success ]; then echo "OK      $1"; else echo "NOT OK  $1: $2"; fi
}
{
  check "What changed" "${CHANGES:-missing}"
  check "Quick checks (brand, typecheck, unit and API tests, build)" "${QUICK:-missing}"
  check "Browser and picture tests (all 4 parts)" "${E2E:-missing}"
} | tee -a "$summary"
bad=0
for r in "${CHANGES:-}" "${QUICK:-}" "${E2E:-}"; do [ "$r" = success ] || bad=1; done

if [ "$bad" = 1 ]; then
  echo "test is red: at least one part did not pass (see above). Pictures of any differences: the visual-diffs artifact." | tee -a "$summary"
  exit 1
fi
echo "test is green: every part passed." | tee -a "$summary"
