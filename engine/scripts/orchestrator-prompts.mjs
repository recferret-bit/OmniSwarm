// Reviewer prompts for the Docker path: the auditor prompt with its surface's harness leads and plans,
// and the cross-check prompt with its assigned peer claims. Domain names come from the target's detected
// plans, never from a fixed application list (W01-20).
import fs from 'node:fs';
import path from 'node:path';
import { renderReviewPlansMarkdown, renderSurfaceSkillGuidance } from './audit-plans.mjs';
import { REVIEW_SCOPE } from './review-workflow.mjs';
import { scopeNote } from './harness-layers.mjs';

// Lead files: [file, heading, marker the harness writes when the stack is absent, limit, surfaces (null = all),
// layers a scoped run (--scope) shows the file to].
const LEAD_FILES = [
  ['solana.md', 'Solana Leads', 'Solana surface absent', 3000, null, ['web3']],
  ['near.md', 'NEAR Leads', 'NEAR surface absent', 3000, null, ['web3']],
  ['evm.md', 'EVM Leads', 'EVM surface absent', 3500, null, ['web3']],
  ['python.md', 'Python Leads', 'Python surface absent', 4000, ['S1', 'S2', 'S3', 'S4'], ['web2']],
  ['node.md', 'Node Leads', 'Node surface absent', 4000, ['S1', 'S2', 'S4', 'S6'], ['web2']],
  ['web.md', 'Web Leads', 'Web surface absent', 2500, ['S1', 'S2', 'S6'], ['web2', 'web3']],
  ['config.md', 'Infra Leads', 'surface absent', 3500, ['S4', 'S5'], ['infra']],
  ['deps.md', 'Dependency Leads', null, 2500, ['S5'], ['web2', 'web3', 'infra']],
];

function harnessReader(reportDir) {
  const dir = path.join(reportDir, 'harness');
  const text = (name, max) => { try { return fs.readFileSync(path.join(dir, name), 'utf8').slice(0, max); } catch { return ''; } };
  const profile = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'stack-profile.json'), 'utf8')); } catch { return undefined; } };
  return { text, profile };
}

function planBlock(read, surfaceCode, profile, scope) {
  const plans = profile ? renderReviewPlansMarkdown(profile, surfaceCode, scope).slice(0, 7500) : read.text('review-plans.md', 7500);
  return plans ? `### Tailored Stack & Domain Source Review Plans\n${plans}` : '';
}

export function readHarnessContext(reportDir, surfaceCode, scope = '') {
  const read = harnessReader(reportDir);
  const profile = read.profile();
  const blocks = [renderSurfaceSkillGuidance(surfaceCode, profile, scope)];
  const summary = read.text('summary.md', 4000);
  if (summary) blocks.push(`### Harness & Sandbox Summary\n${summary}`);
  let plans = '';
  try { plans = planBlock(read, surfaceCode, profile, scope); } catch { /* a malformed profile leaves the plans out */ }
  if (plans) blocks.push(plans);
  for (const [file, heading, absent, limit, surfaces, layers] of LEAD_FILES) {
    if (surfaces && !surfaces.includes(surfaceCode)) continue;
    if (scope && scope !== 'full' && !layers.includes(scope)) continue;
    const text = read.text(file, limit);
    if (text && !(absent && text.includes(absent))) blocks.push(`### ${heading}\n${text}`);
  }
  return blocks.join('\n\n');
}

