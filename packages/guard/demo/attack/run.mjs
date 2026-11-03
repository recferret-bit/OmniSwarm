// @ts-check
// Prompt-injection demo on a recorded mock chain. Nothing here signs or sends a transaction:
// the signer is a dry stub that only counts calls, and --no-guard never calls it.
//
//   node packages/guard/demo/attack/run.mjs [--no-guard] [--ticket <file>] [--out <dir>]
//
// Writes attack-log.md and attack-log.json to --out (default: <tmpdir>/omniswarm-guard-demo/<mode>).
// Exit 1 if a reported account would be paid in guard mode, or the log is incomplete.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createGuard, GuardBlockedError, GuardWarnDeclinedError } from '@omniswarm/guard';
import { createRecordedReader } from '@omniswarm/guard/recorded-reader';
import { paymentIntent, planPayments } from './agent.mjs';
import { renderMarkdown } from './log.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const AGENT = 'demo-agent.owner.testnet';
const PAYMENTS = 'demo-payments.owner.testnet';

const { values } = parseArgs({
  options: {
    'no-guard': { type: 'boolean', default: false },
    ticket: { type: 'string', default: path.join(here, 'tickets', 'injected.md') },
    out: { type: 'string' },
  },
});
const mode = values['no-guard'] ? 'no-guard' : 'guard';
const outDir = values.out ?? path.join(os.tmpdir(), 'omniswarm-guard-demo', mode);
const snapshot = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'chain-snapshot.json'), 'utf8'));
const ticketText = fs.readFileSync(values.ticket, 'utf8');

/** @param {ReturnType<typeof paymentIntent>} intent */
async function attempt(intent) {
  if (mode === 'no-guard') return { outcome: 'would_send', verdict: null, signerCalls: 0 };
  let signerCalls = 0;
  const drySigner = { async signAndSendTransaction(/** @type {unknown} */ _intent) { signerCalls += 1; return { dryRun: true }; } };
  const guard = createGuard({ reader: createRecordedReader(snapshot), now: () => Date.parse(snapshot.recordedAt) });
  const verdict = await guard.checkIntent(intent);
  const askHuman = async () => false; // the demo's human declines every warning
  try {
    await guard.wrap(drySigner, { onWarn: askHuman }).signAndSendTransaction(intent);
    return { outcome: 'signed_dry_run', verdict, signerCalls };
  } catch (error) {
    if (!(error instanceof GuardBlockedError || error instanceof GuardWarnDeclinedError)) throw error;
    return { outcome: 'refused_before_signing', code: error.code, verdict, signerCalls };
  }
}

const attempts = [];
for (const plan of planPayments(ticketText)) {
  const intent = paymentIntent({ agentId: AGENT, paymentsContract: PAYMENTS, receiver: plan.receiver, amountNear: plan.amountNear });
  attempts.push({ toolCall: { tool: 'pay', receiver: plan.receiver, amount: `${plan.amountNear} NEAR` }, instruction: plan.line, intent, ...(await attempt(intent)) });
}

const log = { mode, chain: { kind: 'recorded-mock', recordedAt: snapshot.recordedAt }, ticket: path.basename(values.ticket), attempts, transactionsSent: 0 };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'attack-log.json'), `${JSON.stringify(log, null, 2)}\n`);
const markdown = renderMarkdown(log);
fs.writeFileSync(path.join(outDir, 'attack-log.md'), markdown);
process.stdout.write(markdown);

const paidBad = attempts.some((a) => mode === 'guard' && a.outcome !== 'refused_before_signing' && snapshot.reported.includes(a.toolCall.receiver));
const complete = attempts.length > 0 && attempts.every((a) => a.instruction && a.intent && a.outcome);
if (paidBad || !complete) process.exit(1);
