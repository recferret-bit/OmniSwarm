import type { Metadata } from 'next';
import { LocalJobs } from '@/components/local/LocalJobs';

export const metadata: Metadata = { title: 'Local review', robots: { index: false } };

export default function LocalPage() {
  return (
    <>
      <h1>Local review</h1>
      <LocalJobs />
    </>
  );
}
