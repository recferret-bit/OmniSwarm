# Owner tasks for the hosted demo

These are the steps only the owner can do: rent the host, buy or point the domain, create keys, register the donation account, and deploy for the first time. Do them in order. Each task says where to do it and what to hand over: a variable name and the env file it goes in. **No real value belongs in this file or anywhere in the repository.**

Keep your filled env files in `~/.omniswarm/env/` on your own machine (`chmod 700` on the directory, `chmod 600` on the files). `infra/deploy/secrets.sh` copies them to the host.

`<you>` below is your NEAR mainnet account name. `<domain>` is the app hostname, and `<host>` is the ssh alias of the VM.

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
| [ ] No provider key. OmniSwarm charges users nothing and pays for no review: each user pastes their own NEAR AI Cloud key on `/dashboard`. Leave `providers.env` empty (the worker unit still loads the file) | nothing to buy | nothing (`providers.env` stays comment-only) |
| [ ] Generate the account-key secret: `openssl rand -base64 48`. It seals each account's own NEAR AI key in Postgres and must differ from `SESSION_SECRET`, because the workers receive it. Without it a production API cannot store any account's key | your machine | `ACCOUNT_KEYS_SECRET` (`stack.env` and `worker.env`, equal) |
| [ ] A mainnet NEAR RPC endpoint for wallet sign-in (the API checks that the signing key belongs to the account). Keep `KEY_VERIFIER=rpc`: production refuses `mock`. If the provider puts an API key in the URL, treat the URL as a secret | an RPC provider (for example FastNEAR) | `RPC_URLS` (`stack.env`), a comma list of https URLs |
| [ ] Fine-grained GitHub token: public repositories, read-only, no other permission. Optional: without it, the API uses the unauthenticated rate limit | github.com, Settings, Developer settings, Fine-grained tokens | `GITHUB_TOKEN` (`stack.env`) |
| [ ] Generate two random secrets: `openssl rand -hex 32`, run once for each | your machine | `SESSION_SECRET`, `POSTGRES_PASSWORD` (`stack.env`); the same password inside `DATABASE_URL` (`worker.env`) |
| [ ] An alert webhook (a Slack or Discord incoming webhook) and a heartbeat URL (`docs/ops/UPTIME.md`) | Slack/Discord, healthchecks.io | `OMNI_ALERT_WEBHOOK_URL`, `OMNI_HEARTBEAT_URL` (`ops.env`) |

## 4. NEAR

OmniSwarm has no contract of its own, no operator key and no payment (docs/spec/DECISIONS.md, 2026-11-13). There is nothing to deploy on a NEAR network. NEAR appears only in wallet sign-in (NEP-413) and in the optional mainnet USDC donation (task 13).

## 5. Fill the env files

- [ ] Copy the examples and fill every empty value:
  ```sh
  mkdir -p -m 700 ~/.omniswarm/env
  for f in stack worker providers ops; do install -m 600 infra/env/$f.env.example ~/.omniswarm/env/$f.env; done
  ```
- [ ] Dashboard reviews always run `account-nearai` on the user's own key (OD-26); there is no hosted preset. Leave `OMNI_API_NODE_ENV=production` and `GITHUB_ADAPTER=live` as they are: production refuses the test adapters.
- [ ] Optional: `~/.omniswarm/env/omniswarm.config.json`, your copy of `engine/omniswarm.config.example.json` with your own presets or `prices`. Without it, each release uses the example file, which defines `hosted` and `demo`.
- [ ] Check without copying anything: `node infra/deploy/secrets-check.mjs ~/.omniswarm/env`. It lists each variable name with a fingerprint and refuses:
  - an empty required value
  - a `DATABASE_URL` whose password is not `POSTGRES_PASSWORD`
  - secrets shorter than the minimum
  - a `.testnet` donation recipient (mainnet only)
  - any variable in `providers.env`

## 6. Install the secrets