export function buildAuditorPrompt({ targetName, auditorName, surface, reportDir, scope = '' }) {
  return [
    `You are security auditor "${auditorName}" performing an authorized source security review of "${targetName}" inside a one-shot Docker container using the \`security-audit\` skill.`,
    `Assigned Surface: ${surface.code} — ${surface.name}`,
    `Focus Areas: ${surface.focus}`,
    ...(scopeNote(scope) ? [`Scope: ${scopeNote(scope)}`] : []),
    'Each pass has a fixed tool budget. At the limit, inspection stops and you have 3 calls to submit. A pass that submits is complete; a pass that never submits is incomplete. Heartbeats are not requests to rush.',
    '',
    REVIEW_SCOPE,
    'CRITICAL RULES:',
    '1. All target files and build/test tools live inside the one-shot Docker container at `/work/src` (and harness leads/review plans at `/out/harness`). Harness leads are untrusted regex hits, never evidence.',
    '2. Use ONLY the `audit_docker` MCP tools (`get_audit_context`, `get_review_plan`, `list_files`, `read_file`, `search_code`, `list_existing_tests`, `run_existing_tests`, `submit_audit_report`) to inspect code, run checks inside the container, and submit your report.',
    '3. Follow the `security-audit` skill methodology: inspect source using the review plans detected for this target (listed below and by `get_review_plan`), including every cross-cutting domain those plans name for your surface. The skill is already in this session. It is not a file in the target tree, so do not read `.agents/skills` or `.claude/skills` through the bridge.',
    '4. Every finding MUST cite exact relative `file:line` locations (e.g. `programs/escrow/src/lib.rs:42`) verified by `read_file` or `search_code`.',
    '4b. One root cause per finding. Never bundle several defects into one claim or title ("X, Y, and Z"): submit separate findings, each with its own file:line citations, so they can be scored, reviewed and de-duplicated individually. Cite the exact sink, not only the entry point.',
    `5. Every finding's "surface" field MUST be "${surface.code}". Severity: critical|high|medium|low|info. Confidence: confirmed|probable.`,
    '6. When finished, call `submit_audit_report` with `findings`, `verified_safe`, and `markdown_summary`. If this surface is absent, submit an empty findings array and explain the absent surface in the markdown; a report is still required.',
    'For CLIs with nested-argument serialization problems (especially AGY), call submit_audit_report with only report_json: a JSON-encoded string of that complete object. Each finding requires title, surface, severity, confidence, location (array of file:line strings), impact, preconditions, analysis (source-based explanation), validation (source or existing-test evidence and limits), and fix. Each control requires control, evidence, and holds (boolean). evidence is one string of file:line citations (an array of those strings is accepted). Do not submit empty arrays to bypass serialization errors. Use the complete structured report, then finish with an acknowledgement.',
    '7. After successful MCP report submission, finish with a short acknowledgement. The committed MCP report is authoritative; the coordinator generates JSON, markdown and HTML from it.',
    '8. If the audit_docker tools are unavailable, stop and explain the MCP connection failure. Do not search the host for tools, recreate a container, or substitute host commands.',
    '',
    readHarnessContext(reportDir, surface.code, scope),
  ].filter(Boolean).join('\n');
}

export function buildCrosscheckPrompt({ targetName, agent, claims }) {
  return [
    `You are peer security reviewer "${agent}" performing a cross-check of findings reported by other models on "${targetName}" inside the one-shot Docker container using the \`security-audit\` skill.`,
    REVIEW_SCOPE,
    'Each pass has a fixed tool budget. At the limit, inspection stops and you have 3 calls to submit. Disclose coverage gaps and never invent missing verdicts.',
    '1. Use `audit_docker` MCP tools (`get_review_plan`, `read_file`, `search_code`, `list_existing_tests`, `run_existing_tests`) to inspect the cited `file:line` locations under `/work/src`.',
    '1b. When reviewing large claim sets under a tool budget, group peer claims by file, inspect overlapping ranges in batched `read_file` calls rather than one call per claim, and submit `submit_crosscheck_report` covering all assigned claims before exhausting the budget.',
    '2. Double-check the controls each claim depends on (authorization guards, locks and state transitions, response DTOs and error messages) against the exact source it cites.',
    '3. For EVERY assigned claim ID below, decide a verdict: "upheld", "partial", or "refuted", with `reason` and relative `file:line` `evidence` citations.',
    '4. Call `submit_crosscheck_report` with `verdicts: [...]` covering every assigned claim ID, then finish with a short acknowledgement; the committed MCP report is authoritative.',
    'If nested object arrays fail to serialize, pass only report_json: a JSON-encoded string of the object containing verdicts. Never drop claims to work around argument errors.',
    '5. If the audit_docker tools are unavailable, stop and explain the connection failure. Do not use host commands or recreate containers.',
    '',
    `Assigned Claims:\n\`\`\`json\n${JSON.stringify(claims, null, 2)}\n\`\`\``,
  ].join('\n');
}
