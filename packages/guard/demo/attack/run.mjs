// @ts-check
// Prompt-injection demo. Nothing here signs or sends a transaction: the signer is a dry
// function-call key that only counts calls, and --no-guard never calls it.
//
//   node packages/guard/demo/attack/run.mjs [--no-guard] [--sandbox] [--ticket <file>] [--out <dir>]
//
// Without --sandbox the chain is fixtures/chain-snapshot.json. With --sandbox the registry and
// view_account are read from the local RPC (NEAR_LOCAL_RPC_PORT, default 3030). Account age uses
// GUARD_ACCOUNT_AGE_URL, or the local indexer port (NEAR_LOCAL_INDEXER_PORT, default 3031).
//
// Writes attack-log.md and attack-log.json to --out (default: <tmpdir>/omniswarm-guard-demo/<mode>).
// Exit 1 if a reported account would be paid in guard mode, or the log is incomplete.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createGuard, GuardBlockedError, GuardWarnDeclinedError } from '@omniswarm/guard';
import { nearblocksAgeSource } from '@omniswarm/guard/account-age';
import { createRecordedReader } from '@omniswarm/guard/recorded-reader';
import { createFunctionCallSigner, paymentIntent, planPayments } from './agent.mjs';
import { renderMarkdown } from './log.mjs';
import { createSandboxReader, sandboxAgeUrl, sandboxRpcUrl } from './sandbox.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const AGENT = 'demo-agent.owner.testnet';
const PAYMENTS = 'demo-payments.owner.testnet';

const { values } = parseArgs({
  options: {
    'no-guard': { type: 'boolean', default: false },
    sandbox: { type: 'boolean', default: false },
    ticket: { type: 'string', default: path.join(here, 'tickets', 'injected.md') },
    out: { type: 'string' },
  },
});
const mode = values['no-guard'] ? 'no-guard' : 'guard';
const outDir = values.out ?? path.join(os.tmpdir(), 'omniswarm-guard-demo', values.sandbox ? `${mode}-sandbox` : mode);
const snapshot = values.sandbox ? null : JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'chain-snapshot.json'), 'utf8'));
const ticketText = fs.readFileSync(values.ticket, 'utf8');
const rpcUrl = values.sandbox ? sandboxRpcUrl() : '';
const reader = values.sandbox ? createSandboxReader({ rpcUrl }) : createRecordedReader(snapshot);
const accountAge = values.sandbox ? nearblocksAgeSource({ network: 'sandbox', baseUrl: sandboxAgeUrl() }) : undefined;

/** @param {ReturnType<typeof paymentIntent>} intent */
async function attempt(intent) {
  if (mode === 'no-guard') return { outcome: 'would_send', verdict: null, signerCalls: 0 };
  const key = createFunctionCallSigner();
  const guard = values.sandbox
    ? createGuard({ reader, accountAge })
    : createGuard({ reader, now: () => Date.parse(snapshot.recordedAt) });
  const verdict = await guard.checkIntent(intent);
  const askHuman = async () => false; // the demo's human declines every warning
  try {
    await guard.wrap(key.signer, { onWarn: askHuman }).signAndSendTransaction(intent);
    return { outcome: 'signed_dry_run', verdict, signerCalls: key.calls() };
  } catch (error) {
    if (!(error instanceof GuardBlockedError || error instanceof GuardWarnDeclinedError)) throw error;
    return { outcome: 'refused_before_signing', code: error.code, verdict, signerCalls: key.calls() };
  }
}

const attempts = [];
for (const plan of planPayments(ticketText)) {
  const intent = paymentIntent({ agentId: AGENT, paymentsContract: PAYMENTS, receiver: plan.receiver, amountNear: plan.amountNear });
  attempts.push({ toolCall: { tool: 'pay', receiver: plan.receiver, amount: `${plan.amountNear} NEAR` }, instruction: plan.line, intent, ...(await attempt(intent)) });
}

const log = {
  mode,
  chain: values.sandbox ? { kind: 'sandbox', rpc: rpcUrl } : { kind: 'recorded-mock', recordedAt: snapshot.recordedAt },
  ticket: path.basename(values.ticket),
  attempts,
  transactionsSent: 0,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'attack-log.json'), `${JSON.stringify(log, null, 2)}\n`);
const markdown = renderMarkdown(log);
fs.writeFileSync(path.join(outDir, 'attack-log.md'), markdown);
process.stdout.write(markdown);

const reported = values.sandbox
  ? (await Promise.all(attempts.map(async (attempt) => (mode === 'guard' && await reader.isReported(attempt.toolCall.receiver) ? attempt.toolCall.receiver : '')))).filter(Boolean)
  : snapshot.reported;
const paidBad = attempts.some((a) => mode === 'guard' && a.outcome !== 'refused_before_signing' && reported.includes(a.toolCall.receiver));
const complete = attempts.length > 0 && attempts.every((a) => a.instruction && a.intent && a.outcome);
if (paidBad || !complete) process.exit(1);
