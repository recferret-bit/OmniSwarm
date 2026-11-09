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
  const verified = state.phase === 'done'
    ? state.result.state === 'match' ? true : state.result.state === 'mismatch' ? false : undefined
    : undefined;
  return <Receipt receipt={receipt} match={verified} />;
}
