'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import type { ReportIndexResponse } from '@/lib/api/schema.gen';
import { reportFiles, verifyReport } from '@/lib/report/verify';
import { useRequestFlow } from '@/stores/request-flow';
import { Receipt, type ReceiptBody } from './Receipt';
import { useVerification } from './useVerification';

function asReceipt(value: ReportIndexResponse['receipt']): ReceiptBody | null {
  return value ?? null;
}

// No published files: leave match undefined so the API flag can show. A published
// report with no request hash cannot be checked. A running check is pending.
// match and mismatch come from the browser. Anything else is unavailable, and
// the API flag must not stand in for that result.
export function receiptMatch(input: {
  reportUrl?: string;
  requestHash: string | null;
  phase: 'idle' | 'checking' | 'error' | 'done';
  verifyState?: 'match' | 'mismatch' | 'unattested';
}): boolean | 'pending' | 'unavailable' | undefined {
  if (!input.reportUrl) return undefined;
  if (!input.requestHash || input.phase === 'idle') return 'unavailable';
  if (input.phase === 'checking') return 'pending';
  if (input.verifyState === 'match') return true;
  if (input.verifyState === 'mismatch') return false;
  return 'unavailable';
}

// The receipt on /r/<id>. Match comes from the in-browser attestation check
// (W15-10) when the published files can be hashed, and from the API otherwise.
export function ReceiptSection({ id }: { id: string }) {
  const [index, setIndex] = useState<ReportIndexResponse | null>(null);
  const signed = useRequestFlow((state) => (state.request?.requestId === id ? state.request.requestHash : null));

  useEffect(() => {
    let live = true;
    api.getReport(id).then(
      (value) => { if (live) setIndex(value); },
      () => { if (live) setIndex(null); },
    );
    return () => { live = false; };
  }, [id]);

  const requestHash = signed ?? index?.attestation?.requestHash ?? null;
  const reportUrl = index?.reportUrl;
  const run = useCallback(
    () => (index && reportUrl && requestHash
      ? verifyReport(reportFiles({ reportUrl, generalReviewUrl: index.generalReviewUrl }), requestHash, { apiAttestation: index.attestation ?? null })
      : Promise.reject(new Error('the report index has no request hash'))),
    [index, reportUrl, requestHash],
  );
  const { state } = useVerification(reportUrl && requestHash ? run : null);
  const receipt = index ? asReceipt(index.receipt) : null;
  if (!receipt) return null;
  const match = receiptMatch({
    reportUrl, requestHash,
    phase: reportUrl && requestHash ? state.phase : 'idle',
    verifyState: state.phase === 'done' ? state.result.state : undefined,
  });
  return <Receipt receipt={receipt} match={match} />;
}
