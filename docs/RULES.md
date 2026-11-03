# RULES.md

The review round of OmniSwarm written as swarm rules. This is the rulebook the debate code implements. Finalized for the hackathon pack. The owner still submits the form, posts, and chooses whether the repo is public. Source of truth for the numbers: `docs/spec/ORCHESTRATION.md` sections 3 and 4.

Model agreement and passing checks do not certify security. The rules below make a review checkable, not conclusive.

## 1. Who takes part

| Role | Who | What it may do |
|---|---|---|
| **Reviewer** | One model in one family (`cli`, `key`, `openrouter`, `scripted`). Many per run | Read the sealed source through the read-only bridge, run the frozen existing tests, submit findings |
| **Challenger** | Any reviewer that did not author a given cluster | Judge another reviewer's finding and say upheld, partial, refuted, or insufficient evidence |
| **Devil's advocate** | One challenger per cluster, assigned by the engine | Argue the strongest case that the finding is a false positive |
| **Author** | A reviewer that reported a finding in the cluster | Defend or concede after seeing the anonymized challenges |
| **Orchestrator** | One model (or `recommended`) with read-only tools | Suggest merges of clusters, adjudicate, write the general review. Never runs tests and never adds a new finding in the general review |
| **Alternate judge** | A reviewer of a different vendor | Judges a cluster when the orchestrator's vendor conflicts with an author's vendor |
| **Engine** | Plain code, no model | Assigns work, anonymizes, checks citations, enforces budgets, writes every record |

## 2. Rules

1. **Isolation first.** In the review phase every reviewer works alone. It sees no peer output.
2. **Passes.** Each reviewer runs exactly P passes per assignment (default 2). Pass 1 is discovery. Pass 2 is self-verification: re-read every own citation, drop or fix what does not hold, then use the rest of the pass on files the coverage map shows unread. Pass 3 and later deepen the reviewer's own highest-severity leads. A pass that submits early still counts; the next pass always runs.
3. **Tool budget.** A pass may make at most N bridge tool calls (default 40, submit calls excluded). After N calls the reviewer may only submit; inspection tools answer "budget exhausted: call submit_audit_report now". Three more calls are allowed, then the session is cancelled and the pass is recorded as stopped by budget. The same numbers apply to every family.
3a. **Cost ceiling.** If `--max-cost-usd` is set and the summed cost crosses it, the current pass ends and is recorded as stopped by cost.
4. **Evidence or nothing.** Every finding and every debate argument cites `file:line` plus a quoted line of code. "Submit no finding if there is none" is a legal result.
5. **Clustering.** The engine groups findings by code: the same title and citation, or at least two shared files within three lines. The orchestrator may propose extra merges; each needs a one-line reason and is applied only if both members cite the same file.
6. **Triage.** A cluster reported by at least two vendors, with every citation passing the checker, skips debate and is marked AGREED. Everything else enters the debate queue, ordered by severity weight times (1 + disagreement), capped at 25 clusters. Clusters over the cap keep their earlier status and are listed as a coverage gap.
7. **Anonymization.** Per cluster, participants are relabelled Reviewer A, B, C in a shuffled order with a recorded seed. Model names, vendors and vote counts are removed. Text is normalized to the schema so style does not leak.
8. **Challenge (round 1).** Every challenger returns a verdict (upheld, partial, refuted, insufficient evidence) with citations. One challenger is the devil's advocate.
9. **Defend (round 2).** Authors see the anonymized challenges and either defend with new citations or concede.
10. **Rebut (round 3).** Only when some verdict changed in round 2. The maximum is three rounds.
11. **Early stop.** A round with no verdict change ends the debate for that cluster.
12. **Citation rule.** The engine checks each cited `{file, startLine, endLine, quote}` against the read-only source by whitespace-normalized substring match. An argument with no valid citation is discarded and the discard is logged. The judge never sees it.
13. **Conformity flag.** A verdict change without a new valid citation is kept but marked as suspect and counts for nothing in front of the judge. Peers agreeing is not evidence.
14. **Judge assignment.** The judge sees the claim, the verified quotes and the valid arguments, never vendors, model names or vote counts. The judge's vendor must differ from every author's vendor in the cluster. If the orchestrator conflicts, the cluster goes to the alternate judge. The assignment is recorded per cluster. An author never judges its own finding.
15. **Final statuses.**
    - CONFIRMED: the evidence holds and at least one independent reviewer upheld it.
    - LIKELY: the evidence holds, one source, not refuted.
    - DISPUTED: valid evidence on both sides.
    - REFUTED: valid refuting evidence.
    - INSUFFICIENT_EVIDENCE: nothing checkable either way.
