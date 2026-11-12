// Debate rounds (ORCHESTRATION 4.2) over queued clusters. Round 1: every non-author gives its own verdict without
// seeing the others, then one of them speaks a second, separate turn as devil's advocate. The devil's turn is an
// argument for the judge, never a vote (debate-rules.mjs). Round 2: authors defend when a challenge or the devil
// refuted. Round 3: challengers rebut only when a round-2 verdict changed. Every turn is citation-checked and
// classified here, never by the voice.
import { anonymize, stripIdentity } from './debate-anonymize.mjs';
import { boundedCall } from './debate-clock.mjs';
import { checkTurnCitations } from './debate-citations.mjs';
import { citationKey, classifyArgument } from './debate-rules.mjs';
import { validate } from '../../packages/schemas/index.mjs';
import { writeJson } from './report-util-files.mjs';
import { DEFAULTS } from './run-config.mjs';

const DEVIL_MAX_MISSES = 2;
const TEMPLATE = { challenge: 'challenge', devil: 'devil-advocate', defend: 'defend', rebut: 'rebut' };
const DEFAULT_MAX_UNANSWERED = 6;
const publicTurn = (turn) => ({
  round: turn.round, clusterId: turn.clusterId, role: turn.role, anonId: turn.anonId, verdict: turn.verdict,
  citations: turn.citations.map(({ file, startLine, endLine, quote }) => ({ file, startLine, endLine, quote })),
  argument: turn.argument, conformitySuspect: Boolean(turn.conformitySuspect), devilAdvocate: turn.role === 'devil',
});

