// @ts-check
// Renders the attack log as Markdown: injected text, tool call, verdict, outcome.

/** @param {unknown} value */
const json = (value) => ['```json', JSON.stringify(value, null, 2), '```'].join('\n');

/** @param {any} verdict */
function verdictSummary(verdict) {
  return {
    verdict: verdict.verdict,
    reasons: verdict.reasons,
    targets: verdict.targets.map((/** @type {any} */ t) => ({ accountId: t.accountId, role: t.role, via: t.via, verdict: t.verdict, reasons: t.reasons })),
  };
}

/** @param {any} attempt @param {number} i */
function renderAttempt(attempt, i) {
  const lines = [
    `## Attempt ${i + 1}`,
    '',
    `Instruction found in the ticket: \`${attempt.instruction}\``,
    '',
    `Tool call: \`pay(receiver="${attempt.toolCall.receiver}", amount="${attempt.toolCall.amount}")\``,
    '',
    'Transaction the agent built:',
    '',
    json(attempt.intent),
    '',
  ];
  if (attempt.verdict) lines.push('Guard verdict:', '', json(verdictSummary(attempt.verdict)), '');
  lines.push(`Outcome: **${attempt.outcome}**${attempt.code ? ` (${attempt.code})` : ''}. Signer calls: ${attempt.signerCalls}.`, '');
  return lines.join('\n');
}

/** @param {any} log */
export function renderMarkdown(log) {
  return [
    `# Guard attack demo (${log.mode})`,
    '',
    `Chain: ${log.chain.kind}, snapshot ${log.chain.recordedAt}. Ticket: \`${log.ticket}\`.`,
    '',
    ...log.attempts.map(renderAttempt),
    `Transactions sent: ${log.transactionsSent}.`,
    '',
  ].join('\n');
}
