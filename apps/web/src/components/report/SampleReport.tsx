'use client';

import { useCallback } from 'react';
import { parseAttestation } from '@/lib/near/rpc';
import { compareAttestation, fetchJson, loadReport } from '@/lib/report/verify';
import { Panel } from '../ui/Panel';
import { AttestationBadge } from './AttestationBadge';
import { ReportContents } from './ReportContents';
import { ReportFrame } from './ReportFrame';
import { useVerification } from './useVerification';

// The bundled sample (public/sample): a published engine report and a recorded
// attestation fixture. The badge is labelled as a sample and never reads NEAR.
const SAMPLE = {
  report: '/sample/report.html',
  findingsUrl: '/sample/findings-and-scores.json',
  generalUrl: '/sample/general-review.json',
  attestation: '/sample/attestation.json',
};

export function SampleReport() {
  const run = useCallback(async () => {
    const [report, recorded] = await Promise.all([loadReport(SAMPLE), fetchJson(SAMPLE.attestation)]);
    return compareAttestation(report, parseAttestation(recorded));
  }, []);
  const { state } = useVerification(run);

  return (
    <>
      <Panel id="sample-attestation" title="Attestation">
        <p>No wallet is required to read a report.</p>
        <AttestationBadge state={state} sample />
      </Panel>
      <Panel id="sample-sections" title="Sections">
        {state.phase === 'done' ? <ReportContents findings={state.result.findings} general={state.result.general} /> : <p>Loading the report…</p>}
      </Panel>
      <Panel id="sample-frame" title="Published report">
        <ReportFrame src={SAMPLE.report} title="Sample OmniSwarm report" />
      </Panel>
    </>
  );
}
