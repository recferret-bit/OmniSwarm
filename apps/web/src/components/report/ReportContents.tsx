import { readFindings, readGeneralReview, severityTone } from '@/lib/report/documents';
import { Pill } from '../ui/Pill';
import { ReportTabs } from './ReportTabs';

function GeneralTab({ general }: { general: ReturnType<typeof readGeneralReview> }) {
  return (
    <div>
      {general.riskPosture ? <p>Risk posture: <Pill tone={general.riskPosture === 'high-risk' ? 'bad' : 'info'}>{general.riskPosture}</Pill></p> : null}
      <p className="prewrap">{general.summary || 'No executive summary in this report.'}</p>
      {general.disclaimer ? <p className="muted">{general.disclaimer}</p> : null}
    </div>
  );
}

function ReviewersTab({ general, reviewers }: { general: ReturnType<typeof readGeneralReview>; reviewers: string[] }) {
  const rows = general.contributions.length ? general.contributions : reviewers.map((reviewerId) => ({ reviewerId, uniqueConfirmed: 0, refuted: 0, toolCalls: 0 }));
  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">Per-model contributions</caption>
        <thead><tr><th scope="col">Reviewer</th><th scope="col">Confirmed</th><th scope="col">Refuted</th><th scope="col">Tool calls</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.reviewerId}><th scope="row">{row.reviewerId}</th><td>{row.uniqueConfirmed}</td><td>{row.refuted}</td><td>{row.toolCalls}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrossCheckTab({ findings }: { findings: ReturnType<typeof readFindings> }) {
  if (!findings.length) return <p>No findings.</p>;
  return (
    <ul className="findings">
      {findings.map((finding, index) => (
        <li key={`${finding.title}-${index}`}>
          <Pill tone={severityTone(finding.severity)}>{finding.severity || 'unknown'}</Pill> {finding.title}
          <span className="muted"> · {finding.status} · {finding.locations.join(', ')}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReportContents({ findings, general, reviewers = [] }: { findings: unknown; general: unknown; reviewers?: string[] }) {
  const review = readGeneralReview(general);
  const rows = readFindings(findings);
  return (
    <ReportTabs
      label="Report sections"
      tabs={[
        { id: 'general', label: 'General review', content: <GeneralTab general={review} /> },
        { id: 'models', label: 'Per-model reports', content: <ReviewersTab general={review} reviewers={reviewers.length ? reviewers : review.reviewers} /> },
        { id: 'cross', label: 'Cross-check', content: <CrossCheckTab findings={rows} /> },
      ]}
    />
  );
}
