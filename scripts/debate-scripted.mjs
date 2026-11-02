// Offline debate voices. Quotes are taken from the golden source so the citation checker can accept or reject them.
import fs from 'node:fs';
import path from 'node:path';

export function lineOf(root, needle) {
  const file = 'src/lib.rs';
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`missing ${needle}`);
  return { file, startLine: index + 1, endLine: index + 1, quote: lines[index].trim() };
}

export function scriptedFindings(root) {
  const bug = lineOf(root, 'saturating_sub');
  const safe = lineOf(root, 'assert_eq!');
  const cite = (row) => [`${row.file}:${row.startLine}`];
  return [
    { auditor: 'scripted-baseline', vendor: 'scripted', title: 'Missing owner check in withdraw', surface: 'S1', severity: 'high', confidence: 'confirmed', location: cite(bug), quote: bug.quote, claimId: 'scripted-baseline-s1-auth#0' },
    { auditor: 'scripted-paranoid', vendor: 'scripted', title: 'Missing owner check in withdraw', surface: 'S1', severity: 'high', confidence: 'probable', location: cite(bug), quote: bug.quote, claimId: 'scripted-paranoid-s1-auth#0' },
    { auditor: 'scripted-lazy', vendor: 'scripted', title: 'Missing owner check in withdraw', surface: 'S1', severity: 'medium', confidence: 'probable', location: cite(bug), quote: bug.quote, claimId: 'scripted-lazy-s1-auth#0' },
    { auditor: 'scripted-wrong', vendor: 'scripted', title: 'deposit has no owner comparison', surface: 'S1', severity: 'low', confidence: 'probable', location: cite(safe), quote: 'no owner check on this line', claimId: 'scripted-wrong-s1-auth#0' },
  ];
}

export function scriptedArgument({ strategy, round, bug, safe }) {
  if (strategy === 'wrong') return { verdict: 'refuted', citations: [{ ...safe, quote: 'no owner check on this line' }], argument: 'The cited line has no check.', verdictChanged: false };
  if (strategy === 'lazy' && round >= 2) return { verdict: 'refuted', citations: [], argument: 'I concede without a new citation.', verdictChanged: true, conformitySuspect: true };
  if (strategy === 'paranoid' && round >= 2) return { verdict: 'refuted', citations: [bug], argument: 'I flip after reading the challenge.', verdictChanged: true };
  if (strategy === 'baseline') return { verdict: 'upheld', citations: [bug], argument: 'The withdraw body never compares the predecessor to the owner.', verdictChanged: false };
  return { verdict: 'upheld', citations: [bug], argument: 'The citation matches the source.', verdictChanged: false };
}
