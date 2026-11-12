// Model voices: one bridge session per debate turn, judgement or general review, launched through the
// orchestrator's ctx.execute with the debater or orchestrator bridge role. The session's answer is the
// hash-committed inbox entry; a session that fails or commits nothing returns null and the caller records a gap.
import path from 'node:path';
import { renderDebateBrief } from './orchestrator-briefs.mjs';
import { readInbox } from './debate-inbox.mjs';
import { DEBATE_TOOL_BUDGET } from './debate-bridge.mjs';

const TEMPLATE = { challenge: 'challenge', devil: 'devil-advocate', defend: 'defend', rebut: 'rebut' };
const publicTurn = ({ round, role, anonId, verdict, argument, citations }) => ({ round, role, anonId, verdict, argument, citations: (citations || []).filter((c) => c.valid) });
// The judge sees the arguments the rules weigh: discarded turns are left out, and a conformity-suspect turn (a
// flip without new evidence) is shown marked so it is not counted as an independent vote.
const judgeTurns = (turns) => turns.filter((t) => !t.discarded).map((t) => ({ ...publicTurn(t), ...(t.conformitySuspect ? { conformitySuspect: true } : {}) }));

const PROVIDER_BLOCKS = ['usage_limit', 'auth_required', 'provider_policy'];

async function session(ctx, { name, agent, role, prompt, assignment, kind, signal }) {
  if (PROVIDER_BLOCKS.includes(ctx.providerFailures?.[agent])) return { body: null, reason: ctx.providerFailures[agent] };
  try {
    const logFile = path.join(ctx.output, 'harness', 'host', `agent-${name}.log`);
    const result = await ctx.execute({ name, agent, role, prompt, assignment, logFile, signal });
    if (result?.code !== 0) {
      const reason = result?.failure?.reason || 'session_failed';
      if (ctx.providerFailures && PROVIDER_BLOCKS.includes(reason)) ctx.providerFailures[agent] ||= reason;
      return { body: null, reason };
    }
    const body = readInbox(ctx.output, name, kind);
    return body ? { body } : { body: null, reason: 'nothing_committed' };
  } catch (error) {
    return { body: null, reason: error.reason || error.code || 'session_failed' };
  }
}

export function bridgeVoice(ctx, reviewer, budget = DEBATE_TOOL_BUDGET) {
  return async ({ role, round, cluster, turns, anonId, signal }) => {
    const schemaRound = round <= 3 ? round : (role === 'defend' ? 2 : 3);
    const suffix = round > 3 ? `-i${round}` : (role === 'devil' ? '-devil' : '');
    const name = `${reviewer.id}-debate-${cluster.id.toLowerCase()}-r${schemaRound}${suffix}`;
    const assignment = { kind: 'debate-turn', clusterId: cluster.id, round: schemaRound, role, anonId, budget };
    const prompt = renderDebateBrief(TEMPLATE[role], { cluster, turns: turns.filter((t) => !t.discarded).map(publicTurn), anonId, round, budget });
    const { body, reason } = await session(ctx, { name, agent: reviewer.id, role: 'debater', prompt, assignment, kind: 'debate-turn', signal });
    return body ? { verdict: body.verdict, citations: body.citations, argument: body.argument } : { unavailable: reason };
  };
}

export function bridgeJudge(ctx, reviewer, budget = DEBATE_TOOL_BUDGET) {
  return async ({ cluster, turns, judge, validArguments, discardedArguments, signal }) => {
    const name = `${reviewer.id}-judge-${cluster.id.toLowerCase()}`;
    const assignment = { kind: 'judge', clusterId: cluster.id, judge, validArguments, discardedArguments, budget };
    const prompt = renderDebateBrief('judge', { cluster, turns: judgeTurns(turns), budget });
    const { body, reason } = await session(ctx, { name, agent: reviewer.id, role: 'orchestrator', prompt, assignment, kind: 'judge', signal });
    return body || { unavailable: reason };
  };
}

export function bridgeSummary(ctx, reviewer, budget = DEBATE_TOOL_BUDGET) {
  return async ({ clusters, signal }) => {
    const name = `${reviewer.id}-general-review`;
    // files: what the adjudicated clusters cite; the submit refuses a summary that cites any other file:line.
    const assignment = { kind: 'general-review', clusterIds: clusters.map((row) => row.clusterId), files: [...new Set(clusters.flatMap((row) => row.files || []))].sort(), budget };
    const prompt = renderDebateBrief('general-review', { clusters });
    const { body, reason } = await session(ctx, { name, agent: reviewer.id, role: 'orchestrator', prompt, assignment, kind: 'general-review', signal });
    return body || { unavailable: reason };
  };
}
