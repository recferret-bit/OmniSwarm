# W13 — Agent Guard: owner check

Wave file: [`../waves/W13-agent-guard.md`](../waves/W13-agent-guard.md). About 3 minutes. No `OMNI_LIVE` and no testnet.

`npm run check:w13` runs the guard tests and the attack demo.

Demo accounts:

| Account | Verdict | Reason |
|---|---|---|
| `clean.testnet` | allow | `ATTESTED_CLEAN` |
| `critical.testnet` | block | `ATTESTED_CRITICAL_STILL_DEPLOYED` |
| `changed.testnet` | warn | `CODE_CHANGED_SINCE_REVIEW` |
| `new.testnet` | warn | `ACCOUNT_TOO_NEW` |
| `unreviewed.testnet` | warn | `CONTRACT_NOT_REVIEWED` |
| `reported.testnet` | block | `REPORTED` |

`GET /api/guard/verdict?account=clean.testnet` returns that allow verdict. A block throws before the signer is called. A warn calls the human callback and does not sign when the human says no.

`node demos/attack/run.mjs` writes a log that contains the injected pay instruction, the attempted payment, a block verdict, and `transaction: not sent`. `node demos/attack/run.mjs --no-guard` is a dry run and also sends nothing.

The review sandbox image is unchanged.
