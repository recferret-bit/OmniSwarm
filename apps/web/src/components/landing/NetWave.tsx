'use client';

import { useEffect, useRef } from 'react';
import { paintNet } from './paint-net';

export function NetWave() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const land = canvas?.closest('.land');
    if (!canvas || !(land instanceof HTMLElement)) return undefined;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduce = media?.matches ?? false;
    let frame = 0;
    let live = true;
    let burst = 0;
    let localX = 0;
    let localY = 0;
    const paint = (time: number) => paintNet(canvas, land, reduce ? burst : time, burst, localX, localY);
    const tick = (time: number) => {
      if (!live) return;
      paint(time);
      if (!reduce && time - burst < 980) frame = requestAnimationFrame(tick);
      else frame = 0;
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const node = event.target;
      if (node instanceof Element && node.closest('a, button, input, textarea, select, label, summary, [role="tab"], [role="button"], form')) return;
      const rect = land.getBoundingClientRect();
      localX = event.clientX - rect.left;
      localY = event.clientY - rect.top;
      burst = performance.now();
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    land.addEventListener('pointerdown', onDown);
    const theme = new MutationObserver(() => { if (burst) paint(performance.now()); });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      theme.disconnect();
      land.removeEventListener('pointerdown', onDown);
    };
  }, []);
  return (
    <>
      <canvas ref={ref} className="land-net" aria-hidden="true" />
      <div className="land-fade" aria-hidden="true" />
    </>
  );
}
