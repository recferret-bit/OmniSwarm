import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DOMAIN_SPECS, PYTHON_CHECKS, analyzeStackAndPlans, renderReviewPlansMarkdown, renderSurfaceSkillGuidance } from './audit-plans.mjs';
import { SURFACES } from './orchestrator-surfaces.mjs';

// W01-20: names from the product these plans were first written for. The terms are split so that the wave's literal
// grep gate over scripts/*.mjs finds nothing in this file either.
const APP_TERMS = [['fc', '_admin'], ['__Host-fc', '_session'], ['mul', 'berry32'], ['bots', '_economy'], ['Replay', 'Engine'], ['winners', '_root'],
  ['telemetry', '_root'], ['HB_TIMEOUT', '_MS'], ['Stats', 'Service'], ['replay', ':worker'], ['ride', 'Id'], ['pool', 'Id'], ['pledge'], ['free ride'],
  ['rider'], ['player'], ['cNFT'], ['/api/', 'live'], ['/api/', 'replays'], ['findByWallet', 'ForUpdate'], ['Bot/', 'Economy'], ['Economy Client']].map((parts) => parts.join(''));

function everyPlanText() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-plans-generic-'));
  try {
    fs.writeFileSync(path.join(root, 'app.py'), 'from fastapi import FastAPI\napp = FastAPI()\n');
    const profile = analyzeStackAndPlans(root);
    return [
      JSON.stringify(DOMAIN_SPECS, (key, value) => (value instanceof RegExp ? value.source : value)),
      JSON.stringify(PYTHON_CHECKS),
      JSON.stringify(SURFACES),
      renderReviewPlansMarkdown(profile),
      renderSurfaceSkillGuidance('ALL'),
      renderSurfaceSkillGuidance('ALL', profile),
    ].join('\n');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('W01-20: generic plans, lead patterns and surface names carry no application-specific names', () => {
  const text = everyPlanText();
  for (const term of APP_TERMS) assert.ok(!text.toLowerCase().includes(term.toLowerCase()), `plan text still names ${term}`);
});

test('the S3 and S6 names agree across the surface table and the plan guidance', () => {
  const byCode = Object.fromEntries(SURFACES.map((s) => [s.code, s.name]));
  assert.equal(byCode.S3, 'Business Logic, Value Flows & Custody');
  assert.match(renderSurfaceSkillGuidance('S3'), /### S3 Skill Focus — Business Logic, Value Flows, DB Locks & Custody \(abuse_economy, databases, crypto, scopes_roles\)/);
  assert.match(renderSurfaceSkillGuidance('S6'), /### S6 Skill Focus — Client, Web Surface, WebSockets & Wallet Flows \(http, websockets, crypto, abuse_economy, api_dto_abuse\)/);
});

test('the value-flow domain finds generic reward, claim and client-state code and stays always active', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-plans-abuse-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'rewards.ts'), 'export function redeemCoupon(code: string) { return claim(code); }\nexport function onHeartbeat(telemetry: unknown) { return telemetry; }\n');
    const domain = analyzeStackAndPlans(root).domains.find((d) => d.id === 'abuse_economy');
    assert.equal(domain.detected, true);
    assert.equal(domain.title, 'Automation Abuse & Value-Flow Integrity');
    const hits = Object.fromEntries(domain.leads.map((lead) => [lead.id, [...new Set(lead.hits.map((h) => h.citation))]]));
    assert.deepEqual(hits['abuse-client-state'], ['src/rewards.ts:2']);
    assert.deepEqual(hits['abuse-value-actions'], ['src/rewards.ts:1']);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-plans-empty-'));
    try { assert.equal(analyzeStackAndPlans(empty).domains.find((d) => d.id === 'abuse_economy').detected, true); } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
