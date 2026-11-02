# W01 — Reviewer Registry: owner check

Wave file: [`../waves/W01-reviewer-registry.md`](../waves/W01-reviewer-registry.md). About 10 minutes, all offline.

## Before you start

- Branch `wave/w01-reviewer-registry`, worktree `../OmniSwarm-wt/w01`. The main checkout is untouched. `cd` into the worktree for every command.
- Docker is **not** needed: every step uses `--plan` or unit tests with inert fixtures. No provider login, no key, no network. `setup-agents` is not needed. Nothing is marked live.
- `<F>` = `scripts/harness-fixtures/near` (an inert fixture repo).
- Steps 6 and 7 are covered by automated tests only (they need no run directory); the commands are given.

## Steps (numbers follow the wave file's demo story)

**1. Existing flags give the same plan, plus a reviewer table.**
`./bin/audit run --repo <F> --agents claude,codex --plan`
See: `Agents:   claude codex` and `Models:   claude=opus codex=gpt-6.1-sol` unchanged, then
`cli-claude-opus  cli  anthropic  opus  yes`, `cli-codex-gpt-6-1-sol  cli  openai  gpt-6.1-sol  yes`, `Assignment: round-robin (6 jobs)` (the old split is kept when you pass `--agents`).
Diff against `main`: `git archive main | tar -x -C <tmp>` and run the same command there; the only differences are the report path and the added table (verified by the lead).

**2. Reviewer x surface matrix.**
`./bin/audit run --repo <F> --reviewers cli:claude:opus,cli:codex:gpt-6.1-sol,cli:grok:grok-4.7,cli:agy:gemini-4-argon-high --plan`
See: `Assignment: matrix (24 jobs)` and four rows of `x x x x x x` (S1..S6). Add `--assign round-robin` with two reviewers: `Assignment: round-robin (6 jobs)`.

**3. A reviewer from a family that is not installed.**
`./bin/audit run --repo <F> --reviewers openrouter:qwen/qwen3.8-max-0902 --plan; echo $?`
See on stderr `openrouter-qwen-qwen3-8-max-0902: family \`openrouter\` not installed yet (W03)` and exit code `2`. The id has no `/`. (The wave file's example id `openrouter-qwen-qwen3-8-max` drops the `-0902` suffix; the slug rule gives the longer id.)

**4. Config file and presets.**
`cp omniswarm.config.example.json omniswarm.config.json && ./bin/audit run --repo <F> --preset local-subscriptions --plan`
See: the four `cli` reviewers, `matrix (24 jobs)`. Add `--passes 3`: `Budgets: passes 3; tool budget 40 per pass`. A flag wins over the file. Then `rm omniswarm.config.json` (it is gitignored). With no file, `--preset demo` stops with "needs a config file".

**5. Recommended orchestrator.**
`./bin/audit run --repo <F> --agents claude --orchestrator recommended --plan`
See: `Orchestrator: recommended -> cli:claude:opus; first choice of the OD-05 order is available. No phase uses it yet.` (On a machine without the `claude` CLI on PATH it says `none available (...)`.)

**6. Crash during cross-check (R-03).**
`node --test --test-name-pattern="crash during cross-check" scripts/docker-agent-orchestrator.test.mjs`
See: pass. The test kills the run with SIGKILL when cross-check starts; `meta.json` has `finalized:false`, `submissionAuthority:"mcp_commit"` and `reviewers`; validation reports the run `incomplete` and the canonical-submission check ran (a tampered derived report is rejected).

**7. Control evidence and header (R-05, R-16).**
`node --test scripts/generate-html-report.test.mjs`
See: pass. `report.html` of the fixture shows the control's real evidence text with a "model assertion" pill; the rail reads "OmniSwarm".

**8. No adapter literals outside the cli provider table.**
`grep -rn "'claude', 'codex', 'grok', 'agy'\|claude|codex|grok|agy" scripts/*.mjs scripts/*.sh bin/audit | grep -v "\.test\.mjs"`
See: only `scripts/model-cli-status.mjs` and two `*.docker.mjs` tests (terminal model connectors, outside W01) and no match in the files W01 owns.

Other refusals, unchanged: `./bin/audit run --repo <F> --rpc https://x --plan` prints "source security review does not contact deployed RPCs", exit 1. `--reviewers 'cli:claude:op;rm'` is rejected (exit 2).

## Automated checks (all green on the branch)

```
node scripts/harness.mjs --self-test      harness self-test ok (104 patterns)
npm test                                  tests 306, pass 306, fail 0
npm run test:schemas                      tests 119, pass 119, fail 0
npm run check:w01                         reviewer-*, phases, run-config: 29 pass; then self-test and npm test as above
cmp skills/security-audit/SKILL.md .claude/skills/security-audit/SKILL.md    identical
npm run check:w00                         W00 ok
```

## When you're done

All good: from the main checkout `git merge --no-ff wave/w01-reviewer-registry -m "W01 Reviewer Registry" && git tag wave-01 && git push origin main --tags`, then `git worktree remove ../OmniSwarm-wt/w01`. Something wrong: tell the wave lead which step and what you saw.

## Known limits of this wave

- Job names now carry the reviewer id (`cli-claude-opus-s1-auth`, not `claude-s1-auth`), so a run made before W01 cannot be resumed with `--resume-from`; reading and validating an old report works (legacy ids are the adapter names).
- `--passes`, `--tool-budget`, `--orchestrator`, `--alternate-judge`, `maxCostUsd` are recorded and printed, not enforced (W04, W06).
- Not done: W01-20 (app-specific plan guidance, H+) and the `runAgentProcess` half of W01-21 (`audit-process.mjs` belongs to W02).
