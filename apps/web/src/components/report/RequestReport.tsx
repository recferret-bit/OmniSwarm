'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { toAppError, messageFor } from '@/lib/api/errors';
import type { ReportIndexResponse } from '@/lib/api/schema.gen';
import { reportFiles, verifyReport } from '@/lib/report/verify';
import { Alert } from '../ui/Alert';
import { Panel } from '../ui/Panel';
import { HashBadge } from './HashBadge';
import { ReportContents } from './ReportContents';
import { ReportFrame } from './ReportFrame';
import { useVerification } from './useVerification';

export function RequestReport({ id }: { id: string }) {
  const [index, setIndex] = useState<ReportIndexResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.getReport(id).then((value) => { if (live) setIndex(value); }, (reason: unknown) => { if (live) setError(messageFor(toAppError(reason).code)); });
    return () => { live = false; };
  }, [id]);

  const run = useCallback(
    () => (index && index.reportUrl
      ? verifyReport(reportFiles({ reportUrl: index.reportUrl, generalReviewUrl: index.generalReviewUrl }), index.reportSha256)
      : Promise.reject(new Error('the report index has no report URL'))),
    [index],
  );
  const { state, recheck } = useVerification(index ? run : null);

  if (error) return <Alert>{error}</Alert>;
  if (!index) return <p role="status">Loading the report…</p>;
  if (!index.reportUrl) return <Alert>This request has no published report.</Alert>;
  return (
    <>
      <Panel id="hash-check" title="Report hash">
        <HashBadge state={state} onRecheck={recheck} />
      </Panel>
      {index.repo || index.maxSeverity || index.check ? (
        <Panel id="summary" title="Summary">
          <dl className="report-summary">
            {index.repo ? <><dt>Repository</dt><dd>{index.repo}</dd></> : null}
            {index.maxSeverity ? <><dt>Highest severity</dt><dd>{index.maxSeverity}</dd></> : null}
            {index.check ? <><dt>Findings that passed the cross-check</dt><dd>{index.check.passed} of {index.check.total}</dd></> : null}
          </dl>
        </Panel>
      ) : null}
      <Panel id="sections" title="Sections">
        {state.phase === 'done' ? <ReportContents findings={state.result.findings} general={state.result.general} reviewers={index.reviewers} /> : <p>Loading the report…</p>}
      </Panel>
      {index.stage1Url || index.adviceUrl || index.pipelineUrl || (index.roundUrls && index.roundUrls.length > 0) ? (
        <Panel id="pipeline-artifacts" title="Pipeline artifacts">
          <ul>
            {index.stage1Url ? <li><a href={index.stage1Url} target="_blank" rel="noreferrer">Stage 1 report (no debates)</a></li> : null}
            {index.adviceUrl ? <li><a href={index.adviceUrl} target="_blank" rel="noreferrer">Frontier orchestrator advice</a></li> : null}
            {index.pipelineUrl ? <li><a href={index.pipelineUrl} target="_blank" rel="noreferrer">Pipeline progress JSON</a></li> : null}
            {(index.roundUrls ?? []).map((url, idx) => (
              <li key={url}><a href={url} target="_blank" rel="noreferrer">Debate round {idx + 1} report</a></li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <Panel id="frame" title="Published report">
        <ReportFrame src={index.reportUrl} title="OmniSwarm report" />
      </Panel>
    </>
  );
}
