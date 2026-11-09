import { isReportHash } from '@/components/report/sample-hash';
import {
  BEAT_MS,
  beat,
  caption,
  clamp01,
  clipText,
  easeOut,
  lerp,
  mono,
  panel,
  type HowScene,
} from './how-scene';
import type { Ink } from './ink';

const HEX = '0123456789abcdef';

export function paintHash(scene: HowScene) {
  const { ctx, ink } = scene;
  const { index, u } = beat(scene.time, BEAT_MS, 4);
  const heads = [
    ['TWO REPORT FILES', 'CANONICAL JSON'],
    ['REPORT SHA256', '64 HEX'],
    ['BROWSER RECOMPUTES', 'DIGEST MATCH'],
    ['ATTEST ON NEAR', 'review_attested'],
  ] as const;
  const head = heads[index] ?? heads[0];
  const box = caption(scene, `0${index + 1} / 04`, head[0], head[1]);
  if (index === 0) drawFiles(scene, box.x, box.y, box.w, box.h, u);
  else if (index === 1) drawLock(scene, box.x, box.y, box.w, box.h, u);
  else if (index === 2) drawMatch(scene, box.x, box.y, box.w, box.h, u);
  else drawAttest(scene, box.x, box.y, box.w, box.h, u);
}

function scramble(hash: string, until: number, time: number) {
  let out = '';
  for (let i = 0; i < hash.length; i += 1) {
    if (i < until) out += hash[i];
    else out += HEX[Math.floor(time / 80 + i * 3) % HEX.length];
  }
  return out;
}

function hashMetrics(w: number, columns: number, length: number) {
  const groups = Math.max(1, columns / 4);
  const groupGap = Math.max(8, Math.min(16, w * 0.012));
  const charW = Math.max(7, (w - groupGap * (groups - 1)) / columns);
  const px = Math.max(12, Math.min(22, charW * 0.72));
  const pitch = px + 16;
  return { groups, groupGap, charW, px, pitch, rows: Math.ceil(length / columns) };
}

/** Draw the hash in rows of `columns`, grouped by 4. Returns the block height. */
function drawHashGrid(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  hash: string,
  x: number,
  y: number,
  w: number,
  settledColor: string,
  wildColor: string,
  settled: number,
  inspect: number,
  columns: number,
): number {
  const { groupGap, charW, px, pitch, rows } = hashMetrics(w, columns, hash.length);
  ctx.font = mono(ink, px, 700);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let i = 0; i < hash.length; i += 1) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const group = Math.floor(col / 4);
    const cx = x + group * (charW * 4 + groupGap) + (col % 4) * charW;
    const cy = y + row * pitch + pitch / 2;
    if (i === inspect) {
      ctx.fillStyle = ink.ember;
      ctx.fillRect(cx - 1, cy - px * 0.62, charW, px * 1.15);
      ctx.fillStyle = ink.onEmber;
    } else ctx.fillStyle = i < settled ? settledColor : wildColor;
    ctx.fillText(hash[i] ?? '', cx, cy);
  }
  return rows * pitch;
}

function drawFiles(scene: HowScene, x: number, y: number, w: number, h: number, u: number) {
  const { ctx, ink } = scene;
  const narrow = w < 640;
  const files = [
    {
      name: 'findings-and-scores.json',
      lines: ['"cluster": "CLUSTER-7"', '"file": "lib.rs"', '"line": 30'],
      raw: ['line', 'cluster', 'file'],
      sorted: ['cluster', 'file', 'line'],
    },
    {
      name: 'general-review.json',
      lines: ['"posture": "high-risk"', '"top": "CLUSTER-7"', '"disputes": 0'],
      raw: ['top', 'disputes', 'posture'],
      sorted: ['disputes', 'posture', 'top'],
    },
  ];
  const gap = 14;
  const footer = 28;
  const natural = 172;
  const fileH = Math.min(narrow ? (h - footer - gap) / 2 : h - footer, natural);
  const stack = narrow ? fileH * 2 + gap : fileH;
  const offset = Math.max(0, (h - footer - stack) / 2);
  const fileW = narrow ? w : (w - gap) / 2;
  const sort = easeOut(clamp01((u - 0.35) / 0.45));
  files.forEach((file, fileIndex) => {
    if (u < fileIndex * 0.08) return;
    const fx = narrow ? x : x + fileIndex * (fileW + gap);
    const fy = y + offset + (narrow ? fileIndex * (fileH + gap) : 0);
    const arrive = easeOut(clamp01((u - fileIndex * 0.08) / 0.28));
    ctx.save();
    ctx.globalAlpha = arrive;
    panel(ctx, fx, fy + (1 - arrive) * 12, fileW, fileH, ink.ember, ink.plate);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = mono(ink, 12, 700);
    ctx.fillStyle = ink.emberText;
    ctx.fillText(clipText(ctx, file.name, fileW - 24), fx + 12, fy + 18);
    file.lines.forEach((line, lineIndex) => {
      const ly = fy + 40 + lineIndex * 22;
      ctx.font = mono(ink, 14, 600);
      ctx.fillStyle = ink.text;
      ctx.fillText(clipText(ctx, line, fileW - 24), fx + 12, ly);
    });
    const orderY = fy + 40 + file.lines.length * 22 + 28;
    if (orderY < fy + fileH - 16) {
      ctx.font = mono(ink, 10, 700);
      ctx.fillStyle = ink.steel;
      ctx.fillText(sort > 0.85 ? 'CANONICAL ORDER' : 'KEY ORDER', fx + 12, orderY - 16);
      drawKeyOrder(scene, fx + 12, orderY, fileW - 24, file.raw, file.sorted, sort);
    }
    ctx.restore();
  });
  ctx.font = mono(ink, 12, 600);
  ctx.fillStyle = ink.steel;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const status = sort > 0.85 ? 'keys sorted · files concatenated' : 'sorting keys';
  const statusY = y + h - 12;
  ctx.fillText(clipText(ctx, status, w * 0.62), x, statusY);
  const used = ctx.measureText(status).width;
  if (w - used > 96) meterBar(ctx, ink, x + Math.min(used + 16, w * 0.62), statusY, w - Math.min(used + 16, w * 0.62), sort);
}

