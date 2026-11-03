// Debate rounds (ORCHESTRATION 4.2) over queued clusters. Round 1: every non-author challenges, one of them as
// devil's advocate. Round 2: authors defend when a challenge refuted. Round 3: challengers rebut only when a
// round-2 verdict changed. Every turn is citation-checked and classified here, never by the voice.
import { anonymize, stripIdentity } from './debate-anonymize.mjs';
import { checkTurnCitations } from './debate-citations.mjs';
import { citationKey, classifyArgument } from './debate-rules.mjs';
import { validate } from '../../packages/schemas/index.mjs';
import { writeJson } from './report-util-files.mjs';

const TEMPLATE = { challenge: 'challenge', devil: 'devil-advocate', defend: 'defend', rebut: 'rebut' };
const publicTurn = (turn) => ({
  round: turn.round, clusterId: turn.clusterId, role: turn.role, anonId: turn.anonId, verdict: turn.verdict,
  citations: turn.citations.map(({ file, startLine, endLine, quote }) => ({ file, startLine, endLine, quote })),
  argument: turn.argument, conformitySuspect: Boolean(turn.conformitySuspect), devilAdvocate: turn.role === 'devil',
});

// One cluster's debate. ctx: {out, reader, voices, vendors, rounds, names, record}.
async function debateCluster(cluster, participants, ctx, seed) {
  const authors = cluster.authors.filter((id) => participants.includes(id));
  const challengers = participants.filter((id) => !cluster.authors.includes(id));
  const map = anonymize([...authors, ...challengers], seed, cluster.id);
  const devil = [...challengers].sort((a, b) => map[a].localeCompare(map[b]))[0] || null;
  const seen = new Set(cluster.evidence.filter((row) => row.valid).map(citationKey));
  const previous = new Map(authors.map((id) => [id, 'upheld']));
  const turns = [];
  const speak = async (speaker, round, role) => {
    const raw = await ctx.voices.get(speaker)({ role, round, cluster, turns, anonId: map[speaker] });
    if (!raw || raw.unavailable || typeof raw.argument !== 'string') {
      ctx.record.gaps.push({ clusterId: cluster.id, anonId: map[speaker], round, reason: raw?.unavailable || 'invalid_turn' });
      return;
    }
    const citations = checkTurnCitations(ctx.reader, raw.citations, cluster.anchors);
    const turn = classifyArgument({ round, clusterId: cluster.id, role, anonId: map[speaker], verdict: raw.verdict, citations, argument: stripIdentity(raw.argument, ctx.names) }, { seen, previous: previous.get(speaker) ?? null });
    const body = publicTurn(turn);
    const check = validate('debate-round', body);
    if (!check.ok) { ctx.record.gaps.push({ clusterId: cluster.id, anonId: map[speaker], round, reason: 'invalid_turn' }); return; }
    turns.push({ ...turn, speaker, speakerVendor: ctx.vendors.get(speaker) || speaker });
    writeJson(ctx.out, `debate/round-${round}/${map[speaker]}-${cluster.id}.json`, body);
    citations.forEach((row) => ctx.record.citations.push({ ...row, clusterId: cluster.id, anonId: map[speaker], round }));
    citations.filter((row) => row.valid).forEach((row) => seen.add(citationKey(row)));
    previous.set(speaker, raw.verdict);
    ctx.record.trace.push({ phase: 'debate', template: TEMPLATE[role], clusterId: cluster.id, round, anonId: map[speaker], verdict: turn.verdict, stop: turn.discarded ? 'discarded' : 'kept', conformitySuspect: Boolean(turn.conformitySuspect) });
  };
  for (const id of challengers) await speak(id, 1, id === devil ? 'devil' : 'challenge');
  const challenged = turns.some((turn) => !turn.discarded && ['refuted', 'partial'].includes(turn.verdict));
  if (ctx.rounds >= 2 && challenged) for (const id of authors) await speak(id, 2, 'defend');
  const changed = turns.some((turn) => turn.round === 2 && turn.verdictChanged);
  if (ctx.rounds >= 3 && changed) for (const id of challengers) await speak(id, 3, 'rebut');
  return { turns, map, rounds: turns.reduce((n, turn) => Math.max(n, turn.round), 0) };
}

// clusters: buildClusters output rows. voices: Map reviewerId -> speak(). vendors: Map reviewerId -> vendor.
export async function runRounds({ out, clusters, voices, vendors, reader, rounds = 2, seed = 1, names = [] }) {
  const record = { citations: [], trace: [], gaps: [] };
  const participants = [...voices.keys()];
  const ctx = { out, reader, voices, vendors, rounds, names, record };
  const debated = new Map();
  const anonymization = { seed, clusters: {} };
  for (const cluster of clusters.filter((row) => row.status === 'QUEUED')) {
    const result = await debateCluster(cluster, participants, ctx, seed);
    debated.set(cluster.id, result);
    anonymization.clusters[cluster.id] = result.map;
  }
  return { debated, anonymization, ...record };
}
