/**
 * crosscheck.mjs
 *
 * Collects the claims a cross-check reviewer receives: every other reviewer's findings (id, title,
 * location, impact). The argument and the other reviewer's write-up are left out on purpose.
 * Peers are chosen by reviewer id; a claim is excluded from a reviewer's inbox when the reviewer
 * shares its **vendor** (cli:claude:opus and openrouter:anthropic/... are one vendor).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAuditors, adapterOf } from './report-contract.mjs';
import { reviewersOfMeta, vendorOfJob } from './reviewer-registry.mjs';

export function loadAuditorFindings(auditorsDir) {
  const claims = [];
  const { reports, meta } = loadAuditors(path.dirname(auditorsDir));
  const reviewers = reviewersOfMeta(meta);
  for (const { name: stem, data } of reports) {
    const model = adapterOf(stem); // reviewer id of the author
    const vendor = vendorOfJob(stem, reviewers);
    const findings = data.filter((x) => x && x.title && !x.verified_safe);
    findings.forEach((x, i) => {
      claims.push({
        id: `${stem}#${i}`,
        auditor: stem,
        model,
        vendor,
        surface: String(x.surface || ''),
        severity: String(x.severity || ''),
        title: String(x.title),
        location: Array.isArray(x.location) ? x.location.slice(0, 8).map(String) : [],
        impact: String(x.impact || '').slice(0, 600),
      });
    });
  }
  return claims;
}

// Claims a reviewer may cross-check: authored by anyone of another vendor. An unknown vendor never matches,
// so claims of unknown origin are never silently dropped.
export function peerClaims(claims, reviewer) {
  return claims.filter((c) => c.model && c.model !== reviewer.id && (!c.vendor || c.vendor !== reviewer.vendor));
}

// The old `prepare` command is gone (the orchestrator builds inboxes in-process).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stderr.write(`crosscheck: unknown command${process.argv[2] ? ` "${process.argv[2]}"` : ''}\n`);
  process.exitCode = 1;
}
