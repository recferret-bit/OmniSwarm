# Owner check guide: full review and fix pass (2026-11-04)

Step-by-step check of what landed on `main` @ `b0c7636` (tag `review-2026-11-04`). Each step says what to run, what you should see, and what it proves. Tick the box when it matches.

What was found and what changed: [`../review-2026-11-03/README.md`](../review-2026-11-03/README.md) and [`../review-2026-11-03/FIXES.md`](../review-2026-11-03/FIXES.md).

Time: about 15 minutes for parts 1–3, about 1 hour for everything (most of it is waiting for Docker builds).

## Before you start

- [ ] Node 24 (`node -v` prints `v24.x`), git, Docker running, Chrome installed (for the browser e2e), Rust via rustup (for the contract).
- [ ] Never point any test at your own Postgres on `127.0.0.1:55432`. Every step below that needs a database starts a throwaway container on `55600` and stops it afterwards.
- [ ] No provider key is needed anywhere in this guide, and none of the steps calls a model, NEAR RPC or GitHub's API.

```sh
cd ~/work/OmniSwarm
git switch main && git pull
git log --oneline -1            # b0c7636 Full review and fix pass …
git tag --points-at HEAD        # review-2026-11-04
npm ci && npm ci --prefix tests/e2e
```

## Part 1: the new layout (2 min)

- [ ] `ls` shows only: `AGENTS.md CLAUDE.md LICENSE README.md SECURITY.md apps bin contracts docs engine infra package.json package-lock.json packages tests tools` (plus the `.claude`, `.github`, `.grok` dot-folders and `node_modules`).
- [ ] `ls engine` shows `docker eval native omniswarm.config.example.json runtime scripts skills`.
- [ ] `ls apps` shows `api web`. `ls packages` shows `guard schemas`.
- [ ] `find engine/scripts -mindepth 1 -type d` lists only fixture folders (`demo-fixture`, `harness-fixtures`, `report-fixtures`, `bridge-tool-snapshots`, …), with no module subfolders.
- [ ] `cmp engine/skills/security-audit/SKILL.md .claude/skills/security-audit/SKILL.md` prints nothing: the two skill copies are identical.

## Part 2: five-minute offline smoke (no Docker, no keys)

1. [ ] `node engine/scripts/harness.mjs --self-test` prints `harness self-test ok (104 patterns)`.
2. [ ] Run the offline demo:
   ```sh
   OUT=$(mktemp -d) && ./bin/audit demo --no-docker --out "$OUT"; open "$OUT/report.html"
   ```
   You should see `DEMO — not a review` and `Demo report saved to: …`. The folder contains `debate/`, `general-review.json`, `reviewers/` and `findings-and-scores.json`. In the browser, the report shows a DEMO stamp, 5 findings (4 LIKELY, 1 REFUTED), a General review section and a link to the per-reviewer pages.
   *Proves:* the debate runs on the run's own findings (W06 fix), and the per-reviewer pages and general review are produced (W05, W07).
3. [ ] `node -e "const r=require('$OUT/findings-and-scores.json');console.log((r.findings||r).map(f=>f.finalStatus))"` prints statuses such as `LIKELY` and `REFUTED`. *Proves:* final statuses reach the report data (W06 gap 3).
4. [ ] Show the plan for a mixed preset without running it:
   ```sh
   ./bin/audit run --repo engine/scripts/demo-fixture --preset mixed --config engine/omniswarm.config.example.json --plan
   ```
   You should see `Assignment: matrix (36 jobs)` and a `Budgets:` line, and the command exits 0. *Proves:* the matrix assignment is planned the way the report contract validates it (W01 fix).
5. [ ] `node packages/guard/demo/attack/run.mjs` ends with `Outcome: **refused_before_signing** (GUARD_BLOCK). Signer calls: 0.` Then `node packages/guard/demo/attack/run.mjs --no-guard` ends with `Outcome: **would_send**`. *Proves:* the guard now checks who actually receives the payment (W13 fix).
6. [ ] `bash tools/screener-check.sh` ends with `screener check ok`. It runs the README's screener blocks in a clean clone, then the secret sweep (gitleaks if installed).

## Part 3: the full gate (10–15 min)

```sh
docker run --rm -d --name owner-pg -p 127.0.0.1:55600:5432 -e POSTGRES_PASSWORD=pw postgres:16-alpine
sleep 5
export DATABASE_URL=postgres://postgres:pw@127.0.0.1:55600/postgres
npm run check:all
```

- [ ] It exits 0. Look for these counts on the way:

