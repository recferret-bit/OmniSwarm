import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RequestStatusView } from '@/components/request/RequestStatusView';

export const metadata: Metadata = { title: 'Review status', robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <>
      <h1>Review request</h1>
      <p className="muted">Request <code>{id}</code></p>
      <RequestStatusView id={id} />
    </>
  );
}
