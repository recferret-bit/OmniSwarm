// Typed fetch client for the intake API (INTAKE section 4) plus the operator
// session, dashboard jobs and local jobs. Same-origin only: `/api/*` is proxied
// in dev and routed by nginx in production. Intake DTO types come from
// schema.gen.ts; an `{error:{code}}` body becomes an AppError. Report PDFs are
// plain links, not this client.
import { AppError, isErrorCode } from './errors';
import type {
  ChallengeResponse,
  CreateRequestBody,
  CreateRequestResponse,
  HealthResponse,
  PaymentRequest,
  PaymentResponse,
  Progress,
  QuoteRequest,
  QuoteResponse,
  ReportIndexResponse,
  RequestListResponse,
  RequestStatusResponse,
} from './schema.gen';

const BASE = '/api';

async function parseError(response: Response): Promise<AppError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = (body as { error?: { code?: unknown; message?: unknown; retryable?: unknown } } | null)?.error;
  const code = isErrorCode(error?.code) ? error.code : 'INTERNAL';
  const message = typeof error?.message === 'string' ? error.message : undefined;
  return new AppError(code, message, { retryable: error?.retryable === true, status: response.status });
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AppError('NETWORK_ERROR', undefined, { retryable: true });
  }
  if (!response.ok) throw await parseError(response);
  // Logout is 204 with an empty body. Any other empty success is not JSON either.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

const id = (value: string) => encodeURIComponent(value);

export interface SessionAccount {
  account: string;
}

export interface LoginRequest {
  login: string;
  password: string;
}

export interface DashboardJobCreated {
  requestId: string;
  repo: string;
  commitSha: string;
  status: 'queued';
}

export type LocalJobRequest = { path: string } | { github: string };

export interface LocalJobCreated {
  id: string;
  kind: 'path' | 'github';
  source: string;
  status: string;
}

export interface LocalJobSummary {
  id: string;
  kind: 'path' | 'github';
  source: string;
  status: string;
  createdAt: string;
}

export interface LocalJobDetail extends LocalJobSummary {
  ref: string | null;
  commitSha: string | null;
  error: string | null;
  pdfReady: boolean;
  /** The engine's live snapshot, as on a hosted request. Absent while queued or for an engine that writes none. */
  progress?: Progress;
}

export function requestReportHref(requestId: string): string {
  return `${BASE}/requests/${id(requestId)}/report.pdf`;
}

export function localReportHref(jobId: string): string {
  return `${BASE}/local/jobs/${id(jobId)}/report.pdf`;
}

export const api = {
  health: () => call<HealthResponse>('GET', '/health'),
  challenge: () => call<ChallengeResponse>('POST', '/challenge', {}),
  quote: (body: QuoteRequest) => call<QuoteResponse>('POST', '/quote', body),
  createRequest: (body: CreateRequestBody) => call<CreateRequestResponse>('POST', '/requests', body),
  confirmPayment: (requestId: string, body: PaymentRequest) => call<PaymentResponse>('POST', `/requests/${id(requestId)}/payment`, body),
  getRequest: (requestId: string) => call<RequestStatusResponse>('GET', `/requests/${id(requestId)}`),
  listMine: () => call<RequestListResponse>('GET', '/requests?mine=1'),
  getReport: (requestId: string) => call<ReportIndexResponse>('GET', `/reports/${id(requestId)}`),
  login: (body: LoginRequest) => call<SessionAccount>('POST', '/login', body),
  logout: () => call<void>('POST', '/logout'),
  session: () => call<SessionAccount>('GET', '/session'),
  createDashboardJob: (body: { repo: string; models?: string[]; scopes?: string[] }) => call<DashboardJobCreated>('POST', '/dashboard/jobs', body),
  createLocalJob: (body: LocalJobRequest) => call<LocalJobCreated>('POST', '/local/jobs', body),
  listLocalJobs: () => call<{ jobs: LocalJobSummary[] }>('GET', '/local/jobs'),
  getLocalJob: (jobId: string) => call<LocalJobDetail>('GET', `/local/jobs/${id(jobId)}`),
};

export type Api = typeof api;

export function eventsUrl(requestId: string): string {
  return `${BASE}/requests/${id(requestId)}/events`;
}
