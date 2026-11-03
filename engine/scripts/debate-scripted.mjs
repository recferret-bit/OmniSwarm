// Debate voices for the scripted family (W03 strategies baseline, paranoid, wrong, lazy). A scripted reviewer
// argues only from what it committed in the review: its own findings and its own control assertions. Quotes
// are the snapshot's lines, so the citation checker decides them like any model's. Nothing here knows the target.
import { anchorEvidence, parseLocation, relevantTo } from './debate-citations.mjs';

const cite = (row) => ({ file: row.file, startLine: row.startLine, endLine: row.endLine, quote: row.quote });

function ownEvidence(cluster, findings) {
  const mine = new Set(findings.flatMap((finding) => finding.location || []));
  return cluster.evidence.find((row) => row.valid && mine.has(`${row.file}:${row.startLine}`)) || null;
}

// A control assertion that holds and names a file:line next to the cluster refutes it.
function controlEvidence(cluster, controls, reader) {
  for (const control of controls) {
    if (control.holds === false) continue;
    for (const match of String(control.evidence || control.how_attacked || '').matchAll(/([\w./-]+:\d+)/g)) {
      const anchor = parseLocation(match[1]);
      const row = anchor && anchorEvidence(reader, anchor);
      if (row?.valid && relevantTo(row, cluster.anchors)) return { row, control: String(control.control || 'a control') };
    }
  }
  return null;
}

const lastRefutation = (turns) => [...turns].reverse().find((turn) => !turn.discarded && turn.verdict === 'refuted' && turn.citations.some((c) => c.valid));
const insufficient = (argument) => ({ verdict: 'insufficient_evidence', citations: [], argument });

const STRATEGIES = {
  baseline({ own, control }) {
    if (own) return { verdict: 'upheld', citations: [cite(own)], argument: 'The cited line is where the missing control should be.' };
    if (control) return { verdict: 'refuted', citations: [cite(control.row)], argument: `${control.control} holds at the cited line.` };
    return insufficient('My review did not cover this code path.');
  },
  paranoid({ own, cluster, role, turns }) {
    const refutation = role === 'defend' ? lastRefutation(turns) : null;
    if (own && refutation) return { verdict: 'refuted', citations: refutation.citations.filter((c) => c.valid).map(cite), argument: 'I concede: the cited control holds.' };
    const line = own || cluster.evidence.find((row) => row.valid);
    return line ? { verdict: 'upheld', citations: [cite(line)], argument: 'The cited line looks unsafe to me.' } : insufficient('No line to cite.');
  },
  wrong({ cluster }) {
    const anchor = cluster.anchors[0];
    if (!anchor) return insufficient('No line to cite.');
    return { verdict: 'refuted', citations: [{ file: anchor.file, startLine: anchor.line, endLine: anchor.line, quote: 'no check on this line' }], argument: 'The cited line has no check.' };
  },
  lazy({ round, turns, speakerAnon }) {
    const other = [...turns].reverse().find((turn) => turn.anonId !== speakerAnon && !turn.discarded && turn.verdict !== 'insufficient_evidence');
    if (round === 1 || !other) return insufficient('I did not read this code.');
    return { verdict: other.verdict, citations: other.citations.filter((c) => c.valid).map(cite), argument: 'I agree with the previous argument.' };
  },
};

// Returns speak(task) for one scripted reviewer. task: {role, round, cluster, turns, anonId}.
export function scriptedVoice(strategy, { findings = [], controls = [], reader }) {
  const play = STRATEGIES[strategy];
  return async ({ role, round, cluster, turns, anonId }) => {
    if (!play) return insufficient('This scripted reviewer has no debate strategy.');
    const own = ownEvidence(cluster, findings);
    const control = controlEvidence(cluster, controls, reader);
    if (role === 'devil') return control ? { verdict: 'refuted', citations: [cite(control.row)], argument: `${control.control} holds at the cited line.` } : insufficient('I found no control that stops this.');
    return play({ own, control, cluster, role, round, turns, speakerAnon: anonId });
  };
}
