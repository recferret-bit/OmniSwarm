# Owner check guides

Every wave ends with the owner checking its demo story by hand before the wave lands in `main` ([`PRODUCT_WAVES.md`](../PRODUCT_WAVES.md) §7 step 6). The wave lead writes that check as a **step-by-step guide** in this folder, `wNN-check.md`, commits it on the wave branch, and pastes it as its final message. Format adapted from `../TerraAgent/docs/plan/checks/README.md`.

## Format

1. **Title and one line:** `# WNN — <name>: owner check`, a link to the wave file, the rough duration.
2. **Before you start:**
   - branch and worktree (`wave/wNN-<slug>` in `../OmniSwarm-wt/wNN`); the main checkout is untouched;
   - what must be running and how to start/stop it:
     - **engine waves (W01–W07):** Docker running or not (say which), `./bin/audit setup-agents` done or not, which provider logins or keys the step needs (`OMNI_LIVE=1` steps are marked **live** and are optional unless the step says otherwise);
     - **service waves (W08–W13):** `npm run stack:local` (W12-20) or the worktree's own ports from `.env.worktree` (`OMNI_PORT_BASE`: API `base+1`, landing `base+173`), the database `omniswarm_<branch>`, and which chain mode (`mock` or `testnet`);
   - define the placeholders once: `<run>` (the report directory the step creates, e.g. `reports/wt-w03/2026-11-05-120000-demo-fixture`), `<api>`, `<landing>`, `<reports>`, `<contract>`;
   - which wallet or test account to use (mock wallet `alice.testnet`, or the testnet test account from `~/.omniswarm/env/`); never paste a key into the guide.
3. **Steps:** one numbered step per demo-story step, **same numbers** as the wave file. Each step says:
   - **where:** the exact terminal command (with flags), the exact URL with parameters, or the exact file to open (`reports/<run>/reviewers/index.json`);
   - **how:** the click sequence or the command, including setup (mock error `?mock=QUEUE_FULL`, `--passes 2`, a fixture name);
   - **see:** the exact visible result: printed line, JSON field and value, file that must exist, page text, badge colour, HTTP status, explorer page — and roughly how long it takes.
   Steps deferred to a later landing say so and are skipped. Steps only automation can check say "(automated only)" and name the command.
4. **Automated checks:** the gate commands already green on the branch, per track:
   - engine: `node scripts/harness.mjs --self-test && npm test`, plus `npm run test:docker` when the sandbox changed, plus the wave's `npm run check:wNN`;
   - intake: `npm run test:intake`; chain: `npm run test:contract`; front: `npm run test:landing && npm run test:e2e -- landing`; infra: `npm run check:infra` and `infra/deploy/smoke.sh <host>`;
   - and every earlier wave's check (`npm run check:all`).
5. **When you're done:** all good → land it (`git merge --no-ff wave/wNN-<slug>`, `git tag wave-NN`, `git push origin main --tags`, remove the worktree; or tell the lead "land WNN"). Something wrong → tell the wave lead which step and what you saw.

## Rules

- Write it from the **running** result: every command, URL and expected output was run by the lead in that worktree (or on the host for W12) before handing over. Paste real outputs, shortened, not invented ones.
- Plain words, short steps. If a step needs a key, a wallet, Docker or a browser profile, say which.
- Never include a secret, a key, a seed phrase or a full signature. Show key **names** and fingerprints only.
- Report paths are relative to the worktree; hosted URLs use the real domain only in W12/W14 guides.
- When a wave adds a CLI flag, an env variable, a mock switch or a dev URL, it also adds it to the README's operator section or `docs/how-it-works.md` in the same wave.
- Live steps (paid providers, testnet transactions) are listed last and say how much they cost (calls, approximate USD or testnet NEAR).
