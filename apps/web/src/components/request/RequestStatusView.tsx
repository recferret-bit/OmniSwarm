'use client';

import { useEffect, useState } from 'react';
import { requestReportHref } from '@/lib/api/client';
import { messageFor } from '@/lib/api/errors';
import { phasesSeen, reviewerRows, selectRequestView, useRequestStatus } from '@/stores/request-status';
import { selectAnnounce, useUi } from '@/stores/ui';
import { RequestReport } from '../report/RequestReport';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { Pill } from '../ui/Pill';
import { ReviewerRows } from './ReviewerRows';
import { TerminalState } from './TerminalState';
import { statusLabel, Timeline } from './Timeline';

export function RequestStatusView({ id }: { id: string }) {
  const watch = useRequestStatus((state) => state.watch);
  const view = useRequestStatus(selectRequestView(id));
  const announce = useUi(selectAnnounce);
  const [open, setOpen] = useState(false);
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
        <Timeline status={current.status} phases={phasesSeen(view.events)} />
        {current.progress?.percent !== undefined ? <progress max={100} value={current.progress.percent} aria-label="Review progress" /> : null}
        <ReviewerRows rows={reviewerRows(view.events)} />
        <TerminalState status={current} />
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
