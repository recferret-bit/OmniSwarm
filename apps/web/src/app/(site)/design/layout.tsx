import type { ReactNode } from 'react';
import '@/design/css/docs.css';

export default function DesignLayout({ children }: { children: ReactNode }) {
  return <div className="bleed">{children}</div>;
}
