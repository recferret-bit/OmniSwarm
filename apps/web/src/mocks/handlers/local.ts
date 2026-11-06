// Dev/e2e only. Local jobs finish immediately; the mock does not spawn a process.
import { http, HttpResponse } from 'msw';
import { parseRepoInput } from '@/lib/repo';
import { clock, readState, stamp, updateState, type LocalJob } from '../db';
import { apiError, MOCK_COMMIT, uuid } from './intake';
import { pdfResponse } from './pdf';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const create = http.post('/api/local/jobs', async ({ request }) => {
  const body = (await request.json()) as unknown;
  if (!isRecord(body) || Object.keys(body).length !== 1) return apiError('VALIDATION_ERROR', 400, 'Send exactly one of path or github');
  let job: Pick<LocalJob, 'kind' | 'source' | 'ref' | 'commitSha'>;
  if (Object.hasOwn(body, 'path')) {
    if (typeof body.path !== 'string' || !body.path.startsWith('/')) return apiError('VALIDATION_ERROR', 400, 'Path must be absolute');
    job = { kind: 'path', source: body.path, ref: null, commitSha: null };
  } else if (Object.hasOwn(body, 'github')) {
    const parsed = typeof body.github === 'string' ? parseRepoInput(body.github) : null;
    if (!parsed) return apiError('REPO_INVALID', 400, 'Not a GitHub repository');
    job = { kind: 'github', source: parsed.repo, ref: parsed.ref ?? null, commitSha: MOCK_COMMIT };
  } else {
    return apiError('VALIDATION_ERROR', 400, 'Send exactly one of path or github');
  }
  const row: LocalJob = { id: uuid(), ...job, status: 'done', error: null, createdAt: clock.now(), pdfReady: true };
  updateState((state) => { state.localJobs.unshift(row); });
  return HttpResponse.json({ id: row.id, kind: row.kind, source: row.source, status: row.status }, { status: 201 });
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
  return HttpResponse.json({
    id: job.id, kind: job.kind, source: job.source, ref: job.ref, commitSha: job.commitSha,
    status: job.status, error: job.error, createdAt: stamp(job.createdAt), pdfReady: job.pdfReady,
  });
});

export const localHandlers = [create, list, pdf, one];
