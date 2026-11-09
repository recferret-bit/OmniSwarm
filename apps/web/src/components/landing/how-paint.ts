import { paintDebate } from './how-paint-debate';
import { paintHash } from './how-paint-hash';
import { paintJudge } from './how-paint-judge';
import { paintReview } from './how-paint-review';
import { BEAT_MS, BEATS, beat, mono, SHOWCASE, type HowScene } from './how-scene';
import { fitCanvas, readInk, type Ink } from './ink';

const STAGES = ['REVIEW', 'DEBATE', 'JUDGE', 'HASH'] as const;
const PAINTERS = [paintReview, paintDebate, paintJudge, paintHash] as const;

export function paintHow(
  canvas: HTMLCanvasElement,
  time: number,
  pointerX: number,
  active: number,
  still = false,
  reportHash = '',
) {
  const ctx = fitCanvas(canvas);
  if (!ctx) return;
  const ink = readInk(canvas);
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  const stage = Math.min(STAGES.length - 1, Math.max(0, active));
  const clock = still ? SHOWCASE : time;
  const frame = beat(clock, BEAT_MS, BEATS);
  rail(ctx, width, stage, ink, frame.index, frame.u);
  const scene: HowScene = {
    ctx,
    ink,
    width,
    height,
    time: clock,
    pointerX: Math.max(0, Math.min(1, pointerX)),
    x: 18,
    y: 74,
    w: Math.max(10, width - 36),
    h: Math.max(10, height - 88),
    reportHash,
  };
  ctx.save();
  PAINTERS[stage]?.(scene);
  ctx.restore();
}

function rail(
  ctx: CanvasRenderingContext2D,
  width: number,
  active: number,
  ink: Ink,
  beatIndex: number,
  beatU: number,
) {
  const y = 24;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = ink.seam;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width * 0.08, y);
  ctx.lineTo(width * 0.92, y);
  ctx.stroke();
  STAGES.forEach((label, index) => {
    const x = (width * (index + 1)) / (STAGES.length + 1);
    const on = index === active;
    ctx.globalAlpha = on ? 1 : 0.45;
    ctx.fillStyle = on ? ink.ember : ink.seam;
    ctx.fillRect(x - 16, y - 9, 32, 18);
    ctx.font = mono(ink, 11, 700);
    ctx.fillStyle = on ? ink.onEmber : ink.text;
    ctx.fillText(String(index + 1).padStart(2, '0'), x, y);
    ctx.font = mono(ink, 10, 600);
    ctx.fillStyle = on ? ink.emberText : ink.steel;
    ctx.fillText(label, x, y + 20);
    if (on) ticks(ctx, ink, x, y + 32, beatIndex, beatU);
    ctx.globalAlpha = 1;
  });
}

function ticks(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  x: number,
  y: number,
  beatIndex: number,
  beatU: number,
) {
  const tw = 14;
  const gap = 3;
  const total = BEATS * tw + (BEATS - 1) * gap;
  const start = x - total / 2;
  for (let i = 0; i < BEATS; i += 1) {
    const amount = i < beatIndex ? 1 : i === beatIndex ? beatU : 0;
    const tickX = start + i * (tw + gap);
    ctx.fillStyle = ink.seam;
    ctx.fillRect(tickX, y, tw, 3);
    if (amount > 0) {
      ctx.fillStyle = ink.ember;
      ctx.fillRect(tickX, y, Math.max(2, tw * amount), 3);
    }
  }
}
