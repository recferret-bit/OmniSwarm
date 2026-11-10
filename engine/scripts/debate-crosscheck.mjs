// Cross-check verdicts as round-1 challenges (ORCHESTRATION 2: crosscheck = debate round 1). A reviewer that
// already gave a verdict on a cluster's claims in the cross-check phase is not asked for the same verdict again
// in a debate session. Its verdict becomes its round-1 turn when it cited a line the checker accepts; the quote
// is the cited line read from the sealed snapshot, never text supplied by the model. With no usable citation
// the reviewer is asked in a debate session as before.
import fs from 'node:fs';
import path from 'node:path';
import { anchorEvidence } from './debate-citations.mjs';
import { loadAuditors, validCrosscheckRow } from './report-contract.mjs';
import { readJsonOr } from './report-util-files.mjs';

const ADVERSE = { refuted: 2, partial: 1, upheld: 0 };
const LOCATION = /^(.+):(\d+)(?:-\d+)?$/;

// Map claimId -> [{reviewer, verdict, reason, evidence}] from auditors/crosscheck-<reviewer>.json. Only rows a
// reviewer was assigned, with a valid shape, are kept; a second row for the same claim is ignored.
export function crosscheckVerdicts(reportDir) {
  const byClaim = new Map();
  const dir = path.join(reportDir, 'auditors');
  if (!fs.existsSync(dir)) return byClaim;
  let assignments;
  try { ({ assignments } = loadAuditors(reportDir)); } catch { return byClaim; }
  for (const file of fs.readdirSync(dir).filter((name) => name.startsWith('crosscheck-') && name.endsWith('.json')).sort()) {
    const reviewer = file.slice('crosscheck-'.length, -'.json'.length);
    const assigned = assignments?.[reviewer];
    const rows = readJsonOr(reportDir, `auditors/${file}`, null);
    if (!Array.isArray(assigned) || !Array.isArray(rows)) continue;
    const seen = new Set();
    for (const row of rows) {
      if (!validCrosscheckRow(row) || !assigned.includes(row.id) || seen.has(row.id)) continue;
      seen.add(row.id);
      const list = byClaim.get(String(row.id)) || [];
      list.push({ reviewer, verdict: row.verdict, reason: String(row.reason || '').slice(0, 800), evidence: Array.isArray(row.evidence) ? row.evidence.map(String).slice(0, 8) : [] });
      byClaim.set(String(row.id), list);
    }
  }
  return byClaim;
}

// The reviewer's cross-check answer on one cluster as a raw debate turn, or null when it gave none. Several
// claims of one cluster take the most adverse verdict: a reviewer that refuted one of them did not uphold the cluster.
export function crosscheckTurn(cluster, reviewerId, byClaim, reader) {
  const rows = (cluster.claimIds || []).flatMap((id) => (byClaim.get(String(id)) || []).filter((row) => row.reviewer === reviewerId));
  if (!rows.length) return null;
  const verdict = rows.map((row) => row.verdict).sort((a, b) => ADVERSE[b] - ADVERSE[a])[0];
  const citations = [];
  const seen = new Set();
  for (const text of rows.filter((row) => row.verdict === verdict).flatMap((row) => row.evidence)) {
    const match = LOCATION.exec(text.trim().replace(/^\/(?:work\/)?src\//, '').replace(/^\.\//, ''));
    if (!match || seen.has(`${match[1]}:${match[2]}`)) continue;
    seen.add(`${match[1]}:${match[2]}`);
    const row = anchorEvidence(reader, { file: match[1], line: Number(match[2]) });
    if (row.valid) citations.push({ file: row.file, startLine: row.startLine, endLine: row.endLine, quote: row.quote });
  }
  const argument = rows.filter((row) => row.verdict === verdict).map((row) => row.reason).filter(Boolean).join(' ').slice(0, 1200) || 'Cross-check verdict; no reason was given.';
  return { verdict, argument, citations };
}

// prior(cluster, reviewerId) for runRounds, or null when the run has no cross-check output.
export function crosscheckPrior(reportDir, reader) {
  const byClaim = crosscheckVerdicts(reportDir);
  return byClaim.size ? (cluster, reviewerId) => crosscheckTurn(cluster, reviewerId, byClaim, reader) : null;
}
