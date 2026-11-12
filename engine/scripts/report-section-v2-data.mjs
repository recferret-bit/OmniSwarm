// The report-v2 inputs every section reads: debate/, general-review.*, reviewers/index.json. Size-capped reads,
// because report directories hold target-influenced text. Not a section (exports no `section`).
import fs from 'node:fs';
import path from 'node:path';
import { listJsonFiles, readJsonOr } from './report-util-files.mjs';
import { readReportText } from './report-files.mjs';

export const FAMILY_ORDER = ['cli', 'key', 'openrouter', 'nearai', 'scripted'];
const familyRank = (family) => (FAMILY_ORDER.includes(family) ? FAMILY_ORDER.indexOf(family) : FAMILY_ORDER.length);

function sortedGroups(index) {
  return [...(index?.groups || [])].sort((a, b) => familyRank(a.family) - familyRank(b.family));
}

// One row per reviewer, in family order, with family and vendor folded in.
function reviewersFromIndex(index) {
  return sortedGroups(index).flatMap((group) => (group.vendors || []).flatMap((vendor) => (vendor.reviewers || []).map((row) => ({ ...row, family: group.family, vendor: vendor.vendor }))));
}

function uniqueGaps(clusters, file) {
  const seen = new Set();
  return [...(file?.coverageGaps || []), ...clusters.filter((c) => c.status === 'CAPPED').map((c) => ({ clusterId: c.id, reason: 'debate_cap' }))]
    .filter((gap) => { const key = `${gap.clusterId}:${gap.reason}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

// null when the run has neither a debate nor a general review: the pre-v2 pages render unchanged.
export function loadV2Data(reportDir) {
  const clustersFile = readJsonOr(reportDir, 'debate/clusters.json', null);
  const general = readJsonOr(reportDir, 'general-review.json', null);
  if (!clustersFile && !general) return null;
  const clusters = Array.isArray(clustersFile?.clusters) ? clustersFile.clusters : [];
  const adjudication = readJsonOr(reportDir, 'debate/adjudication.json', []);
  let markdown = '';
  try { markdown = readReportText(reportDir, 'general-review.md', 1024 * 1024); } catch { /* the section says the review is missing */ }
  const index = readJsonOr(reportDir, 'reviewers/index.json', null);
  let roundNumbers = [1, 2, 3];
  const iterationRoundNumbers = [];
  try {
    const debateDir = path.join(reportDir, 'debate');
    if (fs.existsSync(debateDir)) {
      const found = fs.readdirSync(debateDir)
        .map((name) => /^round-([1-9][0-9]?)$/.exec(name))
        .filter(Boolean)
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b);
      if (found.length) roundNumbers = found;
      const iterDir = path.join(debateDir, 'iterations');
      if (fs.existsSync(iterDir)) {
        const iterFound = fs.readdirSync(iterDir)
          .map((name) => /^round-([1-9][0-9]*)$/.exec(name))
          .filter(Boolean)
          .map((m) => Number(m[1]))
          .filter((n) => n >= 4)
          .sort((a, b) => a - b);
        iterationRoundNumbers.push(...iterFound);
      }
    }
  } catch { /* fall back to 1..3 */ }
  const baseRounds = roundNumbers.flatMap((n) => listJsonFiles(reportDir, `debate/round-${n}`));
  const iterRounds = iterationRoundNumbers.flatMap((n) => listJsonFiles(reportDir, `debate/iterations/round-${n}`).map((turn) => ({ ...turn, round: n })));
  return {
    reportDir, clusters, coverageGaps: uniqueGaps(clusters, clustersFile), general, markdown, index,
    byCluster: new Map((Array.isArray(adjudication) ? adjudication : []).map((row) => [row.clusterId, row])),
    rounds: [...baseRounds, ...iterRounds],
    citations: readJsonOr(reportDir, 'debate/citations.json', []),
    people: reviewersFromIndex(index),
  };
}

// A citation is verified only when the checker recorded it as valid for this cluster; anything it did not
// record is shown as unchecked, never as a tick.
export function citationState(data, turn, citation) {
  const hit = (Array.isArray(data.citations) ? data.citations : []).find((row) => row.file === citation.file && row.startLine === citation.startLine && row.quote === citation.quote && (row.clusterId == null || row.clusterId === turn.clusterId) && (row.anonId == null || row.anonId === turn.anonId));
  if (!hit) return { valid: false, reason: 'unchecked' };
  return hit.valid === true ? { valid: true } : { valid: false, reason: hit.reason || 'quote_not_found' };
}

export function turnsOf(data, clusterId) {
  return data.rounds.filter((turn) => turn.clusterId === clusterId).sort((a, b) => a.round - b.round || String(a.anonId).localeCompare(String(b.anonId)));
}