function drawKeyOrder(
  scene: HowScene,
  x: number,
  y: number,
  w: number,
  raw: string[],
  sorted: string[],
  sort: number,
) {
  const { ctx, ink } = scene;
  const gap = 8;
  const chipW = (w - gap * (raw.length - 1)) / raw.length;
  if (chipW < 36) return;
  raw.forEach((key, from) => {
    const to = Math.max(0, sorted.indexOf(key));
    const cx = lerp(x + from * (chipW + gap), x + to * (chipW + gap), sort);
    panel(ctx, cx, y - 11, chipW, 22, sort > 0.85 ? ink.ok : ink.seam, ink.field);
    ctx.font = mono(ink, 11, 700);
    ctx.fillStyle = sort > 0.85 ? ink.ok : ink.steel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(key, cx + chipW / 2, y);
  });
  ctx.textAlign = 'left';
}

function drawWaiting(scene: HowScene, x: number, y: number) {
  const { ctx, ink } = scene;
  ctx.font = mono(ink, 14, 600);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink.steel;
  ctx.fillText('Reading the sample attestation.', x, y + 24);
}

function drawLock(scene: HowScene, x: number, y: number, w: number, h: number, u: number) {
  const { ctx, ink } = scene;
  if (!isReportHash(scene.reportHash)) {
    drawWaiting(scene, x, y);
    return;
  }
  const locked = easeOut(u) * scene.reportHash.length;
  const metrics = hashMetrics(w, 16, scene.reportHash.length);
  const gridH = metrics.pitch * metrics.rows;
  const group = 24 + gridH + 62;
  const top = y + Math.max(0, (h - group) / 2);
  ctx.font = mono(ink, 13, 600);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = ink.text;
  ctx.fillText(clipText(ctx, 'sha256(canonical findings + canonical general review)', w), x, top + 8);
  drawHashGrid(
    ctx,
    ink,
    scramble(scene.reportHash, locked, scene.time),
    x,
    top + 22,
    w,
    ink.text,
    ink.steel,
    locked,
    -1,
    16,
  );
  const meterY = top + 22 + gridH + 14;
  meterBar(ctx, ink, x, meterY, w, easeOut(u));
  ctx.font = mono(ink, 20, 700);
  ctx.fillStyle = u > 0.75 ? ink.ok : ink.emberText;
  ctx.fillText(u > 0.75 ? 'LOCKED' : 'LOCKING', x, meterY + 22);
  ctx.font = mono(ink, 12, 600);
  ctx.fillStyle = ink.steel;
  ctx.fillText('Same bytes the intake worker attests.', x, Math.min(y + h - 12, meterY + 46));
}

function drawMatch(scene: HowScene, x: number, y: number, w: number, h: number, u: number) {
  const { ctx, ink } = scene;
  if (!isReportHash(scene.reportHash)) {
    drawWaiting(scene, x, y);
    return;
  }
  const browser = easeOut(u) * scene.reportHash.length;
  const inspect = Math.floor(scene.pointerX * (scene.reportHash.length - 1));
  const matched = u > 0.78;
  const columns = w < 860 ? 16 : 32;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let cursor = y + 2;
  ctx.font = mono(ink, 11, 700);
  ctx.fillStyle = ink.steel;
  ctx.fillText('ENGINE', x, cursor + 8);
  cursor += 18;
  cursor += drawHashGrid(ctx, ink, scene.reportHash, x, cursor, w, ink.text, ink.steel, scene.reportHash.length, inspect, columns);
  cursor += 12;
  ctx.font = mono(ink, 11, 700);
  ctx.fillStyle = ink.steel;
  ctx.fillText('BROWSER', x, cursor + 8);
  cursor += 18;
  cursor += drawHashGrid(
    ctx,
    ink,
    scramble(scene.reportHash, browser, scene.time + 40),
    x,
    cursor,
    w,
    ink.ok,
    ink.steel,
    browser,
    inspect,
    columns,
  );
  ctx.font = mono(ink, matched ? 22 : 14, 700);
  ctx.fillStyle = matched ? ink.ok : ink.emberText;
  ctx.fillText(matched ? 'MATCH' : 'COMPARING', x, Math.min(y + h - 32, cursor + 22));
  ctx.font = mono(ink, 12, 600);
  ctx.fillStyle = ink.text;
  ctx.fillText(clipText(ctx, 'digestReport(findings, general) against attestation.report_sha256', w), x, y + h - 10);
}

