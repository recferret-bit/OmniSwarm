'use client';

import { useCallback } from 'react';
import { compareHash, fetchJson, loadReport } from '@/lib/report/verify';
import { Panel } from '../ui/Panel';
import { HashBadge } from './HashBadge';
import { ReportContents } from './ReportContents';
import { ReportStill } from './ReportStill';
import { useVerification } from './useVerification';
import './report-still.css';

// The bundled sample (public/sample): a published engine report and a recorded
// hash. The badge is labelled as a sample.
const SAMPLE = {
  report: '/sample/report.html',
  findingsUrl: '/sample/findings-and-scores.json',
  generalUrl: '/sample/general-review.json',
  recordedHash: '/sample/report-hash.json',
};

export function SampleReport() {
  const run = useCallback(async () => {
    const [report, recorded] = await Promise.all([loadReport(SAMPLE), fetchJson(SAMPLE.recordedHash)]);
    return compareHash(report, (recorded as { reportSha256?: string }).reportSha256);
  }, []);
  const { state } = useVerification(run);

  return (
    <>
      <Panel id="sample-hash-check" title="Report hash">
        <p>No sign-in is required to read a report.</p>
        <HashBadge state={state} sample />
      </Panel>
      <Panel id="sample-sections" title="Sections">
        {state.phase === 'done' ? <ReportContents findings={state.result.findings} general={state.result.general} /> : <p>Loading the report…</p>}
      </Panel>
      <Panel id="sample-frame" title="Published report">
        <ReportStill linked={false} />
      </Panel>
    </>
  );
}
