import { GLYPH, ORCH_GLYPH, type Mark } from './model-marks';
import type { Ink } from './ink';

function strokeGlyph(ctx: CanvasRenderingContext2D, mark: Mark, size: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.35, size / 12);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.translate(-size / 2, -size / 2);
  ctx.scale(size / 24, size / 24);
  for (const d of mark.paths) ctx.stroke(new Path2D(d));
  ctx.restore();
}

function disc(ctx: CanvasRenderingContext2D, radius: number, fill: string, stroke: string) {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

export function drawModel(ctx: CanvasRenderingContext2D, x: number, y: number, mark: Mark, ink: Ink) {
  ctx.save();
  ctx.translate(x, y);
  disc(ctx, GLYPH * 0.78, ink.plate, ink.cite);
  strokeGlyph(ctx, mark, GLYPH, ink.emberText);
  ctx.fillStyle = ink.text;
  ctx.font = `600 9px ${ink.mono}`;
  ctx.textAlign = 'center';
  ctx.fillText(mark.label, 0, GLYPH * 0.78 + 13);
  ctx.restore();
}

export function drawOrchestrator(ctx: CanvasRenderingContext2D, x: number, y: number, mark: Mark, ink: Ink, time: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = ink.ember;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 28, time / 800, time / 800 + Math.PI * 1.35);
  ctx.stroke();
  ctx.globalAlpha = 1;
  disc(ctx, 20, ink.ember, ink.ember);
  strokeGlyph(ctx, mark, ORCH_GLYPH, ink.onEmber);
  ctx.fillStyle = ink.emberText;
  ctx.font = `700 11px ${ink.mono}`;
  ctx.textAlign = 'center';
  ctx.fillText(mark.label, 0, 44);
  ctx.restore();
}
