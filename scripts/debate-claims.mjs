// The debate's input: the claims the reviewers actually committed (auditors/*.json), with the same claim ids
// verify-and-adjudicate uses (`<auditor file stem>#<index>`), so a debate cluster joins its report cluster by claim id.
import { adapterOf, loadAuditors } from './report-contract.mjs';
import { reviewersOfMeta, vendorOfJob } from './reviewer-registry.mjs';

// reports: [{name, data}] as loadAuditors returns them (findings then a {verified_safe} tail).
export function claimsFromReports(reports, reviewers) {
  const claims = [];
  const controls = new Map();
  for (const { name, data } of reports) {
    const reviewerId = adapterOf(name);
    const vendor = vendorOfJob(name, reviewers) || reviewerId;
    data.slice(0, -1).forEach((finding, index) => {
      claims.push({ ...finding, claimId: `${name}#${index}`, auditor: name, reviewerId, vendor });
    });
    const own = controls.get(reviewerId) || [];
    controls.set(reviewerId, [...own, ...(data.at(-1)?.verified_safe || [])]);
  }
  return { claims, controls };
}

export function loadClaims(reportDir) {
  const { meta, reports } = loadAuditors(reportDir);
  const reviewers = reviewersOfMeta(meta);
  return { meta, reviewers, ...claimsFromReports(reports, reviewers) };
}
