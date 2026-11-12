// Debate rounds (ORCHESTRATION 4.2) over queued clusters, with parallel per-round speaker execution and
// resumable startRound..rounds support for iterative step-by-step debate rounds.
// Round 1: every non-author gives its own verdict in parallel without seeing the others, then one of them speaks
// a second, separate turn as devil's advocate when unopposed. Round 2: authors defend in parallel when a challenge
// or devil refuted/partially refuted. Round 3: challengers rebut in parallel when a round-2 defence counts.
// Iterative rounds >= 4 alternate authors (even rounds) and challengers (odd rounds) while new evidence appears.
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

async function debateCluster(cluster, participants, ctx, seed) {
  const authors = cluster.authors.filter((id) => participants.includes(id));
  const vendorOf = (id) => { const vendor = ctx.vendors?.get(id); return vendor && vendor !== 'scripted' ? vendor : id; };
  const authorVendors = new Set([...cluster.authors.map(vendorOf), ...(cluster.vendors || []).filter((vendor) => vendor !== 'scripted')]);
  const siblings = participants.filter((id) => !cluster.authors.includes(id) && authorVendors.has(vendorOf(id)));
  if (siblings.length && ctx.startRound === 1) {
    ctx.record.trace.push({ phase: 'debate', template: 'same-vendor', clusterId: cluster.id, stop: 'excluded', count: siblings.length });
  }
  const nonAuthors = participants.filter((id) => !cluster.authors.includes(id) && !siblings.includes(id));
  const judgeId = ctx.judgeOf ? ctx.judgeOf(cluster) : null;
  const reserved = Boolean(judgeId) && nonAuthors.includes(judgeId) && nonAuthors.length > 1;
  const challengers = reserved ? nonAuthors.filter((id) => id !== judgeId) : nonAuthors;
  if (reserved && ctx.startRound === 1) {
    ctx.record.trace.push({ phase: 'debate', template: 'judge-reserved', clusterId: cluster.id, judge: judgeId, stop: 'kept' });
  }

  const priorDebated = ctx.priorState?.debated;
  const savedCluster = (priorDebated instanceof Map ? priorDebated.get(cluster.id) : priorDebated?.[cluster.id]) || null;
  const map = ctx.priorState?.anonymization?.clusters?.[cluster.id] || savedCluster?.map || anonymize([...authors, ...challengers], seed, cluster.id);
  const turns = Array.isArray(savedCluster?.turns) ? [...savedCluster.turns] : [];
  const seen = new Set(cluster.evidence.filter((row) => row.valid).map(citationKey));
  const previous = new Map(authors.map((id) => [id, 'upheld']));
  for (const existing of turns) {
    for (const row of existing.citations || []) {
      if (row.valid !== false) seen.add(citationKey(row));
    }
    if (existing.role !== 'devil' && existing.speaker) previous.set(existing.speaker, existing.verdict);
  }

  const stoppedReason = () => {
    if (ctx.signal?.aborted) return 'cancelled';
    if (ctx.now() - ctx.started >= ctx.phaseMs) return 'debate_time';
    if (ctx.unanswered >= ctx.maxUnanswered) return 'debate_threshold';
    return null;
  };

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

  const priorTurn = (speaker, round, role) => {
    if (!ctx.prior || round !== 1 || role !== 'challenge') return null;
    const prior = ctx.prior(cluster, speaker);
    return prior && checkTurnCitations(ctx.reader, prior.citations, cluster.anchors).some((row) => row.valid) ? prior : null;
  };

  // Executes all speaker turns of one (round, role) in parallel and settles citations/trace in deterministic speaker order.
  const speakMany = async (speakers, round, role) => {
    if (!speakers.length) return;
    const shown = round === 1 ? [] : [...turns];
    const hasPriorTurns = turns.length > 0;
    const fetched = await Promise.all(speakers.map(async (speaker) => {
      const prior = priorTurn(speaker, round, role);
      const speakerDown = (ctx.speakerUnanswered.get(speaker) || 0) >= ctx.maxSpeakerUnanswered ? 'speaker_threshold' : null;
      const preStop = hasPriorTurns
        ? (stoppedReason() || speakerDown)
        : (ctx.signal?.aborted ? 'cancelled' : (ctx.unanswered >= ctx.maxUnanswered ? 'debate_threshold' : speakerDown));
      if (preStop && !prior) return { speaker, prior: null, preStop, raw: null };
      const raw = prior || await boundedCall(ctx.turnMs, ctx.signal, (signal) => ctx.voices.get(speaker)({ role, round, cluster, turns: shown, anonId: map[speaker], signal }));
      return { speaker, prior, preStop: null, raw };
    }));

    for (const { speaker, prior, preStop, raw } of fetched) {
      if (preStop && !prior) {
        missing(speaker, round, role, preStop);
        continue;
      }
      if (raw?.unavailable === 'debate_turn_timeout') {
        missing(speaker, round, role, 'debate_turn_timeout');
        continue;
      }
      if (!raw || raw.unavailable || typeof raw.argument !== 'string') {
        missing(speaker, round, role, raw?.unavailable || 'invalid_turn');
        continue;
      }
      const schemaRound = round <= 3 ? round : (role === 'defend' ? 2 : 3);
      const citations = checkTurnCitations(ctx.reader, raw.citations, cluster.anchors);
      const turn = classifyArgument(
        { round: schemaRound, clusterId: cluster.id, role, anonId: map[speaker], verdict: raw.verdict, citations, argument: stripIdentity(raw.argument, ctx.names) },
        { seen, previous: role === 'devil' ? null : previous.get(speaker) ?? null },
      );
      const body = publicTurn(turn);
      const check = validate('debate-round', body);
      if (!check.ok) {
        missing(speaker, round, role, 'invalid_turn');
        continue;
      }
      ctx.unanswered = 0;
      ctx.speakerUnanswered.set(speaker, 0);
      if (role === 'devil') ctx.devilMisses.set(speaker, 0);
      turns.push({ ...turn, round, speaker, speakerVendor: ctx.vendors.get(speaker) || speaker });
      const turnDir = round <= 3 ? `debate/round-${round}` : `debate/iterations/round-${round}`;
      writeJson(ctx.out, `${turnDir}/${map[speaker]}-${cluster.id}${role === 'devil' ? '-devil' : ''}.json`, body);
      citations.forEach((row) => ctx.record.citations.push({ ...row, clusterId: cluster.id, anonId: map[speaker], round }));
      citations.filter((row) => row.valid).forEach((row) => seen.add(citationKey(row)));
      if (role !== 'devil') previous.set(speaker, raw.verdict);
      ctx.record.trace.push({
        phase: 'debate', template: TEMPLATE[role], clusterId: cluster.id, round, anonId: map[speaker],
        verdict: turn.verdict, stop: turn.discarded ? 'discarded' : 'kept',
        conformitySuspect: Boolean(turn.conformitySuspect), ...(prior ? { source: 'crosscheck' } : {}),
      });
    }
  };

  for (let r = ctx.startRound; r <= ctx.rounds; r += 1) {
    if (r === 1) {
      await speakMany(challengers, 1, 'challenge');
      const answered = new Set(turns.filter((turn) => turn.round === 1).map((turn) => turn.speaker));
      const devil = [...challengers].filter((id) => answered.has(id) && (ctx.devilMisses.get(id) || 0) < DEVIL_MAX_MISSES).sort((a, b) => map[a].localeCompare(map[b]))[0] || null;
      const opposed = turns.some((turn) => turn.round === 1 && !turn.discarded && turn.verdict === 'refuted');
      if (devil && !opposed && !stoppedReason()) await speakMany([devil], 1, 'devil');
    } else if (r === 2) {
      const challenged = turns.some((turn) => !turn.discarded && ['refuted', 'partial'].includes(turn.verdict));
      if (challenged && !stoppedReason()) await speakMany(authors, 2, 'defend');
    } else if (r === 3) {
      const defended = turns.some((turn) => turn.round === 2 && !turn.discarded && !turn.conformitySuspect && ['upheld', 'partial'].includes(turn.verdict));
      if (defended && !stoppedReason()) await speakMany(challengers, 3, 'rebut');
    } else if (r >= 4 && r % 2 === 0) {
      const rebuttedPrev = turns.some((turn) => turn.round === r - 1 && !turn.discarded && ['refuted', 'partial'].includes(turn.verdict));
      if (rebuttedPrev && !stoppedReason()) await speakMany(authors, r, 'defend');
    } else if (r >= 5 && r % 2 === 1) {
      const defendedPrev = turns.some((turn) => turn.round === r - 1 && !turn.discarded && !turn.conformitySuspect && ['upheld', 'partial'].includes(turn.verdict));
      if (defendedPrev && !stoppedReason()) await speakMany(challengers, r, 'rebut');
    }
  }

  return { turns, map, rounds: turns.reduce((n, turn) => Math.max(n, turn.round), 0) };
}

