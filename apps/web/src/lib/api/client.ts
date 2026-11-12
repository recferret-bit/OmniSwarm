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
  PipelineMode,
  PipelineSummary,
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

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
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

export type DebateStepCreated = DashboardJobCreated;

/**
 * This account's own key for one provider whose catalog entry takes account keys (packages/schemas/providers.mjs;
 * today NEAR AI Cloud). The key is never returned, only its fingerprint.
 */
export interface AccountKeyView {
  provider: string;
  label: string;
  set: boolean;
  fingerprint: string | null;
  models: string[];
  dataPolicy: string;
  /** The operator allows signed (wallet) requests on this key. */
  signedRequests: boolean;
}

export interface ModelList {
  source: 'live' | 'unavailable';
  models: string[];
}

export type LocalJobRequest = ({ path: string } | { github: string }) & {
  pipelineMode?: PipelineMode;
  concurrency?: number;
};

export interface LocalJobCreated {
  id: string;
  kind: 'path' | 'github';
  source: string;
  status: string;
  pipelineMode?: PipelineMode;
}

export interface LocalJobSummary {
  id: string;
  kind: 'path' | 'github';
  source: string;
  status: string;
  pipelineMode?: PipelineMode;
  createdAt: string;
}

export interface LocalJobDetail extends LocalJobSummary {
  ref: string | null;
  commitSha: string | null;
  error: string | null;
  pdfReady: boolean;
  pipeline?: PipelineSummary | null;
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
  createDashboardJob: (body: { repo: string; models?: string[]; scopes?: string[]; source?: string; pipelineMode?: PipelineMode }) => call<DashboardJobCreated>('POST', '/dashboard/jobs', body),
  adviseRequest: (requestId: string) => call<DebateStepCreated>('POST', `/requests/${id(requestId)}/advise`, {}),
  continueDebate: (requestId: string, body: { rounds?: number } = {}) => call<DebateStepCreated>('POST', `/requests/${id(requestId)}/debate`, body),
  adviseDashboardJob: (requestId: string) => call<DebateStepCreated>('POST', `/dashboard/jobs/${id(requestId)}/advise`, {}),
  continueDashboardDebate: (requestId: string, body: { rounds?: number } = {}) => call<DebateStepCreated>('POST', `/dashboard/jobs/${id(requestId)}/debate`, body),
  listAccountKeys: () => call<{ providers: AccountKeyView[] }>('GET', '/account/providers'),
  saveAccountKey: (provider: string, body: { key?: string; models?: string[] }) => call<AccountKeyView>('PUT', `/account/providers/${id(provider)}`, body),
  listProviderModels: (provider: string) => call<ModelList>('GET', `/account/providers/${id(provider)}/models`),
  createLocalJob: (body: LocalJobRequest) => call<LocalJobCreated>('POST', '/local/jobs', body),
  listLocalJobs: () => call<{ jobs: LocalJobSummary[] }>('GET', '/local/jobs'),
  getLocalJob: (jobId: string) => call<LocalJobDetail>('GET', `/local/jobs/${id(jobId)}`),
  adviseLocalJob: (jobId: string) => call<{ id: string; status: string }>('POST', `/local/jobs/${id(jobId)}/advise`, {}),
  continueLocalJobDebate: (jobId: string, body: { rounds?: number } = {}) => call<{ id: string; status: string }>('POST', `/local/jobs/${id(jobId)}/debate`, body),
};

export type Api = typeof api;

export function eventsUrl(requestId: string): string {
  return `${BASE}/requests/${id(requestId)}/events`;
}