16. **No silent drops.** A single-source finding is never removed without a valid refuting citation. Unique findings are often the valuable ones.
17. **Severity.** The judge may change a severity only with a written reason.
18. **Stop conditions.** Every loop has a hard cap: tool calls per pass, passes per reviewer, debate rounds (max 3), debate turns of 12 calls each, one judge call per disputed cluster plus one for the general review (one retry on transport failure only). A failed provider degrades the run to INCOMPLETE; it never restarts the run and never hides per-model findings.
19. **General review.** After adjudication the orchestrator writes the general review: summary, a risk posture (critical-exposure, high-risk, moderate or low-observed; never "secure"), top findings with statuses, coverage and gaps, open disagreements, per-reviewer contributions, methodology, and the fixed sentence above. It adds no new finding.
20. **Everything is a file.** Every call, citation check, verdict change, discard and stop reason is written to the report directory.

## 3. One cluster from challenge to judge

Cluster `c-001` was reported by Reviewer X only (one vendor, so it enters the queue). Reviewers Y and Z did not report it and act as challengers; Z is the devil's advocate.

```
Engine         Reviewer X(author)   Reviewer Y        Reviewer Z (devil)   Judge
  |                   |                  |                  |                |
  | 1. cluster c-001 (title + citation), relabel A=X, B=Y, C=Z, seed recorded |
  |--- brief: claim + quoted code, budget 12 calls ----------------------->  |
  |                   |                  |                  |                |
  | ======================== round 1: challenge =========================     |
  |------------------------------------> | 2. verdict + citations           |
  |-------------------------------------------------------> | 3. verdict + citations (argue false positive)
  | 4. citation check (code): invalid quote -> argument discarded, logged     |
  |                   |                  |                  |                |
  | ======================== round 2: defend ============================     |
  |---- anonymized challenges ---------> |                  |                |
  |                   | 5. defend with NEW citation, or concede              |
  | 6. citation check; verdict change without new citation -> conformity flag |
  |                   |                  |                  |                |
  | ======================== round 3: rebut (only if a verdict changed) ====  |
  |------------------------------------> | 7. rebut         |                |
  | 8. a round with no verdict change -> stop for this cluster                |
  |                   |                  |                  |                |
  | 9. judge check: judge vendor != vendor of X; else alternate judge         |
  |------------------------------------------------------------------------> |
  |                   |                  |                  | 10. read verified quotes + valid arguments only
  |<------------------------------------------------------------------------ | 11. status + severity (+ reason) + rationale
  | 12. write debate/adjudication.json, general review reads it               |
```

Reading it: steps 1 to 3 are rule 7 and 8; step 4 is rule 12; steps 5 and 6 are rules 9 and 13; step 7 and 8 are rules 10 and 11; steps 9 to 11 are rules 14 to 17; step 12 is rule 20.

## 4. What this file does not cover

Review-pass briefs, the bridge tools per role, report layout and the evaluation that decides whether debate ships as the default are in `docs/spec/ORCHESTRATION.md` (sections 5 to 7). W14 turns this v0 into the final RULES.md after the golden eval.
