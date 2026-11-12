# Submission draft

Not submitted. One submission per team (SUBMITTING.md: "you can't edit it after you send it"); a mistake in a saved submission goes through https://nearhackathon.com/request-changes, never a second submission (HACKATHON.md). The owner fills the `<OWNER: …>` slots, checks the rules against the live form, and submits once. Field rules come from [TRACKS.md](TRACKS.md) §1 and the W14-01 row of [the W14 wave](../plan/waves/W14-submission-pack.md) (both from nearhackathon.com `HACKATHON.md`, fetched 2026-11-02). Deadline: internal 2026-11-14 20:00 UTC; the form closes 2026-11-14T23:59Z.

## Form fields

| Field | Rule | Draft |
|---|---|---|
| `requestId` | UUID, generated once and reused on every retry of the same submission | `<OWNER: run node -e "console.log(crypto.randomUUID())" once and paste it here>` |
| `projectName` | 2–80 characters | `OmniSwarm` |
| `leadName` | 2–80 characters | `<OWNER: lead name>` |
| `email` | ≤ 160 characters; at most 2 submissions per email | `<OWNER: email>` |
| `size` | team size | `<OWNER: team size>` |
| `tracks` | track ids | `["security", "agents", "open"]` (see "Tracks" below) |
| `nearAddress` | the **mainnet** payout account the team creates | `<OWNER_MAINNET_ACCOUNT>` |
| `projectUrl` | public repository, unique per submission | `https://github.com/recferret-bit/OmniSwarm` (must be public before submitting) |
| `demoUrl` | the X post | `<OWNER: URL of the X post>` |
| `idea` | 20–2000 characters | the text below (1 251 characters) |
| `consent` | must be `true` | `true` |
| `website` | spam trap: **never fill it, never send it** | — |
| body | ≤ 12 000 bytes, one attempt only; a resubmit answers 409 | — |

### `idea`

Problem: an AI agent that pays a NEAR contract has no cheap way to know whether that contract's code was ever reviewed, and one model's security review is easy to fool or to over-trust. OmniSwarm runs several models (Claude, Codex, Grok, AGY through their CLIs, plus OpenRouter, Z.ai and NEAR AI Cloud models) over a sealed snapshot of a repository inside an offline Docker sandbox. Reviewers can only read source through a restricted MCP bridge and run the repository's own tests; every finding cites file:line. Reviewers of other vendors cross-check each claim, then an anonymized debate with mechanical citation checks and a judge from another vendor gives each finding a status, and an orchestrator writes a general review. NEAR's role: a user signs the request with NEP-413, pays request_review on the review-registry contract, and an operator function-call key attests the report's sha256, the commit and the highest confirmed severity on chain. The deployed account can confirm the binding itself. The @omniswarm/guard wrapper reads that attestation and the live code hash before an agent signs, and blocks or warns. Everything runs offline without keys: ./bin/audit demo --no-docker and the guard attack demo. The testnet deployment is the owner's next step.

Update the last sentence once the testnet deploy and the dogfood attestation exist (replace it with the contract id and the explorer link), and recount (save the paragraph as `idea.txt` first): `node -e "console.log([...require('fs').readFileSync(0,'utf8').trim()].length)" < idea.txt`.

### Tracks

| Track | Enter? | Evidence in the repo |
|---|---|---|
| `security` (06, primary) | yes | `packages/guard` (allow / warn / block before signing), the attack demo log in `packages/guard/demo/attack/examples/`, the operator function-call key limits in `contracts/review-registry/README.md`, the sandboxed review engine |
| `agents` (07, secondary) | yes | the orchestrator splits a review into reviewers × surfaces, checks the work by cross-check, debate and citation checks, stays inside `--max-cost-usd`, and writes `reviewers/<id>/usage.json` per reviewer |
| `open` (13, companion) | yes | entered alongside the others |
| `swarms` (05) | no, unless the owner decides otherwise | per-reviewer sub-accounts and Intents settlement are not built |
| `business` (04) | no | the ledger page and `config.yaml` caps are not built |
| `privacy` (03) | no | the `nearai:` reviewer is built, but there is no nonce-bound attestation check or "Verified" panel (W03-22, W07-22), and reports are stored server-side, so track 03's ask and the OD-15 gate are not met. Do not describe the NEAR AI reviewer as private, TEE or confidential |

