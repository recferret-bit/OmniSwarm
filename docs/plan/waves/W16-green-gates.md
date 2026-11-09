# W16: Green gates and landing polish

> **Track:** Front (F) with Intake (B) · **Tag:** `wave-16` · **Check:** `npm run check:w16` = `npm run check:all && bash tools/screener-check.sh`
> **Depends on waves:** W11, W14 (landed). No soft dependencies.
> **Specs:** review of 2026-11-09 ([`../FINAL_SPRINT.md`](../FINAL_SPRINT.md) §Findings)
> **Owned paths:** `apps/api/openapi.json`, `apps/web/src/lib/api/schema.gen.ts` (until W15-01 lands; after that W15-01 regenerates them), `apps/web/src/components/landing/**`, `apps/web/src/components/report/**`, `apps/web/src/design/css/**`, `apps/web/src/app/layout.tsx`, `apps/web/public/sample/**`, `tests/e2e/landing/flow.test.mjs`, `docs/plan/checks/w16-check.md`
> **Not owned (W15):** `apps/web/src/lib/near/**`, `apps/web/src/lib/report/verify.ts`, web `env.ts`, `tests/e2e/landing/near-local.test.mjs`

## Goal

`npm run check:all` goes from red (it stops at step 3) to fully green, and the uncommitted landing work lands cleanly. A screener that runs the whole gate sees no failure.

## Demo story

1. `npm run check:all` → every track passes. Empty tracks print "skipped".
2. `bash tools/screener-check.sh` → 4 blocks pass and the gitleaks sweep is clean.
3. Open `/`. The How-it-works stage draws the same report hash as `/sample` (all 64 characters). Hiding and showing the tab ten times leaves exactly one animation loop running.
4. Share the landing URL → the link preview shows `public/sample/preview.jpg`.

## Hackathon slice

All `H`. This wave is a precondition for W19.

## Wave DoR

- [x] W11 and W14 are tagged in `main`.
- [x] The failing gates have known causes (FINAL_SPRINT §Findings; the logs are in the 11-09 session scratchpad).
- [ ] The uncommitted landing tree on `main` is moved onto the wave branch, so nobody else edits `components/landing/**` while the wave is open.

## Features covered

- [ ] Generated API files current: W16-01
- [ ] e2e accessibility and copy assertions green: W16-02, W16-03
- [ ] Landing correctness (hash, animation loop, copy), OG image: W16-04, W16-05
- [ ] Landing work committed in reviewable commits under the bundle budget: W16-06
- [ ] Wave check and tag: W16-07

## Issues

| ID | Title | Type | Size | H | Deps | Owned paths | Acceptance (do X → see Y) | Spec |
|---|---|---|---|---|---|---|---|---|
| W16-01 | Regenerate `apps/api/openapi.json` and `apps/web/src/lib/api/schema.gen.ts` with the repo's generators. Make no hand edits | contract | S | H | — | the two generated files | `npm run test:intake` → `contract.test.ts:32` passes. `npm run test:landing` → typecheck passes and vitest runs | — |
| W16-02 | Accessibility fixes for `flow.test.mjs:72`: raise the contrast of `#report-page-findings .eyebrow` and `.report-doc__split .label` to ≥ 4.5:1 using design tokens; make the `.report-stage` accessible name contain its visible label | client | S | H | W16-01 | `apps/web/src/components/report/**`, `apps/web/src/design/css/**` | `npm run test:e2e -- landing` → the axe step reports 0 violations | — |
| W16-03 | Binding status: write "Binding not confirmed" in sentence case in the markup and uppercase it with CSS `text-transform`. Change the markup, not the test | client | S | H | W16-01 | `apps/web/src/components/report/**` (BindingStatus) | `flow.test.mjs:93` passes unchanged | — |
| W16-04 | Landing fixes:<br>• `how-scene.ts:10` `SAMPLE_HASH` set to the full `report_sha256` from `public/sample/attestation.json`, read from that file at build time and not copied by hand<br>• cancel the pending requestAnimationFrame before rescheduling, in `HowStage.tsx:32-35` and `StageCanvas.tsx:43`<br>• `HowItWorks.tsx:9` copy matches `/dashboard` (two reviewers by default, up to six) | client | S | H | — | `apps/web/src/components/landing/**` | New unit tests: the hash equals the sample attestation's; ten simulated hide/show cycles → one active loop. `how.test.tsx` passes | — |
| W16-05 | Set `openGraph.images` in `app/layout.tsx` to `/sample/preview.jpg` (1100×720) | client | S | H | — | `apps/web/src/app/layout.tsx`, `apps/web/public/sample/preview.jpg` | `npm run build -w apps/web` → the rendered `<head>` has `og:image` pointing to the file | — |
| W16-06 | Run `npm run guard -w apps/web` (the bundle budget) and land the work as two commits: "Split the How-it-works stage into per-step painters with a hash lock-in." and "Give the sample report still real buttons and drop landing band borders." | client | S | H | W16-04, W16-05 | — | The guard passes under budget. `git log` shows the two commits | — |
| W16-07 | Wave check: `check:w16`, `checks/w16-check.md`, tag `wave-16` | test | S | H | W16-01..06 | `docs/plan/checks/w16-check.md`, root `check:w16` (lead reserves the name) | `npm run check:w16` → green | — |

**Parallel groups:**
1. W16-01, W16-04 and W16-05 together.
2. W16-02 and W16-03 together.
3. W16-06.
4. W16-07.

Max 3 agents. This is half a day of work.

## Wave DoD

- `npm run check:all` and `bash tools/screener-check.sh` are green on the wave merge commit.
- Every e2e fix changed the product, not the assertion.
- The landing hash matches the sample attestation exactly; a test enforces it.
- The bundle guard passes.
- Tag `wave-16`.
