import { ATTESTED_SHA256 } from './report-doc.ts';

export const HERO = 'A swarm of AI reviewers that argue over your code, then sign the verdict on NEAR';
export const PHASES = ['queued', 'running', 'done'] as const;

export interface Quote {
  repo: string;
  commitSha: string;
  price: string;
  error?: 'private' | 'queue';
  walletReject?: boolean;
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
  signature: string | null;
  publicKey: string | null;
  message: string | null;
  nonce: string | null;
  recipient: string | null;
  paid: boolean;
  rejected: boolean;
  timeline: string[];
  requests: RequestRow[];
  reportSha256: string;
  attestedSha256: string;
  tampered: boolean;
}

export interface SignedPayload {
  requestHash: string;
  signature: string;
  publicKey: string;
  message: string;
  nonce: string;
  recipient: string;
}

export function initialState(): Screen {
  return {
    account: null,
    page: 'home',
    quote: null,
    signed: false,
    requestHash: null,
    signature: null,
    publicKey: null,
    message: null,
    nonce: null,
    recipient: null,
    paid: false,
    rejected: false,
    timeline: [],
    requests: [],
    reportSha256: '',
    attestedSha256: ATTESTED_SHA256,
    tampered: false,
  };
}

export type Action =
  | { type: 'page'; page: Screen['page'] }
  | { type: 'connected'; account: string }
  | { type: 'sign-out' }
  | { type: 'quote'; repo: string; mock?: string }
  | { type: 'signed'; signed: SignedPayload }
  | { type: 'pay'; reject?: boolean }
  | { type: 'advance' }
  | { type: 'hashed'; hash: string }
  | { type: 'tamper' }
  | { type: 'retry' };

function clearSign(state: Screen): Pick<Screen, 'signed' | 'requestHash' | 'signature' | 'publicKey' | 'message' | 'nonce' | 'recipient' | 'paid' | 'rejected' | 'timeline' | 'reportSha256' | 'tampered'> {
  return {
    signed: false, requestHash: null, signature: null, publicKey: null, message: null, nonce: null, recipient: null,
    paid: false, rejected: false, timeline: [], reportSha256: '', tampered: false,
  };
}

export function nextTimeline(timeline: string[]): string[] | null {
  const last = timeline[timeline.length - 1];
  const index = PHASES.indexOf(last as typeof PHASES[number]);
  if (index < 0 || index >= PHASES.length - 1) return null;
  return [...timeline, PHASES[index + 1]];
}

export function reduce(state: Screen, action: Action): Screen {
  if (action.type === 'page') return { ...state, page: action.page };
  if (action.type === 'connected') return { ...state, account: action.account };
  if (action.type === 'sign-out') return { ...initialState(), page: state.page };
  if (action.type === 'quote') {
    const repo = action.repo.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '');
    if (action.mock === 'REPO_PRIVATE' || repo.startsWith('private/')) {
      return { ...state, ...clearSign(state), quote: { repo, commitSha: '', price: '', error: 'private' } };
    }
    if (action.mock === 'QUEUE_FULL') {
      return { ...state, ...clearSign(state), quote: { repo, commitSha: '', price: '', error: 'queue' } };
    }
    return {
      ...state,
      ...clearSign(state),
      quote: {
        repo,
        commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        price: '1 NEAR',
        walletReject: action.mock === 'WALLET_REJECT',
      },
    };
  }
  if (action.type === 'signed') {
    if (!state.quote || state.quote.error || !action.signed.signature || !action.signed.requestHash) return state;
    return { ...state, signed: true, ...action.signed };
  }
  if (action.type === 'retry') return { ...state, rejected: false };
  if (action.type === 'pay') {
    if (!state.signed || !state.signature || state.quote?.error) return state;
    if (action.reject) return { ...state, rejected: true, paid: false, timeline: [] };
    return { ...state, paid: true, rejected: false, timeline: ['queued'] };
  }
  if (action.type === 'advance') {
    const timeline = nextTimeline(state.timeline);
    if (!timeline) return state;
    return { ...state, timeline };
  }
  if (action.type === 'hashed') {
    const row: RequestRow | null = state.quote && !state.quote.error
      ? { id: 'req-1', repo: state.quote.repo, status: 'done', reportSha256: action.hash }
      : null;
    const requests = row ? [row, ...state.requests.filter((item) => item.id !== row.id)] : state.requests;
    return { ...state, reportSha256: action.hash, page: 'report', requests };
  }
  if (action.type === 'tamper') return { ...state, tampered: true, reportSha256: '' };
  return state;
}

export function payOffered(state: Screen) {
  return Boolean(state.signed && state.signature && state.requestHash && state.quote && !state.quote.error);
}
