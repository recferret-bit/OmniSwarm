'use client';

import { useEffect, useRef } from 'react';
import { paintHow } from './how-paint';

export function HowStage({ active }: { active: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const aim = useRef(0.2);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduce = media?.matches ?? false;
    let frame = 0;
    let live = true;
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width) aim.current = (event.clientX - rect.left) / rect.width;
    };
    canvas.addEventListener('pointermove', onMove);
    const tick = (time: number) => {
      if (!live) return;
      paintHow(canvas, reduce ? 400 : time, aim.current, active);
      if (!reduce && !document.hidden) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', onMove);
    };
  }, [active]);
  return <canvas ref={ref} className="how-stage" aria-hidden="true" />;
}