- [ ] `infra/deploy/secrets.sh --dry-run <host>` prints the plan. Then run `infra/deploy/secrets.sh <host>`. It installs each file as `/etc/omniswarm/<name>` (`root:root 0600`), compares hashes, and prints names and fingerprints only.

## 7. First deploy

- [ ] Tag the release you deploy, on your machine: `git tag wave-12 <commit>`. `deploy.sh` reads local tags. Push the tag if CI should deploy it later.
- [ ] Run these in order:
  ```sh
  infra/deploy/deploy.sh --dry-run <host> wave-12   # the plan; contacts nothing
  infra/deploy/deploy.sh <host> wave-12             # first run also issues the TLS certificate
  infra/deploy/smoke.sh <domain>  # 10 checks, all "ok"
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
- [ ] Environment variables: `DEPLOY_HOST` (IP or hostname), `DEPLOY_USER` (`deploy`), `OMNI_DOMAIN`.
- [ ] Actions → deploy → Run workflow, with `tag=wave-12`. The run waits for your approval, deploys, then runs the smoke test.

## 11. Security contact

- [ ] Replace `<SECURITY_CONTACT_EMAIL>` in `SECURITY.md` with an address you read.
- [ ] Turn on private vulnerability reporting (Settings → Code security).

## 12. Cost measurement (W12-18)

- [ ] After the first hosted review, fill the table in `docs/ops/COST.md` ("Measuring a hosted run").

## 13. Donations (optional, mainnet only)

The user dashboard and the end of the landing page can show a NEAR USDC donation section (README "Support the project"). It is hidden until you set a recipient. A donation is a NEP-141 `ft_transfer` with 1 yoctoNEAR attached, signed by the donor's wallet.

- [ ] Pick a mainnet recipient account (`<you>.near` or an implicit account). Use an account you control; it receives the USDC directly. A `.testnet` account is refused by `secrets.sh`.
- [ ] Storage-register it on the USDC contract, or every transfer to it fails. Read the minimum deposit, check the account, then register it once (mainnet USDC is `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`):
  ```sh
  USDC=17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1
  near contract call-function as-read-only $USDC storage_balance_bounds json-args '{}' network-config mainnet now
  near contract call-function as-read-only $USDC storage_balance_of json-args '{"account_id":"<recipient>"}' network-config mainnet now
  near contract call-function as-transaction $USDC storage_deposit \
    json-args '{"account_id":"<recipient>","registration_only":true}' \
    prepaid-gas '30.0 Tgas' attached-deposit '<min from storage_balance_bounds, in NEAR>' \
    sign-as <you>.near network-config mainnet sign-with-keychain send
  ```
  `storage_balance_of` returns `null` before the deposit and a balance after it.
- [ ] Hand over: `NEXT_PUBLIC_DONATION_ACCOUNT=<recipient>` (`stack.env`). Leave `NEXT_PUBLIC_DONATION_USDC_CONTRACT` empty to use mainnet USDC; set it only to use another NEP-141 contract (the recipient must be registered there too). `secrets.sh` refuses a `.testnet` recipient.
- [ ] Deploy again: both values are web build args, so the section appears only in a new web image.

## Maintenance while the demo runs

- Security updates install themselves (`unattended-upgrades`). The host never reboots on its own. When `/var/run/reboot-required` exists, reboot when no review is running: `systemctl is-active omniswarm-worker@1` and `/api/health` `queueDepth` 0.
- Docker and Node come from their own repositories and do not auto-upgrade. Upgrade them with `sudo apt-get install --only-upgrade docker-ce nodejs` in the same window.
- Changed a secret? Run `secrets.sh` again. For `worker.env` or `providers.env`, restart the workers: `sudo systemctl restart omniswarm-workers.target`. For `stack.env`, deploy again: compose reads it when it recreates the containers. Use a new tag or commit, because `deploy.sh` refuses the release that is already current.
