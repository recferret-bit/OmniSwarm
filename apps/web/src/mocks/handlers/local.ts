// Dev/e2e only. Local jobs finish immediately; the mock does not spawn a process.
import { http, HttpResponse } from 'msw';
import type { PipelineMode } from '@/lib/api/schema.gen';
import { parseRepoInput } from '@/lib/repo';
import { clock, readState, stamp, updateState, type LocalJob } from '../db';
import { apiError, MOCK_COMMIT, uuid } from './intake';
import { pdfResponse } from './pdf';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VALID_MODES = new Set<string>(['full', 'step-by-step', 'stage-1']);

const create = http.post('/api/local/jobs', async ({ request }) => {
  const body = (await request.json()) as unknown;
  if (!isRecord(body)) return apiError('VALIDATION_ERROR', 400, 'Send exactly one of path or github');
  const hasPath = Object.hasOwn(body, 'path');
  const hasGithub = Object.hasOwn(body, 'github');
  if (hasPath === hasGithub) return apiError('VALIDATION_ERROR', 400, 'Send exactly one of path or github');
  for (const key of Object.keys(body)) {
    if (key !== 'path' && key !== 'github' && key !== 'pipelineMode' && key !== 'concurrency') {
      return apiError('VALIDATION_ERROR', 400, `Unexpected field: ${key}`);
    }
  }
  const pipelineMode = typeof body.pipelineMode === 'string' && VALID_MODES.has(body.pipelineMode)
    ? (body.pipelineMode as PipelineMode)
    : undefined;
  if (Object.hasOwn(body, 'pipelineMode') && !pipelineMode) {
    return apiError('VALIDATION_ERROR', 400, 'Invalid pipelineMode');
  }
  let job: Pick<LocalJob, 'kind' | 'source' | 'ref' | 'commitSha'>;
  if (hasPath) {
    if (typeof body.path !== 'string' || !body.path.startsWith('/')) return apiError('VALIDATION_ERROR', 400, 'Path must be absolute');
    job = { kind: 'path', source: body.path, ref: null, commitSha: null };
  } else {
    const parsed = typeof body.github === 'string' ? parseRepoInput(body.github) : null;
    if (!parsed) return apiError('REPO_INVALID', 400, 'Not a GitHub repository');
    job = { kind: 'github', source: parsed.repo, ref: parsed.ref ?? null, commitSha: MOCK_COMMIT };
  }
  const roundsCompleted = !pipelineMode || pipelineMode === 'full' ? 2 : 0;
  const row: LocalJob = {
    id: uuid(), ...job, status: 'done', error: null, createdAt: clock.now(), pdfReady: true,
    ...(pipelineMode ? { pipelineMode } : {}), roundsCompleted,
  };
  updateState((state) => { state.localJobs.unshift(row); });
  return HttpResponse.json({
    id: row.id, kind: row.kind, source: row.source, status: row.status,
    ...(pipelineMode ? { pipelineMode } : {}),
  }, { status: 201 });
});

const list = http.get('/api/local/jobs', () => {
  const jobs = readState().localJobs.map((job) => ({
    id: job.id, kind: job.kind, source: job.source, status: job.status, createdAt: stamp(job.createdAt),
  }));
  return HttpResponse.json({ jobs });
});

const pdf = http.get<{ id: string }>('/api/local/jobs/:id/report.pdf', ({ params }) => {
  const job = readState().localJobs.find((item) => item.id === params.id);
  if (!job?.pdfReady) return apiError('NOT_FOUND', 404, 'Request not found');
  return pdfResponse();
});

const one = http.get<{ id: string }>('/api/local/jobs/:id', ({ params }) => {
  const job = readState().localJobs.find((item) => item.id === params.id);
  if (!job) return apiError('NOT_FOUND', 404, 'Request not found');
  const mode = job.pipelineMode ?? 'full';
  const rounds = job.roundsCompleted ?? (mode === 'full' ? 2 : 0);
  return HttpResponse.json({
    id: job.id, kind: job.kind, source: job.source, ref: job.ref, commitSha: job.commitSha,
    status: job.status, error: job.error, createdAt: stamp(job.createdAt), pdfReady: job.pdfReady,
    ...(job.pipelineMode ? { pipelineMode: job.pipelineMode } : {}),
    ...(job.pipelineMode ? {
      pipeline: {
        pipelineMode: mode,
        currentStage: rounds > 0 ? 'stage-3-debate' : mode === 'stage-1' ? 'stage-1' : 'stage-2-advice',
        noDebates: rounds === 0,
        roundsCompleted: rounds,
        canRunMoreRounds: rounds < 20,
        advice: {
          debateNeeded: rounds === 0,
          recommendedDepth: rounds === 0 ? 'shallow' : 'none',
          recommendedRounds: rounds === 0 ? 1 : 0,
          qualityRating: 'adequate',
          summary: rounds === 0 ? 'Stage 1 pass complete; 1 debate round recommended.' : `Completed ${rounds} debate round(s).`,
        },
      },
    } : {}),
  });
});

const advise = http.post<{ id: string }>('/api/local/jobs/:id/advise', ({ params }) => {
  const job = readState().localJobs.find((item) => item.id === params.id);
  if (!job) return apiError('NOT_FOUND', 404, 'Request not found');
  if (job.status !== 'done') return apiError('INVALID_TRANSITION', 409, 'Local job is still running');
  updateState(() => { job.pipelineMode = 'step-by-step'; });
  return HttpResponse.json({ id: job.id, status: job.status }, { status: 202 });
});

const debate = http.post<{ id: string }>('/api/local/jobs/:id/debate', async ({ params, request }) => {
  const job = readState().localJobs.find((item) => item.id === params.id);
  if (!job) return apiError('NOT_FOUND', 404, 'Request not found');
  if (job.status !== 'done') return apiError('INVALID_TRANSITION', 409, 'Local job is still running');
  const body = (await request.json().catch(() => ({}))) as { rounds?: number };
  const rounds = typeof body?.rounds === 'number' && Number.isInteger(body.rounds) && body.rounds >= 1 && body.rounds <= 5 ? body.rounds : 1;
  updateState(() => { job.roundsCompleted = (job.roundsCompleted ?? 0) + rounds; });
  return HttpResponse.json({ id: job.id, status: job.status }, { status: 202 });
});

export const localHandlers = [create, list, pdf, one, advise, debate];
