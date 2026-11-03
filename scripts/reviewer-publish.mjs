// Reviewers as they are written to harness/reviewers.json and meta.reviewers: the parsed spec plus
// `keyFingerprint` (first 4 + last 4 hex of sha256) of the operator variable that holds the key.
// The key itself is never part of the result (AGENTS.md "Key policy").
import { families } from './reviewer-families.mjs';
import { withKeyFingerprint } from './reviewer-env.mjs';

export function publishReviewers(reviewers, env = process.env) {
  return reviewers.map((reviewer) => withKeyFingerprint(reviewer, families.has(reviewer.family) ? families.fingerprintEnv(reviewer) : null, env));
}
