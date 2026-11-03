# infra/

**Track:** Infra (I)
**Owning waves:** W12 (remote host and deploy).
**Owned subpaths:** `infra/compose/`, `infra/nginx/`, `infra/systemd/`, `infra/deploy/`, `infra/hosts/`, `infra/env/`.
**Gate command:** `npm run check:infra` (`docker compose config`, shellcheck, `nginx -t` in a container). Prints "skipped (no package yet)" until `infra/check.sh` exists; W12 creates it.
**Secrets:** provider keys, the backend function-call key and the GitHub token live in a root-only env file on the host (INTAKE.md section 5). Nothing secret is committed here; only `*.example` files.

**Boundary:** NEAR RPC, wallets, payments, the GitHub API and the queue live only in `apps/`, `contracts/` and `infra/`. `scripts/`, `docker/`, `native/` and `skills/` stay the offline review engine and never gain a network path to them (AGENTS.md, "Tracks and boundaries"). The worker runs next to Docker on the host; the sandbox never receives a key.

Nothing is built here yet (W00 lands the folder only).
