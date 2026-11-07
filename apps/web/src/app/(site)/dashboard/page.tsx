import type { Metadata } from 'next';
import { Dashboard } from '@/components/dashboard/Dashboard';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

export default function DashboardPage() {
  return (
    <>
      <h1>Dashboard</h1>
      <Dashboard />
    </>
  );
}
