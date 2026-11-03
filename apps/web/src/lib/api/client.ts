// Typed fetch client for the intake API (INTAKE section 4). Same-origin only:
// `/api/*` is proxied in dev and routed by nginx in production. DTO types come
// from schema.gen.ts; an `{error:{code}}` body becomes an AppError.
import { AppError, isErrorCode } from './errors';
import type {
  ChallengeResponse,
  CreateRequestBody,
  CreateRequestResponse,
  HealthResponse,
  PaymentRequest,
  PaymentResponse,
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
  return (await response.json()) as T;
}

const id = (value: string) => encodeURIComponent(value);

export const api = {
  health: () => call<HealthResponse>('GET', '/health'),
  challenge: () => call<ChallengeResponse>('POST', '/challenge', {}),
  quote: (body: QuoteRequest) => call<QuoteResponse>('POST', '/quote', body),
  createRequest: (body: CreateRequestBody) => call<CreateRequestResponse>('POST', '/requests', body),
  confirmPayment: (requestId: string, body: PaymentRequest) => call<PaymentResponse>('POST', `/requests/${id(requestId)}/payment`, body),
  getRequest: (requestId: string) => call<RequestStatusResponse>('GET', `/requests/${id(requestId)}`),
  listMine: () => call<RequestListResponse>('GET', '/requests?mine=1'),
  getReport: (requestId: string) => call<ReportIndexResponse>('GET', `/reports/${id(requestId)}`),
};

export type Api = typeof api;

export function eventsUrl(requestId: string): string {
  return `${BASE}/requests/${id(requestId)}/events`;
}
