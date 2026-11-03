# W12 — Remote Host & Deploy: owner check

Wave file: [`../waves/W12-remote-host.md`](../waves/W12-remote-host.md).
- Step 1 takes about 4 minutes on a laptop with Docker.
- Steps 2–9 need the VM and the domain (`docs/ops/OWNER_TASKS.md`) and were **not run**: no host exists yet. Each step shows the `--dry-run` form that was run, and what the real run must show.

## Before you start

- Docker running (compose v2), Node 24, `openssl`, `curl`. Nothing in step 1 contacts a host or a provider.
- Step 1 uses:
  - loopback ports `18480`, `18443` and `55873` (`infra/env/dev.env.example`)
  - compose project `omniswarm-infra-check`
  - two cached check images, `omniswarm-infra-check/{systemd,hosts}`, built once from Debian trixie

  It removes everything it started, volumes included.
- Placeholders: `<host>` is the ssh alias of the VM, `<ip>` is its address, `<domain>` is the app hostname, and `reports.<domain>` is the reports hostname.
- Secrets: fill the copies in `~/.omniswarm/env/` on your machine, never in the repo (`docs/ops/OWNER_TASKS.md` sections 3–5).

## Steps

1. **Laptop gate.** Run `npm run check:infra`. Expect `infra check ok`, in about 250 s on the first run, which also builds the check images. Shortened output from this branch:

   ```
   compose + env contract
     env contract: ok (0 errors, 1 warnings)
     compose refuses to start without each of 14 required values
   nginx
     nginx access log: truncated client address, path without query, no headers or cookies
     nginx -t ok (prod: omniswarm.example, reports.omniswarm.example)
   lint + dry runs
     shellcheck ok (28 scripts, all executable)
     workflow policy (.github/workflows/deploy.yml): ok
     actionlint ok (.github/workflows); deploy.yml: dispatch-only, protected environment, pinned actions
     checker unit tests: pass 30
     deploy, release, certbot, backup, restore, smoke, health, prune and log-hygiene dry runs print their plans
     health.sh: repair + alert on the 2nd failure only, one recovery alert, heartbeat only when green, workers and disk
     prune.sh: runs kept until OMNI_PRUNE_NOT_BEFORE, then only dirs with nothing newer than 30 days; ...
     log-hygiene.sh: exact secret values and key shapes found in journal, container and engine logs; names only in output; one alert
   systemd
     systemd-analyze verify ok (13 units)
   hosts (provisioning)
     provision.sh dry runs (local and --remote) plan every step; key fingerprints pinned; no curl | sh
     provision: idempotent (3rd run 0 changes), lockout guard, sshd -T, nft load x2, fail2ban -t, visudo, modes
   api image
     api image: 93 MB, uid=1000, healthcheck, no engine code / .env, /app read-only
   bring-up (stub apps)
     ok   tls-app … ok   rate-limit (28/40 answered 429)
     rolling restart to check-2: 162 requests during the roll, 0 failed, 3 replicas on the new image
     backup + restore drill: restored from db-…dump: stub_request=1
   infra check ok (251s)
   ```

   The one `warn:` line is `RUNS_ROOT`. `infra/env/worker.env.example` now sets it under `/srv/omniswarm/work`, but `apps/api/.env.example` still has it commented out. Then run `bash infra/check.sh --apps=real`: the same gate with the real api and web images. It ends `infra check ok (134s)`, with all 10 smoke checks `ok`.
2. **Provision the VM.**
   - Run `infra/deploy/provision.sh --dry-run --remote <host> --deploy-key ~/.ssh/omniswarm_deploy.pub`. It prints `git archive`, `scp` and one ssh block that runs `sudo bash $HOME/omniswarm-provision/infra/deploy/provision.sh --deploy-user deploy --dry-run …`. Run it without `--dry-run`.
   - Switch your ssh alias to `User deploy` and run it again. Expect `provision: 0 change(s)`.
   - On the host:
     - `id omniswarm` shows group `docker`
     - `stat -c %a /etc/omniswarm` prints `700`
     - `swapon --show` prints nothing
     - `docker info --format '{{.SecurityOptions}}'` shows `name=no-new-privileges`
     - `ss -ltn` shows no `:2375`/`:2376`
     - `sudo nft list table inet omniswarm` shows the ruleset
   - From outside, `nmap -Pn <ip>` shows only 22, 80 and 443, and `ssh -o PubkeyAuthentication=no <host>` is refused.
   - Every check is listed in `infra/README.md`, "Host hardening".