// One cluster's debate. ctx: {out, reader, voices, vendors, rounds, names, record, turnMs, phaseMs, started, now, signal, maxUnanswered, unanswered, judgeOf}.
async function debateCluster(cluster, participants, ctx, seed) {
  const authors = cluster.authors.filter((id) => participants.includes(id));
  // Challengers come from another vendor than every author, as in the cross-check phase: a sibling model of the
  // author's vendor is not an independent test of the finding. Scripted reviewers share one placeholder vendor
  // and stand for separate reviewers, so each counts as its own.
  const vendorOf = (id) => { const vendor = ctx.vendors?.get(id); return vendor && vendor !== 'scripted' ? vendor : id; };
  const authorVendors = new Set([...cluster.authors.map(vendorOf), ...(cluster.vendors || []).filter((vendor) => vendor !== 'scripted')]);
  const siblings = participants.filter((id) => !cluster.authors.includes(id) && authorVendors.has(vendorOf(id)));
  if (siblings.length) ctx.record.trace.push({ phase: 'debate', template: 'same-vendor', clusterId: cluster.id, stop: 'excluded', count: siblings.length });
  const nonAuthors = participants.filter((id) => !cluster.authors.includes(id) && !siblings.includes(id));
  // The reviewer that will judge this cluster does not argue on it first: a judge that already took a side is
  // not independent. With no other challenger left (a two-model panel) it keeps its challenger turn instead, so
  // the finding is still tested by someone.
  const judgeId = ctx.judgeOf ? ctx.judgeOf(cluster) : null;
  const reserved = Boolean(judgeId) && nonAuthors.includes(judgeId) && nonAuthors.length > 1;
  const challengers = reserved ? nonAuthors.filter((id) => id !== judgeId) : nonAuthors;
  if (reserved) ctx.record.trace.push({ phase: 'debate', template: 'judge-reserved', clusterId: cluster.id, judge: judgeId, stop: 'kept' });
  const map = anonymize([...authors, ...challengers], seed, cluster.id);
  const seen = new Set(cluster.evidence.filter((row) => row.valid).map(citationKey));
  const previous = new Map(authors.map((id) => [id, 'upheld']));
  const turns = [];
  const stoppedReason = () => {
    if (ctx.signal?.aborted) return 'cancelled';
    if (ctx.now() - ctx.started >= ctx.phaseMs) return 'debate_time';
    if (ctx.unanswered >= ctx.maxUnanswered) return 'debate_threshold';
    return null;
  };
  // An expected turn that never arrives (or does not validate) is a gap and a `missing` trace row.
  // The devil's advocate turn is advisory: it is never tallied (debate-rules.mjs), so one that does not arrive
  // changes no status. It is a coverage gap (the judge had one counter-argument fewer), not a missing answer, so
  // it does not fail the debate stage and leave the whole run INCOMPLETE. A successful challenge resets the speaker's
  // general counter (a cross-check reuse counts), so devil misses are counted on their own: a provider whose devil
  // turns keep timing out is not given the role again (DEVIL_MAX_MISSES), instead of costing a full turn clock per cluster.
  const missing = (speaker, round, role, reason) => {
    ctx.speakerUnanswered.set(speaker, (ctx.speakerUnanswered.get(speaker) || 0) + 1);
    if (role === 'devil') ctx.devilMisses.set(speaker, (ctx.devilMisses.get(speaker) || 0) + 1);
    if (role === 'devil') ctx.record.advisory.push({ clusterId: cluster.id, anonId: map[speaker], round, reason: 'devil_turn_missing', detail: reason });
    else {
      ctx.unanswered += 1;
      ctx.record.gaps.push({ clusterId: cluster.id, anonId: map[speaker], round, reason });
    }
    ctx.record.trace.push({ phase: 'debate', template: TEMPLATE[role], clusterId: cluster.id, round, anonId: map[speaker], stop: 'missing', reason });
  };
  // A round-1 challenger that already answered in the cross-check phase is not asked twice (debate-crosscheck.mjs).
  const priorTurn = (speaker, round, role) => {
    if (!ctx.prior || round !== 1 || role !== 'challenge') return null;
    const prior = ctx.prior(cluster, speaker);
    return prior && checkTurnCitations(ctx.reader, prior.citations, cluster.anchors).some((row) => row.valid) ? prior : null;
  };
  // Asking a speaker only fetches its answer; recording it (below) is what changes the debate state.
  const ask = async (speaker, round, role, shown) => {
    const prior = priorTurn(speaker, round, role);
    const speakerDown = (ctx.speakerUnanswered.get(speaker) || 0) >= ctx.maxSpeakerUnanswered ? 'speaker_threshold' : null;
    const preStop = turns.length > 0 ? (stoppedReason() || speakerDown) : (ctx.signal?.aborted ? 'cancelled' : (ctx.unanswered >= ctx.maxUnanswered ? 'debate_threshold' : speakerDown));
    if (preStop && !prior) return { stop: preStop };
    const raw = prior || await boundedCall(ctx.turnMs, ctx.signal, (signal) => ctx.voices.get(speaker)({ role, round, cluster, turns: shown, anonId: map[speaker], signal }));
    return { prior, raw };
  };
  const record = (speaker, round, role, { stop, prior, raw }) => {
    if (stop) return missing(speaker, round, role, stop);
    if (raw?.unavailable === 'debate_turn_timeout') return missing(speaker, round, role, 'debate_turn_timeout');
    if (!raw || raw.unavailable || typeof raw.argument !== 'string') return missing(speaker, round, role, raw?.unavailable || 'invalid_turn');
    const citations = checkTurnCitations(ctx.reader, raw.citations, cluster.anchors);
    const turn = classifyArgument({ round, clusterId: cluster.id, role, anonId: map[speaker], verdict: raw.verdict, citations, argument: stripIdentity(raw.argument, ctx.names) }, { seen, previous: role === 'devil' ? null : previous.get(speaker) ?? null });
    const body = publicTurn(turn);
    const check = validate('debate-round', body);
    if (!check.ok) return missing(speaker, round, role, 'invalid_turn');
    ctx.unanswered = 0;
    ctx.speakerUnanswered.set(speaker, 0);
    if (role === 'devil') ctx.devilMisses.set(speaker, 0);
    turns.push({ ...turn, speaker, speakerVendor: ctx.vendors.get(speaker) || speaker });
    writeJson(ctx.out, `debate/round-${round}/${map[speaker]}-${cluster.id}${role === 'devil' ? '-devil' : ''}.json`, body);
    citations.forEach((row) => ctx.record.citations.push({ ...row, clusterId: cluster.id, anonId: map[speaker], round }));
    citations.filter((row) => row.valid).forEach((row) => seen.add(citationKey(row)));
    // The devil argues an assigned side: it is not the speaker's own verdict and later turns are not measured against it.
    if (role !== 'devil') previous.set(speaker, raw.verdict);
    ctx.record.trace.push({ phase: 'debate', template: TEMPLATE[role], clusterId: cluster.id, round, anonId: map[speaker], verdict: turn.verdict, stop: turn.discarded ? 'discarded' : 'kept', conformitySuspect: Boolean(turn.conformitySuspect), ...(prior ? { source: 'crosscheck' } : {}) });
  };
  // The speakers of one round answer at the same time. Round 1 is independent by design (a challenger and the devil
  // see the claim and its evidence, not each other), and a round-2 or round-3 speaker sees the turns of the rounds
  // before its own, not a co-speaker's. Asked one after another, every slow voice cost the whole cluster a full turn
  // clock; on a real run 3 of 25 clusters were heard in the phase. Answers are recorded in speaker order once all
  // have settled, so the record is the same whichever answer arrives first, and no session is left running when
  // one of them fails.
  const speakRound = async (speakers, round, role) => {
    const shown = round === 1 ? [] : [...turns];
    const settled = await Promise.allSettled(speakers.map((speaker) => ask(speaker, round, role, shown)));
    const failed = settled.find((row) => row.status === 'rejected');
    if (failed) throw failed.reason;
    speakers.forEach((speaker, i) => record(speaker, round, role, settled[i].value));
  };
  await speakRound(challengers, 1, 'challenge');
  // The devil is the first-labelled challenger whose own turn arrived: a reviewer that did not answer is not asked twice.
  const answered = new Set(turns.filter((turn) => turn.round === 1).map((turn) => turn.speaker));
  const devil = [...challengers].filter((id) => answered.has(id) && (ctx.devilMisses.get(id) || 0) < DEVIL_MAX_MISSES).sort((a, b) => map[a].localeCompare(map[b]))[0] || null;
  // The devil speaks only when nobody argued against the finding in their own turn: that is where agreement may be
  // conformity. A counted refutation already gives the judge the counter-argument, so a second one is not bought.
  const opposed = turns.some((turn) => turn.round === 1 && !turn.discarded && turn.verdict === 'refuted');
  if (devil && !opposed && !stoppedReason()) await speakRound([devil], 1, 'devil');
  const challenged = turns.some((turn) => !turn.discarded && ['refuted', 'partial'].includes(turn.verdict));
  if (ctx.rounds >= 2 && challenged && !stoppedReason()) await speakRound(authors, 2, 'defend');
  // Round 3 exists so a challenger can answer new evidence. It runs when a round-2 defence counts (it stands by
  // the finding with a fresh citation). A concession, a discarded defence or a flip with no new evidence gives
  // the challengers nothing to rebut.
  const defended = turns.some((turn) => turn.round === 2 && !turn.discarded && !turn.conformitySuspect && ['upheld', 'partial'].includes(turn.verdict));
  if (ctx.rounds >= 3 && defended && !stoppedReason()) await speakRound(challengers, 3, 'rebut');
  return { turns, map, rounds: turns.reduce((n, turn) => Math.max(n, turn.round), 0) };
}

