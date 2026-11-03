# Full review, 2026-11-03

Review of `main` @ `a9f4239` (all waves W00–W14 tagged and merged). Every wave was checked twice:

1. **Static:** each issue row's gate against the code that should satisfy it (`file:line` or "absent").
2. **Dynamic:** the wave's `check:wNN` and its offline demo steps, reconciled with pass 1 to find green checks that do not exercise their gate.

Paths in these files are the pre-move paths (`backend/intake`, `frontend/landing`, `shared/schemas`, `e2e/`); see the path map in [`../README.md`](../README.md).

| File | Scope |
|---|---|
| [`w00-w02.md`](./w00-w02.md) | Foundation, reviewer registry, sandbox hardening |
| [`w03-w05.md`](./w03-w05.md) | API reviewers, iteration budget, per-reviewer reports |
| [`w06-w07-w14.md`](./w06-w07-w14.md) | Orchestrator & debate, golden eval, report v2, submission pack |
| [`w08-w09.md`](./w08-w09.md) | Intake API, queue & worker, horizontal-scaling readiness |
| [`w10-w11-w13.md`](./w10-w11-w13.md) | Review registry contract, landing app, agent guard, NEAR integration |
| [`w12-structure-quality.md`](./w12-structure-quality.md) | Remote host & deploy, root layout, god code, duplication, dead code, deps |

Headline: every `check:wNN` was green, but most gates past W02 were only partly met. The fix branch `review/full-pass` addresses them track by track; the outcome is recorded in [`FIXES.md`](./FIXES.md).
