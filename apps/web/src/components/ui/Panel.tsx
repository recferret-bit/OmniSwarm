import type { ReactNode } from 'react';

export function Panel({ id, title, children, className }: { id?: string; title?: ReactNode; children: ReactNode; className?: string }) {
  const headingId = id && title ? `${id}-title` : undefined;
  return (
    <section id={id} className={['panel', className].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      {title ? <h2 id={headingId} className="panel__title">{title}</h2> : null}
      {children}
    </section>
  );
}
