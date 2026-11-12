'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, requestReportHref } from '@/lib/api/client';
import { messageFor } from '@/lib/api/errors';
import { phasesSeen, reviewerRows, selectRequestView, useRequestStatus } from '@/stores/request-status';
import { selectAnnounce, useUi } from '@/stores/ui';
import { ReceiptSection } from '../report/ReceiptSection';
import { RequestReport } from '../report/RequestReport';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { Pill } from '../ui/Pill';
import { PipelinePanel } from './PipelinePanel';
import { ProgressPanel } from './ProgressPanel';
import { ReviewerRows } from './ReviewerRows';
import { ShareOnX } from './ShareOnX';
import './share-x.css';
import { TerminalState } from './TerminalState';
import { statusLabel, Timeline } from './Timeline';

export function RequestStatusView({ id }: { id: string }) {
  const watch = useRequestStatus((state) => state.watch);
  const view = useRequestStatus(selectRequestView(id));
  const announce = useUi(selectAnnounce);
  const [open, setOpen] = useState(false);
  const [queuedNext, setQueuedNext] = useState<{ id: string; kind: 'advise' | 'debate' } | null>(null);
  const status = view.status?.status;

  useEffect(() => watch(id), [id, watch]);
  useEffect(() => { if (status) announce(`Status: ${statusLabel(status)}`); }, [status, announce]);

  if (!view.status) {
    return view.error ? <Alert>{messageFor(view.error)}</Alert> : <p role="status">Loading request…</p>;
  }
  const current = view.status;
  return (
    <>
      <Panel id="status" title={<>Request status <Pill tone={current.status === 'done' ? 'good' : current.status === 'refunded' || current.status === 'failed' ? 'bad' : 'info'}>{statusLabel(current.status)}</Pill></>}>
        {view.mode === 'polling' ? <Alert tone="info">Live updates paused — refreshing every 5 seconds.</Alert> : null}
        {/* With the engine's snapshot the phases and reviewers come from it; otherwise from the events seen since load. */}
        <Timeline status={current.status} phases={current.progress?.detail ? [] : phasesSeen(view.events)} />
        {current.progress?.detail ? <ProgressPanel progress={current.progress} status={current.status} /> : (
          <>
            {current.progress?.percent !== undefined ? <progress max={100} value={current.progress.percent} aria-label="Review progress" /> : null}
            <ReviewerRows rows={reviewerRows(view.events)} />
          </>
        )}
        <TerminalState status={current} />
        <PipelinePanel
          pipeline={current.pipeline}
          incomplete={current.incomplete}
          canContinue={current.status === 'done'}
          onAdvise={async () => {
            const created = await api.adviseRequest(id);
            setQueuedNext({ id: created.requestId, kind: 'advise' });
            announce('Step 2 orchestrator advice queued');
          }}
          onContinue={async (rounds) => {
            const created = await api.continueDebate(id, { rounds });
            setQueuedNext({ id: created.requestId, kind: 'debate' });
            announce('Debate round queued');
          }}
        />
        {queuedNext ? (
          <Alert
            tone="info"
            action={(
              <Link href={`/r/${queuedNext.id}`}>
                {queuedNext.kind === 'advise' ? 'Open advice run' : 'Open debate round'}
              </Link>
            )}
          >
            {queuedNext.kind === 'advise' ? 'Follow-up Step 2 advice queued.' : 'Follow-up debate round queued.'}
          </Alert>
        ) : null}
        {current.status === 'done' || current.status === 'refunded' ? <ReceiptSection id={id} /> : null}
        {current.status === 'done' ? <ShareOnX requestId={id} incomplete={current.incomplete} /> : null}
        {current.status === 'done' ? (
          <p>
            {!open ? <Button onClick={() => setOpen(true)}>Open report</Button> : null}
            {' '}
            <a href={requestReportHref(id)}>Download PDF</a>
          </p>
        ) : null}
      </Panel>
      {current.status === 'done' && open ? <RequestReport id={id} attestTx={current.attestTx} /> : null}
    </>
  );
}
