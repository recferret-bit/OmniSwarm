'use client';

import { useState } from 'react';
import { AccountChip } from '@/components/wallet/AccountChip';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Pill } from '@/components/ui/Pill';
import { Stat, StatGrid } from '@/components/ui/Stat';
import { ReportTabs } from '@/components/report/ReportTabs';
import { Timeline } from '@/components/request/Timeline';
import type { Status } from '@/lib/api/schema.gen';

export function StoryPanel({ id }: { id: string }) {
  if (id === 'button') return <Buttons />;
  if (id === 'badge') return <Badges />;
  if (id === 'panel') return <Panels />;
  if (id === 'field') return <Fields />;
  if (id === 'choice') return <Choices />;
  if (id === 'switch') return <Switches />;
  if (id === 'alert') return <Alerts />;
  if (id === 'report') return <ReportBits />;
  return <AccountStory />;
}

function Buttons() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <div className="stage-box plate">
        <Button busy={busy}>Review a repo</Button>
      </div>
      <div className="row">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button disabled>Disabled</Button>
        <button type="button" className="btn btn-system">System</button>
        <button type="button" className="btn btn-danger">Stop</button>
        <button type="button" className="btn btn-icon" aria-label="Cite"><span aria-hidden="true">+</span></button>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" aria-pressed={busy} onClick={() => setBusy((v) => !v)}>Toggle busy</button>
    </div>
  );
}

function Badges() {
  return (
    <div className="row">
      <span className="badge badge-ok">Shipped</span>
      <span className="badge badge-later">Later</span>
      <span className="badge badge-act">Cite</span>
      <span className="badge badge-line">src/lib.rs:30</span>
      <span className="badge badge-neutral">Disputed</span>
      <Pill tone="good">Verified</Pill>
      <Pill tone="warn">Incomplete</Pill>
      <Pill tone="bad">Mismatch</Pill>
      <Pill tone="info">Running</Pill>
      <Pill>Queued</Pill>
    </div>
  );
}

function Panels() {
  return (
    <div className="stack">
      <Panel title="Hosted review">
        <StatGrid label="Budget">
          <Stat label="Reviewers" value="3" />
          <Stat label="Passes" value="2" />
          <Stat label="Tool calls" value="40" />
        </StatGrid>
      </Panel>
      <div className="cols-2">
        <div className="card plate"><p className="label">Field plate</p><p>Reviewers read this on the dark field.</p></div>
        <div className="card card-paper os-on-paper plate"><p className="label">Paper plate</p><p>A report excerpt sits on paper.</p></div>
      </div>
    </div>
  );
}

function Fields() {
  return (
    <div className="forms">
      <Field label="GitHub repository" placeholder="owner/name" hint="Public repository you are allowed to review." />
      <Field label="Deployed account" defaultValue="not-an-account" error="Not a NEAR account id" />
      <Field label="Locked seed" defaultValue="Locked after quote" disabled />
    </div>
  );
}

function Choices() {
  return (
    <div className="stack">
      <fieldset>
        <legend className="label">Scope</legend>
        <div className="cols-3">
          <label className="radio-card plate"><input className="sr-only" type="radio" name="scope" defaultChecked /><span className="radio-ind" /><span>Full</span><span className="muted">The whole tree.</span></label>
          <label className="radio-card plate"><input className="sr-only" type="radio" name="scope" /><span className="radio-ind" /><span>Web3</span><span className="muted">Chain roots only.</span></label>
          <label className="radio-card plate"><input className="sr-only" type="radio" name="scope" disabled /><span className="radio-ind" /><span>Sealed</span><span className="muted">Not offered.</span></label>
        </div>
      </fieldset>
      <div className="row">
        <label className="check"><input className="sr-only" type="checkbox" defaultChecked /><span className="check-box" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ color: 'var(--os-on-ember)' }}><path d="M4 12l5 5L20 6" /></svg></span>Let the judge see the cluster</label>
        <label className="check"><input className="sr-only" type="checkbox" /><span className="check-box" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ color: 'var(--os-on-ember)' }}><path d="M4 12l5 5L20 6" /></svg></span>Include scripts</label>
      </div>
    </div>
  );
}

function Switches() {
  const [on, setOn] = useState(true);
  const [weight, setWeight] = useState(40);
  return (
    <div className="stack">
      <div className="setting">
        <div><b id="sw-debate">Anonymized debate</b><span>The default. A later toggle would show names.</span></div>
        <button type="button" className="switch" role="switch" aria-checked={on} aria-labelledby="sw-debate" onClick={() => setOn((v) => !v)}>
          <span className="switch-knob" /><span className="switch-text" />
        </button>
      </div>
      <div className="prio">
        <label htmlFor="weight">Tool budget</label>
        <input id="weight" className="range" type="range" min={0} max={100} value={weight} style={{ ['--val' as string]: `${weight}%` }} onChange={(e) => setWeight(Number(e.target.value))} />
        <output htmlFor="weight">{weight}</output>
      </div>
      <p className="muted">Display only. A hosted review is fixed at 2 passes and 40 calls.</p>
    </div>
  );
}

function Alerts() {
  const [open, setOpen] = useState(true);
  return (
    <div className="stack">
      <Alert tone="info">Quote ready.</Alert>
      <Alert tone="warn">The review cannot run. Nothing was charged.</Alert>
      <Alert tone="bad">The recomputed hash does not match the published hash.</Alert>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Show toast</button>
      {open ? <div className="toast" role="status">Report hash copied. <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(false)}>Dismiss</button></div> : null}
    </div>
  );
}

const STATUSES: Status[] = ['queued', 'running', 'done', 'failed'];

function ReportBits() {
  const [status, setStatus] = useState<Status>('running');
  return (
    <div className="stack">
      <label className="field">
        <span className="field__label" id="status-label">Request status</span>
        <select className="input" aria-labelledby="status-label" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <Timeline status={status} phases={['review', 'debate', 'judge']} />
      <ReportTabs label="Sample sections" tabs={[
        { id: 'findings', label: 'Findings', content: <p>High · src/lib.rs:30 · disputed</p> },
        { id: 'cross', label: 'Cross-check', content: <p>Quotes disagree.</p> },
        { id: 'general', label: 'General review', content: <p>One disputed finding remains.</p> },
      ]} />
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Sample finding shape</caption>
          <thead><tr><th>Severity</th><th>Location</th><th>Status</th></tr></thead>
          <tbody><tr><td>high</td><td className="mono">src/lib.rs:30</td><td>disputed</td></tr></tbody>
        </table>
      </div>
    </div>
  );
}

function AccountStory() {
  const [signedOut, setSignedOut] = useState(false);
  if (signedOut) {
    return <button type="button" className="btn btn-primary" onClick={() => setSignedOut(false)}>Connect NEAR wallet</button>;
  }
  return <AccountChip accountId="auditor.near" onSignOut={() => setSignedOut(true)} />;
}
