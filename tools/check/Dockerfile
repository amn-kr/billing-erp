# The Linux machine for the browser and picture tests, run on the Mac with Docker (tools/check/check-all.sh).
# The approved pictures were taken on Ubuntu 24.04 with Playwright 1.56.1's Chrome: this image is the same
# Ubuntu and the same Chrome, so the pictures come out the same as they did on GitHub.
# DejaVu Sans: GitHub's Ubuntu had it, and Chrome draws some signs with it (the ← of "← Products"); without it
# those lines come out 2 pixels taller and the pictures move. Keep the version below equal to @playwright/test in package.json.
FROM mcr.microsoft.com/playwright:v1.56.1-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends rsync postgresql-client fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.28.0
ENV CI=1
