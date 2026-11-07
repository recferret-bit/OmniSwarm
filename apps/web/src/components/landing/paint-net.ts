import { fitCanvas, readInk } from './ink';

const STEP = 56;
const LIFE = 980;

export function paintNet(canvas: HTMLCanvasElement, land: HTMLElement, time: number, burst: number, localX: number, localY: number) {
  const ctx = fitCanvas(canvas);
  if (!ctx) return;
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, width, height);
  const age = burst > 0 ? time - burst : -1;
  if (age < 0 || age >= LIFE) return;
  const ink = readInk(canvas);
  const landRect = land.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const originX = landRect.left - canvasRect.left;
  const originY = landRect.top - canvasRect.top;
  const cx = originX + localX;
  const cy = originY + localY;
  const ring = (age / LIFE) * Math.max(width, height) * 0.72;
  const hot = (pos: number, center: number) => Math.abs(Math.abs(pos - center) - ring) < 20;
  const first = (origin: number) => origin - Math.floor(origin / STEP) * STEP;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ink.ember;
  ctx.globalAlpha = 0.95 * (1 - age / LIFE);
  ctx.beginPath();
  for (let x = first(originX) + 0.5; x <= width; x += STEP) {
    if (!hot(x, cx)) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = first(originY) + 0.5; y <= height; y += STEP) {
    if (!hot(y, cy)) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
  const radius = (age / LIFE) * Math.max(width, height) * 0.42;
  ctx.save();
  ctx.strokeStyle = ink.ember;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.95 * (1 - age / LIFE);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(8, radius), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.4 * (1 - age / LIFE);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(4, radius * 0.62), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  const narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 800px)').matches;
  if (narrow) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createLinearGradient(0, 0, canvas.width, 0);
  mask.addColorStop(0, 'rgba(0, 0, 0, 0)');
  mask.addColorStop(0.38, 'rgba(0, 0, 0, 0)');
  mask.addColorStop(0.68, 'rgba(0, 0, 0, 1)');
  mask.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}
