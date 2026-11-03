// Model voices: one bridge session per debate turn, judgement or general review, launched through the
// orchestrator's ctx.execute with the debater or orchestrator bridge role. The session's answer is the
// hash-committed inbox entry; a session that fails or commits nothing returns null and the caller records a gap.
import path from 'node:path';
import { renderDebateBrief } from './orchestrator-briefs.mjs';
import { readInbox } from './debate-inbox.mjs';
import { DEBATE_TOOL_BUDGET } from './debate-bridge.mjs';

const TEMPLATE = { challenge: 'challenge', devil: 'devil-advocate', defend: 'defend', rebut: 'rebut' };
const publicTurn = ({ round, role, anonId, verdict, argument, citations }) => ({ round, role, anonId, verdict, argument, citations: (citations || []).filter((c) => c.valid) });

async function session(ctx, { name, agent, role, prompt, assignment, kind }) {
  try {
    const logFile = path.join(ctx.output, 'harness', 'host', `agent-${name}.log`);
    const result = await ctx.execute({ name, agent, role, prompt, assignment, logFile });
    if (result?.code !== 0) return { body: null, reason: result?.failure?.reason || 'session_failed' };
    const body = readInbox(ctx.output, name, kind);
    return body ? { body } : { body: null, reason: 'nothing_committed' };
  } catch (error) {
    return { body: null, reason: error.reason || error.code || 'session_failed' };
  }
}

export function bridgeVoice(ctx, reviewer, budget = DEBATE_TOOL_BUDGET) {
  return async ({ role, round, cluster, turns, anonId }) => {
    const name = `${reviewer.id}-debate-${cluster.id.toLowerCase()}-r${round}`;
    const assignment = { kind: 'debate-turn', clusterId: cluster.id, round, role, anonId, budget };
    const prompt = renderDebateBrief(TEMPLATE[role], { cluster, turns: turns.filter((t) => !t.discarded).map(publicTurn), anonId, round, budget });
    const { body, reason } = await session(ctx, { name, agent: reviewer.id, role: 'debater', prompt, assignment, kind: 'debate-turn' });
    return body ? { verdict: body.verdict, citations: body.citations, argument: body.argument } : { unavailable: reason };
  };
}

export function bridgeJudge(ctx, reviewer, budget = DEBATE_TOOL_BUDGET) {
  return async ({ cluster, turns, judge, validArguments, discardedArguments }) => {
    const name = `${reviewer.id}-judge-${cluster.id.toLowerCase()}`;
    const assignment = { kind: 'judge', clusterId: cluster.id, judge, validArguments, discardedArguments, budget };
    const prompt = renderDebateBrief('judge', { cluster, turns: turns.map(publicTurn), budget });
    const { body, reason } = await session(ctx, { name, agent: reviewer.id, role: 'orchestrator', prompt, assignment, kind: 'judge' });
    return body || { unavailable: reason };
  };
}

export function bridgeSummary(ctx, reviewer) {
  return async ({ clusters }) => {
    const name = `${reviewer.id}-general-review`;
    const assignment = { kind: 'general-review', clusterIds: clusters.map((row) => row.clusterId), budget: DEBATE_TOOL_BUDGET };
    const prompt = renderDebateBrief('general-review', { clusters });
    const { body, reason } = await session(ctx, { name, agent: reviewer.id, role: 'orchestrator', prompt, assignment, kind: 'general-review' });
    return body || { unavailable: reason };
  };
}
