import type { Metadata } from 'next';
import { MyRequests } from '@/components/request/MyRequests';

export const metadata: Metadata = { title: 'My requests', robots: { index: false } };

export default function MyRequestsPage() {
  return (
    <>
      <h1>My requests</h1>
      <MyRequests />
    </>
  );
}