| Stage | Expect |
|---|---|
| `test:schemas` | `ℹ pass 164`, `ℹ fail 0` |
| `test:tools` | `ℹ pass 23` |
| `test:intake` | `ℹ pass 73`, `ℹ skipped 1` (the live GitHub test needs `OMNI_LIVE=1`) |
| `test:landing` | typecheck clean, then `Tests 57 passed` |
| `test:contract` | `test result: ok. 86 passed` |
| `test:e2e` | `ℹ pass 5` (headless Chrome at 360 px, axe checks) |
| `check:infra` | `infra check ok` |
| harness + `npm test` | `harness self-test ok`, `ℹ pass 473`, `ℹ fail 0` |

Keep `DATABASE_URL` exported for Part 4, then stop the container at the end of it.

## Part 4: each wave on its own

Run each one and check that it exits 0. W02 needs Docker and the sandbox image (Part 5 builds it if missing).

| Wave | Command | Expect |
|---|---|---|
| W00 foundation | `npm run check:w00` | `W00 ok` |
| W01 reviewer registry | `npm run check:w01` | `ℹ pass 45` then `ℹ pass 473` |
| W02 sandbox hardening | `OMNI_REQUIRE_HARDENING=1 npm run check:w02` | `ℹ pass 473` then the Docker half `ℹ pass 9` |
| W03 API reviewers | `npm run check:w03` | `ℹ pass 4` (includes the 3-turn OpenRouter replay) |
| W04 iteration budget | `npm run check:w04` | `ℹ pass 5` (Docker-path budget wiring) |
| W05 per-reviewer reports | `npm run check:w05` | `ℹ pass 4` |
| W06 orchestrator & debate | `npm run check:w06` | `ℹ pass 39` |
| W07 report v2 | `npm run check:w07` | `ℹ pass 15` |
| W08 intake API | `npm run check:w08` | `ℹ pass 73` then e2e `ℹ pass 6` |
| W09 queue & worker | `npm run check:w09` | `ℹ pass 73` then e2e `ℹ pass 7` (SIGTERM keeps the retry, exactly one attestation) |
| W10 review registry | `CARGO_TARGET_DIR=/tmp/omni-cargo npm run check:w10` | `86 passed`, clippy clean, the deploy dry run prints its commands |
| W11 landing app | `npm run check:w11` | web tests, landing e2e `ℹ pass 5`, bundle guard `no mock wallet, MSW, mock controls …` |
| W12 remote host | `npm run check:w12` | `infra check ok` |
| W13 agent guard | `npm run check:w13` | `ℹ pass 84`, typecheck clean, both attack-demo runs |
| W14 submission | `npm run check:w14` | `screener check ok`, then the whole `check:all` again |

- [ ] All 15 exit 0.
- [ ] `docker stop owner-pg` (it was started with `--rm`, so it is gone afterwards).

## Part 5: Docker paths (20–40 min, mostly image builds)

1. [ ] `npm run test:docker` ends with `ℹ tests 34`, `ℹ pass 34`, `ℹ fail 0`. Before this pass it was 14 of 33.
2. [ ] The real demo through the sandbox:
   ```sh
   OUT=$(mktemp -d) && ./bin/audit demo --surface s1 --out "$OUT"; echo "exit=$?"
   ```
   The first run builds `audit-sandbox:local` with `cargo-near` 0.22.0 and the wasm target, which takes several minutes. Expect `exit=0`, the line `DEMO — verification limited by design`, and a single remaining gap: `NEAR contract tests in . are a local-sandbox coverage gap…`.
   - [ ] In `$OUT/report-health.json`, `reviewState` is `validated_outputs`, and the passed suites are `near-build`, `near-clippy` and the client's `npm` suite.
   - [ ] In `$OUT/report.html`, the NEAR row of the evidence table shows the near-build and near-clippy results, not "not run".
   *Proves:* NEAR builds are really verified, and the demo no longer ends "AUDIT FAILED". A real target with the same gap still exits 2 (`engine/scripts/audit-demo-verdict.test.mjs`).
3. [ ] `npm run test:contract:sandbox` ends with `test result: ok. 6 passed`. The first run downloads a `near-sandbox` binary. These are the contract's near-workspaces integration tests: request → attest → lookup, refund, a failed refund that rolls back, a second `new` rejected, `#[private]` callbacks, and report/retract.

## Part 6: the web app by hand (10 min, mocks only)

```sh
npm run dev -w apps/web          # mocks and the mock wallet are the dev defaults (apps/web/.env.development)
```

