# W11 — Landing & Review App: owner check

Wave file: [`../waves/W11-landing-app.md`](../waves/W11-landing-app.md). About 4 minutes. No browser binary is required. Vitest renders the real components. The production bundle is `vite build`.

## Steps

`npm test --workspace frontend/landing` renders the page and walks the reducer.

- The home page contains `A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR`.
- The sample page says `Attested (sample)` and `No wallet is required.`
- Connect sets the chip to `alice.testnet`. Quote of `https://github.com/near/near-sdk-rs` shows `1 NEAR`. Sign shows the request hash. Pay walks `queued`, `running`, `done`. The report says `hash matches on-chain attestation` because the recomputed hash equals the attested hash.
- A private repo says `This repository is private` and Pay is not offered.
- `QUEUE_FULL` says `Queue is full, try later` and Pay is not offered.
- A rejected payment says `Payment cancelled in wallet` with `Retry`.
- `/me` lists that account's request.
- `src/style.css` keeps the flow usable at `max-width: 360px` (stacked header, 44px targets). The transitions do not depend on width.

`npm run guard --workspace frontend/landing` builds production and checks the bundle has no `ed25519:`, a free-standing `sk-`, `ghp_`, `github_pat_`, `OPENROUTER`, `ZAI_`, or `MockConnector`.

Not in this land: a live NEAR wallet and the real API.
