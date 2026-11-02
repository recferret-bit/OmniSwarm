# W00 — Foundation: owner check

Wave file: [`../waves/W00-foundation.md`](../waves/W00-foundation.md). About 10 minutes (the engine tests take about 80 seconds, twice if you also run `check:all`).

Every command and output below was run by the wave lead in the worktree on 2026-11-02 (Node v24.15.0, macOS). Outputs are shortened.

## Before you start

- Branch and worktree: `wave/w00-foundation` in `../OmniSwarm-wt/w00`. The main checkout is untouched.
- Docker is not needed. No provider login, key or network call is used by any step. `./bin/audit setup-agents` is not needed: this wave makes `npm test` pass without `runtime/node_modules`.
- Placeholders: none. Paths are relative to the worktree.

```sh
cd ../OmniSwarm-wt/w00
git status -sb            # ## wave/w00-foundation, clean
```

## Steps (same numbers as the wave's demo story)

### 1. Install

```sh
npm ci
```

See: `found 0 vulnerabilities`; `runtime/` is untouched (it keeps its own lockfile). Check the workspace link: `node -e "import('@omniswarm/schemas').then(m=>console.log(m.validate('reviewer-spec','cli:claude:opus').ok))"` prints `true`.

### 2. Engine tests without `runtime/node_modules`

```sh
ls runtime            # README.md package-lock.json package.json   (no node_modules)
npm test
```

See (about 80 s):

```
ℹ tests 258
ℹ pass 258
ℹ fail 0
```

Before this wave, 257 of 258 passed (R-19: `runtime_missing`). The fix is an injectable `runtimeAdapter` in `buildSessionLaunch` (default unchanged) stubbed in `scripts/docker-mcp-bridge.test.mjs`.

### 3. Self-test and skill copies

```sh
node scripts/harness.mjs --self-test
cmp skills/security-audit/SKILL.md .claude/skills/security-audit/SKILL.md && echo identical
```

See: `harness self-test ok (104 patterns)` and `identical`.

### 4. Schemas

```sh
npm run test:schemas
npm run test:schemas -- reviewer-spec run-config
```

See:

```
ℹ tests 119      (all schemas plus the canonical-message tests)
ℹ pass 119
ℹ fail 0

ℹ tests 24       (filtered to reviewer-spec and run-config)
ℹ pass 24
ℹ fail 0
```

Spot checks (these are examples in `shared/schemas/examples/`): `openrouter:qwen/qwen3.8-max-0902` and `key:zai:glm-5.3#glm` are valid; `bogus:x:y` and a run-config with `passes: 9` are invalid; a job with a 39-character `commitSha` is invalid, 40 hex is valid; a general review with `riskPosture: "secure"` or without the disclaimer is invalid.

To see the test catch a regression: remove a key from `required` in `shared/schemas/attestation.schema.json` and run `npm run test:schemas -- attestation`. It fails with `invalid-no-report-hash.json should be invalid but passed`. Restore with `git checkout shared/schemas/attestation.schema.json`.

### 5. Layout

```sh
ls -d backend frontend contracts infra packages eval e2e
grep -l "Owning waves" */README.md | wc -l
```

See: the seven folders and `7`. Each README names its track, owning waves, owned subpaths and gate command.

### 6. AGENTS.md

Open `AGENTS.md`. See: the section "Tracks and boundaries" (track table E/B/C/F/I/S plus Lead, NEAR RPC, wallets, payments, GitHub API and queue only outside `scripts/`, the intake worker spawns `./bin/audit` with argv and never `--rpc`, and `contracts/` may run `cargo test` on the developer host), the section "Key policy" (operator env only, one allow-listed variable per reviewer, never the bridge or sandbox, `keyFingerprint` only, OpenRouter `data_collection: "deny"`), and the extended Layout table. `CLAUDE.md` has the key-policy pointer and the per-track gates.

```sh
grep -n "keyFingerprint\|allow-listed" AGENTS.md CLAUDE.md
```

