import type { Metadata } from 'next';
import { Foundations } from '@/design/Foundations';

export const metadata: Metadata = { title: 'Foundations' };

export default function FoundationsPage() {
  return <Foundations />;
}
