# W12 — Remote Host & Deploy: owner check

Wave file: [`../waves/W12-remote-host.md`](../waves/W12-remote-host.md). About 2 minutes. No remote host.

`npm run check:infra` on this Mac:

- `docker compose config` accepts `infra/compose/docker-compose.yml`. Postgres is not published. The API is bound to `127.0.0.1:8787`.
- shellcheck (via the `koalaman/shellcheck` image; the host has no shellcheck binary) accepts `infra/check.sh`, `infra/deploy/deploy.sh`, and `infra/deploy/smoke.sh`.
- `nginx -t` in `nginx:alpine` reports the configuration test is successful.
- `systemd-analyze` is absent. The unit files `omniswarm-api.service` and `omniswarm-worker.service` are present and were not verified by systemd. `smoke.sh <host>` is not run and does not invent a host.

`bash infra/deploy/deploy.sh` with no host is a dry run. A host argument exits 2 and does not deploy.
