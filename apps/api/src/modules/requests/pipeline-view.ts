// Reads pipeline-progress.json, orchestrator-advice.json and report-health.json from a report directory
// into the intake-api.schema.json#/$defs/pipeline-summary DTO shape.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../../worker/classify.ts';
import { readPublished } from '../../worker/publish.ts';

export type PipelineMode = 'full' | 'step-by-step' | 'stage-1';

export interface PipelineSummaryDto {
  pipelineMode: PipelineMode;
  currentStage: 'stage-1' | 'stage-2-advice' | 'stage-3-debate' | 'completed';
  noDebates: boolean;
  roundsCompleted: number;
  canRunMoreRounds: boolean;
  advice?: {
    debateNeeded: boolean;
    recommendedDepth: 'none' | 'shallow' | 'standard' | 'deep';
    recommendedRounds: number;
    qualityRating: 'strong' | 'adequate' | 'degraded' | 'incomplete';
    summary: string;
  };
  incompletionNotes?: Array<{
    category: string;
    code: string;
    source: string;
    reason: string;
    impact: string;
    nextStep?: string;
  }>;
  nextRoundRequestIds?: string[];
}

const VALID_MODES = new Set<string>(['full', 'step-by-step', 'stage-1']);
const VALID_DEPTHS = new Set<string>(['none', 'shallow', 'standard', 'deep']);

function normalizeStage(raw: unknown, mode: PipelineMode): PipelineSummaryDto['currentStage'] {
  if (raw === 'stage-1' || raw === 'stage-2-advice' || raw === 'stage-3-debate' || raw === 'completed') return raw;
  if (raw === 'complete') return 'completed';
  if (mode === 'stage-1') return 'stage-1';
  if (mode === 'step-by-step') return 'stage-2-advice';
  return 'completed';
}

function normalizeRating(raw: unknown): NonNullable<PipelineSummaryDto['advice']>['qualityRating'] | null {
  if (raw === 'strong' || raw === 'adequate' || raw === 'degraded' || raw === 'incomplete') return raw;
  if (raw === 'thin') return 'degraded';
  return null;
}

export function findLatestReportDir(reportsRoot: string, runsRoot: string, requestId: string): string | null {
  const published = readPublished(reportsRoot, requestId);
  if (published && fs.existsSync(published.dir)) return published.dir;
  const base = path.join(runsRoot, requestId);
  if (!fs.existsSync(base)) return null;
  const attempts = fs.readdirSync(base)
    .filter((name) => /^\d+(?:\.\d+)?$/.test(name) && fs.existsSync(path.join(base, name, 'report')))
    .sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a));
  const latest = attempts[0];
  return latest ? path.join(base, latest, 'report') : null;
}

