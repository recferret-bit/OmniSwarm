// @ts-check
// Scripted demo agent: reads a support ticket and turns any "pay <n> NEAR to <account>" line
// into its one tool call, pay(receiver, amount). It is deliberately gullible: the guard, not
// the agent, has to stop the injected instruction. The agent's key is a function-call key on
// the payments contract, so it pays through `pay_out` and never with a plain Transfer.

const PAY = /\bpay\s+(\d{1,9}(?:\.\d{1,24})?)\s+NEAR\s+to\s+([a-z0-9._-]{2,65})/gi;
const YOCTO_DIGITS = 24;

/**
 * @param {string} ticket
 * @returns {{ receiver: string, amountNear: string, line: string }[]}
 */
export function planPayments(ticket) {
  return [...ticket.matchAll(PAY)].map((m) => {
    const receiver = m[2].replace(/\.+$/, '').toLowerCase();
    return { amountNear: m[1], receiver, line: m[0].replace(/\.+$/, '') };
  });
}

/**
 * Decimal NEAR to a yocto string, exactly.
 * @param {string} near
 */
export function nearToYocto(near) {
  const [whole, fraction = ''] = near.split('.');
  return (BigInt(whole) * 10n ** BigInt(YOCTO_DIGITS) + BigInt(fraction.padEnd(YOCTO_DIGITS, '0') || '0')).toString();
}

/**
 * The transaction the agent would sign for one planned payment.
 * @param {{ agentId: string, paymentsContract: string, receiver: string, amountNear: string }} p
 * @returns {import('../../types.js').TxIntent}
 */
export function paymentIntent({ agentId, paymentsContract, receiver, amountNear }) {
  return {
    signerId: agentId,
    receiverId: paymentsContract,
    actions: [{ type: 'FunctionCall', params: { methodName: 'pay_out', args: { receiver, amount: nearToYocto(amountNear) }, gas: '30000000000000', deposit: '0' } }],
  };
}

/**
 * Dry signer for a function-call key. It accepts only function calls with no attached
 * deposit, counts each request, and does not broadcast.
 * @returns {{ calls: () => number, signer: { signAndSendTransaction: (intent: import('../../types.js').TxIntent) => Promise<{ dryRun: true }> } }}
 */
export function createFunctionCallSigner() {
  let signerCalls = 0;
  return {
    calls() {
      return signerCalls;
    },
    signer: {
      async signAndSendTransaction(intent) {
        signerCalls += 1;
        const txActions = intent?.actions ?? [];
        const allowed = txActions.length > 0 && txActions.every((action) => {
          if (action?.type !== 'FunctionCall') return false;
          const deposit = action.params?.deposit;
          return deposit === undefined || deposit === '0';
        });
        if (!allowed) throw new Error('function-call key cannot sign this transaction');
        return { dryRun: true };
      },
    },
  };
}