## X post draft

The owner posts it, with the video attached, after the testnet attestation exists (before that, drop "and attest the verdict on NEAR"). 248 characters with the URL placeholder; X counts a link as 23, so about 261 with the real link, under 280.

```text
One AI's security review is easy to fool. OmniSwarm makes several models review your code, argue over cited lines, and attest the verdict on NEAR so an agent can check before it pays.

built at NEAR HACKATHON @NEARProtocol #NEARHackathon
<REPO_URL>
```

## What is real and what is mock

| Part | State | How to see it |
|---|---|---|
| Review engine: sealed snapshot, offline sandbox, MCP bridge, reviewer families, passes and budgets, per-reviewer reports, cross-check, debate, judge, general review, report pages | real; tested offline with scripted reviewers | `npm test`, `./bin/audit demo --no-docker`, `./bin/audit demo` with Docker |
| A review with real models | built, not run in this pack | [dogfood.md](dogfood.md) is the owner procedure |
| Golden eval | real code, scripted reviewers: it measures the debate mechanics, not model quality | `npm run eval:golden` |
| `review-registry` contract | real; tested on near-sdk's mock VM only; not deployed | `npm run test:contract` |
| Intake API and worker (NEP-413 check, payment check at FINAL, pg-boss queue, attest and refund) | real code; tested on a mock chain, recorded GitHub and a mock engine runner | `npm run test:intake`, `npm run check:w08`, `npm run check:w09` (need `DATABASE_URL`) |
| Web app (wallet, sign, pay, status, hash check) | real code; tested on MSW mocks and a mock wallet | `npm run test:landing`, `npm run test:e2e -- landing` |
| Guard | real; the attack demo reads a recorded chain snapshot and a dry signer | `node packages/guard/demo/attack/run.mjs` |
| Testnet deploy, payment, attestation, guard reads on testnet | **not done** | owner list below |
| Hosted demo | **not deployed**; known gaps in the README "Hosted flow" status | — |

## Owner-only actions

Agents prepare these and never do them.

1. **Testnet deploy.** `bash contracts/review-registry/scripts/deploy-testnet.sh --dry-run`, read the six commands, then `--execute` with your testnet owner account (near-cli-rs and cargo-near on the host). Put the contract id and its nearblocks link in the README NEAR table.
2. **Dogfood review with real models**, then its **testnet attestation**: follow [dogfood.md](dogfood.md) and paste the results there.
3. **Video**: record from [VIDEO.md](VIDEO.md), under 3 minutes.
4. **X post**: post the draft above with the video; paste its URL into `demoUrl`.
5. **Payout account**: create the mainnet account and paste it into `nearAddress`. Sign nothing else on mainnet.
6. **Make the repo public** before submitting, after `bash tools/secret-sweep.sh` prints `secret sweep ok`.
7. **Submit the form** once, with the fields above.
8. **Tags**: create and push `hackathon-submission` on the final commit, and push `pre-hackathon` (it exists locally and points at `94551b9`):

   ```sh
   git tag hackathon-submission <final-commit>
   git push origin pre-hackathon hackathon-submission
   git ls-remote --tags origin
   ```

## Pre-public checklist

- [ ] `LICENSE` present (MIT).
- [ ] `bash tools/secret-sweep.sh` prints `secret sweep ok`.
- [ ] `bash tools/screener-check.sh` prints `screener check ok`.
- [ ] No local paths or private emails in committed files beyond what the owner chooses.
- [ ] Repository description and topics set; default branch `main`.
