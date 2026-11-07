'use client';

import { useEffect, useRef } from 'react';
import type { Pointer } from './ink';
import { paintHero } from './paint-hero';
import { paintPipe } from './paint-pipe';

function useFrame(kind: 'hero' | 'pipe') {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduce = media?.matches ?? false;
    const pointer: Pointer = { x: 0.72, y: 0.42, down: false, burst: 0 };
    const crossed = new Set<number>();
    let frame = 0;
    let live = true;
    const at = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointer.x = (event.clientX - rect.left) / rect.width;
      pointer.y = (event.clientY - rect.top) / rect.height;
    };
    const onMove = (event: PointerEvent) => { at(event); if (reduce) paint(performance.now()); };
    const onDown = (event: PointerEvent) => { at(event); pointer.down = true; pointer.burst = performance.now(); paint(performance.now()); };
    const onUp = () => { pointer.down = false; };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onUp);
    const paint = (time: number) => {
      const t = reduce ? 1400 : time;
      if (kind === 'hero') paintHero(canvas, t, pointer, crossed);
      else paintPipe(canvas, t);
    };
    const tick = (time: number) => {
      if (!live) return;
      paint(time);
      if (!reduce && !document.hidden) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const onVis = () => { if (!document.hidden && !reduce) frame = requestAnimationFrame(tick); };
    document.addEventListener('visibilitychange', onVis);
    const theme = new MutationObserver(() => paint(performance.now()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      theme.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onUp);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [kind]);
  return ref;
}

export function HeroCanvas() {
  const ref = useFrame('hero');
  return <canvas ref={ref} className="hero-stage__canvas" aria-hidden="true" />;
}

export function PipeCanvas() {
  const ref = useFrame('pipe');
  return <canvas ref={ref} className="pipe-canvas" aria-hidden="true" />;
}
