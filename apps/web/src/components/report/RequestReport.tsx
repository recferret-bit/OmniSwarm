'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { toAppError, messageFor } from '@/lib/api/errors';
import type { ReportIndexResponse } from '@/lib/api/schema.gen';
import { reportFiles, verifyReport } from '@/lib/report/verify';
import { useRequestFlow } from '@/stores/request-flow';
import { Alert } from '../ui/Alert';
import { Panel } from '../ui/Panel';
import { AttestationBadge } from './AttestationBadge';
import { ReportContents } from './ReportContents';
import { ReportFrame } from './ReportFrame';
import { useVerification } from './useVerification';

// The request hash keys the on-chain attestation. The hash this browser signed
// wins over the one the API reports, so a lying index cannot pick the record.
function useRequestHash(id: string, index: ReportIndexResponse | null): string | null {
  const signed = useRequestFlow((state) => (state.request?.requestId === id ? state.request.requestHash : null));
  return signed ?? index?.attestation?.requestHash ?? null;
}

export function RequestReport({ id, attestTx }: { id: string; attestTx?: string }) {
  const [index, setIndex] = useState<ReportIndexResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestHash = useRequestHash(id, index);

  useEffect(() => {
    let live = true;
    api.getReport(id).then((value) => { if (live) setIndex(value); }, (reason: unknown) => { if (live) setError(messageFor(toAppError(reason).code)); });
    return () => { live = false; };
  }, [id]);

  const run = useCallback(
    () => (index && requestHash ? verifyReport(reportFiles(index), requestHash) : Promise.reject(new Error('the report index has no request hash'))),
    [index, requestHash],
  );
  const { state, recheck } = useVerification(index ? run : null);

  if (error) return <Alert>{error}</Alert>;
  if (!index) return <p role="status">Loading the report…</p>;
  return (
    <>
      <Panel id="attestation" title="Attestation">
        <AttestationBadge state={state} attestTx={attestTx} onRecheck={recheck} />
      </Panel>
      <Panel id="sections" title="Sections">
        {state.phase === 'done' ? <ReportContents findings={state.result.findings} general={state.result.general} reviewers={index.reviewers} /> : <p>Loading the report…</p>}
      </Panel>
      <Panel id="frame" title="Published report">
        <ReportFrame src={index.reportUrl} title="OmniSwarm report" />
      </Panel>
    </>
  );
}
