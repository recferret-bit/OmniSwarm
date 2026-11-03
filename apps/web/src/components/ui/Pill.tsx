import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}
