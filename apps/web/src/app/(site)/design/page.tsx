import type { Metadata } from 'next';
import { DesignIndex } from '@/design/DesignIndex';

export const metadata: Metadata = { title: 'Design system' };

export default function DesignPage() {
  return <DesignIndex />;
}
