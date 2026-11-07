import { validateAuditor } from './report-contract-auditor.mjs';
import { commitSubmission, deriveSubmission } from './audit-submission.mjs';
import { SAFE_ANNOTATIONS, BridgeError, objSchema, strProp, boolProp, strArr, normalizeCitation, commonToolDefinitions, commonHandlers } from './bridge-tools-common.mjs';

export const role = 'auditor';

export function renderMarkdownFromFindings(auditor, surface, findings, verifiedSafe, summaryText) {
  if (typeof summaryText === 'string' && summaryText.trim().length > 20) return `${summaryText.trim()}\n`;
  const lines = [`# Security Audit Report — ${auditor} (${surface})`, '', `## Findings (${findings.length})`, ''];
  if (!findings.length) {
    lines.push('No supported findings were reported for the reviewed scope.', '');
  } else {
    for (const [i, f] of findings.entries()) {
      lines.push(`### ${i + 1}. [${String(f.severity).toUpperCase()}] ${f.title}`);
      lines.push(`- **Surface**: ${f.surface}`, `- **Confidence**: ${f.confidence}`, `- **Locations**: ${(f.location || []).join(', ')}`, `- **Impact**: ${f.impact}`);
      if (f.analysis) lines.push(`- **Source analysis**: ${f.analysis}`);
      if (f.validation) lines.push(`- **Validation and limits**: ${f.validation}`);
      if (f.preconditions) lines.push(`- **Preconditions**: ${f.preconditions}`);
      if (Array.isArray(f.attack) && f.attack.length) {
        lines.push('- **Attack Path**:', ...f.attack.map((step) => `  1. ${step}`));
      }
      if (f.poc) lines.push('', '```', f.poc, '```', '');
      lines.push(`- **Fix**: ${f.fix}`, '');
    }
  }
  lines.push(`## Reviewed Control Assertions (${verifiedSafe.length})`, '');
  if (!verifiedSafe.length) lines.push('- No additional safe controls recorded.');
  else for (const c of verifiedSafe) lines.push(`- **${c.control}** (${c.holds ? 'holds' : 'broke'}): ${c.how_attacked}`);
  lines.push('');
  return lines.join('\n');
}

export function normalizeFindingsPayload(input, auditor, surfaceCode) {
  const surface = String(surfaceCode || 'S1').toUpperCase();
  const rawFindings = Array.isArray(input) ? input.slice(0, -1) : input?.findings;
  const verifiedSafe = Array.isArray(input) ? input.at(-1)?.verified_safe : input?.verified_safe;
  if (!Array.isArray(rawFindings) || !Array.isArray(verifiedSafe)) throw new Error('Expected findings and explicit verified_safe controls');
  const findings = rawFindings.map((f) => {
    if (!f || typeof f !== 'object' || Array.isArray(f) || !Array.isArray(f.location)) throw new Error('Invalid finding object');
    if (typeof f.surface !== 'string' || f.surface.toUpperCase() !== surface) throw new Error('Finding surface mismatch');
    return { ...f, surface, severity: f.severity?.toLowerCase(), confidence: f.confidence?.toLowerCase(), location: f.location.map(normalizeCitation) };
  });
  const payload = [...findings, Array.isArray(input) ? input.at(-1) : { verified_safe: verifiedSafe }];
  validateAuditor(payload, auditor);
  return { payload, findings, verifiedSafe };
}

export function submitAuditToolDefinition() {
  return {
      name: 'submit_audit_report',
      description: 'Validate and save the final audit report (.json and .md) for your assigned surface. Call this tool before finishing.',
      annotations: SAFE_ANNOTATIONS,
      inputSchema: objSchema({
        report_json: strProp('JSON-encoded object containing findings, verified_safe and markdown_summary. Use this instead of nested arguments when the CLI cannot serialize object arrays.'),
        findings: {
          type: 'array',
          items: objSchema({
            title: strProp(), surface: strProp(),
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
            confidence: { type: 'string', enum: ['confirmed', 'probable'] },
            location: strArr(), impact: strProp(), preconditions: strProp(),
            analysis: strProp('Source-based explanation of the missing or incorrect control; no exploit instructions'), validation: strProp('Source inspection or existing test evidence, including limitations'), fix: strProp(),
          }, ['title', 'surface', 'severity', 'confidence', 'location', 'impact', 'preconditions', 'analysis', 'validation', 'fix']),
        },
        verified_safe: {
          type: 'array',
          items: objSchema({ control: strProp(), evidence: strProp('Source inspection or existing test evidence'), holds: boolProp() }, ['control', 'evidence', 'holds']),
        },
        markdown_summary: strProp(),
      }, []),
    };
}

export function toolDefinitions() {
  const submit = submitAuditToolDefinition();
  submit.inputSchema.oneOf = [{ required: ['report_json'] }, { required: ['findings', 'verified_safe'] }];
  return [...commonToolDefinitions(), submit];
}

export async function submitAuditReport(ctx, args) {
  const { reportDir, role, auditor, surface } = ctx;
  if (role !== 'auditor') throw new Error('Audit submission is unavailable in this bridge role');
  if (!auditor) throw new Error('Bridge was not configured with an --auditor identity');
  // R-09: there is no path that writes a report without a submission identity and the evidence checks below.
  if (!ctx.submissionIdentity) throw new BridgeError('IDENTITY_REQUIRED', 'Report submission requires a submission identity; the bridge was started without --identity-file');
  if (!Array.isArray(args.findings) || !Array.isArray(args.verified_safe)) throw new Error('Expected security review findings and control evidence');
  args = { ...args, findings: args.findings.map(finding => {
    if (typeof finding.analysis !== 'string' || !finding.analysis.trim() || typeof finding.validation !== 'string' || !finding.validation.trim() || finding.attack?.length || finding.poc) throw new Error('Security review requires source analysis and validation, not exploit steps or PoCs');
    return { ...finding, attack: [], poc: '' };
  }), verified_safe: args.verified_safe.map(control => {
    const evidence = Array.isArray(control.evidence) ? control.evidence.filter((item) => typeof item === 'string' && item.trim()).join('; ') : control.evidence;
    if (typeof evidence !== 'string' || !evidence.trim()) throw new Error('Security review control requires evidence');
    return { ...control, evidence, how_attacked: evidence };
  }) };
  const { payload, findings, verifiedSafe } = normalizeFindingsPayload(args, auditor, surface);
  const submission = commitSubmission(reportDir, auditor, ctx.submissionIdentity, payload, args.markdown_summary || '');
  deriveSubmission(reportDir, submission, renderMarkdownFromFindings);
  return `Report committed for ${auditor}: ${findings.length} findings, ${verifiedSafe.length} control assertions. Submission hash: ${submission.hash}. Finish with a short acknowledgement; the coordinator generates the report files.`;
}

export const handlers = { ...commonHandlers, submit_audit_report: submitAuditReport };
