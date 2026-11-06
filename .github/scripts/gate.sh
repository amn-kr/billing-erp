#!/usr/bin/env bash
# The required check `test`: green only when every part of the check passed. After a merge whose
# exact files already passed on the PR, the quick checks are skipped on purpose and only What changed
# and the picture tests at 1280/1920 px must pass. Any part that failed, was cancelled or was skipped
# for another reason makes it red.
# Reads (results of the jobs it waits for: success, failure, cancelled or skipped):
#   ALREADY_TESTED_RUN, ALREADY_TESTED_URL  outputs of the already-tested job
#   CHANGES, QUICK, E2E                     results of the changes, quick-checks and e2e (4 parts) jobs
set -u
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

check() {
  if [ "$2" = success ]; then echo "OK      $1"; else echo "NOT OK  $1: $2"; fi
}

if [ -n "${ALREADY_TESTED_RUN:-}" ]; then
  echo "Quick checks and flow tests skipped: these exact files already passed on the PR: ${ALREADY_TESTED_URL:-}" | tee -a "$summary"
  {
    check "What changed" "${CHANGES:-missing}"
    check "Picture tests after the merge (all 4 parts)" "${E2E:-missing}"
  } | tee -a "$summary"
  required=("${CHANGES:-}" "${E2E:-}")
else
  {
    check "What changed" "${CHANGES:-missing}"
    check "Quick checks (brand, typecheck, unit and API tests, build)" "${QUICK:-missing}"
    check "Browser and picture tests (all 4 parts)" "${E2E:-missing}"
  } | tee -a "$summary"
  required=("${CHANGES:-}" "${QUICK:-}" "${E2E:-}")
fi
bad=0
for r in "${required[@]}"; do [ "$r" = success ] || bad=1; done

if [ "$bad" = 1 ]; then
  echo "test is red: at least one part did not pass (see above). Pictures of any differences: the visual-diffs artifact." | tee -a "$summary"
  exit 1
fi
echo "test is green: every part passed." | tee -a "$summary"