Open http://localhost:3000 and walk the flow:

1. [ ] **Connect wallet:** the account chip shows `alice.testnet`. It is still connected after a reload. **Sign out** removes it.
2. [ ] **Get a quote:** paste `https://github.com/near/near-sdk-rs` and click Get quote. A commit SHA, the price, the queue depth and an ETA appear.
3. [ ] **Sign, then Pay:** you land on `/r/<id>`. The timeline walks `queued → running → publishing → done` and the progress bar moves.
4. [ ] **Report page:** shows "hash matches on-chain attestation", the attest time and whether the binding is confirmed.
5. [ ] **Tamper:** in the mock panel, click **Tamper the report**. The hash check turns red. **Restore the report** turns it green again.
6. [ ] **Error copy:** open `/?mock=QUEUE_FULL`. The quote says the queue is full and **Pay is never offered**. Open `/?mock=REPO_PRIVATE` for the private-repo message. Open `/?wallet=reject` and click Pay: you get "Payment cancelled in wallet" and a **Retry** button.
7. [ ] `/sample` shows the sample report labelled "Attested (sample)". `/me` lists your requests.
8. [ ] Narrow the browser to phone width (about 360 px). Nothing scrolls sideways.
9. [ ] Stop the dev server, then run `npm run guard -w apps/web`. It builds production and prints `production bundle checked (… files): no mock wallet, MSW, mock controls, fixture hash or key-shaped strings`. *Proves:* the mock panel and mock wallet never ship to production.

## Part 7: the whole stack locally (10 min)

```sh
npm run stack:local
```

1. [ ] It builds the api and web images and starts postgres, migrate, api ×2, web and nginx, then prints the worker command. Leave the worker off for now.
2. [ ] `curl -k https://omniswarm.localhost:18443/api/health` returns `{"ok":true,…}`, and `curl -k https://omniswarm.localhost:18443/api/ready` returns 200. If 18443 was busy, use the port `local.sh` printed.
3. [ ] `curl -k -o /dev/null -w '%{http_code}\n' https://omniswarm.localhost:18443/api/admin/requests` prints `403`: nginx never proxies the admin routes.
4. [ ] `docker ps --filter name=api` shows two api containers. *Proves:* the API runs as several replicas behind nginx.
5. [ ] Optional: in a second terminal, run the worker command `local.sh` printed (mock chain, mock engine) and watch it start and wait for jobs. The web image is a production build with the real wallet, so the click-through of Part 6 stays on `npm run dev`.
6. [ ] `npm run stack:local:down` stops everything and keeps the database volume. `bash infra/compose/local.sh reset` removes the volume too.
7. [ ] `bash infra/check.sh --apps=real` ends with `smoke: all checks passed` and `infra check ok`. It brings the same stack up on its own project and ports, checks TLS, the redirect, health, ready, the web root, headers, admin blocked, the reports CSP and rate limiting, then tears it down.

## Part 8: deploy scripts in dry-run only

None of these touch a host or a network. Each prints the plan and exits 0.

- [ ] `bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run`: the operator key's method list is exactly `mark_running, attest, refund, report_address`, and no key material is printed.
- [ ] `bash infra/deploy/provision.sh --dry-run`
- [ ] `bash infra/deploy/deploy.sh --dry-run deploy-host.invalid HEAD`: prints the release, migrate and rolling-restart plan.
- [ ] `bash infra/deploy/smoke.sh --dry-run omniswarm.example`: ends with `dry run: nothing was sent`.
- [ ] `bash infra/deploy/backup.sh --dry-run` and `bash infra/deploy/restore.sh drill --dry-run`
- [ ] `.github/workflows/deploy.yml`: a push only runs the dry-run job, with no secrets. The `deploy` job runs only on `workflow_dispatch`, in the `production` environment. There is no `pull_request` trigger.

Each script's usage line (run it with no arguments) lists its options.

## Part 9: spot-check the audit's worst findings

Each line below is a finding from the 2026-11-03 audit, with where to see it fixed. Each one has a test that fails on the old code.

