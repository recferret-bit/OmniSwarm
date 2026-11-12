'use client';

import { useEffect, useState } from 'react';
import { api, type AccountKeyView } from '@/lib/api/client';
import { Panel } from '../ui/Panel';
import { AccountKeyPanel } from './AccountKeyPanel';

/** A signed-in account's own provider keys (every provider whose catalog entry takes one). Hidden when signed out. */
export function AccountKeys() {
  const [views, setViews] = useState<AccountKeyView[] | null>(null);
  useEffect(() => {
    let live = true;
    void api.listAccountKeys().then(({ providers }) => { if (live) setViews(providers); }).catch(() => { if (live) setViews(null); });
    return () => { live = false; };
  }, []);
  if (!views?.length) return null;
  const replace = (next: AccountKeyView) => setViews((current) => (current ?? []).map((view) => (view.provider === next.provider ? next : view)));
  return (
    <Panel title="Your model keys">
      {views.map((view) => (
        <div key={view.provider}>
          <AccountKeyPanel view={view} onChange={replace} />
          {!view.signedRequests ? <p className="muted">This service does not take wallet requests on your own {view.label} key yet; the dashboard can use it.</p> : null}
        </div>
      ))}
    </Panel>
  );
}
