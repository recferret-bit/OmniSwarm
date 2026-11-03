# W11 — Landing & Review App: owner check

Wave file: [`../waves/W11-landing-app.md`](../waves/W11-landing-app.md). About 5 minutes. Needs Google Chrome on the host. No paid key and no testnet.

## Steps

`npm run check:w11` runs the landing unit tests, `npm run test:e2e -- landing`, and the production bundle guard.

`npm run test:e2e -- landing` starts the Vite dev server and drives the page in headless Chrome at 360×800.

- The home page contains `A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR`.
- The sample page says `Attested (sample)` and `No wallet is required.`
- Connect reads the account from the dev mock wallet. The chip shows `alice.testnet`.
- Quote of `https://github.com/near/near-sdk-rs` shows `1 NEAR`. Sign builds the canonical request message, produces a NEP-413 signature, and shows the request hash. The intake `verifyNep413` accepts that signature, and the hash equals `requestHash(message)`.
- Pay shows `queued` first. `running` appears before `done`. The report then says `hash matches on-chain attestation`. The badge equals `reportSha256` of the findings and general-review JSON on the page.
- Tamper the report. The same function recomputes a different hash and the page says `hash does not match the attestation`.
- A private repo says `This repository is private` and Pay is absent.
- `QUEUE_FULL` says `Queue is full, try later` and Pay is absent.
- A wallet rejection says `Payment cancelled in wallet` with `Retry`, and the timeline stays empty.
- My requests lists that account's repo and `done`.

`npm run guard --workspace frontend/landing` builds production. The dev wallet source contains `MockConnector` and `ed25519:`. The `dist/` bundle contains neither of those, nor a free-standing `sk-`, `ghp_`, `github_pat_`, `OPENROUTER`, or `ZAI_`.

Not in this land: a live NEAR wallet and the real API.
