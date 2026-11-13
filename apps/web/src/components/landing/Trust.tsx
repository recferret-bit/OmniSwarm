'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { HealthResponse } from '@/lib/api/schema.gen';
import { env } from '@/lib/env';


function serviceLabel(health: HealthResponse | null): string {
  if (env.apiMock) return 'Service: mock (dev)';
  if (!health) return 'Service: checking';
  return `Service: ${health.ok ? 'up' : 'degraded'} · ${health.queueDepth} queued · ${health.workers} ${health.workers === 1 ? 'worker' : 'workers'}`;
}

export function Trust() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  useEffect(() => {
    let live = true;
    api.health().then((value) => { if (live) setHealth(value); }, () => undefined);
    return () => { live = false; };
  }, []);

  return (
    <section className="land-section" id="trust" aria-labelledby="trust-title">
      <div className="container-wide">
        <header className="land-head">
          <p className="land-kicker"><i>06</i><span className="eyebrow">Trust</span></p>
          <h2 id="trust-title" className="h2">What you can rely on</h2>
        </header>
        <ul className="trust__list">
          <li>Reviews run in an offline sandbox: no network, no exploits, no probing of deployed contracts.</li>
          <li>Instructions found in your repository are treated as data, never as commands.</li>
          <li>Your NEAR AI key is stored encrypted, goes only to the reviewer process for that job, and appears in a report only as a fingerprint.</li>
          <li>The report hash is public. Your browser recomputes it from the published files, so an edited report shows as a mismatch.</li>
          <li>Model agreement does not certify security. The report says what was checked and what was not.</li>
        </ul>
        <p className="trust__service" data-testid="service-status">{serviceLabel(health)}</p>
      </div>
    </section>
  );
}
