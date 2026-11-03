// The offline reviewer panel for the golden eval: the four W03 scripted strategies (scripts/scripted-strategies.mjs),
// run through their own read/submit loop. Their fixture answers are derived from expected.json by one fixed policy,
// so the offline numbers measure the debate protocol (citation checks, rules, judge), not model skill:
//   baseline  reports every bug it does not miss, and asserts each decoy's guard as a holding control
//             (or, with misjudgedBy, wrongly asserts a control next to a real bug);
//   paranoid  reports every bug it does not miss plus every decoy;
//   wrong     reports the first decoy, and argues with quotes that are not in the source;
//   lazy      reads until its budget and submits nothing.
import fs from 'node:fs';
import path from 'node:path';
import { runStrategy } from '../scripts/scripted-strategies.mjs';
import { parseReviewerSpec } from '../scripts/reviewer-registry.mjs';
import { claimsFromReports } from '../scripts/debate-claims.mjs';

export const STRATEGIES = ['baseline', 'paranoid', 'wrong', 'lazy'];
const LAZY_BUDGET = 10;

const claimOf = (title, item, severity) => ({
  title, surface: 'S1', severity, confidence: 'probable', location: [`${item.file}:${item.startLine}`],
  impact: `${title}.`, preconditions: 'The entry point is reachable.', analysis: `Source inspection of ${item.file}:${item.startLine}.`,
  validation: 'Source inspection only.', fix: 'Add the missing control.',
});
const control = (text, item) => ({ control: text, evidence: `${item.file}:${item.startLine}`, holds: true });
const misses = (bug, strategy) => (bug.missedBy || []).includes(strategy);

function panelAnswers(expected) {
  const { bugs, decoys } = expected;
  return {
    baseline: {
      findings: bugs.filter((b) => !misses(b, 'baseline')).map((b) => claimOf(b.title, b, b.severity)),
      verified_safe: [...decoys.map((d) => control(d.reason, d)), ...bugs.filter((b) => b.misjudgedBy === 'baseline').map((b) => control(`${b.title} is constrained`, b))],
    },
    paranoid: { findings: [...bugs.filter((b) => !misses(b, 'paranoid')).map((b) => claimOf(b.title, b, b.severity)), ...decoys.map((d) => claimOf(d.claim, d, 'medium'))], verified_safe: [] },
    wrong: { findings: decoys.slice(0, 1).map((d) => claimOf(d.claim, d, 'medium')), verified_safe: [] },
    lazy: { read: bugs[0].file },
  };
}

// Runs one strategy over the repo with an in-process tool loop; returns the submitted payload.
async function play(strategy, repoDir, fixtureRoot) {
  let reads = 0;
  let submitted = null;
  const callTool = async (name, args) => {
    if (name === 'submit_audit_report') { submitted = args; return 'committed'; }
    if (name !== 'read_file') throw new Error(`unexpected tool ${name}`);
    reads += 1;
    if (strategy === 'lazy' && reads > LAZY_BUDGET) return 'budget exhausted: call submit_audit_report now';
    return fs.readFileSync(path.join(repoDir, args.path), 'utf8');
  };
  await runStrategy(strategy, { callTool, fixtureRoot, surface: 'S1', pass: 1 });
  // The shape the bridge commits (bridge-tools-auditor.submitAuditReport): no attack steps, control evidence kept.
  const findings = (submitted?.findings || []).map((finding) => ({ ...finding, attack: [], poc: '' }));
  const controls = (submitted?.verified_safe || []).map((row) => ({ ...row, how_attacked: row.evidence }));
  return { reads, payload: [...findings, { verified_safe: controls }] };
}

// Writes the derived answers under work/answers/ and runs the panel. Returns claims ready for the debate.
export async function runPanel(repoDir, expected, work) {
  const answers = panelAnswers(expected);
  fs.mkdirSync(path.join(work, 'answers'), { recursive: true });
  for (const [name, body] of Object.entries(answers)) fs.writeFileSync(path.join(work, 'answers', `${name}.json`), `${JSON.stringify(body, null, 2)}\n`);
  const reviewers = STRATEGIES.map((name) => parseReviewerSpec(`scripted:${name}`));
  const reports = [];
  const usage = {};
  for (const reviewer of reviewers) {
    const { reads, payload } = await play(reviewer.provider, repoDir, work);
    reports.push({ name: `${reviewer.id}-s1-auth`, data: payload });
    usage[reviewer.id] = reads;
  }
  return { reviewers, usage, reports, ...claimsFromReports(reports, reviewers) };
}
