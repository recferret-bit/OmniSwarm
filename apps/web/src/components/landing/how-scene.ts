import { drawOrchestrator } from './draw-marks';
import type { Ink } from './ink';
import { ORCHESTRATOR } from './model-marks';

export const BEAT_MS = 2800;
export const BEATS = 4;
export const SHOWCASE = BEAT_MS * 3 + BEAT_MS * 0.92;

export interface HowScene {
  ctx: CanvasRenderingContext2D;
  ink: Ink;
  width: number;
  height: number;
  time: number;
  pointerX: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Full report_sha256. Empty until the browser has read the public attestation. */
  reportHash: string;
}

export interface Box { x: number; y: number; w: number; h: number }

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function easeOut(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

export function beat(time: number, ms: number, count: number): { index: number; u: number; age: number } {
  const span = ms * Math.max(1, count);
  const wrapped = ((time % span) + span) % span;
  const index = Math.min(count - 1, Math.floor(wrapped / ms));
  const age = wrapped - index * ms;
  return { index, u: age / ms, age };
}

export function mono(ink: Ink, px: number, weight = 600): string {
  return `${weight} ${px}px ${ink.mono}`;
}

export function clipText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return '';
  if (ctx.measureText(text).width <= max) return text;
  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}…`).width > max) next = next.slice(0, -1);
  return `${next}…`;
}

export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  stroke: string,
  fill?: string,
) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
}

export function meter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  amount: number,
  fill: string,
  track: string,
) {
  ctx.fillStyle = track;
  ctx.fillRect(x, y, w, h);
  const next = clamp01(amount);
  if (next <= 0) return;
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, Math.max(2, w * next), h);
}

export function caption(scene: HowScene, kicker: string, title: string, aside: string): Box {
  const { ctx, ink, x, y, w } = scene;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = mono(ink, 11, 600);
  ctx.fillStyle = ink.emberText;
  ctx.fillText(kicker, x, y + 8);
  const kickerW = ctx.measureText(kicker).width;
  ctx.textAlign = 'right';
  ctx.fillStyle = ink.steel;
  const asideText = clipText(ctx, aside, w * 0.38);
  const asideW = ctx.measureText(asideText).width;
  ctx.fillText(asideText, x + w, y + 8);
  ctx.textAlign = 'left';
  ctx.font = mono(ink, 13, 600);
  ctx.fillStyle = ink.text;
  const titleMax = Math.max(48, w - kickerW - asideW - 28);
  ctx.fillText(clipText(ctx, title, titleMax), x + kickerW + 12, y + 8);
  return { x, y: y + 26, w, h: Math.max(10, scene.h - 26) };
}

export function orchAt(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  x: number,
  y: number,
  time: number,
  scale: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  drawOrchestrator(ctx, 0, 0, ORCHESTRATOR, ink, time);
  ctx.restore();
}
