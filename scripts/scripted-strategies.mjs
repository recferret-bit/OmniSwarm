// Fixture strategies for the scripted family. They call the bridge for real (read, then submit) and
// never open a network connection. Answers live in the OmniSwarm fixture, not in the target's trust.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'demo-fixture');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function judgeAnswer(title, fixtureRoot = DEMO_FIXTURE) {
  const table = readJson(path.join(fixtureRoot, 'answers', 'adjudication.json'));
  return table[title] || { status: 'INSUFFICIENT_EVIDENCE', title };
}

async function readCitations(callTool, findings) {
  const seen = new Set();
  for (const finding of findings) {
    for (const loc of finding.location || []) {
      const file = String(loc).split(':')[0];
      if (!file || seen.has(file)) continue;
      seen.add(file);
      await callTool('read_file', { path: file });
    }
  }
}

async function submit(callTool, findings, verified, summary) {
  await callTool('submit_audit_report', {
    findings,
    verified_safe: verified || [],
    markdown_summary: summary || 'Scripted reviewer finished this surface.',
  });
}

export function passFromBrief(brief) {
  const match = /Pass (\d+)/.exec(String(brief || ''));
  return match ? Number(match[1]) : 1;
}

export async function runStrategy(name, { callTool, fixtureRoot = DEMO_FIXTURE, surface = 'S1', pass = 1 } = {}) {
  if (name === 'judge') return judgeAnswer(surface, fixtureRoot);
  const answers = readJson(path.join(fixtureRoot, 'answers', `${name}.json`));
  if (name === 'lazy') {
    const file = answers.read || 'src/lib.rs';
    for (let i = 0; i < 30; i++) {
      const text = await callTool('read_file', { path: file });
      if (String(text).includes('budget exhausted') || String(text).includes('budget_exhausted')) break;
    }
    await submit(callTool, [], [], answers.markdown_summary || 'Read until the budget and submitted.');
    return { submitted: true, findings: 0 };
  }
  const want = String(surface || 'S1').toUpperCase();
  const findings = (answers.findings || []).filter((finding) => String(finding.surface || '').toUpperCase() === want && !(pass >= 2 && finding.selfVerifyDrop));
  await readCitations(callTool, findings);
  await submit(callTool, findings, answers.verified_safe || [], answers.markdown_summary);
  return { submitted: true, findings: findings.length };
}
