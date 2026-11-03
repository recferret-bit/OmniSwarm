import type { ReviewerProgress } from '@/stores/request-status';

export const PASSES = 2;

export function ReviewerRows({ rows }: { rows: ReviewerProgress[] }) {
  if (!rows.length) return null;
  return (
    <ul className="reviewers" aria-label="Reviewers">
      {rows.map((row) => (
        <li key={row.reviewer} className="reviewers__row">
          <span className="reviewers__id">{row.reviewer}</span>
          <span className="reviewers__pass">pass {row.pass}/{PASSES}</span>
        </li>
      ))}
    </ul>
  );
}
