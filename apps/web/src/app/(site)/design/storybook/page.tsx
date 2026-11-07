import type { Metadata } from 'next';
import { Storybook } from '@/design/Storybook';
import '@/design/css/storybook.css';

export const metadata: Metadata = { title: 'Storybook' };

export default function StorybookPage() {
  return <Storybook />;
}
