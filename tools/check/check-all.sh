#!/usr/bin/env bash
# Every check of the project, run on this Mac (owner, 13 Nov 2026: no checks on GitHub — the repository is
# private and GitHub's minutes cost money). Run it before every push / pull request / merge:
#
#   pnpm check            everything (about 30–45 minutes)
#   pnpm check mac        only the Mac part: brand, typecheck, unit + API tests, build, Windows app tests
#   pnpm check linux      only the browser and picture tests (Linux, in Docker)
#   pnpm check linux e2e/bring.visual.spec.ts      one test file (anything after "linux" goes to Playwright)
#   PICTURE_WIDTHS=1366 pnpm check linux           pictures at one width only
#
# Mac part: needs the Mac's PostgreSQL 16 running on localhost:5432 with the roles of infra/db/init-ci.sql.
# Linux part: the browser and picture tests in Docker (Colima), on the same Ubuntu 24.04 and Playwright
# Chrome as GitHub had, with its own fresh PostgreSQL 16. Failed pictures are copied back to
# apps/web/test-results/ on the Mac.
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
PART="${1:-all}"; [ $# -gt 0 ] && shift
IMAGE="billing-check:pw$(node -p "require('./package.json').devDependencies['@playwright/test']")"
# The Mac's own ARM Linux. (Intel Linux through Rosetta was tried: Chrome crashes there.)
PLATFORM=linux/arm64
results=()
failed=0
step() { # step "name" command...
  local name="$1"; shift
  echo; echo "━━━ $name ━━━"
  local t=$SECONDS
  if "$@"; then results+=("✅ $name ($(( (SECONDS - t + 59) / 60 )) min)"); else results+=("❌ $name"); failed=1; fi
}

mac_part() {
  step "Install packages" pnpm install --frozen-lockfile
  step "Brand check" pnpm brand:check
  step "Typecheck" pnpm typecheck
  # --retry=1: a test that fails once is run once more (on the Mac, about 1 full run in 2 had one API test
  # fail with "Parse Error: Expected HTTP/", a network hiccup that passes when run again)
  step "Unit and API tests" pnpm exec turbo run test -- --retry=1
  step "Build" pnpm build
  step "Windows app tests (Electron)" pnpm --filter @billing/desktop e2e
}

linux_part() {
  if ! docker info >/dev/null 2>&1; then
    echo "Starting Docker (Colima)…"
    colima start --cpu 4 --memory 5 --disk 40 --vm-type vz || { results+=("❌ Docker could not start"); failed=1; return; }
  fi
  docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build --platform $PLATFORM -t "$IMAGE" tools/check || { results+=("❌ Linux machine could not be made"); failed=1; return; }
  docker rm -f billing-check-pg >/dev/null 2>&1
  docker run -d --rm --name billing-check-pg -e POSTGRES_PASSWORD=postgres postgres:16 >/dev/null
  rm -rf apps/web/test-results
  # the code goes into the Linux machine's own folder (its packages are Linux ones, kept between runs)
  step "Browser and picture tests (Linux, 1280/1366/1920 px unless PICTURE_WIDTHS says otherwise)" \
    docker run --rm --platform $PLATFORM --network container:billing-check-pg --ipc=host --init \
      -e PGPASSWORD=postgres -e PICTURE_WIDTHS="${PICTURE_WIDTHS:-}" \
      -v "$ROOT":/src:ro -v billing-check-work:/work -v billing-check-store:/pnpm-store \
      "$IMAGE" bash -c '
        set -e
        rsync -a --delete --exclude node_modules --exclude .git --exclude dist --exclude .turbo --exclude test-results \
          --exclude playwright-report --exclude apps/desktop/.cache --exclude apps/desktop/release /src/ /work/
        cd /work
        until pg_isready -h localhost -U postgres -q; do sleep 1; done
        psql -q -h localhost -U postgres -f infra/db/init-ci.sql
        pnpm config set store-dir /pnpm-store >/dev/null
        pnpm install --frozen-lockfile
        pnpm build
        status=0
        pnpm --filter @billing/web e2e "$@" || status=$?
        exit $status
      ' bash "$@"
  # failed pictures and traces back to the Mac
  docker run --rm --platform $PLATFORM -v billing-check-work:/work -v "$ROOT/apps/web":/out "$IMAGE" \
    bash -c '[ -d /work/apps/web/test-results ] && cp -r /work/apps/web/test-results /out/ || true'
  docker rm -f billing-check-pg >/dev/null 2>&1
}

case "$PART" in
  all) mac_part; linux_part "$@" ;;
  mac) mac_part ;;
  linux) linux_part "$@" ;;
  *) echo "Use: pnpm check [all|mac|linux] [Playwright arguments]"; exit 2 ;;
esac

echo; echo "━━━ Result ━━━"
printf '%s\n' "${results[@]}"
if [ $failed = 0 ]; then echo "Everything passed."; else echo "Something failed (see above). Failed pictures: apps/web/test-results/"; fi
exit $failed
