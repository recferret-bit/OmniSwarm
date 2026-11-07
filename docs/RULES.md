# RULES.md

The review round of OmniSwarm written as swarm rules. **Status: this file describes what the engine does today** (checked against `engine/scripts/` on 2026-11-03). Where the plan in `docs/spec/ORCHESTRATION.md` asks for more, the difference is stated in the rule. The numbers are the defaults in `engine/scripts/run-config.mjs`; `./bin/audit run --plan` prints the ones a run will use.

Model agreement and passing checks do not certify security. The rules below make a review checkable, not conclusive.

## 1. Who takes part

| Role | Who | What it may do |
|---|---|---|
| **Reviewer** | One model in one family (`cli`, `key`, `openrouter`, `scripted`). Many per run | Read the sealed source through the read-only bridge, run the frozen existing tests, submit findings |
| **Challenger** | Every run reviewer that did not author a given cluster | Answer upheld, partial, refuted or insufficient evidence on another reviewer's finding |
| **Devil's advocate** | One challenger per cluster: the one whose anonymous label sorts first | Argue the strongest case that the finding is a false positive |
| **Author** | A reviewer that reported a finding in the cluster | Defend or concede in round 2, which runs only when a challenger refuted or partly upheld the finding |
| **Orchestrator** | One model (`--orchestrator <spec>` or `recommended`) with read-only tools | Adjudicate each debated cluster and write the general review. It never runs tests, never merges clusters, and the general review cannot cite a cluster that does not exist |
| **Alternate judge** | `--alternate-judge <spec>`, else the first non-scripted run reviewer whose vendor differs from the orchestrator's | Judges a cluster when the orchestrator's vendor matches an author's vendor |
| **Engine** | Plain code, no model | Assigns work, clusters, anonymizes, checks citations, enforces budgets, applies the status rules, writes every record |

Without `--orchestrator` there is no debate: the run ends after the review and cross-check phases.

## 2. Rules

1. **Isolation first.** In the review phase every reviewer works alone and sees no peer output. Peer claims are shown only afterwards, in the cross-check phase, and only to reviewers of another vendor.
2. **Passes.** Each reviewer runs P passes per assignment (`--passes`, 1 to 5, default 2). Pass 1 is discovery. Pass 2 is self-verification: re-read every own citation, drop or fix what does not hold, then read files the previous pass did not open. Pass 3 and later deepen the reviewer's own highest-severity leads. A pass that submits early still counts and the next pass runs, unless the pass failed (the last committed pass is kept) or the cost ceiling stopped it.
3. **Tool budget.** A pass may make N inspection calls (`--tool-budget`, 5 to 200, default 40; submit calls excluded). After N calls, inspection tools answer "budget exhausted: call submit_audit_report now" three more times; the next call is refused and the pass is recorded as stopped by budget. The session is cancelled after N + 3 calls. The same numbers apply to every family. Debate and judge sessions have their own budget (rule 18).
   - 3a. **Cost ceiling.** With `--max-cost-usd`, an API reviewer (`key:` or `openrouter:`) whose session cost reaches the ceiling stops, and its later passes are skipped and recorded as `cost_ceiling`. CLI reviewers report no per-call cost, so the ceiling does not apply to them.
