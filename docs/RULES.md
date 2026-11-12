# RULES.md

The review round of OmniSwarm written as swarm rules. **Status: this file describes what the engine does today** (checked against `engine/scripts/` on 2026-11-10). Where the plan in `docs/spec/ORCHESTRATION.md` asks for more, the difference is stated in the rule. The numbers are the defaults in `engine/scripts/run-config.mjs`; `./bin/audit run --plan` prints the ones a run will use.

Model agreement and passing checks do not certify security. The rules below make a review checkable, not conclusive.

## 1. Who takes part

| Role | Who | What it may do |
|---|---|---|
| **Reviewer** | One model in one family (`cli`, `nearai`, `key`, `scripted`). Many per run | Read the sealed source through the read-only bridge, run the frozen existing tests, submit findings |
| **Challenger** | Every run reviewer of another vendor than the cluster's authors, except the reviewer reserved to judge it | Answer upheld, partial, refuted or insufficient evidence on another reviewer's finding |
| **Devil's advocate** | One challenger (the first anonymous label among those that answered), in a second, separate turn after its own verdict, on clusters no challenger refuted | Argue the strongest case that the finding is a false positive. It is an argument for the judge, never a vote |
| **Author** | A reviewer that reported a finding in the cluster | Defend or concede in round 2, which runs only when a challenger refuted or partly upheld the finding |
| **Orchestrator** | One model (`--orchestrator <spec>` or `recommended`) with read-only tools | Adjudicate each debated cluster and write the general review. It never runs tests, never merges clusters, and the general review cannot cite a cluster that does not exist |
| **Alternate judge** | `--alternate-judge <spec>`, else the first non-scripted run reviewer whose vendor differs from the orchestrator's | Judges a cluster when the orchestrator's vendor matches an author's vendor |
| **Engine** | Plain code, no model | Assigns work, clusters, anonymizes, checks citations, enforces budgets, applies the status rules, writes every record |

Without `--orchestrator` there is no debate: the run ends after the review and cross-check phases.

## 2. Rules

1. **Isolation first.** In the review phase every reviewer works alone and sees no peer output. Peer claims are shown only afterwards, in the cross-check phase, and only to reviewers of another vendor.
2. **Passes.** Each reviewer runs P passes per assignment (`--passes`, 1 to 5, default 2). Pass 1 is discovery. Pass 2 is self-verification: re-read every own citation, drop or fix what does not hold, then read files the previous pass did not open. Pass 3 and later deepen the reviewer's own highest-severity leads. A pass that submits early still counts and the next pass runs, unless the pass failed (the last committed pass is kept) or the cost ceiling stopped it.
3. **Tool budget.** A pass may make N inspection calls (`--tool-budget`, 5 to 200, default 40; submit calls excluded). After N calls, inspection tools answer "budget exhausted: call submit_audit_report now" three more times; the next call is refused and the pass is recorded as stopped by budget. The session is cancelled after N + 3 calls. The same numbers apply to every family. Debate and judge sessions have their own budget (rule 18).
   - 3a. **Cost ceiling.** With `--max-cost-usd`, an API reviewer (`nearai:` or `key:`) whose session cost reaches the ceiling stops, and its later passes are skipped and recorded as `cost_ceiling`. CLI reviewers report no per-call cost, so the ceiling does not apply to them.
