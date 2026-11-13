import { drawMark } from './draw-marks';
import { BEAT_MS, beat, caption, clipText, easeOut, meter, mono, panel, type HowScene } from './how-scene';
import { MODELS, type Mark } from './model-marks';

const FAMILY_IDS = ['opus', 'codex', 'grok', 'agy'] as const;

const FAMILIES: Mark[] = FAMILY_IDS.flatMap((id) => {
  const mark = MODELS.find((item) => item.id === id);
  return mark ? [mark] : [];
});

interface Surface {
  kind: string;
  path: string;
  lines: readonly string[];
  hot: number;
  cite: string;
}

const CONTRACT: Surface = {
  kind: 'CONTRACT',
  path: 'contracts/vault/src/lib.rs',
  lines: ['fn withdraw(account_id, amount) {', '    transfer(account_id, amount);', '}'],
  hot: 1,
  cite: 'lib.rs:30',
};

const SURFACES: readonly Surface[] = [
  CONTRACT,
  {
    kind: 'INFRA',
    path: 'infra/nginx/edge.conf',
    lines: ['location /api/operator/ {', '    proxy_pass http://api:8080;', '}'],
    hot: 1,
    cite: 'edge.conf:14',
  },
  {
    kind: 'APP',
    path: 'apps/web/src/session/token.ts',
    lines: ['export async function issueToken(req) {', '    return sign(req.payload);', '}'],
    hot: 1,
    cite: 'token.ts:88',
  },
  { ...CONTRACT, kind: 'PASS 2' },
];

const ACTIVE = [0, 1, 2, 1] as const;

function laneClock(time: number, lane: number) {
  const span = BEAT_MS * 4;
  const local = (time + lane * 900) % span;
  const pass = local < span / 2 ? 1 : 2;
  const within = (local % (span / 2)) / (span / 2);
  return { pass, calls: Math.min(40, Math.floor(easeOut(within) * 40)) };
}

function laneCite(lane: number, index: number): string {
  if (index >= 3 && lane === 3) return 'same snapshot';
  if (index >= 3 && (lane === 0 || lane === 1)) return 'lib.rs:30';
  if (index >= lane) return ['lib.rs:30', 'edge.conf:14', 'intent.ts:88', ''][lane] ?? '';
  return '';
}

export function paintReview(scene: HowScene) {
  const { index, u } = beat(scene.time, BEAT_MS, 4);
  const surface = SURFACES[index] ?? SURFACES[0]!;
  const cited = u > 0.62;
  const aside = index === 3 ? 'PASS 2 · SAME SNAPSHOT' : 'PASS 1 · 40 CALLS';
  const box = caption(scene, `0${index + 1} / 04`, `${surface.kind} · ${surface.path}`, aside);
  const narrow = box.w < 640;
  const fileW = narrow ? box.w : Math.round(box.w * 0.5);
  const fileH = narrow ? Math.round(box.h * 0.48) : box.h;
  const lanesX = narrow ? box.x : box.x + fileW + 18;
  const lanesY = narrow ? box.y + fileH + 14 : box.y;
  const lanesW = narrow ? box.w : box.w - fileW - 18;
  const lanesH = narrow ? Math.max(10, box.h - fileH - 14) : box.h;
  const row = (fileH - 44) / surface.lines.length;
  const hotY = box.y + 16 + row * surface.hot + row * 0.5;
  drawFile(scene, box.x, box.y, fileW, fileH, surface, u, cited);
  drawLanes(scene, lanesX, lanesY, lanesW, lanesH, index, u);
  if (!narrow && cited) {
    const targets = index === 3 ? [0, 1] : [ACTIVE[index] ?? 0];
    const rowH = lanesH / Math.max(1, FAMILIES.length);
    scene.ctx.save();
    scene.ctx.strokeStyle = scene.ink.cite;
    scene.ctx.lineWidth = 1.5;
    scene.ctx.globalAlpha = easeOut((u - 0.62) / 0.38);
    for (const lane of targets) {
      const y2 = lanesY + rowH * lane + rowH / 2;
      scene.ctx.beginPath();
      scene.ctx.moveTo(box.x + fileW, hotY);
      scene.ctx.lineTo(lanesX - 6, y2);
      scene.ctx.stroke();
    }
    scene.ctx.restore();
  }
}

