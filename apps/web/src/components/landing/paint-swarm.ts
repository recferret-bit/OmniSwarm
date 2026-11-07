import { drawModel, drawOrchestrator } from './draw-marks';
import type { Ink, Pointer } from './ink';
import { MODELS, ORCHESTRATOR } from './model-marks';

export interface Box { x: number; y: number; w: number; h: number }

export function sourceBox(width: number, height: number): Box {
  if (height < 240) return { x: width * 0.05, y: height * 0.06, w: width * 0.9, h: height * 0.88 };
  const w = Math.min(480, width * 0.38);
  const h = Math.min(540, height * 0.72);
  return { x: width * 0.56, y: Math.max(16, (height - h) * 0.36), w, h };
}

const ROWS = 16;

function lineGeom(box: Box, index: number) {
  const y = box.y + 28 + index * ((box.h - 48) / ROWS);
  const w = box.w * (0.35 + ((index * 17) % 40) / 100);
  return { y, x: box.x + 22, w };
}

export function markCross(box: Box, x: number, y: number, crossed: Set<number>) {
  if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) return;
  for (let i = 0; i < ROWS; i += 1) {
    const line = lineGeom(box, i);
    if (Math.abs(y - line.y) <= 9 && x >= line.x - 8 && x <= line.x + line.w + 12) crossed.add(i);
  }
}

function lines(ctx: CanvasRenderingContext2D, box: Box, ink: Ink, xHit: number, yHit: number) {
  let active = -1;
  let best = 14;
  const inside = xHit > box.x && xHit < box.x + box.w && yHit > box.y && yHit < box.y + box.h;
  if (inside) {
    for (let i = 0; i < ROWS; i += 1) {
      const line = lineGeom(box, i);
      const dy = Math.abs(yHit - line.y);
      if (dy < best && xHit >= line.x - 8 && xHit <= line.x + line.w + 16) {
        best = dy;
        active = i;
      }
    }
  }
  ctx.save();
  for (let i = 0; i < ROWS; i += 1) {
    const line = lineGeom(box, i);
    const lit = i === active;
    ctx.globalAlpha = lit ? 1 : 0.2;
    ctx.fillStyle = lit ? ink.ember : ink.text;
    ctx.fillRect(line.x, line.y, lit ? Math.min(box.w - 36, line.w + 36) : line.w, lit ? 3.5 : 2);
  }
  ctx.restore();
}

export function drawSource(ctx: CanvasRenderingContext2D, box: Box, ink: Ink, pointer: Pointer, width: number, height: number) {
  const mx = pointer.x * width;
  const my = pointer.y * height;
  const inside = mx > box.x && mx < box.x + box.w && my > box.y && my < box.y + box.h;
  const dx = inside ? (mx - (box.x + box.w / 2)) / box.w : 0;
  const dy = inside ? (my - (box.y + box.h / 2)) / box.h : 0;
  ctx.save();
  ctx.strokeStyle = ink.ember;
  ctx.lineWidth = inside ? 2.6 : 1.4;
  ctx.globalAlpha = inside ? 1 : 0.8;
  ctx.strokeRect(box.x + dx * 14, box.y + dy * 10, box.w, box.h);
  ctx.globalAlpha = 0.45 + (inside ? 0.35 : 0);
  ctx.strokeRect(box.x + 8 + dx * 8, box.y + 8 + dy * 6, box.w - 16, box.h - 16);
  const arm = inside ? 22 : 12;
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  const corners: Array<[number, number, number, number]> = [
    [box.x, box.y, 1, 1],
    [box.x + box.w, box.y, -1, 1],
    [box.x, box.y + box.h, 1, -1],
    [box.x + box.w, box.y + box.h, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
    ctx.stroke();
  }
  ctx.restore();
}

interface Node { i: number; x: number; y: number; z: number; s: number }

const SPHERE = 18;

function layout(box: Box, time: number, tiltX: number, tiltY: number): Node[] {
  const radius = Math.min(box.w, box.h) * 0.34;
  const yaw = time * 0.00032;
  return Array.from({ length: SPHERE }, (_, i) => {
    const y0 = 1 - (i / (SPHERE - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y0 * y0));
    const theta = i * Math.PI * (3 - Math.sqrt(5)) + yaw;
    let x = Math.cos(theta) * ring;
    let y = y0;
    let z = Math.sin(theta) * ring;
    const cosY = Math.cos(tiltY);
    const sinY = Math.sin(tiltY);
    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;
    const cosX = Math.cos(tiltX);
    const sinX = Math.sin(tiltX);
    const y1 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;
    const depth = 1.8 / (1.8 - z2);
    return { i, x: x1 * radius * depth, y: y1 * radius * depth, z: z2, s: 0.42 + (z2 + 1) * 0.38 };
  });
}

export function drawSwarm(ctx: CanvasRenderingContext2D, box: Box, width: number, height: number, time: number, pointer: Pointer, ink: Ink, _crossed: Set<number>) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const localX = pointer.x * width;
  const localY = pointer.y * height;
  const inside = localX > box.x && localX < box.x + box.w && localY > box.y && localY < box.y + box.h;
  const tiltX = inside ? (localX - cx) / box.w : 0;
  const tiltY = inside ? (localY - cy) / box.h : 0;
  const nodes = layout(box, time, tiltX * 0.85, tiltY * 0.65).sort((a, b) => a.z - b.z);
  const placed = nodes.map((node) => {
    const sx = cx + node.x;
    const sy = cy + node.y;
    const near = Math.hypot(sx - localX, sy - localY);
    const hover = inside ? Math.max(0, 1 - near / 64) : 0;
    return { node, sx, sy, hover };
  });
  lines(ctx, box, ink, localX, localY);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = ink.cite;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.ellipse(0, box.h * 0.08, box.w * 0.34, box.h * 0.12, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  for (const { node, sx, sy, hover } of placed) {
    const mark = MODELS[node.i % MODELS.length];
    if (!mark) continue;
    ctx.save();
    ctx.globalAlpha = 0.2 + hover * 0.8;
    ctx.strokeStyle = hover > 0.2 ? ink.ember : ink.cite;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.globalAlpha = 0.55 + node.s * 0.2;
    ctx.translate(sx, sy);
    ctx.scale(node.s * (1 + hover * 0.45), node.s * (1 + hover * 0.45));
    drawModel(ctx, 0, 0, mark, ink);
    ctx.restore();
  }
  drawOrchestrator(ctx, cx, cy, ORCHESTRATOR, ink, time);
  if (inside) {
    ctx.save();
    ctx.strokeStyle = ink.emberText;
    ctx.globalAlpha = pointer.down ? 0.9 : 0.35;
    ctx.beginPath();
    ctx.arc(localX, localY, pointer.down ? 22 : 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