4. **Evidence or nothing.** Every finding cites `file:line`; the engine reads the quoted line from the sealed snapshot. Every debate argument cites `{file, startLine, endLine, quote}`, except an `insufficient_evidence` answer. "No finding" is a legal result.
5. **Clustering.** The engine groups findings with no model involved. Findings merge when they have the same surface, the same title (ignoring case) and the same `file:line`; or different reviewers cite at least two of the same files within three lines; or, **same site**, different reviewers' first (sink) locations are in one file on adjacent lines, or within three lines when their titles share at least two significant words. Only the first location is compared, and two findings that each cite further files with none in common never merge on this rule (different issues in a shared error mapper or config). Real models cite one `file:line` per finding with their own wording, so without the same-site rule the same defect from three models stays three clusters: on a live three-model run of the golden fixture it was 160 clusters for 52 seeded bugs, and 69 with the rule (48 of 52 bugs in one cluster, none mixing two bugs). There are no model-proposed merges.
6. **Triage.** A cluster skips the debate and is marked AGREED only when two vendors reported the same defect: two of their claims cite one `file:line` and share the surface or two significant title words, or cite lines within three of each other and share two significant title words, and every cited line exists in the snapshot and is real code (not blank, not a lone brace). A cluster that merely merged two vendors' adjacent-line claims with no shared subject (rule 5) is `merged_only` and is debated. A vendor is who trained the model, whatever route serves it: a hosted or resold model takes the vendor named in its own model name. Every other cluster enters the queue, ordered by severity weight (critical 5, high 4, medium 3, low 2, info 1) plus 0.5 when the cluster's reports disagree on severity, so a disagreement moves a cluster ahead inside its own severity and never ahead of a higher one; ties break on cluster id. At most `--debate-max-clusters` clusters (default 25) are debated. The rest are marked CAPPED, are listed as a `debate_cap` coverage gap, and are still given a status from the citation rules alone (rule 15), so a capped finding stays in the adjudication and in the risk posture.
7. **Anonymization.** Per cluster, participants are relabelled Reviewer A, B, C in an order derived from a seed and the cluster id. The seed (currently fixed at 1) and every cluster's map are written to `debate/anonymization.json`, which no brief contains. Model and vendor names are scrubbed from argument text, and every turn is validated against the `debate-round` schema.
8. **Challenge (round 1).** Every challenger returns its own verdict (upheld, partial, refuted, insufficient evidence) with citations, without seeing any other round-1 turn. A challenger that already gave a verdict on the cluster's claims in the cross-check phase, citing a line the checker accepts, is not asked again: that verdict is its round-1 turn, quoted from the snapshot by the engine (`source: crosscheck` in the trace). Then, when no challenger's own turn refuted the finding, one challenger that answered speaks a second, separate turn as devil's advocate (`<label>-<cluster>-devil.json`). The devil's turn is not that reviewer's verdict: it is not tallied (rule 15), and later turns are not measured against it. A devil turn that never arrives is a `devil_turn_missing` coverage gap, not a missing answer: it changes no status, so it does not fail the debate stage. A reviewer that did not answer is not asked again as devil, and a reviewer whose devil turns have missed twice is not given the role again (its challenges are unaffected), so a failing provider does not cost a turn clock per cluster.
9. **Defend (round 2).** Runs when rounds ≥ 2 (`--debate-rounds`, 1 to 3, default 2) and some kept round-1 verdict is refuted or partial. Authors see the anonymized challenges and defend with a new citation or concede. A defence that only repeats lines the cluster already holds is discarded (`no_fresh_citation`): an author always upholds itself, so it takes new evidence to turn a counted refutation into a dispute.
10. **Rebut (round 3).** Runs only with `--debate-rounds 3` and only when a round-2 defence counts: the author stood by the finding with a fresh citation, which the challengers may then answer. A concession, a discarded defence or a flip with no new evidence opens no round 3. With the default of 2 rounds there is no round 3.
11. **Early stop.** Per cluster: a cluster with no refuted or partial verdict in round 1 stops after round 1, and one with no counted defence in round 2 stops after round 2.
12. **Citation rule.** The engine checks each cited `{file, startLine, endLine, quote}` against the sealed snapshot: the file must be in the snapshot with the hash recorded in `source-manifest.json`, the range at most 400 lines, the quote a whitespace-normalized substring of that range and at least six non-space characters long (`quote_too_short` otherwise), and the lines the quote occupies within three lines of one of the cluster's own cited lines, or, in a source file, inside the same function within 80 lines of it (`not_about_this_cluster` otherwise). Three lines do not count when a block ends in between (a less-indented line separates the quote from the cited line), and configuration files have no same-function widening. Relevance is measured on the quote's own lines, not on the cited range, so a wide range cannot carry a quote from elsewhere in the file. An argument with no valid citation is discarded. Every check and its reason is written to `debate/citations.json`, and the discard to `debate/trace.jsonl` and to `discardedArguments` in the adjudication. A discarded argument does not count in the status rules (rule 15) and is not shown to the model judge.
13. **Conformity flag.** A verdict change whose valid citations all overlap lines already known to the cluster is kept, marked `conformitySuspect`, and listed as `conformity_suspect`. Overlap is by line, so citing a known line again inside a wider range is not new evidence. It does not count in the status rules. As with rule 12, the model judge's brief still shows it.
14. **Judge assignment.** The judge's vendor must differ from every author's vendor in the cluster. If the orchestrator's vendor conflicts, the alternate judge takes the cluster. With no eligible judge the cluster ends DISPUTED with the rationale `no_independent_judge`. The judge sees anonymous labels, never vendors, model names or vote counts. Its status is clamped to what rule 15 allows from the counted evidence: it cannot raise a finding to CONFIRMED, cannot answer INSUFFICIENT_EVIDENCE when every cited line verified, and cannot keep a finding (LIKELY) against a refutation that nothing answered, unless every counted refutation came from the devil's advocate, whose brief requires that argument. When counted support stands against a refutation the judge resolves the dispute either way. The reviewer that will judge a cluster is reserved before the rounds and does not challenge it, unless it is the only non-author on the panel (a two-model run), where it challenges and then judges in a separate session. The assignment is recorded per cluster in `debate/adjudication.json` (`judge.reviewerId`, `judge.vendor`, `judge.alternate`) and in the general review's methodology. The scripted judge (`scripted:judge`) skips the vendor check and is refused (`scripted_judge_demo_only`) on anything but the bundled fixtures.
15. **Final statuses.**
    - CONFIRMED: triage AGREED, or the cited lines hold and a challenger of another vendor upheld or partly upheld it.
    - LIKELY: the cited lines hold, one source, not refuted.
    - DISPUTED: a counted refutation and counted support, or no independent judge.
    - REFUTED: a counted refutation with a valid citation and no support.
    - INSUFFICIENT_EVIDENCE: a cited line cannot be checked, and no refutation.

    The devil's advocate turn is never tallied: it cannot refute a finding and cannot confirm one. A valid devil refutation that no other vendor's support answers makes the cluster DISPUTED, for the judge to weigh.

    Each speaker counts once, with its last counted verdict: a challenger who refuted in round 1 and upheld in round 3 is support, not both.

    `finalStatus` is written to `debate/adjudication.json`, to each row of `findings-and-scores.json` (joined by claim id, with `judge`, `debateRounds` and `severityReason`) and to the general review's top findings. In `findings-and-scores.json` a triage-agreed cluster shows `AGREED`.