| Finding | Where it is fixed | Test |
|---|---|---|
| Multi-reviewer matrix runs always INCOMPLETE | `engine/scripts/report-contract.mjs` uses `reviewer-plan-assign.mjs` | `report-contract.test.mjs` "W01-09 …" |
| OpenRouter `vendor/model` ids rejected | `validModelId` in `reviewer-registry.mjs`, used by submissions | `tests/e2e/engine/w03.test.mjs` replay |
| Budgets never reached real (Docker) runs | `docker-agent-orchestrator.mjs`, `reviewer-pass-loop.mjs` | `tests/e2e/engine/w04.test.mjs` |
| Cost ceiling capped each loop, not the run | `bridge-budget.mjs` `spentUsd`, the pass loop skips passes | `reviewer-pass-loop.test.mjs` |
| Debate invented findings on real targets | `orchestrator-phase-debate.mjs`, `debate-*.mjs` | `debate-phases.test.mjs` |
| Golden eval was 6 copies of one file | `engine/eval/golden/*` (6 distinct repos) | `npm run eval:golden` |
| Admin refund public behind a default token | loopback admin listener, ≥32-char token, refund queued to the worker | `apps/api/test` replicas, `w09.spec` step 9 |
| Engine inherited worker secrets | allow-listed engine env in `apps/api/src/engine` | `engine-cli.test.ts` |
| No real queue, crash re-ran jobs twice | pg-boss with heartbeat, retry and singleton | `crash.test.ts` |
| In-memory rate limit (not multi-replica) | Postgres rate-limit store, LISTEN/NOTIFY SSE | `replicas.test.ts` |
| Signed message fields not enforced | byte-equal canonical message, preset allow-list, single-use nonce | `http-intake.test.ts`, `auth.test.ts` |
| Frontend could not connect a wallet | Next.js 16 + Zustand, `@hot-labs/near-connect` | `npm test -w apps/web`, landing e2e |
| Contract withdraw could drain storage | `get_withdrawable` reserve, transfer callbacks | `cargo test` |
| Guard checked the wrong field | receiver and payees checked, lookups awaited | `npm test -w packages/guard` |
| Worker unit started the API | `infra/systemd/omniswarm-worker@.service` | `infra/check.sh` systemd stage |
| Logs carried query strings, IPs, keys | `apps/api/src/shared/log-scrub.ts` | `logger.test.ts` |

- [ ] Open two or three of these and confirm the fix and test are there.

## Part 10: what only you can do

Full commands are in [`../../ops/OWNER_TASKS.md`](../../ops/OWNER_TASKS.md). None of these were run by this pass.

- [ ] **Placeholders:** replace the placeholder contract id `review-registry.omniswarm.testnet`, the domains and the `SECURITY.md` contact address. `NEXT_PUBLIC_CONTRACT_ID` must equal the API's `CONTRACT_ID` (`infra/deploy/secrets.sh` refuses a mismatch).
- [ ] **Testnet deploy:** `bash contracts/review-registry/scripts/deploy-testnet.sh --execute`, then a first live run of the NEAR adapter. Issue the operator key with `report_address` included.
- [ ] **Native reviewers:** `node engine/native/codex-review/admit.mjs --admit` and `node engine/native/grok-review/admit.mjs --admit`. These have never been admitted. The step clones and builds the pinned upstream sources and takes a long time.
- [ ] **Provider limits:** set the OpenRouter monthly spend limit and the Z.ai prepaid balance before the first hosted run. The engine ceiling is $25 per reviewer for the whole run (`docs/ops/COST.md`).
- [ ] **Submission:**
  - The dogfood review with real models ([`../../hackathon/dogfood.md`](../../hackathon/dogfood.md)).
  - The video ([`../../hackathon/VIDEO.md`](../../hackathon/VIDEO.md)).
  - The owner fields in [`../../hackathon/SUBMISSION.md`](../../hackathon/SUBMISSION.md).
- [ ] **Host steps:** provisioning on a real host, plus [`w12-check.md`](./w12-check.md) steps 2–10 and off-box backups.
- [ ] **Worktree cleanup:** `git worktree remove --force ../OmniSwarm-wt/w10` and `git worktree remove --force .claude/worktrees/agent-ac3d8f4ce061a1b66`, then remove any other leftover `.claude/worktrees/*` entry, and finish with `git worktree prune`.

## Known limits (expected, not failures)

- The demo's HTML still says INCOMPLETE VERIFICATION for the one NEAR local-sandbox gap. The demo verdict is what exits 0.
- The binding proof shows the requester controls the deployed account, not that its code came from the reviewed commit.
- The guard's account-age signal is off by default, and the NearBlocks response shape is unverified.
- A guard-report job that cannot pay for contract storage (`ERR_RESERVE`) stops after 5 retries with no alert.
- `GET /api/reports/:id` lists the reviewers and the general-review link only when the API can read the reports folder. Compose mounts it read-only; an API started without that mount leaves those two fields out.
