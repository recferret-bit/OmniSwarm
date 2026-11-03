import type { ReactNode } from 'react';

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value}</dd>
    </div>
  );
}

export function StatGrid({ children, label }: { children: ReactNode; label?: string }) {
  return <dl className="stat-grid" aria-label={label}>{children}</dl>;
}
