// "Share on X": builds the text of a post about a finished review and the X web-intent link that opens it.
// Nothing is posted by OmniSwarm: no X account is linked and no token is held. The link opens x.com in a new
// tab with the text filled in, and the person reads, edits and posts it there themselves.

/** X counts every link as 23 characters, whatever its length. */
export const X_LINK_LENGTH = 23;
export const X_POST_LIMIT = 280;

export type MaxSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'none';

export interface ReviewPostInput {
  repo?: string | null;
  maxSeverity?: MaxSeverity | null;
  /** Findings that held up under the cross-check, and findings checked in all. */
  passed?: number | null;
  total?: number | null;
  /** The report was published with report-health state incomplete. */
  incomplete?: boolean;
}

const SEVERITY: Record<MaxSeverity, string> = {
  critical: 'highest severity: critical',
  high: 'highest severity: high',
  medium: 'highest severity: medium',
  low: 'highest severity: low',
  info: 'informational findings only',
  none: 'no findings',
};

function count(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The default post text. Counts and severity only: a finding's title, file or code is never put in a post. */
export function buildReviewPost(input: ReviewPostInput): string {
  const subject = input.repo ? `my repo ${input.repo}` : 'my repo';
  const lines = [`OmniSwarm reviewed ${subject} with a panel of AI models and published the report.`];
  const facts: string[] = [];
  if (input.maxSeverity) facts.push(SEVERITY[input.maxSeverity]);
  if (count(input.total) && count(input.passed)) facts.push(`${input.passed} of ${input.total} findings held up under cross-check`);
  if (facts.length) lines.push(`${facts.join(', ')}.`);
  // A partial run is not a clean bill: say so in the post as in the report.
  if (input.incomplete) lines.push('The run was incomplete, so zero findings is not a clean audit.');
  return lines.join(' ');
}

/** Characters X will count: the text plus a 23-character link and its separator. */
export function postLength(text: string, hasLink: boolean): number {
  return [...text].length + (hasLink ? X_LINK_LENGTH + 1 : 0);
}

/** The x.com compose link, or null when the link is not https (never put a javascript: or http link in a post). */
export function xIntentUrl(text: string, link?: string | null): string | null {
  const params = new URLSearchParams({ text });
  if (link) {
    let parsed: URL;
    try { parsed = new URL(link); } catch { return null; }
    if (parsed.protocol !== 'https:') return null;
    params.set('url', parsed.toString());
  }
  return `https://x.com/intent/post?${params.toString()}`;
}
