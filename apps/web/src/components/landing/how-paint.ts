import { fitCanvas, readInk } from './ink';

const STAGES = ['REVIEW', 'DEBATE', 'JUDGE', 'HASH'] as const;
const HASH = 'cd8a533dc78a6d48';

function rail(ctx: CanvasRenderingContext2D, width: number, active: number, ink: ReturnType<typeof readInk>) {
  const y = 22;
  ctx.font = `600 11px ${ink.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = ink.seam;
  ctx.beginPath();
  ctx.moveTo(width * 0.12, y);
  ctx.lineTo(width * 0.88, y);
  ctx.stroke();
  STAGES.forEach((label, index) => {
    const x = (width * (index + 1)) / (STAGES.length + 1);
    const on = index === active;
    ctx.globalAlpha = on ? 1 : 0.4;
    ctx.fillStyle = on ? ink.ember : ink.seam;
    ctx.fillRect(x - 18, y - 10, 36, 20);
    ctx.fillStyle = on ? ink.onEmber : ink.text;
    ctx.fillText(String(index + 1).padStart(2, '0'), x, y);
    ctx.fillStyle = on ? ink.emberText : ink.steel;
    ctx.fillText(label, x, y + 22);
  });
  ctx.globalAlpha = 1;
}

function fileCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ink: ReturnType<typeof readInk>, cited: boolean, scan: number) {
  ctx.strokeStyle = ink.ember;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  const lines = ['fn withdraw(...) {', '  transfer(account, amount);', '}'];
  ctx.font = `600 13px ${ink.mono}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    const ly = y + 28 + index * 28;
    const hot = cited && index === 1;
    if (hot) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ink.ember;
      ctx.fillRect(x + 8, ly - 12, w - 16, 24);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = hot ? ink.emberText : ink.text;
    ctx.fillText(line, x + 14, ly);
  });
  const sx = x + 10 + scan * (w - 20);
  ctx.strokeStyle = ink.cite;
  ctx.beginPath();
  ctx.moveTo(sx, y + 8);
  ctx.lineTo(sx, y + h - 8);
  ctx.stroke();
}

export function paintHow(canvas: HTMLCanvasElement, time: number, pointerX: number, active: number) {
  const ctx = fitCanvas(canvas);
  if (!ctx) return;
  const ink = readInk(canvas);
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height;
  ctx.clearRect(0, 0, width, height);
  rail(ctx, width, active, ink);
  const scan = time > 500 ? (pointerX * 0.65 + ((time / 1600) % 1) * 0.35) : pointerX;
  const top = 58;
  const stage = Math.min(STAGES.length - 1, Math.max(0, active));

  if (stage === 0) {
    fileCard(ctx, 16, top, Math.min(420, width * 0.46), height - top - 16, ink, true, scan);
    ctx.fillStyle = ink.text;
    ctx.font = `600 14px ${ink.mono}`;
    ctx.textAlign = 'left';
    ctx.fillText('src/lib.rs:30', width * 0.54, top + 28);
    ctx.fillStyle = ink.text;
    ctx.font = `600 13px ${ink.mono}`;
    ctx.fillText('3 families · same snapshot', width * 0.54, top + 56);
    ctx.fillText('2 passes · 40 calls each', width * 0.54, top + 80);
    ctx.fillStyle = ink.emberText;
    ctx.fillText('A hit is a lead until cited.', width * 0.54, top + 112);
  } else if (stage === 1) {
    const boxW = Math.min(280, width * 0.34);
    ctx.strokeStyle = ink.ember;
    ctx.strokeRect(24, top, boxW, 88);
    ctx.fillStyle = ink.emberText;
    ctx.font = `600 12px ${ink.mono}`;
    ctx.textAlign = 'left';
    ctx.fillText('CLAIM', 36, top + 22);
    ctx.fillStyle = ink.text;
    ctx.font = `600 15px ${ink.mono}`;
    ctx.fillText('Missing owner check', 36, top + 52);
    const rx = width - boxW - 24;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = ink.seam;
    ctx.strokeRect(rx, top + 24, boxW, 72);
    ctx.fillStyle = ink.steel;
    ctx.font = `600 12px ${ink.mono}`;
    ctx.fillText('NO CITATION', rx + 12, top + 48);
    ctx.font = `600 15px ${ink.mono}`;
    ctx.fillText('Refuted', rx + 12, top + 74);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink.ember;
    ctx.beginPath();
    ctx.moveTo(24 + boxW, top + 44);
    ctx.lineTo(rx, top + 60);
    ctx.stroke();
    ctx.fillStyle = ink.emberText;
    ctx.fillText('Challenge with the file, or drop it.', 24, height - 22);
  } else if (stage === 2) {
    const w = Math.min(460, width - 48);
    const x = (width - w) / 2;
    ctx.strokeStyle = ink.ember;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, top, w, height - top - 28);
    ctx.fillStyle = ink.emberText;
    ctx.font = `600 12px ${ink.mono}`;
    ctx.textAlign = 'left';
    ctx.fillText('CLUSTER-1  ·  HIGH', x + 16, top + 28);
    ctx.fillStyle = ink.text;
    ctx.font = `700 28px ${ink.mono}`;
    ctx.fillText('DISPUTED', x + 16, top + 68);
    ctx.font = `600 14px ${ink.mono}`;
    ctx.fillText('Another family rules.', x + 16, top + 104);
  } else {
    ctx.fillStyle = ink.emberText;
    ctx.font = `600 12px ${ink.mono}`;
    ctx.textAlign = 'left';
    ctx.fillText('REPORT SHA256', 24, top + 16);
    ctx.fillStyle = ink.attested;
    ctx.font = `700 28px ${ink.mono}`;
    ctx.fillText(HASH, 24, top + 58);
    ctx.strokeStyle = ink.ember;
    ctx.lineWidth = 2;
    const lock = Math.min(1, time / 700);
    ctx.strokeRect(24, top + 78, (width - 48) * lock, 8);
    ctx.fillStyle = ink.text;
    ctx.font = `600 14px ${ink.mono}`;
    ctx.fillText('Written on the review-registry. Recomputed in the browser.', 24, top + 116);
  }
}