4. **Evidence or nothing.** Every finding cites `file:line`; the engine reads the quoted line from the sealed snapshot. Every debate argument cites `{file, startLine, endLine, quote}`, except an `insufficient_evidence` answer. "No finding" is a legal result.
5. **Clustering.** The engine groups findings with no model involved: the same surface, the same title (ignoring case) and the same `file:line`, or findings from different reviewers that cite at least two of the same files within three lines. There are no model-proposed merges.
6. **Triage.** A cluster reported by at least two vendors whose every cited line exists in the snapshot and is real code (not blank, not a lone brace) skips the debate and is marked AGREED. Every other cluster enters the queue, ordered by severity weight (critical 5, high 4, medium 3, low 2, info 1) times 1 + d, where d is 1 when the cluster's reports disagree on severity; ties break on cluster id. At most `--debate-max-clusters` clusters (default 25) are debated. The rest are marked CAPPED, keep their earlier status, and are listed as a `debate_cap` coverage gap.
7. **Anonymization.** Per cluster, participants are relabelled Reviewer A, B, C in an order derived from a seed and the cluster id. The seed (currently fixed at 1) and every cluster's map are written to `debate/anonymization.json`, which no brief contains. Model and vendor names are scrubbed from argument text, and every turn is validated against the `debate-round` schema.
8. **Challenge (round 1).** Every challenger returns a verdict (upheld, partial, refuted, insufficient evidence) with citations. One challenger is the devil's advocate.
9. **Defend (round 2).** Runs when rounds ≥ 2 (`--debate-rounds`, 1 to 3, default 2) and some kept round-1 verdict is refuted or partial. Authors see the anonymized challenges and defend with citations or concede.
10. **Rebut (round 3).** Runs only with `--debate-rounds 3` and only when a verdict changed in round 2. With the default of 2 rounds there is no round 3.
11. **Early stop.** Per cluster: a cluster with no refutation in round 1 stops after round 1, and one with no verdict change in round 2 stops after round 2.
12. **Citation rule.** The engine checks each cited `{file, startLine, endLine, quote}` against the sealed snapshot: the file must be in the snapshot with the hash recorded in `source-manifest.json`, the range at most 400 lines, the quote a whitespace-normalized substring of that range, and the citation within three lines of one of the cluster's own cited lines (`not_about_this_cluster` otherwise). An argument with no valid citation is discarded. Every check and its reason is written to `debate/citations.json`, and the discard to `debate/trace.jsonl` and to `discardedArguments` in the adjudication. A discarded argument does not count in the status rules (rule 15). The model judge's brief still shows the turn's verdict and text, with only its valid citations.
13. **Conformity flag.** A verdict change whose valid citations are all already known to the cluster is kept, marked `conformitySuspect`, and listed as `conformity_suspect`. It does not count in the status rules. As with rule 12, the model judge's brief still shows it.
14. **Judge assignment.** The judge's vendor must differ from every author's vendor in the cluster. If the orchestrator's vendor conflicts, the alternate judge takes the cluster. With no eligible judge the cluster ends DISPUTED with the rationale `no_independent_judge`. The judge sees anonymous labels, never vendors, model names or vote counts. Its status is clamped to what rule 15 allows from the counted evidence, so a judge cannot raise a finding above it. The assignment is recorded per cluster in `debate/adjudication.json` (`judge.reviewerId`, `judge.vendor`, `judge.alternate`) and in the general review's methodology. The scripted judge (`scripted:judge`) skips the vendor check and is refused (`scripted_judge_demo_only`) on anything but the bundled fixtures.
15. **Final statuses.**
    - CONFIRMED: triage AGREED, or the cited lines hold and a challenger of another vendor upheld or partly upheld it.
    - LIKELY: the cited lines hold, one source, not refuted.
    - DISPUTED: a counted refutation and counted support, or no independent judge.
    - REFUTED: a counted refutation with a valid citation and no support.
    - INSUFFICIENT_EVIDENCE: a cited line cannot be checked, and no refutation.

    `finalStatus` is written to `debate/adjudication.json`, to each row of `findings-and-scores.json` (joined by claim id, with `judge`, `debateRounds` and `severityReason`) and to the general review's top findings. In `findings-and-scores.json` a triage-agreed cluster shows `AGREED`.
