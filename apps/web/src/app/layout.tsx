import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { LiveRegion } from '@/components/ui/LiveRegion';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'OmniSwarm — AI code review attested on NEAR', template: '%s · OmniSwarm' },
  description: 'A swarm of AI reviewers argues over your public GitHub repository, then the report hash is attested on NEAR.',
  icons: { icon: '/favicon.svg' },
  openGraph: { title: 'OmniSwarm', description: 'Multi-model security review with an on-chain attestation.', type: 'website' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ffffff' }, { media: '(prefers-color-scheme: dark)', color: '#111318' }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <LiveRegion />
      </body>
    </html>
  );
}