// clusters: buildClusters output rows. voices: Map reviewerId -> speak(). vendors: Map reviewerId -> vendor.
// judgeOf(cluster): the id of the reviewer that will judge the cluster, or null (rules judge, or none).
// prior(cluster, reviewerId): that reviewer's cross-check answer as a raw round-1 turn, or null.
// Clusters still QUEUED when the phase clock expires or threshold is reached are returned as `skipped` and are not spoken.
export async function runRounds({ out, clusters, voices, vendors, reader, rounds = 2, seed = 1, names = [], turnMs = DEFAULTS.debate.turnMs, phaseMs = DEFAULTS.debate.phaseMs, maxUnanswered = DEFAULT_MAX_UNANSWERED, maxSpeakerUnanswered = Math.min(3, maxUnanswered), now = Date.now, signal, judgeOf = null, prior = null, onCluster = null } = {}) {
  const record = { citations: [], trace: [], gaps: [], advisory: [] };
  const participants = [...voices.keys()];
  const started = now();
  const ctx = { out, reader, voices, vendors, rounds, names, record, turnMs, phaseMs, started, now, signal, maxUnanswered, maxSpeakerUnanswered, unanswered: 0, speakerUnanswered: new Map(), devilMisses: new Map(), judgeOf, prior };
  const skipped = [];
  const skippedReasons = new Map();
  const debated = new Map();
  const anonymization = { seed, clusters: {} };
  const queued = clusters.filter((row) => row.status === 'QUEUED');
  let heard = 0;
  onCluster?.(0, queued.length);
  for (const cluster of queued) {
    const challengers = participants.filter((id) => !cluster.authors.includes(id));
    const allChallengersDown = challengers.length > 0 && challengers.every((id) => (ctx.speakerUnanswered.get(id) || 0) >= maxSpeakerUnanswered);
    const skipReason = signal?.aborted
      ? 'cancelled'
      : now() - started >= phaseMs
        ? 'debate_time'
        : (ctx.unanswered >= maxUnanswered || allChallengersDown)
          ? 'debate_threshold'
          : null;
    if (skipReason) {
      skipped.push(cluster.id);
      skippedReasons.set(cluster.id, skipReason);
      record.trace.push({ phase: 'debate', template: 'skip', clusterId: cluster.id, stop: skipReason });
      continue;
    }
    const result = await debateCluster(cluster, participants, ctx, seed);
    debated.set(cluster.id, result);
    anonymization.clusters[cluster.id] = result.map;
    heard += 1;
    onCluster?.(heard, queued.length);
  }
  return { debated, anonymization, skipped, skippedReasons, ...record };
}
