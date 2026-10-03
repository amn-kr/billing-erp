#!/usr/bin/env bash
# Downloads the Google Fonts used by the design into ./fonts (run once; the files are committed).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fonts
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" -o fonts/jakarta.css
curl -sS -A "$UA" "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" -o fonts/inter.css
grep -ho "https://fonts.gstatic.com/[^)]*" fonts/*.css | sort -u | while read -r u; do
  curl -sS "$u" -o "fonts/$(echo "$u" | sed 's#https://fonts.gstatic.com/##; s#/#_#g')"
done
