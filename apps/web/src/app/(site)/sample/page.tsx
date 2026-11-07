import type { Metadata } from 'next';
import { SampleReport } from '@/components/report/SampleReport';

export const metadata: Metadata = { title: 'Sample report' };

export default function SamplePage() {
  return (
    <>
      <h1>Sample report</h1>
      <SampleReport />
    </>
  );
}