### 7. Worktree isolation

```sh
node tools/worktree-env.mjs --branch wave/w03-api-reviewers
cat .env.worktree
```

See (the file is gitignored):

```
OMNI_BRANCH=wave/w03-api-reviewers
OMNI_PORT_BASE=4900
OMNI_API_PORT=4901
OMNI_LANDING_PORT=5073
DATABASE_URL=postgres://localhost:5432/omniswarm_wave_w03_api_reviewers
OMNI_REPORTS_DIR=reports/wt-wave-w03-api-reviewers
```

Another branch gives another file: `--branch wave/w08-intake-api` gives `OMNI_PORT_BASE=4700` and `omniswarm_wave_w08_intake_api`. A rerun gives the identical file. Delete it afterwards: `rm .env.worktree`.

### 8. CI (automated only)

`.github/workflows/ci.yml` defines six jobs: `engine`, `schemas`, `intake`, `landing`, `contract`, `infra`. The non-engine jobs print a notice and succeed until their folder has a `package.json` or `Cargo.toml`. It could not be run from here (no push allowed for the lead). On your first push of the branch, check that all six are green on GitHub, then break one schema example to see `schemas` go red.

### 9. Tags and baseline

```sh
git log --format=%ad --date=short -1 94551b9     # 2026-10-17
git tag --list                                   # nothing
```

`README.md` has a "Hackathon baseline" section. No tag was created by the lead.

## Automated checks

```sh
npm run check:w00
```

See `W00 ok` after: layout and contract presence checks, `test:schemas`, the `tools/` tests, `harness --self-test`, the skill `cmp`, and `npm test`. Actual run (without `runtime/node_modules`, 1 min 20 s): `ℹ tests 258  ℹ pass 258  ℹ fail 0` then `W00 ok`.

Reserved root scripts for later waves print a notice and exit 0:

```
$ npm run test:intake     ->  test:intake: skipped (no package yet)
$ npm run check:infra     ->  check:infra: skipped (no package yet)
$ npm run check:w06       ->  check:w06: W06 is not built yet; its wave replaces this script
```

Optional (`H+`, W00-16): `node tools/wave.mjs open 06 --dry-run` prints `W06 waits for W02, W03, W05 in main` (exit 1); `node tools/wave.mjs status` lists every wave.

## When you are done

All good, land it (you or an agent on your explicit go), from the main checkout:

```sh
cd ../OmniSwarm
git merge --no-ff wave/w00-foundation -m "W00 Foundation"
git tag wave-00
git push origin main --tags
git worktree remove ../OmniSwarm-wt/w00
```

Baseline tag for the hackathon (OD-11). The lead did not create it. Run it yourself, once, from any checkout:

```sh
git tag pre-hackathon 94551b9 && git push origin pre-hackathon
```

(`94551b9` is `94551b9ce6fe0d6cb6fc345a2277e5963265ba3a`, "docs: illustrate review workflow in README", 2026-10-17.) After that, every open wave merges the new `main`. Something wrong: tell the wave lead which step and what you saw.

## Merge note for later waves

- **Docs that W03 must update when keys really enter a reviewer runtime** (`grep -n "no API key" README.md docs/*.md` finds nothing, so these are the places that state or encode the old rule): the comment at `scripts/agent-session-launch.mjs:14` ("No key, endpoint, proxy ... enters this runtime"), the test `scripts/agent-session.test.mjs:190` ("subscription environments omit credential and routing overrides"), `skills/security-audit/SKILL.md:25` and `docs/live-model.md:94` (existing official subscription logins only). AGENTS.md "Key policy" now describes the target rule; the code and these places still enforce the old one until W03.
- **Change requests already visible:** W13 asks for `reasons[{code, detail}]` in the guard verdict (CR-13a) while `intake-api.schema.json` has `reasons` as strings; W08-01 and CR-08b may add error codes. The lead lands both as pre-steps.
