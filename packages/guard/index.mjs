// Verdicts for the demo accounts. A block throws before any signature. A warn asks a human.
export const REASONS = {
  ATTESTED_CLEAN: 'allow',
  ATTESTED_CRITICAL_STILL_DEPLOYED: 'block',
  CODE_CHANGED_SINCE_REVIEW: 'warn',
  ACCOUNT_TOO_NEW: 'warn',
  CONTRACT_NOT_REVIEWED: 'warn',
  REPORTED: 'block',
};

export const DEMO_ACCOUNTS = {
  'clean.testnet': { reasons: ['ATTESTED_CLEAN'] },
  'critical.testnet': { reasons: ['ATTESTED_CRITICAL_STILL_DEPLOYED'] },
  'changed.testnet': { reasons: ['CODE_CHANGED_SINCE_REVIEW'] },
  'new.testnet': { reasons: ['ACCOUNT_TOO_NEW'] },
  'unreviewed.testnet': { reasons: ['CONTRACT_NOT_REVIEWED'] },
  'reported.testnet': { reasons: ['REPORTED'] },
};

export function verdictFor(account) {
  const row = DEMO_ACCOUNTS[account] || { reasons: ['CONTRACT_NOT_REVIEWED'] };
  const reasons = row.reasons;
  const verdict = reasons.some((code) => REASONS[code] === 'block')
    ? 'block'
    : reasons.some((code) => REASONS[code] === 'warn')
      ? 'warn'
      : 'allow';
  return { verdict, reasons, account };
}

export function wrap(signer, { onWarn, lookup = verdictFor } = {}) {
  return {
    async sign(action) {
      const decision = lookup(action.account);
      if (decision.verdict === 'block') {
        const error = new Error(`guard blocked ${action.account}: ${decision.reasons.join(',')}`);
        error.code = 'GUARD_BLOCK';
        error.decision = decision;
        throw error;
      }
      if (decision.verdict === 'warn') {
        const allowed = await onWarn?.(decision, action);
        if (!allowed) {
          const error = new Error('guard warn was not approved');
          error.code = 'GUARD_WARN';
          error.decision = decision;
          throw error;
        }
      }
      return signer.sign(action);
    },
  };
}
