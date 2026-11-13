import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { IBM_Plex_Mono, Sora, Source_Sans_3 } from 'next/font/google';
import { LiveRegion } from '@/components/ui/LiveRegion';
import { Providers } from './providers';
import './globals.css';

const display = Sora({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display', display: 'swap' });
const body = Source_Sans_3({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' });

function requestOrigin(headerList: Headers): URL {
  const forwardedHost = headerList.get('x-forwarded-host') ?? headerList.get('host') ?? 'omniswarm.localhost:18480';
  const host = forwardedHost.split(',')[0]?.trim() || 'omniswarm.localhost:18480';
  const forwardedProto = headerList.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.includes('.localhost');
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : local ? 'http' : 'https';
  return new URL(`${proto}://${host}`);
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: requestOrigin(await headers()),
    title: { default: 'OmniSwarm — Multi-model AI code review', template: '%s · OmniSwarm' },
    description: 'A swarm of AI reviewers argues over your public GitHub repository, then you get a report whose hash you can verify in your browser.',
    icons: { icon: '/favicon.svg' },
    openGraph: {
      title: 'OmniSwarm',
      description: 'Multi-model security review on your own NEAR AI key, with a report hash you can verify.',
      type: 'website',
      images: [{ url: '/sample/preview.jpg', width: 1100, height: 720, alt: 'OmniSwarm sample security report' }],
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#090B10',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <LiveRegion />
      </body>
    </html>
  );
}
