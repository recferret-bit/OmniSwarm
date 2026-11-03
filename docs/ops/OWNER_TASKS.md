# Owner tasks for the hosted demo

These are the steps only the owner can do: rent the host, buy or point the domain, create keys, sign testnet transactions, and deploy for the first time. Do them in order. Each task says where to do it and what to hand over: a variable name and the env file it goes in. **No real value belongs in this file or anywhere in the repository.**

Keep your filled env files in `~/.omniswarm/env/` on your own machine (`chmod 700` on the directory, `chmod 600` on the files). `infra/deploy/secrets.sh` copies them to the host.

`<you>` below is your NEAR testnet account name without `.testnet`. `<domain>` is the app hostname, and `<host>` is the ssh alias of the VM.

## 1. Host

- [ ] Rent one Linux VM: 8 vCPU, 32 GB RAM, 200 GB SSD, Debian 13 or Ubuntu 24.04, a public IPv4 address. See `docs/ops/COST.md` "Host" for the reasoning and a smaller fallback. Needed by D4 (HACKATHON_CUT).
- [ ] Add an ssh alias for it to `~/.ssh/config` on your machine (`Host <host>`, `HostName <ip>`, `User <cloud default user or root>`).
- [ ] Create a dedicated deploy key: `ssh-keygen -t ed25519 -f ~/.ssh/omniswarm_deploy -C omniswarm-deploy`.
- [ ] Check the plan, then provision. The first command contacts nothing; the second applies the plan over ssh. The ssh user must be root, or have passwordless sudo (the cloud images' default user does), because the remote `sudo` runs without a terminal. If the image ships a distribution `nodejs` older than 24 that apt keeps, the script stops with a message. Remove that package and run it again:
  ```sh
  infra/deploy/provision.sh --dry-run --remote <host> --deploy-key ~/.ssh/omniswarm_deploy.pub
  infra/deploy/provision.sh --remote <host> --deploy-key ~/.ssh/omniswarm_deploy.pub
  ```
  After that, connect as `deploy` with that key: change the alias to `User deploy` and `IdentityFile ~/.ssh/omniswarm_deploy`. Run the second command again: it must end with `provision: 0 change(s)`.
- [ ] Verify the host (the commands are in `infra/README.md`, "Host hardening"). From another machine, `nmap -Pn <ip>` must show only 22, 80 and 443.

## 2. Domain and DNS

- [ ] Create an `A` record for `<domain>` and one for `reports.<domain>`, both pointing at the VM. Add `AAAA` records too if the VM has IPv6. Set a low TTL (300 s) until the demo ends.
- [ ] **No domain by D6?** Use a free dynamic-DNS name (for example two DuckDNS names: `<name>.duckdns.org` and `<name>-reports.duckdns.org`) or two provider-assigned hostnames. The reports must stay on a hostname of their own. Never serve them from the app origin: the reports CSP sandbox and `frame-ancestors` depend on the separate origin.
- [ ] Hand over: `OMNI_DOMAIN` and `OMNI_REPORTS_DOMAIN` (`stack.env`), and `REPORTS_BASE_URL=https://<reports hostname>` (`worker.env`). Set `OMNI_ACME_EMAIL` (`stack.env`) to the address Let's Encrypt should write to.

## 3. Keys and accounts

| Task | Where | Hand over |
|---|---|---|
| [ ] Z.ai **pay-as-you-go** API key. Not the Coding Plan, which may only be used through Z.ai's own coding tools (OD-04). Top up a small prepaid balance: that balance is the hard spend limit | z.ai console, API keys | `ZAI_API_KEY` (`providers.env`) |
| [ ] OpenRouter API key, with a **monthly spend limit** set on the key (`docs/ops/COST.md` explains why that limit is the real ceiling). The engine sends `data_collection: "deny"` on every request | openrouter.ai, Keys | `OPENROUTER_API_KEY` (`providers.env`) |
| [ ] Fine-grained GitHub token: public repositories, read-only, no other permission. Optional: without it, the API uses the unauthenticated rate limit | github.com, Settings, Developer settings, Fine-grained tokens | `GITHUB_TOKEN` (`stack.env`) |
| [ ] Generate three random secrets: `openssl rand -hex 32`, run once for each | your machine | `SESSION_SECRET`, `ADMIN_TOKEN`, `POSTGRES_PASSWORD` (`stack.env`); the same password inside `DATABASE_URL` (`worker.env`) |
| [ ] An alert webhook (a Slack or Discord incoming webhook) and a heartbeat URL (`docs/ops/UPTIME.md`) | Slack/Discord, healthchecks.io | `OMNI_ALERT_WEBHOOK_URL`, `OMNI_HEARTBEAT_URL` (`ops.env`) |

## 4. Testnet contract (W10)

You need `near` (near-cli-rs 0.30) and `cargo-near` on your machine, not on the host. You also need a funded testnet account `<you>.testnet` with at least 7 NEAR: 5 for the contract account, 1 for the operator account, and gas.

- [ ] Print the six commands (this touches nothing), read them, then run them:
  ```sh
  OWNER=<you>.testnet bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run
  OWNER=<you>.testnet bash contracts/review-registry/scripts/deploy-testnet.sh --execute
  ```
  This creates `review-registry.<you>.testnet` (the contract) and `operator.<you>.testnet`, deploys with price 1 NEAR, adds the operator's function-call key, and reads back `get_price`. Override `CONTRACT`, `OPERATOR`, `TREASURY`, `PRICE_YOCTO` or `OPERATOR_ALLOWANCE` in the environment if you need other values.
- [ ] Check the operator key: `near account list-keys operator.<you>.testnet network-config testnet now` must show one function-call key for `review-registry.<you>.testnet`, limited to `mark_running`, `attest` and `refund`.
- [ ] Copy the operator key file that step 5 wrote under `~/.near-credentials/testnet/` (named `operator.<you>.testnet.json`, or a `<public key>.json` inside `operator.<you>.testnet/`) to `~/.omniswarm/env/operator-key.json`. It holds `account_id`, `public_key` and `private_key`. Its `public_key` must be the function-call key from the check above. Never copy the contract account's own key: that is the upgrade key, and it stays offline in your keychain.
- [ ] Hand over:
  - `CONTRACT_ID=review-registry.<you>.testnet` in `stack.env` **and** in `worker.env`
  - `NEXT_PUBLIC_CONTRACT_ID` in `stack.env`, which **must equal `CONTRACT_ID`**. Otherwise every payment stops at `CONTRACT_MISMATCH` in the browser. `secrets.sh` refuses a mismatch.
  - `INTAKE_RECIPIENT` and `NEXT_PUBLIC_INTAKE_RECIPIENT` (`stack.env`, equal): the NEP-413 recipient the wallet signs for. Use an account you own, for example `<you>.testnet`.
  - `RPC_URLS` in `stack.env` and in `worker.env` (equal), and `NEXT_PUBLIC_RPC_URL`: one or more testnet RPC endpoints. If a provider puts an API key in the URL, treat the URL as a secret.
  - `PRICE_YOCTO=1000000000000000000000000` (1 NEAR, OD-08) in `stack.env`.

## 5. Fill the env files

- [ ] Copy the examples and fill every empty value:
  ```sh
  mkdir -p -m 700 ~/.omniswarm/env
  for f in stack worker providers ops; do install -m 600 infra/env/$f.env.example ~/.omniswarm/env/$f.env; done
  ```
- [ ] `HOSTED_PRESET` in `stack.env` and in `worker.env` (equal): `hosted` for the six API reviewers (OD-04), or `demo` for a first deploy that spends nothing.
- [ ] Optional: `~/.omniswarm/env/omniswarm.config.json`, your copy of `engine/omniswarm.config.example.json` with your own presets or `prices`. Without it, each release uses the example file, which defines `hosted` and `demo`.
- [ ] Check without copying anything: `node infra/deploy/secrets-check.mjs ~/.omniswarm/env`. It lists each variable name with a fingerprint and refuses:
  - an empty required value
  - a contract-id mismatch, or a placeholder contract id (`*.mock`, `review-registry.owner.testnet`)
  - a `DATABASE_URL` whose password is not `POSTGRES_PASSWORD`
  - secrets shorter than the minimum
  - an operator key of the contract account

### Placeholder contract ids in the repository

These stay as they are. They are local or test defaults, and production takes its ids from `stack.env`:

| File | Value | Used by |
|---|---|---|
| `infra/env/dev.env.example` | `review-registry.mock` | `npm run stack:local` and the infra gate (mock chain) |
| `apps/web/.env`, `apps/web/.env.example`, `apps/web/vitest.config.ts` | `review-registry.omniswarm.testnet` | local `next dev` and the web tests. The production image gets `NEXT_PUBLIC_CONTRACT_ID` as a build argument from `stack.env` |
| `contracts/review-registry/scripts/deploy-testnet.sh` | `OWNER=owner.testnet` | the default when you forget `OWNER=`. The script then fails, because you do not hold that account's key |

If you want `next dev` on your machine to talk to your real contract, ask the web track to change `apps/web/.env`. Do not put a production value in `apps/web/.env.example`.

## 6. Install the secrets

- [ ] `infra/deploy/secrets.sh --dry-run <host>` prints the plan. Then run `infra/deploy/secrets.sh <host>`. It installs each file as `/etc/omniswarm/<name>` (`root:root 0600`), compares hashes, and prints names and fingerprints only.

## 7. First deploy

- [ ] Tag the release you deploy, on your machine: `git tag wave-12 <commit>`. `deploy.sh` reads local tags. Push the tag if CI should deploy it later.
- [ ] Run these in order:
  ```sh
  infra/deploy/deploy.sh --dry-run <host> wave-12   # the plan; contacts nothing
  infra/deploy/deploy.sh <host> wave-12             # first run also issues the TLS certificate
  infra/deploy/smoke.sh --network testnet <domain>  # 10 checks, all "ok"
  ```
- [ ] Copy one sample report to `/srv/omniswarm/reports/sample/` so the smoke test's `reports-csp` check has a page to fetch. Then follow `docs/plan/checks/w12-check.md` from step 5.

## 8. Native reviewers on your machine (not on the host)

The hosted preset uses API keys only. The native Codex and Grok brokers are for your local runs. Their admission receipts are bound to the exact engine sources, so re-admit after every change to `engine/scripts/` or `engine/native/` (`docs/live-model.md`):

```sh
node engine/native/codex-review/build.mjs --test
node engine/native/codex-review/admit.mjs --admit
./bin/audit check-model-cli --provider codex-native
node engine/native/grok-review/build.mjs --test
node engine/native/grok-review/admit.mjs --admit
./bin/audit check-model-cli --provider grok-native
```

- [ ] Both `--admit` runs end with an admission receipt, and both `check-model-cli` runs pass.

## 9. Uptime and alerts

- [ ] Pick the external check (`docs/ops/UPTIME.md`, "Off the host"), set it up, and record the choice here: `____`.
- [ ] Run the drill in `docs/ops/UPTIME.md`. Expect one alert and one recovery.
- [ ] On 2026-11-25, follow "After 2026-11-25" in the same file.

## 10. CI deploy (optional, `H+`)

`.github/workflows/deploy.yml` deploys on a manual dispatch only.

- [ ] Create the GitHub environment `production` (Settings → Environments). Add yourself as a required reviewer, and limit deployments to protected branches and tags.
- [ ] Environment secrets:
  - `DEPLOY_SSH_KEY`: the private half of `~/.ssh/omniswarm_deploy`
  - `DEPLOY_KNOWN_HOSTS`: the output of `ssh-keyscan -t ed25519 <ip>`. Compare its fingerprint with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the host itself.
- [ ] Environment variables: `DEPLOY_HOST` (IP or hostname), `DEPLOY_USER` (`deploy`), `OMNI_DOMAIN`, `NETWORK` (`testnet`).
- [ ] Actions → deploy → Run workflow, with `tag=wave-12`. The run waits for your approval, deploys, then runs the smoke test.

## 11. Security contact

- [ ] Replace `<SECURITY_CONTACT_EMAIL>` in `SECURITY.md` with an address you read.
- [ ] Turn on private vulnerability reporting (Settings → Code security).

## 12. Cost measurement (W12-18)

- [ ] After the first hosted review, fill the table in `docs/ops/COST.md` ("Measuring a hosted run").

## 13. Mainnet payout account (W14)

- [ ] Create the mainnet account that will receive withdrawals once mainnet is priced (OD-08). Hand it over only when W14 asks. Mainnet stays off for the hackathon.

## Maintenance while the demo runs

- Security updates install themselves (`unattended-upgrades`). The host never reboots on its own. When `/var/run/reboot-required` exists, reboot when no review is running: `systemctl is-active omniswarm-worker@1` and `/api/health` `queueDepth` 0.
- Docker and Node come from their own repositories and do not auto-upgrade. Upgrade them with `sudo apt-get install --only-upgrade docker-ce nodejs` in the same window.
- Changed a secret? Run `secrets.sh` again. For `worker.env`, `providers.env` or `operator-key.json`, restart the workers: `sudo systemctl restart omniswarm-workers.target`. For `stack.env`, deploy again: compose reads it when it recreates the containers. Use a new tag or commit, because `deploy.sh` refuses the release that is already current.
