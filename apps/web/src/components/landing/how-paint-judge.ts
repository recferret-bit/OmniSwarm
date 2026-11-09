import { drawMark } from './draw-marks';
import { BEAT_MS, beat, caption, clamp01, clipText, easeOut, lerp, meter, mono, orchAt, panel, type HowScene } from './how-scene';
import { MODELS } from './model-marks';

const QWEN = MODELS.find((item) => item.id === 'qwen');

const LINES = [
  ['posture', 'high-risk'],
  ['top finding', 'CLUSTER-7 · high · upheld'],
  ['open disputes', '0'],
  ['method', 'alternate judge · vendor differed'],
] as const;

export function paintJudge(scene: HowScene) {
  const { index, u } = beat(scene.time, BEAT_MS, 4);
  const heads = [
    ['ORCH YIELDS THE SEAT', 'VENDOR CONFLICT'],
    ['ONE LINE, TWO REPORTS', 'DUPLICATES GONE'],
    ['CLAMPED TO THE EVIDENCE', 'CANNOT RAISE IT'],
    ['ORCH WRITES THE REVIEW', 'HIGH-RISK'],
  ] as const;
  const head = heads[index] ?? heads[0];
  const box = caption(scene, `0${index + 1} / 04`, head[0], head[1]);
  const narrow = box.w < 680;
  const handoff = index === 0 ? easeOut(clamp01((u - 0.28) / 0.45)) : 1;
  const seatW = narrow ? box.w : Math.round(box.w * 0.38);
  const seatH = narrow ? Math.min(168, box.h * 0.36) : box.h;
  drawSeat(scene, box.x, box.y, seatW, seatH, handoff, index);
  const dx = narrow ? box.x : box.x + seatW + 16;
  const dy = narrow ? box.y + seatH + 12 : box.y;
  const dw = narrow ? box.w : box.w - seatW - 16;
  const dh = narrow ? Math.max(10, box.h - seatH - 12) : box.h;
  if (index === 0) drawRules(scene, dx, dy, dw, dh, handoff);
  else if (index === 1) drawFold(scene, dx, dy, dw, dh, u);
  else if (index === 2) drawStamp(scene, dx, dy, dw, dh, u);
  else drawGeneral(scene, dx, dy, dw, dh, u);
  const fromX = box.x + seatW * (handoff > 0.5 && !narrow ? 0.62 : 0.5);
  const fromY = box.y + (narrow ? 36 : seatH * 0.48);
  scene.ctx.save();
  scene.ctx.strokeStyle = index === 3 ? scene.ink.ember : scene.ink.cite;
  scene.ctx.globalAlpha = 0.7;
  scene.ctx.lineWidth = 1.5;
  scene.ctx.beginPath();
  scene.ctx.moveTo(fromX, fromY);
  scene.ctx.lineTo(dx, dy + Math.min(36, dh * 0.2));
  scene.ctx.stroke();
  scene.ctx.restore();
}

function drawSeat(scene: HowScene, x: number, y: number, w: number, h: number, handoff: number, index: number) {
  const { ctx, ink } = scene;
  panel(ctx, x, y, w, h, handoff > 0.5 ? ink.cite : ink.ember, ink.plate);
  const cx = x + w * 0.5;
  const cy = y + h * 0.46;
  orchAt(
    ctx,
    ink,
    cx - lerp(0, w * 0.24, handoff),
    lerp(cy, y + 34, handoff),
    scene.time,
    lerp(0.58, 0.38, handoff),
  );
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = mono(ink, 10, 700);
  ctx.fillStyle = ink.emberText;
  const orchLabel = handoff > 0.55 ? 'ASSIGNS' : 'IN CHARGE';
  ctx.fillText(orchLabel, cx - lerp(0, w * 0.24, handoff), lerp(cy, y + 34, handoff) + lerp(46, 32, handoff));
  if (QWEN && handoff > 0.02) {
    ctx.save();
    ctx.globalAlpha = handoff;
    const qx = lerp(x + w + 24, cx + w * 0.18, handoff);
    const qy = cy + 4;
    drawMark(ctx, qx, qy, QWEN, ink, 1.05);
    ctx.font = mono(ink, 11, 700);
    ctx.textAlign = 'center';
    ctx.fillStyle = ink.cite;
    ctx.fillText(index === 3 ? 'SEATED' : 'ALTERNATE', qx, qy + 28);
    ctx.restore();
  }
  ctx.textAlign = 'left';
  ctx.font = mono(ink, 12, 600);
  ctx.fillStyle = ink.text;
  const note = handoff < 0.5 ? 'Author vendor matches the orchestrator.' : 'Alternate judge takes this cluster.';
  ctx.fillText(clipText(ctx, note, w - 16), x + 8, y + h - 14);
}

function drawRules(scene: HowScene, x: number, y: number, w: number, h: number, handoff: number) {
  const { ctx, ink } = scene;
  panel(ctx, x, y, w, h, ink.seam, ink.plate);
  const rules = [
    [handoff > 0.15, 'Judge vendor must differ from every author'],
    [handoff > 0.4, 'Orchestrator overlaps an author'],
    [handoff > 0.75, 'Alternate judge is seated'],
  ] as const;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const row = (h - 28) / rules.length;
  rules.forEach(([on, text], ruleIndex) => {
    const ly = y + row * ruleIndex + row / 2;
    ctx.fillStyle = on ? ink.ok : ink.seam;
    ctx.fillRect(x + 16, ly - 6, 12, 12);
    ctx.font = mono(ink, 15, 600);
    ctx.fillStyle = on ? ink.text : ink.steel;
    ctx.fillText(clipText(ctx, text, w - 48), x + 38, ly);
  });
}

