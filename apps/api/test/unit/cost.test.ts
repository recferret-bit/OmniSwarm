// W09-18: model cost comes from reviewers/<id>/usage.json as the engine writes it
// (packages/schemas/usage.schema.json), summed over every attempt of a request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validate } from '@omniswarm/schemas';
import { requestCost, usageCostUsd } from '../../src/worker/cost.ts';
import { APP_ROOT } from '../../src/shared/paths.ts';

function usage(dir: string, reviewer: string, body: unknown): void {
  fs.mkdirSync(path.join(dir, 'report', 'reviewers', reviewer), { recursive: true });
  fs.writeFileSync(path.join(dir, 'report', 'reviewers', reviewer, 'usage.json'), JSON.stringify(body));
}

const pass = (cost: number) => ({ k: 1, calls: 1, tokensIn: 10, tokensOut: 5, cost, stop: 'submitted', startedAt: 'a', endedAt: 'b' });

test('usage.json: totals.cost, else the sum of passes[].cost; anything else is not a usage record', () => {
  assert.equal(usageCostUsd({ passes: [pass(1)], totals: { cost: 1.25 } }), 1.25);
  assert.equal(usageCostUsd({ passes: [pass(0.5), pass(0.25)] }), 0.75);
  assert.equal(usageCostUsd({ costUsd: 9 }), null);
  assert.equal(usageCostUsd(null), null);
  assert.equal(usageCostUsd({ passes: [pass(-3)], totals: { cost: 'x' } }), 0, 'never negative or NaN');
  const fixture = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'test/fixtures/engine-report/reviewers/scripted-baseline/usage.json'), 'utf8'));
  assert.ok(validate('usage', fixture).ok, 'the mock engine writes a schema-valid usage.json');
});

test('a request costs what every attempt spent', () => {
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'));
  const id = '3f2b8c1e-5d4a-4b7e-9c1a-2e6f0a8b4d10';
  usage(path.join(runs, id, '0'), 'nearai-deepseek-ai-deepseek-v4', { passes: [pass(0.4)], totals: { cost: 0.4 } });
  usage(path.join(runs, id, '1'), 'nearai-deepseek-ai-deepseek-v4', { passes: [pass(1.1)], totals: { cost: 1.1 } });
  usage(path.join(runs, id, '1'), 'nearai-qwen-qwen3-8-max', { passes: [pass(0.2), pass(0.3)] });
  fs.mkdirSync(path.join(runs, id, '1', 'report', 'reviewers', 'by-provider'), { recursive: true });
  assert.deepEqual(requestCost(runs, id), { costUsd: 2, reviewers: 2 });
  assert.deepEqual(requestCost(runs, 'missing'), { costUsd: 0, reviewers: 0 });
});