export function readPipelineSummary(
  dir: string | null,
  fallbackMode?: PipelineMode,
  nextRoundRequestIds: string[] = [],
): PipelineSummaryDto | null {
  if (!dir || !fs.existsSync(dir)) return null;
  const progress = readJson(path.join(dir, 'pipeline-progress.json'));
  const adviceRaw = readJson(path.join(dir, 'orchestrator-advice.json'));
  const health = readJson(path.join(dir, 'report-health.json'));

  const hasNotes = Array.isArray(health?.incompletionNotes) && health.incompletionNotes.length > 0;
  if (!progress && !adviceRaw && !hasNotes && (!fallbackMode || fallbackMode === 'full') && nextRoundRequestIds.length === 0) {
    return null;
  }

  const modeRaw = typeof progress?.pipelineMode === 'string' && VALID_MODES.has(progress.pipelineMode)
    ? (progress.pipelineMode as PipelineMode)
    : (fallbackMode ?? 'full');
  const currentStage = normalizeStage(progress?.currentStage, modeRaw);

  const debateObj = (progress?.debate ?? {}) as Record<string, unknown>;
  const stage1Obj = (progress?.stage1 ?? {}) as Record<string, unknown>;
  const rawCompleted = debateObj.completedRounds ?? debateObj.roundsCompleted;
  const roundsCompleted = typeof rawCompleted === 'number' && Number.isInteger(rawCompleted) && rawCompleted >= 0
    ? Math.min(20, rawCompleted)
    : 0;
  const noDebates = typeof stage1Obj.noDebates === 'boolean' ? stage1Obj.noDebates : (roundsCompleted === 0 && modeRaw !== 'full');
  const canRunMoreRounds = typeof debateObj.canRunMoreRounds === 'boolean' ? debateObj.canRunMoreRounds : roundsCompleted < 20;

  let advice: PipelineSummaryDto['advice'] | undefined;
  const qualityObj = (adviceRaw?.quality && typeof adviceRaw.quality === 'object' ? adviceRaw.quality : null) as Record<string, unknown> | null;
  const debateAdvObj = (adviceRaw?.debateAdvice && typeof adviceRaw.debateAdvice === 'object' ? adviceRaw.debateAdvice : null) as Record<string, unknown> | null;
  const rating = normalizeRating(qualityObj?.rating ?? adviceRaw?.qualityRating);
  const rawSummary = typeof qualityObj?.summary === 'string' && qualityObj.summary.trim()
    ? `${qualityObj.summary.trim()}${typeof debateAdvObj?.rationale === 'string' && debateAdvObj.rationale.trim() ? ` ${debateAdvObj.rationale.trim()}` : ''}`
    : typeof adviceRaw?.qualitySummary === 'string' && adviceRaw.qualitySummary.trim()
      ? `${adviceRaw.qualitySummary.trim()}${typeof adviceRaw.debateRationale === 'string' && adviceRaw.debateRationale.trim() ? ` ${adviceRaw.debateRationale.trim()}` : ''}`
      : typeof adviceRaw?.summary === 'string' && adviceRaw.summary.trim()
        ? adviceRaw.summary.trim()
        : '';
  const advNeeded = typeof debateAdvObj?.debateNeeded === 'boolean' ? debateAdvObj.debateNeeded : adviceRaw?.debateNeeded;
  const advRounds = typeof debateAdvObj?.recommendedRounds === 'number' ? debateAdvObj.recommendedRounds : adviceRaw?.recommendedRounds;
  const advDepth = typeof debateAdvObj?.recommendedDepth === 'string' ? debateAdvObj.recommendedDepth : adviceRaw?.recommendedDepth;
  if (
    adviceRaw &&
    typeof advNeeded === 'boolean' &&
    typeof advRounds === 'number' &&
    typeof advDepth === 'string' && VALID_DEPTHS.has(advDepth) &&
    rating &&
    rawSummary.length > 0
  ) {
    advice = {
      debateNeeded: advNeeded,
      recommendedDepth: advDepth as NonNullable<PipelineSummaryDto['advice']>['recommendedDepth'],
      recommendedRounds: Math.max(0, Math.min(3, Math.trunc(advRounds))),
      qualityRating: rating,
      summary: rawSummary.slice(0, 2000),
    };
  }

  const rawNotes = Array.isArray(progress?.incompletionNotes)
    ? progress.incompletionNotes
    : Array.isArray(health?.incompletionNotes)
      ? health.incompletionNotes
      : [];
  const incompletionNotes = rawNotes
    .filter((n: unknown): n is Record<string, unknown> => Boolean(n && typeof n === 'object'))
    .filter((n) => typeof n.category === 'string' && typeof n.code === 'string' && typeof n.reason === 'string' && typeof n.impact === 'string')
    .slice(0, 50)
    .map((n) => ({
      category: String(n.category).slice(0, 64),
      code: String(n.code).slice(0, 120),
      source: typeof n.source === 'string' && n.source.length > 0 ? String(n.source).slice(0, 200) : 'engine',
      reason: String(n.reason).slice(0, 1000),
      impact: String(n.impact).slice(0, 1000),
      ...(typeof n.nextStep === 'string' && n.nextStep.length > 0 ? { nextStep: String(n.nextStep).slice(0, 500) } : {}),
    }));

  return {
    pipelineMode: modeRaw,
    currentStage,
    noDebates,
    roundsCompleted,
    canRunMoreRounds,
    ...(advice ? { advice } : {}),
    ...(incompletionNotes.length > 0 ? { incompletionNotes } : {}),
    ...(nextRoundRequestIds.length > 0 ? { nextRoundRequestIds } : {}),
  };
}