16. **No silent drops.** A finding is REFUTED only by a counted refutation with a valid citation. A REFUTED finding stays in the report with score 0. When the judge is unavailable, the rule-based status stands.
17. **Severity.** The judge may change a severity and is asked for a reason. Raising it needs none. Lowering it without a reason is not applied: the reported severity stays and the record says what the judge proposed.
18. **Stop conditions.** Every loop has a hard cap: N inspection calls per pass plus 3, P passes per reviewer, at most 3 debate rounds, and `--debate-tool-budget` read calls per debate turn or judgement (default 12, then reads are refused). Each debate turn, judgement, and the general review stops after `--debate-turn-ms` (default 180000); the harness aborts that session. The speaking phase stops after `--debate-phase-ms` (default 900000). Clusters not started are a `debate_time` coverage gap and are judged from citations only, which does not by itself make the run INCOMPLETE. A started turn that times out is a `debate_turn_timeout` gap. A cluster that stays DISPUTED, or whose judge does not answer, is adjudicated once more by a different model that neither authored nor argued on it; when every other reviewer argued, there is no second judgement. A second DISPUTED stays DISPUTED. A retry that also does not answer leaves the first gap. A resumable session may recover once from a lost transport. A missing challenge, defence or judgement (not a devil turn, rule 8) is recorded as a `debate` stage failure: the run ends INCOMPLETE, and the per-model findings, the adjudication and the general review are still written. A failed provider never restarts the run.
19. **General review.** After adjudication the orchestrator writes the general review: executive summary, a risk posture computed by the engine from open severities (critical-exposure, high-risk, moderate or low-observed; never "secure"), the top 10 findings with statuses, coverage and gaps, open disagreements (the DISPUTED clusters), per-reviewer contributions, methodology, and the fixed sentence above. A general review that names a cluster id the debate did not produce is rejected, in its structured rows and in its free text alike; so is text that cites a `file:line` in a file no adjudicated cluster cites, or that calls the target secure, safe to ship, production-ready or certified. The refusal goes back to the model, which may submit again. The model writes the summary and the disagreement wording; everything else comes from the records.
20. **Everything is a file.** The debate writes `debate/clusters.json`, `debate/anonymization.json`, `debate/citations.json`, `debate/round-<n>/<Reviewer X>-<cluster>.json`, `debate/trace.jsonl`, `debate/adjudication.json` and `general-review.{json,md}`. A turn that never arrived appears only in the stage failure and the general review's coverage gaps, not in `trace.jsonl`.

## 3. One cluster from challenge to judge

Cluster `CLUSTER-1` was reported by Reviewer X only (one vendor, so it enters the queue). Reviewers Y and Z did not report it and act as challengers; Z also speaks the devil's advocate turn. The run uses `--debate-rounds 3`.

```
Engine         Reviewer X(author)   Reviewer Y        Reviewer Z (devil)   Judge
  |                   |                  |                  |                |
  | 1. cluster CLUSTER-1, relabel per cluster (A=X, B=Y, C=Z), seed recorded |
  |--- brief: claim + quoted code, budget 12 read calls ------------------>  |
  |                   |                  |                  |                |
  | ======================== round 1: challenge =========================     |
  |------------------------------------> | 2. verdict + citations           |
  |-------------------------------------------------------> | 3. own verdict + citations, then a separate devil turn
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
