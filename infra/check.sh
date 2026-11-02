#!/bin/bash
# Local infra gate: compose, shellcheck, nginx -t. systemd-analyze is optional.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "compose"
docker compose -f infra/compose/docker-compose.yml config >/dev/null
echo "shellcheck"
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck infra/check.sh infra/deploy/deploy.sh infra/deploy/smoke.sh
else
  docker run --rm -v "$ROOT:/work" -w /work koalaman/shellcheck:stable infra/check.sh infra/deploy/deploy.sh infra/deploy/smoke.sh
fi
echo "nginx"
docker run --rm -v "$ROOT/infra/nginx/omniswarm.conf:/etc/nginx/nginx.conf:ro" nginx:alpine nginx -t
if command -v systemd-analyze >/dev/null 2>&1; then
  systemd-analyze verify infra/systemd/omniswarm-api.service infra/systemd/omniswarm-worker.service
else
  echo "systemd-analyze is absent; unit files were not verified on this machine"
  test -f infra/systemd/omniswarm-api.service
  test -f infra/systemd/omniswarm-worker.service
fi
echo "infra check ok"
