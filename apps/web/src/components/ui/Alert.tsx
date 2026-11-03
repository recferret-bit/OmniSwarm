import type { ReactNode } from 'react';

export function Alert({ tone = 'bad', children, action }: { tone?: 'bad' | 'warn' | 'info'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      <p className="alert__text">{children}</p>
      {action ? <div className="alert__action">{action}</div> : null}
    </div>
  );
}
