import { fitCanvas, readInk, type Pointer } from './ink';
import { drawSource, drawSwarm, sourceBox } from './paint-swarm';

export type { Pointer };

export function paintHero(canvas: HTMLCanvasElement, time: number, pointer: Pointer, crossed: Set<number>) {
  const ctx = fitCanvas(canvas);
  if (!ctx) return;
  const ink = readInk(canvas);
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, width, height);
  const box = sourceBox(width, height);
  drawSource(ctx, box, ink, pointer, width, height);
  drawSwarm(ctx, box, width, height, time, pointer, ink, crossed);
}
