# W12 — Remote Host & Deploy: owner check

Wave file: [`../waves/W12-remote-host.md`](../waves/W12-remote-host.md). Step 1 takes about 2 minutes on a laptop with Docker. Steps 2–8 need the VM and domain (W12-19, owner task) and were **not run**: no host exists yet. Their commands are given with the `--dry-run` form that was run.

## Before you start

- Docker running (compose v2), Node 24, `openssl`, `curl`. Nothing in step 1 contacts a host or a provider.
- Step 1 uses loopback ports `18480`, `18443` and `55873` (`infra/env/dev.env.example`), compose project `omniswarm-infra-check`, and removes everything it started, volumes included.
- Placeholders: `<host>` is the ssh alias of the VM, `<domain>` is the app hostname, and `reports.<domain>` is the reports hostname.
- Secrets: fill `infra/env/{stack,worker,providers}.env.example` into `~/.omniswarm/env/` on your machine, never in the repo. On the host, install them as `root:root 0600` under `/etc/omniswarm/` (README "Env contract and secrets").

## Steps

1. **Laptop gate.** Run `npm run check:infra`. Expect `infra check ok` after about 70 s (the first run also pulls the pinned images). Shortened output of the run on this branch:

   ```
   compose + env contract
     compose policy (prod): ok
     compose policy (dev): ok
     env contract: ok (0 errors, 12 warnings)
     compose refuses to start without each of 11 required values
   nginx
     nginx -t ok (prod: omniswarm.example, reports.omniswarm.example)
     nginx -t ok (dev: omniswarm.localhost, reports.omniswarm.localhost)
   lint + dry runs
     shellcheck ok (19 scripts)
     hadolint ok; final stages non-root, bases digest-pinned, healthchecks present (3 Dockerfiles)
   systemd
     systemd-analyze verify ok (6 units)
   api image
     api image: 85 MB, uid=1000, healthcheck, no engine code / .env, /app read-only
   bring-up (stub apps)
     stack healthy: apix2 nginxx1 postgresx1 webx1
       ok   tls-app … ok   rate-limit (29/40 answered 429)
     api sees nginx's client address, not the forged header
     SSE streamed unbuffered (6 events in 2 s)
     nginx spreads requests over every replica and follows --scale api=3 without a reload
     rolling restart to check-2: 159 requests during the roll, 0 failed, 3 replicas on the new image
     backup + restore drill: restored from db-20261103T141512Z.dump: stub_request=1
   infra check ok (67s)
   ```

   The 12 `warn:` lines name variables that infra sets but `apps/api/.env.example` does not declare yet: `HOST`, `ADMIN_HOST`, `ADMIN_PORT`, `ADMIN_TOKEN`, `TRUST_PROXY`, `RPC_URLS`, `GITHUB_TOKEN`, `WORKER_CONCURRENCY`, `WORKER_ID`, `REPORTS_ROOT`, `ENGINE_ROOT`, `OPERATOR_KEY_FILE`. They disappear once the API track's `.env.example` lands. Set `OMNI_ENV_CONTRACT=strict` to make them errors.

   Optional: `bash infra/check.sh --apps=real` runs the same bring-up with `apps/api/Dockerfile` and `apps/web/Dockerfile` in place of the stub. It needs the API to bind `HOST` and serve `/api/ready`, and the web app to be a Next.js standalone build.
2. **Provision the VM.** `infra/hosts/provision.sh` is not built (W12-06, see the README "Not here yet"). Do these steps by hand:
   - Install Docker Engine with the compose plugin, Node 24, `rsync`.
   - Create the user `omniswarm` in the `docker` group.
   - Create `/srv/omniswarm/{releases,reports,work,backup,acme,nginx}` owned by `omniswarm`.
   - Create `/etc/omniswarm` as `root:root 0700`.
3. **Secrets.** Copy the filled env files from `~/.omniswarm/env/` with `install -o root -g root -m 0600`. You need `stack.env`, `worker.env`, `providers.env` and `operator-key.json`. Check with `sudo ls -l /etc/omniswarm`: every file shows `-rw------- root root`.
4. **Deploy.** First `infra/deploy/deploy.sh --dry-run <host> wave-12`. It prints `git archive`, `rsync`, then one ssh block that unpacks to `/srv/omniswarm/releases/wave-12` and runs `release.sh activate wave-12`. Then run it without `--dry-run`. Expect the `release.sh` log to end with `release wave-12 is live`. On the first deploy it issues the certificate first (`certbot.sh issue`, standalone on :80).
5. **Open the site.**
   - `https://<domain>/` shows the landing.
   - `https://<domain>/api/health` returns `{"ok":true,"network":"testnet",…}`.
   - `curl -I https://reports.<domain>/sample/report.html` shows `content-security-policy: … frame-ancestors https://<domain>; sandbox …` (copy a sample report into `/srv/omniswarm/reports/sample/` first).
6. **Smoke.** Run `infra/deploy/smoke.sh --network testnet <domain>`. Expect 10 `ok` lines and `smoke: all checks passed for https://<domain>`. The checks are: `tls-app`, `tls-reports`, `http-redirect`, `health`, `ready`, `web-root`, `app-headers`, `admin-blocked` (403), `reports-csp`, `rate-limit` (429 after a burst). Stop nginx (`docker compose … stop nginx`): it exits 1 with `FAIL` lines naming the checks. The worker self-test (`bin/audit demo` on the host) is not part of `smoke.sh` yet.
7. **Rollback.** Run `infra/deploy/deploy.sh <host> --rollback`. Then `readlink /srv/omniswarm/current` shows the previous release, and `smoke.sh` stays green. The dry run prints one ssh line, `sudo /srv/omniswarm/current/infra/deploy/release.sh rollback`.
8. **Restart on failure.** If an api process exits, Docker starts it again (`restart: unless-stopped`). Test it with `docker compose … exec api sh -c 'kill 1'`. A worker that exits is restarted by systemd (`Restart=always`, 5 s): test it with `sudo systemctl kill omniswarm-worker@1` and then `systemctl status omniswarm-worker@1`. A container that is running but unhealthy is not restarted: that needs the on-box health timer, which is not built (W12-17). The external uptime alert is not built either.

## Automated checks

- `npm run check:infra` is green (step 1). CI job `infra` runs the same command.
- `infra/deploy/smoke.sh <host>` has not been run: no host yet.

## When you're done

All good: land it. Something wrong: tell the wave lead the step number and what you saw.
