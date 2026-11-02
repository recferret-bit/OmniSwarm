// Drop arguments that never cite a real line. A flip without a new valid citation is kept but untrusted.
export function classifyArgument(turn) {
  const valid = (turn.citations || []).filter((citation) => citation.valid);
  if (!valid.length && turn.verdict !== 'insufficient_evidence') {
    return { ...turn, discarded: true, reason: 'no_valid_citation' };
  }
  const suspect = Boolean(turn.verdictChanged) && valid.length === 0;
  return { ...turn, discarded: false, conformitySuspect: Boolean(turn.conformitySuspect) || suspect };
}

export function judgeVisible(turns) {
  return turns.filter((turn) => !turn.discarded && !turn.conformitySuspect);
}
