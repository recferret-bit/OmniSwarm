# W09 — Queue & Worker: owner check

Wave file: [`../waves/W09-queue-worker.md`](../waves/W09-queue-worker.md). About 4 minutes. Uses the throwaway Postgres from W08 and the mock engine. No Docker review and no provider key.

## Steps

The check is `npm run check:w09`. It drives the shipped worker.

- The worker spawns `./bin/audit` with argv `run --github <repo> --ref <sha> --preset scripted --out <dir>`. The child writes that argv. `--rpc` is absent, and a field that smuggles `--rpc` is rejected before spawn. The child pid is not the test pid.
- A completed mock run is `done`, with a 64-hex `reportSha256`. `node backend/intake/scripts/report-hash.ts <dir>` prints that same hash. The mock chain has one attestation.
- `MOCK` mode `infra` sets `refunded` and a second refund does not insert another row.
- A finished run with a critical finding is `done` and has no refund.
- Stopping after the attestation is written, then resuming, leaves exactly one attestation and status `done`, and does not spawn again.
- Stopping after a successful spawn and before the attestation, then resuming, spawns once more and finishes `done` with exactly one attestation.
- Three queued jobs start at positions 1, 2, 3. After the worker takes one, the other two are 1 and 2.
- `POST /api/admin/requests/:id/refund` with the admin token on a `done` request returns `409 REFUND_NOT_ALLOWED`.

Not in this land: pg-boss itself, the real Docker engine, and the public cost ledger.
