// Exit status of the Docker demo. The report keeps every health rule: a NEAR contract's cargo test is a
// local-sandbox coverage gap (near-sandbox does not run offline), so report-health.json stays INCOMPLETE.
// The demo alone may still exit 0, and only when the report is the bundled fixture's, the review outputs
// validated, and every remaining gap is one the fixture has by design. `audit run` never reads this.
import fs from 'node:fs';
import path from 'node:path';
import { nearSandboxGap } from './review-workflow.mjs';
import { createSnapshot, disposeSnapshot } from './worker-isolation.mjs';

export const DEMO_LIMITED_STAMP = 'DEMO — verification limited by design';
// The fixture is one near-sdk cdylib crate at its root; its WASM build and clippy run and must pass.
export const DEMO_BY_DESIGN_GAPS = Object.freeze([nearSandboxGap('.')]);

const readJson = (dir, rel) => { try { return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')); } catch { return null; } };

export function fixtureDigest(fixture) {
  const snapshot = createSnapshot(fixture);
  try { return snapshot.manifest.digest; } finally { disposeSnapshot(snapshot); }
}

// { code, limited, reason }: code 0 with the by-design gaps it accepted, or 2 with the reason it refused.
export function demoVerdict({ meta, health, sourceDigest, expectedDigest }) {
  if (meta?.demo !== true) return { code: 2, reason: 'the report is not stamped as the demo' };
  if (!expectedDigest || sourceDigest !== expectedDigest) return { code: 2, reason: 'the report is not a review of the bundled fixture' };
  if (health?.reviewState !== 'validated_outputs') return { code: 2, reason: 'the review outputs did not validate' };
  const errors = Array.isArray(health.errors) ? health.errors : [];
  const gaps = Array.isArray(health.verification?.gaps) ? health.verification.gaps : [];
  const unexpected = errors.filter((error) => !DEMO_BY_DESIGN_GAPS.includes(error) || !gaps.includes(error));
  if (unexpected.length) return { code: 2, reason: `verification gaps the fixture does not have by design: ${unexpected.join(' | ')}` };
  return { code: 0, limited: errors };
}

export function demoReportVerdict(out, fixture) {
  return demoVerdict({
    meta: readJson(out, 'meta.json'), health: readJson(out, 'report-health.json'),
    sourceDigest: readJson(out, 'source-manifest.json')?.digest, expectedDigest: fixtureDigest(fixture),
  });
}