function drawAttest(scene: HowScene, x: number, y: number, w: number, h: number, u: number) {
  const { ctx, ink } = scene;
  const land = easeOut(u);
  const narrow = w < 680;
  const facts: Array<[string, string]> = [
    ['method', 'attest'],
    ['report_sha256', isReportHash(scene.reportHash) ? `${scene.reportHash.slice(0, 16)}…` : 'reading sample'],
    ['repo', 'sample/vault'],
    ['commit', 'a1c4e9b'],
    ['max_severity', 'high'],
    ['event', 'review_attested'],
  ];
  const foot = 22;
  const factW = narrow ? w : Math.round(w * 0.56);
  const factH = narrow ? Math.round((h - foot) * 0.62) : h - foot;
  panel(ctx, x, y, factW, factH, ink.ember, ink.plate);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = mono(ink, 13, 700);
  ctx.fillStyle = ink.emberText;
  ctx.fillText('attest(', x + 14, y + 16);
  const rowH = (factH - 48) / facts.length;
  facts.forEach(([key, value], factIndex) => {
    const shown = clamp01(u * facts.length - factIndex);
    const ly = y + 34 + rowH * factIndex + rowH / 2;
    ctx.font = mono(ink, 12, 600);
    ctx.fillStyle = ink.steel;
    ctx.fillText(key, x + 22, ly);
    const valueX = x + Math.min(150, factW * 0.38);
    ctx.font = mono(ink, 14, 700);
    ctx.fillStyle = key === 'event' ? ink.emberText : ink.text;
    const typed = value.slice(0, Math.ceil(shown * value.length));
    ctx.fillText(typed ? clipText(ctx, typed, factW - (valueX - x) - 12) : '·', valueX, ly);
  });
  ctx.font = mono(ink, 13, 700);
  ctx.fillStyle = ink.emberText;
  ctx.fillText(')', x + 14, y + factH - 14);
  const chainX = narrow ? x : x + factW + 14;
  const chainY = narrow ? y + factH + 8 : y;
  const chainW = narrow ? w : w - factW - 14;
  const chainH = narrow ? Math.max(36, h - foot - factH - 8) : h - foot;
  drawChain(ctx, ink, chainX, chainY, chainW, chainH, land, isReportHash(scene.reportHash) ? scene.reportHash : '');
  ctx.font = mono(ink, 12, 600);
  ctx.fillStyle = ink.steel;
  ctx.textAlign = 'left';
  ctx.fillText('The chain stores the hash, not the report.', x, y + h - 8);
}

function drawChain(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  x: number,
  y: number,
  w: number,
  h: number,
  landed: number,
  reportHash: string,
) {
  const count = 4;
  const gap = 8;
  const blockW = (w - gap * (count - 1)) / count;
  const blockH = Math.max(64, Math.min(h, 168));
  const top = y + Math.max(0, (h - blockH) / 2);
  const slices = [0, 8, 16, 24].map((start) => reportHash.slice(start, start + 8));
  for (let i = 0; i < count; i += 1) {
    const bx = x + i * (blockW + gap);
    const drop = i === count - 1 ? (1 - landed) * 22 : 0;
    const on = i < count - 1 ? landed > i * 0.18 : landed > 0.8;
    panel(ctx, bx, top + drop, blockW, blockH, on ? ink.ember : ink.seam, ink.field);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = mono(ink, 12, 700);
    ctx.fillStyle = on ? ink.emberText : ink.steel;
    ctx.fillText(i === count - 1 ? 'NOW' : `N-${count - 1 - i}`, bx + blockW / 2, top + drop + blockH * 0.38);
    if (on && blockH > 72) {
      ctx.font = mono(ink, blockW < 72 ? 9 : 11, 600);
      ctx.fillStyle = ink.text;
      ctx.fillText(slices[i] ?? '', bx + blockW / 2, top + drop + blockH * 0.68);
    }
    if (i < count - 1) {
      ctx.strokeStyle = on ? ink.ember : ink.seam;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx + blockW, top + blockH / 2);
      ctx.lineTo(bx + blockW + gap, top + blockH / 2);
      ctx.stroke();
    }
  }
}

function meterBar(ctx: CanvasRenderingContext2D, ink: Ink, x: number, y: number, width: number, amount: number) {
  ctx.fillStyle = ink.seam;
  ctx.fillRect(x, y, width, 4);
  const fill = width * clamp01(amount);
  if (fill > 1) {
    ctx.fillStyle = ink.ember;
    ctx.fillRect(x, y, fill, 4);
  }
}