function drawFold(scene: HowScene, x: number, y: number, w: number, h: number, u: number) {
  const { ctx, ink } = scene;
  const slide = easeOut(clamp01((u - 0.34) / 0.48));
  const bAlpha = 1 - easeOut(clamp01((u - 0.42) / 0.32));
  const merged = u > 0.62;
  panel(ctx, x, y, w, h, ink.ember, ink.plate);
  const pad = 16;
  const innerW = w - pad * 2;
  const gap = 10;
  const cardH = Math.max(48, Math.min(84, (h - 56 - gap * 2) / 3));
  const openA = y + 14;
  const closedA = y + Math.max(14, (h - (cardH * 2 + gap + 36)) / 2);
  const yA = lerp(openA, closedA, slide);
  const yKept = lerp(openA + (cardH + gap) * 2, yA + cardH + gap, slide);
  const yB = lerp(openA + cardH + gap, yA + 8, slide);
  if (bAlpha > 0.04) reportCard(scene, x + pad, yB, innerW, cardH, 'REPORT B', 'lib.rs:30   report B', ink.seam, bAlpha);
  reportCard(
    scene,
    x + pad,
    yA,
    innerW,
    cardH,
    merged ? 'CLUSTER-7' : 'REPORT A',
    merged ? 'lib.rs:30   cited twice' : 'lib.rs:30   report A',
    ink.ember,
    1,
  );
  reportCard(scene, x + pad, yKept, innerW, cardH, 'KEPT APART', 'edge.conf:14   kept apart', ink.cite, 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = mono(ink, 12, 700);
  ctx.fillStyle = ink.emberText;
  const labelY = slide > 0.8 ? yKept + cardH + 20 : y + h - 16;
  ctx.fillText(u > 0.72 ? 'FOLDED  2 → 1' : 'TWO REPORTS', x + pad, labelY);
}

function reportCard(
  scene: HowScene,
  x: number,
  y: number,
  w: number,
  h: number,
  kicker: string,
  body: string,
  stroke: string,
  alpha: number,
) {
  const { ctx, ink } = scene;
  ctx.save();
  ctx.globalAlpha = alpha;
  panel(ctx, x, y, w, h, stroke, ink.field);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = mono(ink, 11, 700);
  ctx.fillStyle = ink.emberText;
  ctx.fillText(kicker, x + 12, y + h * 0.32);
  ctx.font = mono(ink, 14, 600);
  ctx.fillStyle = ink.text;
  ctx.fillText(clipText(ctx, body, w - 24), x + 12, y + h * 0.68);
  ctx.restore();
}

function drawStamp(scene: HowScene, x: number, y: number, w: number, h: number, u: number) {
  const { ctx, ink } = scene;
  const latch = easeOut(u);
  panel(ctx, x, y, w, h, ink.ember, ink.plate);
  const wordY = y + h * 0.34;
  const out = clamp01((u - 0.42) / 0.2);
  const inn = clamp01((u - 0.64) / 0.28);
  stamp(ctx, ink.mono, w, x, wordY - out * 36, 'DISPUTED', ink.fault, 1 - out, 1);
  stamp(ctx, ink.mono, w, x, wordY + (1 - inn) * 14, 'UPHELD', ink.ok, inn, lerp(1.08, 1, inn));
  const noteY = y + h * 0.64;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = mono(ink, 14, 600);
  ctx.fillStyle = ink.text;
  ctx.fillText(clipText(ctx, 'Status cannot rise above the cited lines.', w - 28), x + 16, noteY);
  meter(ctx, x + 16, noteY + 18, w - 32, 6, latch, ink.ember, ink.seam);
  ctx.font = mono(ink, 12, 700);
  ctx.fillStyle = ink.emberText;
  ctx.fillText('CLAMP', x + 16, noteY + 36);
}

function stamp(
  ctx: CanvasRenderingContext2D,
  family: string,
  w: number,
  x: number,
  y: number,
  word: string,
  color: string,
  alpha: number,
  pop: number,
) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x + w / 2, y);
  ctx.scale(pop, pop);
  ctx.font = `700 ${w < 280 ? 28 : 40}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(word, 0, 0);
  ctx.restore();
}

function drawGeneral(scene: HowScene, x: number, y: number, w: number, h: number, u: number) {
  const { ctx, ink } = scene;
  panel(ctx, x, y, w, h, ink.ember, ink.plate);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = mono(ink, 11, 700);
  ctx.fillStyle = ink.emberText;
  ctx.fillText('GENERAL REVIEW', x + 16, y + 18);
  const shown = u * LINES.length;
  const row = (h - 52) / LINES.length;
  LINES.forEach(([key, value], line) => {
    const age = shown - line;
    const ly = y + 36 + row * line + row / 2;
    ctx.font = mono(ink, 13, 600);
    ctx.fillStyle = ink.steel;
    ctx.fillText(key, x + 16, ly);
    const valueX = x + Math.min(168, w * 0.4);
    if (age <= 0) {
      ctx.fillStyle = ink.seam;
      ctx.fillText('—', valueX, ly);
      return;
    }
    const typed = u > 0.75 || age > 0.9 ? value : value.slice(0, Math.max(1, Math.ceil(clamp01(age) * value.length)));
    ctx.font = mono(ink, 15, 700);
    ctx.fillStyle = line === 0 ? ink.warn : ink.text;
    ctx.fillText(clipText(ctx, typed, w - (valueX - x) - 16), valueX, ly);
  });
}
