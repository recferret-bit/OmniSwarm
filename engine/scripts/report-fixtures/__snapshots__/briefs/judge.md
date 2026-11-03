# judge

## Objective
Judge this cluster from the verified quotes and the valid arguments only: CONFIRMED, LIKELY, DISPUTED, REFUTED or INSUFFICIENT_EVIDENCE. You may re-calibrate severity with a reason.

## Cluster CLUSTER-2
Claim: withdraw has no owner check (severity high, surface S1)
Evidence:
- src/lib.rs:16 `self.balance -= amount;`
- src/lib.rs:99 (not checkable: line_out_of_range)

## Arguments so far
- Reviewer A, round 1 (challenge): refuted. The guard holds. Cites src/lib.rs:12.

## Output schema
Call submit_adjudication once with fields of the adjudication schema. Cite file, startLine, endLine and an exact quote, or the argument is discarded.

## Tools and sources
Read the sealed source with read_file, search_code and list_files; get_audit_context gives the scope.

## Boundaries
One cluster only; no new findings. insufficient_evidence is allowed. No exploits. Budget: 12 tool calls.