export async function runRounds({
  out, clusters, voices, vendors, reader, rounds = 2, startRound = 1, priorState = null, concurrency = 1,
  seed = 1, names = [], turnMs = DEFAULTS.debate.turnMs, phaseMs = DEFAULTS.debate.phaseMs,
  maxUnanswered = DEFAULT_MAX_UNANSWERED, maxSpeakerUnanswered = Math.min(3, maxUnanswered),
  now = Date.now, signal, judgeOf = null, prior = null, onCluster = null,
} = {}) {
  const record = {
    citations: Array.isArray(priorState?.citations) ? [...priorState.citations] : [],
    trace: Array.isArray(priorState?.trace) ? [...priorState.trace] : [],
    gaps: Array.isArray(priorState?.gaps) ? [...priorState.gaps] : [],
    advisory: Array.isArray(priorState?.advisory) ? [...priorState.advisory] : [],
  };
  const participants = [...voices.keys()];
  const started = now();
  const ctx = {
    out, reader, voices, vendors, rounds, startRound: Math.max(1, Number(startRound) || 1), priorState,
    names, record, turnMs, phaseMs, started, now, signal, maxUnanswered, maxSpeakerUnanswered,
    unanswered: 0, speakerUnanswered: new Map(), devilMisses: new Map(), judgeOf, prior,
  };
  const skipped = [];
  const skippedReasons = new Map();
  const debated = new Map();
  const anonymization = { seed: priorState?.anonymization?.seed ?? seed, clusters: { ...(priorState?.anonymization?.clusters || {}) } };
  const queued = clusters.filter((row) => row.status === 'QUEUED');
  let heard = 0;
  onCluster?.(0, queued.length);

  const width = Math.max(1, Math.min(8, Number(concurrency) || 1));
  const outcomes = new Array(queued.length);
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < queued.length) {
      const idx = cursor++;
      const cluster = queued[idx];
      if (!cluster) break;
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
        outcomes[idx] = { skipped: true, clusterId: cluster.id, skipReason };
        continue;
      }
      const result = await debateCluster(cluster, participants, ctx, anonymization.seed);
      outcomes[idx] = { skipped: false, clusterId: cluster.id, result };
      heard += 1;
      onCluster?.(heard, queued.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, Math.max(1, queued.length)) }, () => runWorker()));

  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.skipped) {
      skipped.push(outcome.clusterId);
      skippedReasons.set(outcome.clusterId, outcome.skipReason);
      record.trace.push({ phase: 'debate', template: 'skip', clusterId: outcome.clusterId, stop: outcome.skipReason });
    } else {
      debated.set(outcome.clusterId, outcome.result);
      anonymization.clusters[outcome.clusterId] = outcome.result.map;
    }
  }
  return { debated, anonymization, skipped, skippedReasons, ...record };
}
