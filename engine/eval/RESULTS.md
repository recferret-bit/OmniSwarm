# Golden eval

Command: `npm run eval:golden` · date 2026-11-10 · commit 33e420b

Reviewers: scripted:baseline, scripted:paranoid, scripted:wrong, scripted:lazy; judge scripted:judge. Cost: none (no model was called).

These are scripted reviewers whose answers derive from each repo's expected.json by the fixed policy in
eval/panel.mjs, so the table measures the debate protocol (citation checks, conformity rule, evidence floor),
not model skill. The live eval with real models (`OMNI_LIVE=1`) is pending.

Default debate rounds: 2. debate precision 1 beats union 0.75 and majority 0.91; 1 seeded bug(s) lost against union (limit 1).

Union keeps every cluster. Majority keeps clusters reported by more than half of the reviewers that submitted
a finding. debate-N keeps every cluster the N-round debate did not REFUTE; every cluster is debated (no cluster
cap), so the table measures the protocol and not the cap. Totals are micro-averaged.

| repo | mode | recall | precision | decoy FP | dedup | conformity | cost USD |
|---|---|---:|---:|---:|---:|---:|---:|
| fullstack-dapp | union | 1 | 0.83 | 1 | 1 | 0 | 0 |
| fullstack-dapp | majority | 0.89 | 0.98 | 0.07 | 1 | 0 | 0 |
| fullstack-dapp | debate-1 | 1 | 1 | 0 | 1 | 0 | 0 |
| fullstack-dapp | debate-2 | 1 | 1 | 0 | 1 | 0.06 | 0 |
| near-client | union | 1 | 0.5 | 1 | 1 | 0 | 0 |
| near-client | majority | 1 | 0.67 | 0.5 | 1 | 0 | 0 |
| near-client | debate-1 | 1 | 1 | 0 | 1 | 0 | 0 |
| near-client | debate-2 | 1 | 1 | 0 | 1 | 0.21 | 0 |
| near-escrow | union | 1 | 0.5 | 1 | 1 | 0 | 0 |
| near-escrow | majority | 0.5 | 0.5 | 0.5 | 1 | 0 | 0 |
| near-escrow | debate-1 | 1 | 1 | 0 | 1 | 0 | 0 |
| near-escrow | debate-2 | 1 | 1 | 0 | 1 | 0.2 | 0 |
| py-fastapi | union | 1 | 0.5 | 1 | 1 | 0 | 0 |
| py-fastapi | majority | 0.5 | 0.5 | 0.5 | 1 | 0 | 0 |
| py-fastapi | debate-1 | 1 | 1 | 0 | 1 | 0 | 0 |
| py-fastapi | debate-2 | 1 | 1 | 0 | 1 | 0.2 | 0 |
| rust-crate | union | 1 | 0.5 | 1 | 1 | 0 | 0 |
| rust-crate | majority | 0.5 | 0.5 | 0.5 | 1 | 0 | 0 |
| rust-crate | debate-1 | 1 | 1 | 0 | 1 | 0 | 0 |
| rust-crate | debate-2 | 1 | 1 | 0 | 1 | 0.2 | 0 |
| solana-vault | union | 1 | 0.5 | 1 | 1 | 0 | 0 |
| solana-vault | majority | 0.5 | 0.5 | 0.5 | 1 | 0 | 0 |
| solana-vault | debate-1 | 0.5 | 1 | 0 | 1 | 0 | 0 |
| solana-vault | debate-2 | 0.5 | 1 | 0 | 1 | 0.27 | 0 |
| ts-api | union | 1 | 0.5 | 1 | 1 | 0 | 0 |
| ts-api | majority | 1 | 0.67 | 0.5 | 1 | 0 | 0 |
| ts-api | debate-1 | 1 | 1 | 0 | 1 | 0 | 0 |
| ts-api | debate-2 | 1 | 1 | 0 | 1 | 0.21 | 0 |
| **total** | union | 1 | 0.75 | 1 | 1 | 0 | 0 |
| **total** | majority | 0.86 | 0.91 | 0.27 | 1 | 0 | 0 |
| **total** | debate-1 | 0.99 | 1 | 0 | 1 | 0 | 0 |
| **total** | debate-2 | 0.99 | 1 | 0 | 1 | 0.1 | 0 |