3. **Secrets.**
   - Run `node infra/deploy/secrets-check.mjs ~/.omniswarm/env`. It prints names and fingerprints, then `secrets check: ok`.
   - Run `infra/deploy/secrets.sh --dry-run <host>`. It prints one ssh install block per file, then `dry run: nothing was copied`.
   - Run it for real. Each file prints `installed /etc/omniswarm/<name> (root:root 0600, sha256:…)`, and the run ends with `api containers hold no provider or operator key`.
4. **Deploy.** First `infra/deploy/deploy.sh --dry-run <host> wave-12`. It prints `git archive`, `rsync`, then one ssh block that unpacks to `/srv/omniswarm/releases/wave-12` and runs `release.sh activate wave-12`. Then run it without `--dry-run`. The `release.sh` log:
   - shows `omniswarm.config.json` installed into the release
   - shows the health, prune and log-hygiene timers enabled
   - ends with `release wave-12 is live`

   On the first deploy, it issues the certificate first (`certbot.sh issue`, standalone on :80).
5. **Open the site.**
   - `https://<domain>/` shows the landing.
   - `https://<domain>/api/health` returns `{"ok":true,"network":"testnet",…,"workers":1,…}`.
   - `curl -I https://reports.<domain>/sample/report.html` shows `content-security-policy: … frame-ancestors https://<domain>; sandbox …` (copy a sample report into `/srv/omniswarm/reports/sample/` first).
6. **Smoke.** Run `infra/deploy/smoke.sh --network testnet <domain>`. Expect 10 `ok` lines and `smoke: all checks passed for https://<domain>`. The checks are: `tls-app`, `tls-reports`, `http-redirect`, `health`, `ready`, `web-root`, `app-headers`, `admin-blocked` (403), `reports-csp`, `rate-limit` (429 after a burst). Stop nginx (`docker compose … stop nginx`): it exits 1 with `FAIL` lines naming the checks. The worker self-test (`bin/audit demo` on the host) is not part of `smoke.sh` yet.
7. **Rollback.** Run `infra/deploy/deploy.sh <host> --rollback`. Then `readlink /srv/omniswarm/current` shows the previous release, and `smoke.sh` stays green. The dry run prints one ssh line, `sudo /srv/omniswarm/current/infra/deploy/release.sh rollback`.
8. **Restart on failure, and alerts.**
   - Stop the api containers: `sudo docker stop $(sudo docker ps -q --filter label=com.docker.compose.service=api)`.
   - Within 2 minutes, `journalctl -u omniswarm-health` shows two `FAIL api-health` runs, then the repair (`up -d --no-deps --no-recreate api web nginx`). The api is back.
   - The webhook gets one `down` alert and one `recovered` alert. The external check sends one alert and one recovery (`docs/ops/UPTIME.md`, "Drill").
   - A worker that exits is restarted by systemd (`Restart=always`). A failed one is reset by the timer.
   - The dry run, `sudo /srv/omniswarm/current/infra/deploy/health.sh --dry-run`, prints the four probes and the repair commands.
9. **Logs and retention.**
   - `sudo systemctl start omniswarm-log-hygiene` then `journalctl -u omniswarm-log-hygiene -n 3` shows `clean: N log source(s), last 24h, M secret value(s) and 4 shapes`.
   - `journalctl --disk-usage` is under 1 G.
   - `sudo /srv/omniswarm/current/infra/deploy/prune.sh --dry-run` prints `runs: kept (pruning starts 2026-12-31)` before that date.
   - `systemctl list-timers 'omniswarm-*'` lists the backup, certbot-renew, health, prune and log-hygiene timers.
10. **CI deploy (optional).** Set up the `production` environment (`docs/ops/OWNER_TASKS.md` section 10).
    - Every push runs job `plan` (dry runs only, no secrets).
    - Dispatching `deploy` with `tag=wave-12` waits for approval, deploys, and runs the smoke test.
    - Pull requests never trigger the workflow.

## Automated checks

- `npm run check:infra` is green (step 1), and `bash infra/check.sh --apps=real` is green. CI job `infra` runs `npm run check:infra`. Workflow `deploy` runs the dry runs on every push.
- `infra/deploy/smoke.sh <host>` has not been run: no host yet.
- `docs/ops/COST.md` has budgets only. The measured row needs one hosted run (W12-18).

## When you're done

All good: land it. Something wrong: tell the wave lead the step number and what you saw.
