'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { api } from '@/lib/api/client';
import type { ReportIndexResponse } from '@/lib/api/schema.gen';
import { Button } from '../ui/Button';
import { buildReviewPost, postLength, X_POST_LIMIT, xIntentUrl } from '@/lib/share/x-post';

export interface ShareOnXProps {
  requestId: string;
  incomplete?: boolean;
  /** Test seam: the report index without a request. */
  index?: ReportIndexResponse | null;
}

/** An absolute https link to the report page, or null where the page is not on https (a local dev stack). */
function reportLink(index: ReportIndexResponse | null, requestId: string): string | null {
  const candidates = [index?.reportUrl, typeof window === 'undefined' ? null : `${window.location.origin}/r/${requestId}`];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate, typeof window === 'undefined' ? undefined : window.location.origin);
      if (parsed.protocol === 'https:') return parsed.toString();
    } catch { /* next candidate */ }
  }
  return null;
}

/**
 * Share a finished review on X. The post is a preview the person edits; "Post on X" opens x.com's compose
 * window in a new tab with it filled in. OmniSwarm holds no X credentials and posts nothing itself.
 */
export function ShareOnX({ requestId, incomplete, index: given }: ShareOnXProps) {
  const fieldId = useId();
  const [fetched, setFetched] = useState<ReportIndexResponse | null>(null);
  const index = given ?? fetched;
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (given !== undefined) return undefined;
    let live = true;
    api.getReport(requestId).then((value) => { if (live) setFetched(value); }, () => { if (live) setFetched(null); });
    return () => { live = false; };
  }, [given, requestId]);

  const link = reportLink(index, requestId);
  const suggested = useMemo(() => buildReviewPost({
    repo: index?.repo,
    maxSeverity: index?.maxSeverity,
    passed: index?.check?.passed,
    total: index?.check?.total,
    incomplete,
  }), [index, incomplete]);
  const text = draft ?? suggested;
  const length = postLength(text, link !== null);
  const over = length > X_POST_LIMIT;
  const href = xIntentUrl(text, link);

  return (
    <section className="share-x" aria-labelledby={`${fieldId}-title`}>
      <h3 id={`${fieldId}-title`} className="panel__title">Share on X</h3>
      <p className="muted">
        Opens X with this post ready to send. You edit and post it there; OmniSwarm posts nothing and keeps no X login.
        Only the counts above are included. If the repository is private, check the post before you send it.
      </p>
      <label className="field__label" htmlFor={fieldId}>Post</label>
      <textarea
        id={fieldId}
        className="field__input share-x__text"
        rows={4}
        value={text}
        onChange={(event) => setDraft(event.target.value)}
        aria-describedby={`${fieldId}-count`}
      />
      <p id={`${fieldId}-count`} className={over ? 'share-x__count share-x__count--over' : 'share-x__count muted'}>
        {length} / {X_POST_LIMIT}{link ? ' (the report link counts as 23)' : ''}{over ? ' · too long for X' : ''}
      </p>
      <div className="share-x__actions">
        {href && !over && text.trim() ? (
          <a className="button button--primary" href={href} target="_blank" rel="noopener noreferrer">Post on X</a>
        ) : (
          <Button disabled>Post on X</Button>
        )}
        {draft !== null && draft !== suggested ? <Button variant="ghost" onClick={() => setDraft(null)}>Reset text</Button> : null}
      </div>
      {!link ? <p className="muted">This site is not on https, so the post has no report link.</p> : null}
    </section>
  );
}
