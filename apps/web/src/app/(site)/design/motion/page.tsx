import type { Metadata } from 'next';
import { Motion } from '@/design/Motion';
import '@/design/css/motion.css';

export const metadata: Metadata = { title: 'Motion' };

export default function MotionPage() {
  return <Motion />;
}
