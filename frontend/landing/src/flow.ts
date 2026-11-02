export const HERO = 'A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR';

export interface Quote {
  repo: string;
  commitSha: string;
  price: string;
  error?: 'private' | 'queue';
}

export interface RequestRow {
  id: string;
  repo: string;
  status: string;
  reportSha256: string;
}

export interface Screen {
  account: string | null;
  page: 'home' | 'sample' | 'me' | 'report';
  quote: Quote | null;
  signed: boolean;
  requestHash: string | null;
  paid: boolean;
  rejected: boolean;
  timeline: string[];
  requests: RequestRow[];
  reportSha256: string;
  attestedSha256: string;
}

export const SAMPLE_SHA = 'ab'.repeat(32);

export function initialState(): Screen {
  return {
    account: null,
    page: 'home',
    quote: null,
    signed: false,
    requestHash: null,
    paid: false,
    rejected: false,
    timeline: [],
    requests: [],
    reportSha256: SAMPLE_SHA,
    attestedSha256: SAMPLE_SHA,
  };
}

export type Action =
  | { type: 'page'; page: Screen['page'] }
  | { type: 'connect' }
  | { type: 'sign-out' }
  | { type: 'quote'; repo: string; mock?: string }
  | { type: 'sign' }
  | { type: 'pay'; reject?: boolean }
  | { type: 'retry' };

export function reduce(state: Screen, action: Action): Screen {
  if (action.type === 'page') return { ...state, page: action.page };
  if (action.type === 'connect') return { ...state, account: 'alice.testnet' };
  if (action.type === 'sign-out') return { ...initialState(), page: state.page };
  if (action.type === 'quote') {
    const repo = action.repo.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
    if (action.mock === 'REPO_PRIVATE' || repo.startsWith('private/')) {
      return { ...state, quote: { repo, commitSha: '', price: '', error: 'private' }, signed: false, paid: false };
    }
    if (action.mock === 'QUEUE_FULL') {
      return { ...state, quote: { repo, commitSha: '', price: '', error: 'queue' }, signed: false, paid: false };
    }
    return {
      ...state,
      quote: { repo, commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', price: '1 NEAR' },
      signed: false,
      paid: false,
      rejected: false,
    };
  }
  if (action.type === 'sign') {
    if (!state.quote || state.quote.error) return state;
    return { ...state, signed: true, requestHash: SAMPLE_SHA };
  }
  if (action.type === 'retry') return { ...state, rejected: false };
  if (action.type === 'pay') {
    if (!state.signed || state.quote?.error) return state;
    if (action.reject) return { ...state, rejected: true, paid: false };
    const row: RequestRow = { id: 'req-1', repo: state.quote!.repo, status: 'done', reportSha256: state.reportSha256 };
    return {
      ...state,
      paid: true,
      rejected: false,
      timeline: ['queued', 'running', 'done'],
      requests: [...state.requests, row],
      page: 'report',
    };
  }
  return state;
}

export function payOffered(state: Screen) {
  return Boolean(state.signed && state.quote && !state.quote.error);
}