16. **No silent drops.** A finding is REFUTED only by a counted refutation with a valid citation. A REFUTED finding stays in the report with score 0. When the judge is unavailable, the rule-based status stands.
17. **Severity.** The judge may change a severity and is asked for a reason. The reason is not required; when none is given the record says "Left at the reported severity."
18. **Stop conditions.** Every loop has a hard cap: N inspection calls per pass plus 3, P passes per reviewer, at most 3 debate rounds, and `--debate-tool-budget` read calls per debate turn or judgement (default 12, then reads are refused). Each debate turn, judgement, and the general review stops after `--debate-turn-ms` (default 180000); the harness aborts that session. The speaking phase stops after `--debate-phase-ms` (default 900000). Clusters not started are a `debate_time` coverage gap and are judged from citations only, which does not by itself make the run INCOMPLETE. A started turn that times out is a `debate_turn_timeout` gap. A cluster that stays DISPUTED, or whose judge does not answer, is adjudicated once more by a different model. A second DISPUTED stays DISPUTED. A retry that also does not answer leaves the first gap. A resumable session may recover once from a lost transport. A missing turn or judgement is recorded as a `debate` stage failure: the run ends INCOMPLETE, and the per-model findings, the adjudication and the general review are still written. A failed provider never restarts the run.
19. **General review.** After adjudication the orchestrator writes the general review: executive summary, a risk posture computed by the engine from open severities (critical-exposure, high-risk, moderate or low-observed; never "secure"), the top 10 findings with statuses, coverage and gaps, open disagreements (the DISPUTED clusters), per-reviewer contributions, methodology, and the fixed sentence above. A general review that names a cluster id the debate did not produce is rejected. The model writes the summary and the disagreement wording; everything else comes from the records.
20. **Everything is a file.** The debate writes `debate/clusters.json`, `debate/anonymization.json`, `debate/citations.json`, `debate/round-<n>/<Reviewer X>-<cluster>.json`, `debate/trace.jsonl`, `debate/adjudication.json` and `general-review.{json,md}`. A turn that never arrived appears only in the stage failure and the general review's coverage gaps, not in `trace.jsonl`.

## 3. One cluster from challenge to judge

Cluster `CLUSTER-1` was reported by Reviewer X only (one vendor, so it enters the queue). Reviewers Y and Z did not report it and act as challengers; Z is the devil's advocate. The run uses `--debate-rounds 3`.

```
Engine         Reviewer X(author)   Reviewer Y        Reviewer Z (devil)   Judge
  |                   |                  |                  |                |
  | 1. cluster CLUSTER-1, relabel per cluster (A=X, B=Y, C=Z), seed recorded |
  |--- brief: claim + quoted code, budget 12 read calls ------------------>  |
  |                   |                  |                  |                |
  | ======================== round 1: challenge =========================     |
  |------------------------------------> | 2. verdict + citations           |
  |-------------------------------------------------------> | 3. verdict + citations (argue false positive)
  | 4. citation check (code): invalid or off-cluster quote -> argument discarded, logged
  |    no counted refutation or partial -> stop after round 1                 |
  |                   |                  |                  |                |
  | ======================== round 2: defend ============================     |
  |---- anonymized challenges ---------> |                  |                |
  |                   | 5. defend with citations, or concede                 |
  | 6. citation check; verdict change with no new citation -> conformity flag |
  |                   |                  |                  |                |
  | ======================== round 3: rebut (--debate-rounds 3, a verdict changed)
  |------------------------------------> | 7. rebut         |                |
  | 8. no verdict change in round 2 -> stop for this cluster                  |
  |                   |                  |                  |                |
  | 9. judge check: judge vendor != vendor of X; else alternate judge; none -> DISPUTED
  |------------------------------------------------------------------------> |
  |                   |                  |                  | 10. read the claim, quotes and arguments
  |<------------------------------------------------------------------------ | 11. status + severity (+ reason) + rationale
  | 12. clamp the status to rule 15, write debate/adjudication.json; general review reads it
```

Reading it: steps 1 to 3 are rules 7 and 8; step 4 is rules 11 and 12; steps 5 and 6 are rules 9 and 13; steps 7 and 8 are rules 10 and 11; steps 9 to 12 are rules 14 to 17 and 20.

## 4. What this file does not cover

Review-pass briefs, the bridge tools per role and the report layout are in `docs/spec/ORCHESTRATION.md` (sections 5 and 6) and `docs/how-it-works.md`. The evaluation behind the default of 2 rounds is `engine/eval/RESULTS.md`; it uses scripted reviewers, so it measures the debate mechanics, not model quality.
