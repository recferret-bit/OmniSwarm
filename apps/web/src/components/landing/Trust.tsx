'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { HealthResponse } from '@/lib/api/schema.gen';
import { env } from '@/lib/env';
import { Panel } from '../ui/Panel';

function chainLabel(health: HealthResponse | null): string {
  if (env.apiMock) return 'Chain: mock (dev)';
  const network = health?.network ?? env.network;
  return `Chain: NEAR ${network}${health && !health.chain.rpc ? ' (RPC unavailable)' : ''}`;
}

export function Trust() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  useEffect(() => {
    let live = true;
    api.health().then((value) => { if (live) setHealth(value); }, () => undefined);
    return () => { live = false; };
  }, []);

  return (
    <Panel id="trust" title="What you can rely on">
      <ul className="trust__list">
        <li>Reviews run in an offline sandbox: no network, no exploits, no probing of deployed contracts.</li>
        <li>Instructions found in your repository are treated as data, never as commands.</li>
        <li>The operator key is a function-call key limited to the registry&apos;s attest, refund and mark-running methods; it cannot move NEAR.</li>
        <li>Model agreement does not certify security. The report says what was checked and what was not.</li>
      </ul>
      <p className="trust__chain" data-testid="chain-status">
        {chainLabel(health)} · contract <code>{env.contractId}</code>
      </p>
    </Panel>
  );
}
