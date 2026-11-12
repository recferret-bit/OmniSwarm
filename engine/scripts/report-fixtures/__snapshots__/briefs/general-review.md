# general-review

## Objective
Write the executive summary of the adjudicated clusters listed below and name the disagreements that stayed open. Do not add a finding that was not adjudicated: name only the cluster ids listed here and cite only files they cite. Report findings and gaps; do not state that the target is secure, safe to ship or certified.

## Adjudicated clusters
Adjudicated: 1 cluster, 1 LIKELY; by severity 1 high. These counts are computed and printed before your summary: do not restate or recount them.
- CLUSTER-2: LIKELY (high) withdraw has no owner check

## Output schema
Call submit_general_review once with fields of the general-review schema. Cite file, startLine, endLine and an exact quote, or the argument is discarded.

## Tools and sources
No source reads are needed; use the adjudication above.

## Boundaries
No new findings in this step. insufficient_evidence is allowed. No exploits. Budget: 12 tool calls.
