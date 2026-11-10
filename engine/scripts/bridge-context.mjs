// get_audit_context and get_review_plan: scope, skill guidance and harness leads, read from the host report directory.
import fs from 'node:fs';
import path from 'node:path';
import { renderReviewPlansMarkdown, renderSurfaceSkillGuidance } from './audit-plans.mjs';
import { REVIEW_SCOPE } from './review-workflow.mjs';

const LEAD_FILES = [
  ['solana.md', 'Solana Leads', 'Solana surface absent', null, ['web3']],
  ['near.md', 'NEAR Leads', 'NEAR surface absent', null, ['web3']],
  ['python.md', 'Python Leads', 'Python surface absent', null, ['web2']],
  ['node.md', 'Node Leads', 'Node surface absent', null, ['web2']],
  ['web.md', 'Web Leads', 'Web surface absent', ['S1', 'S2', 'S6'], ['web2', 'web3']],
  ['config.md', 'Infra Leads', 'surface absent', ['S4', 'S5'], ['infra']],
];
// A scoped run (--scope) shows the lead files of its own layer only.
const inScope = (layers, scope) => !scope || scope === 'full' || layers.includes(scope);
// A lead file with a surface list is shown to those surfaces only (and to roles that span every surface).
const leadApplies = (surfaces, surface) => !surfaces || !/^S[1-6]$/i.test(String(surface || '')) || surfaces.includes(String(surface).toUpperCase());

const harnessFile = (ctx, name) => (ctx.reportDir ? path.join(ctx.reportDir, 'harness', name) : null);

function readHarness(ctx, name) {
  const file = harnessFile(ctx, name);
  return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function readProfile(ctx) {
  const text = readHarness(ctx, 'stack-profile.json');
  if (text == null) return undefined;
  try { return JSON.parse(text); } catch { return null; }
}

function planSection(ctx, profile) {
  if (profile) return ['## Surface Source Security Review Plans', renderReviewPlansMarkdown(profile, ctx.surface, ctx.scope).slice(0, 12_000)];
  if (profile === null) return []; // malformed profile: no plans rather than a guess
  const plans = readHarness(ctx, 'review-plans.md');
  return plans == null ? [] : ['## Source Security Review Plans', plans.slice(0, 12_000)];
}

export async function getAuditContext(ctx) {
  const profile = readProfile(ctx);
  const parts = [
    '# Docker Security Review Context', REVIEW_SCOPE, `- Container: ${ctx.container}`, `- Role: ${ctx.role}`, `- Agent: ${ctx.agent || 'unknown'}`,
    `- Auditor ID: ${ctx.auditor || 'n/a'}`, `- Assigned Surface: ${ctx.surface}`, '- Target Source Root (in container): /work/src',
    '- Harness Leads Root (in container): /out/harness', '',
    renderSurfaceSkillGuidance(ctx.surface, profile || undefined, ctx.scope), '',
  ];
  const summary = readHarness(ctx, 'summary.md');
  if (summary != null) parts.push('## Harness Summary', summary);
  parts.push(...planSection(ctx, profile));
  for (const [file, title, absent, surfaces, layers] of LEAD_FILES) {
    if (!leadApplies(surfaces, ctx.surface) || !inScope(layers, ctx.scope)) continue;
    const text = readHarness(ctx, file);
    if (text != null && !text.includes(absent)) parts.push(`## ${title}`, text.slice(0, 6000));
  }
  if (ctx.role === 'crosscheck' && ctx.reportDir) {
    const inbox = path.join(ctx.reportDir, 'crosscheck', `${ctx.agent}.json`);
    if (fs.existsSync(inbox)) parts.push('## Assigned Peer Claims to Cross-Check', fs.readFileSync(inbox, 'utf8'));
  }
  return parts.join('\n');
}

export async function getReviewPlan(ctx, args) {
  const domain = String(args.domain || '').trim().toLowerCase();
  const text = readHarness(ctx, 'stack-profile.json');
  if (text != null) {
    const profile = JSON.parse(text);
    const match = domain && domain !== 'all' ? (profile.domains || []).find((d) => d.id === domain) : null;
    if (match) return renderReviewPlansMarkdown({ ...profile, domains: [match] }, '');
    return renderReviewPlansMarkdown(profile, domain === 'all' ? '' : ctx.surface, ctx.scope);
  }
  const plans = readHarness(ctx, 'review-plans.md');
  if (plans != null) return plans;
  return renderSurfaceSkillGuidance(ctx.surface, undefined, ctx.scope);
}