function drawFile(
  scene: HowScene,
  x: number,
  y: number,
  w: number,
  h: number,
  surface: Surface,
  u: number,
  cited: boolean,
) {
  const { ctx, ink } = scene;
  const reveal = easeOut(Math.min(1, u / 0.28));
  panel(ctx, x, y, w, h, ink.ember, ink.plate);
  const row = (h - 44) / surface.lines.length;
  const band = Math.min(28, row * 0.62);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, y + 1, w - 2, h - 2);
  ctx.clip();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  surface.lines.forEach((line, lineIndex) => {
    if (reveal < lineIndex / surface.lines.length && reveal < 0.92) return;
    const ly = y + 16 + row * lineIndex + row * 0.5;
    const hot = lineIndex === surface.hot;
    if (hot) {
      ctx.globalAlpha = cited ? 1 : 0.22 + 0.35 * easeOut(u / 0.62);
      ctx.fillStyle = ink.ember;
      ctx.fillRect(x + 8, ly - band / 2, w - 16, band);
      ctx.globalAlpha = 1;
    }
    ctx.font = mono(ink, 11, 600);
    ctx.fillStyle = hot && cited ? ink.onEmber : ink.steel;
    ctx.fillText(String(lineIndex + 1).padStart(2, '0'), x + 12, ly);
    ctx.font = mono(ink, 13, 600);
    ctx.fillStyle = hot && cited ? ink.onEmber : hot ? ink.emberText : ink.text;
    ctx.fillText(clipText(ctx, line, w - 64), x + 36, ly);
  });
  if (!cited) {
    const scan = (u / 0.62) * 0.75 + scene.pointerX * 0.25;
    const sx = x + 28 + scan * Math.max(8, w - 56);
    ctx.strokeStyle = ink.cite;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, y + 8);
    ctx.lineTo(sx, y + h - 24);
    ctx.stroke();
  }
  ctx.font = mono(ink, 11, 700);
  ctx.fillStyle = cited ? ink.cite : ink.emberText;
  ctx.fillText(cited ? `CITED  ${surface.cite}` : 'LEAD · NOT A FINDING YET', x + 12, y + h - 14);
  ctx.restore();
}

function drawLanes(scene: HowScene, x: number, y: number, w: number, h: number, index: number, u: number) {
  const { ctx, ink } = scene;
  const rowH = h / Math.max(1, FAMILIES.length);
  const active = ACTIVE[index] ?? 0;
  FAMILIES.forEach((mark, lane) => {
    const { pass, calls } = laneClock(scene.time, lane);
    const ly = y + rowH * lane;
    const on = lane === active;
    const cite = laneCite(lane, index === lane && u <= 0.62 ? index - 1 : index);
    const dup = index >= 3 && (lane === 0 || lane === 1);
    if (on) {
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = ink.ember;
      ctx.fillRect(x, ly + 3, w, Math.max(8, rowH - 6));
      ctx.restore();
    }
    drawMark(ctx, x + 16, ly + rowH / 2, mark, ink, rowH < 48 ? 0.7 : 0.86);
    const textX = x + 34;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = mono(ink, 12, 700);
    ctx.fillStyle = on ? ink.text : ink.steel;
    ctx.fillText(mark.label, textX, ly + rowH * 0.32);
    const nameW = ctx.measureText(mark.label).width;
    for (let pip = 1; pip <= 2; pip += 1) {
      ctx.fillStyle = pip <= pass ? (on ? ink.ember : ink.cite) : ink.seam;
      ctx.fillRect(textX + nameW + 8 + (pip - 1) * 10, ly + rowH * 0.32 - 3, 7, 7);
    }
    if (cite) {
      ctx.textAlign = 'right';
      ctx.font = mono(ink, 11, 700);
      ctx.fillStyle = dup ? ink.warn : ink.cite;
      ctx.fillText(clipText(ctx, dup ? `${cite} · DUP` : cite, w * 0.46), x + w - 2, ly + rowH * 0.32);
    }
    ctx.textAlign = 'left';
    ctx.font = mono(ink, 11, 600);
    ctx.fillStyle = ink.steel;
    ctx.fillText(`pass ${pass}   ${String(calls).padStart(2, '0')}/40`, textX, ly + rowH * 0.7);
    const meterW = Math.max(24, w - (textX - x) - 8);
    meter(ctx, textX, ly + rowH * 0.7 + 9, meterW, 3, calls / 40, on ? ink.ember : ink.cite, ink.seam);
  });
}
