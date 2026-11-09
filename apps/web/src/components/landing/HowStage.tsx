'use client';

import { useEffect, useRef } from 'react';
import { readSampleHash } from '@/components/report/sample-hash';
import { paintHow } from './how-paint';

export function HowStage({ active }: { active: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const aim = useRef(0.5);
  const hash = useRef('');
  useEffect(() => {
    let live = true;
    void readSampleHash().then((value) => { if (live) hash.current = value; });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduce = media?.matches ?? false;
    const started = performance.now();
    let frame = 0;
    let live = true;
    const paint = (time: number) => {
      paintHow(canvas, reduce ? 0 : time - started, aim.current, active, reduce, hash.current);
    };
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width) aim.current = (event.clientX - rect.left) / rect.width;
      if (reduce) paint(performance.now());
    };
    canvas.addEventListener('pointermove', onMove);
    const tick = (time: number) => {
      if (!live) return;
      paint(time);
      if (!reduce && !document.hidden) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const onVis = () => {
      if (!document.hidden && live && !reduce) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const theme = new MutationObserver(() => paint(performance.now()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      theme.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [active]);
  const picture = ['independent review', 'anonymized debate', 'judgement', 'NEAR attestation'][active] ?? 'review stage';
  return <canvas ref={ref} className="how-stage" role="img" aria-label={`Animated picture of ${picture}`} />;
}
