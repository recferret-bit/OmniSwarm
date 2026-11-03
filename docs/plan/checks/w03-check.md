# W03 — API Reviewers: owner check

Wave file: [`../waves/W03-api-reviewers.md`](../waves/W03-api-reviewers.md). About 10 minutes offline. Step 6 is live and optional.

## Before you start

- Branch `wave/w03-api-reviewers` in `../OmniSwarm-wt/w03`. This checkout stays there; `main` is untouched.
- Docker is not required for steps 1–5. `--no-docker` forces the host snapshot even when Docker is running.
- No provider key is required until step 6. Do not paste a key into this guide.
- `<fixture>` is `scripts/demo-fixture`. `<out>` is an empty directory you choose.

## Steps

**1. Plan.** Where: the worktree terminal.

```sh
./bin/audit run --repo scripts/demo-fixture --reviewers key:zai:glm-5.3,openrouter:qwen/qwen3.8-max-0902,scripted:baseline --surface s1 --plan
```

See three rows, no key value: `key-zai-glm-5-3` family `key` vendor `zai` model `glm-5.3` env `ZAI_API_KEY,ZAI_BASE_URL` transport `api-acp`; `openrouter-qwen-qwen3-8-max-0902` vendor `alibaba` env `OPENROUTER_API_KEY`; `scripted-baseline` vendor `scripted`. Exit 0. Ran on this branch; the id keeps the `-0902` suffix.

**2. Replay.** With dummy keys and the relative replay path the docs give:

```sh
OMNI_DEMO_HOST=1 OMNI_HTTP_REPLAY=scripts/provider-fixtures/w03 ZAI_API_KEY=zk-test OPENROUTER_API_KEY=or-test \
  ./bin/audit run --repo scripts/demo-fixture --reviewers key:zai:glm-5.3,openrouter:qwen/qwen3.8-max-0902 --surface s1 --passes 1 --out <out>
```

See exit 0 and two submissions; the OpenRouter replay reads a file, searches, then submits. `npm run check:w03` runs exactly this. Until the lead lands the `audit-submission.mjs` model-id change (OpenRouter ids contain `/`), that test is marked `todo` and the OpenRouter submit is refused by the bridge.

**3. Scripted reviewers.** Where:

```sh
./bin/audit demo --no-docker --surface s1 --out <out>
```

See `DEMO — not a review`, then `Demo report saved to: <out>`. `<out>/submissions/` has four files. `<out>/harness/bridge-scripted-*.json` contains `read_file`. `<out>/meta.json` has `"demo": true`. `<out>/report.html` contains `DEMO — not a review`. About 2 seconds.

**4. check-agents.** Unset `OPENROUTER_API_KEY`, then:

```sh
./bin/audit check-agents --reviewers openrouter:qwen/qwen3.8-max-0902
```

See `openrouter: OPENROUTER_API_KEY missing` and exit 1. Set the variable to any non-empty test value and run it again. See `openrouter: key present` and exit 0. The value is not printed.

**5. Refused target.**

```sh
./bin/audit demo --repo /tmp/x
```

See `demo runs only the bundled fixture` and exit 2.

**6. Live smoke (optional, costs provider calls).** Needs `OMNI_LIVE=1`, `ZAI_API_KEY`, and `OPENROUTER_API_KEY` in the environment. Not run while writing this guide.

```sh
OMNI_LIVE=1 ./bin/audit run --repo scripts/demo-fixture --reviewers key:zai:glm-5.3,openrouter:qwen/qwen3.8-max-0902,cli:claude-zai:glm-5.3 --surface s1 --out <out>
```

See a submission per reviewer and no copy of either key under `<out>`.

## Automated checks

On this branch: `node scripts/harness.mjs --self-test`, `npm test`, and `npm run check:w03` (`node --test e2e/engine/w03.test.mjs`).

## When you're done

All good: say "land W03". The lead merges `wave/w03-api-reviewers`, tags `wave-03`, and pushes. Something wrong: name the step and what you saw.

Left for later: OpenAI / xAI / Google presets (W03-05, `H+`), the Anthropic Messages loop (W03-11, `H+`), and the NEAR AI family (W03-22, `H+`).
