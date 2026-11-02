#!/usr/bin/env node
// Offline debate for scripted reviewers. Each step writes a file under debate/.
import fs from 'node:fs';
import path from 'node:path';
import { buildClusters } from './debate-cluster.mjs';
import { checkCitations } from './debate-citations.mjs';
import { anonymize, stripIdentity } from './debate-anonymize.mjs';
import { classifyArgument, judgeVisible } from './debate-rules.mjs';
import { scriptedArgument, scriptedFindings, lineOf } from './debate-scripted.mjs';
import { validate } from '../shared/schemas/index.mjs';

const DISCLAIMER = 'Model agreement and passing checks do not certify security.';

function write(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function strategyOf(auditor) {
  return String(auditor).replace(/^scripted-/, '');
}

export function judgeCluster(cluster, turns) {
  const visible = judgeVisible(turns);
  const refuted = visible.filter((turn) => turn.verdict === 'refuted' && (turn.citations || []).some((citation) => citation.valid));
  const upheld = visible.filter((turn) => turn.verdict === 'upheld' && (turn.citations || []).some((citation) => citation.valid));
  let finalStatus = 'DISPUTED';
  if (upheld.length && !refuted.length) finalStatus = cluster.vendors.length >= 2 ? 'CONFIRMED' : 'LIKELY';
  else if (refuted.length && !upheld.length) finalStatus = 'REFUTED';
  else if (!visible.length) finalStatus = cluster.vendors.length < 2 ? 'LIKELY' : 'INSUFFICIENT_EVIDENCE';
  if (cluster.vendors.length < 2 && !refuted.length) finalStatus = 'LIKELY';
  return finalStatus;
}

export function runDebate(out, { sourceRoot, findings, rounds = 2, maxClusters = 25, seed = 1, orchestrator = 'scripted:judge', reviewers = [], fault = process.env.OMNI_FAULT } = {}) {
  if (fault === 'debate-round-2' || fault === 'general-review') {
    write(out, 'meta.json', JSON.stringify({ stageFailures: [fault === 'debate-round-2' ? 'debate' : 'general-review'], reviewers: reviewers.length ? reviewers : findings.map((row) => ({ id: row.auditor })) }, null, 2));
    write(out, 'report-health.json', JSON.stringify({ state: 'INCOMPLETE', errors: [`stageFailures: ${fault === 'debate-round-2' ? 'debate' : 'general-review'}`] }, null, 2));
    if (reviewers.length) write(out, 'reviewers/index.json', JSON.stringify({ reviewers: reviewers.map((row) => row.id || row) }, null, 2));
    const error = new Error(fault);
    error.code = fault;
    throw error;
  }
  const bug = lineOf(sourceRoot, 'saturating_sub');
  const safe = lineOf(sourceRoot, 'assert_eq!');
  const vendors = Object.fromEntries(findings.map((row) => [row.auditor, row.vendor || 'scripted']));
  const built = buildClusters(findings, { sourceRoot, maxClusters, vendors });
  write(out, 'debate/clusters.json', built);
  const ids = [...new Set(findings.map((row) => row.auditor))];
  const names = anonymize(ids, seed);
  write(out, 'debate/anonymization.json', names);
  const trace = [];
  const citations = [];
  const adjudication = [];
  for (const cluster of built.clusters) {
    if (cluster.status !== 'QUEUED') {
      if (cluster.status === 'AGREED') adjudication.push({ clusterId: cluster.id, finalStatus: 'CONFIRMED', severity: cluster.severity || 'high', severityReason: 'Two vendors cited the same lines.', judge: { reviewerId: 'scripted-judge', vendor: 'scripted', alternate: false }, rationale: 'Agreed before debate.', validArguments: [], discardedArguments: [] });
      continue;
    }
    const authors = new Set(cluster.auditors);
    const challengers = ids.filter((id) => !authors.has(id));
    const advocate = challengers[seed % Math.max(challengers.length, 1)] || null;
    const turns = [];
    const speak = (speaker, round, role) => {
      const raw = scriptedArgument({ strategy: strategyOf(speaker), round, bug, safe });
      const checked = checkCitations(sourceRoot, raw.citations);
      citations.push(...checked.map((row) => ({ ...row, speaker: names.map[speaker], clusterId: cluster.id })));
      const turn = classifyArgument({
        round, clusterId: cluster.id, role, anonId: names.map[speaker], verdict: raw.verdict,
        citations: checked, argument: stripIdentity(raw.argument), conformitySuspect: raw.conformitySuspect,
        devilAdvocate: role === 'devil', verdictChanged: raw.verdictChanged, discarded: false,
      });
      turns.push(turn);
      const file = `debate/round-${round}/${names.map[speaker]}-${cluster.id}.json`;
      const body = { round, clusterId: cluster.id, role, anonId: names.map[speaker], verdict: turn.verdict, citations: checked.map(({ file: f, startLine, endLine, quote }) => ({ file: f, startLine, endLine, quote })), argument: turn.argument, conformitySuspect: Boolean(turn.conformitySuspect), devilAdvocate: role === 'devil' };
      write(out, file, body);
      trace.push({ template: role, anonId: names.map[speaker], clusterId: cluster.id, stop: turn.discarded ? 'discarded' : turn.verdict });
    };
    challengers.forEach((speaker) => speak(speaker, 1, speaker === advocate ? 'devil' : 'challenge'));
    let changed = turns.some((turn) => turn.verdictChanged);
    if (rounds >= 2) {
      for (const speaker of cluster.auditors) speak(speaker, 2, 'defend');
      changed = turns.filter((turn) => turn.round === 2).some((turn) => turn.verdictChanged);
    }
    if (rounds >= 3 && changed) {
      for (const speaker of challengers) speak(speaker, 3, 'rebut');
    }
    const finalStatus = judgeCluster(cluster, turns);
    const discarded = turns.filter((turn) => turn.discarded).map((turn) => turn.anonId);
    adjudication.push({
      clusterId: cluster.id, finalStatus, severity: cluster.severity || 'medium', severityReason: 'Left at the reported severity.',
      judge: { reviewerId: 'scripted-judge', vendor: 'scripted', alternate: false },
      rationale: `${finalStatus} from verified citations only.`,
      validArguments: judgeVisible(turns).map((turn) => turn.anonId),
      discardedArguments: discarded,
    });
    trace.push({ template: 'judge', anonId: 'judge', clusterId: cluster.id, stop: finalStatus });
  }
  write(out, 'debate/citations.json', citations);
  write(out, 'debate/adjudication.json', adjudication);
  const general = {
    executiveSummary: 'Scripted debate finished on the golden fixture.',
    riskPosture: adjudication.some((row) => row.finalStatus === 'LIKELY' || row.finalStatus === 'CONFIRMED') ? 'high-risk' : 'moderate',
    topFindings: adjudication.map((row) => ({ clusterId: row.clusterId, title: built.clusters.find((cluster) => cluster.id === row.clusterId)?.primaryTitle || row.clusterId, severity: row.severity, finalStatus: row.finalStatus })),
    coverage: [{ surface: 'S1', covered: true, gaps: built.coverageGaps.map((gap) => gap.reason) }],
    openDisagreements: adjudication.filter((row) => row.finalStatus === 'DISPUTED').map((row) => ({ clusterId: row.clusterId, summary: row.rationale })),
    contributions: ids.map((id) => ({ reviewerId: id, uniqueConfirmed: 0, refuted: 0, toolCalls: 1, costUsd: 0 })),
    methodology: { reviewers: ids, orchestrator, passes: 1, toolBudget: 12, debateRounds: rounds },
    disclaimer: DISCLAIMER,
  };
  const check = validate('general-review', general);
  if (!check.ok) throw new Error(check.errors[0]);
  write(out, 'general-review.json', general);
  write(out, 'general-review.md', `# General review\n\n${general.executiveSummary}\n\nRisk posture: ${general.riskPosture}\n\n${general.topFindings.map((row) => `- ${row.title}: ${row.finalStatus}`).join('\n')}\n\n${ids.map((id) => `- ${id}`).join('\n')}\n\n${DISCLAIMER}\n`);
  trace.push({ template: 'general_review', anonId: 'orchestrator', stop: 'submitted' });
  write(out, 'debate/trace.jsonl', `${trace.map((row) => JSON.stringify(row)).join('\n')}\n`);
  return { clusters: built.clusters, adjudication, names };
}

export function runGolden(sourceRoot, out, options = {}) {
  const findings = options.findings || scriptedFindings(sourceRoot);
  return runDebate(out, { sourceRoot, findings, ...options });
}
