import {
  BEAT_MS,
  beat,
  caption,
  clamp01,
  clipText,
  easeOut,
  lerp,
  mono,
  orchAt,
  panel,
  type HowScene,
} from './how-scene';
import type { Ink } from './ink';

interface Claim {
  label: string;
  title: string;
  cite: string;
  accent: string;
  alpha: number;
  struck: boolean;
}

export function paintDebate(scene: HowScene) {
  const { ctx, ink } = scene;
  const { index, u } = beat(scene.time, BEAT_MS, 4);
  const heads = [
    ['ORCH ASSIGNS LABELS', 'ANONYMOUS'],
    ['ORCH FOLDS DUPLICATES', '2 REPORTS → 1'],
    ['ORCH OPENS THE CHALLENGE', 'NO CITATION DROPPED'],
    ['ORCH · ROUND 2 · DEFEND', 'PARTIAL'],
  ] as const;
  const head = heads[index] ?? heads[0];
  const box = caption(scene, `0${index + 1} / 04`, head[0], head[1]);
  const narrow = box.w < 620;
  const seat = narrow ? 0 : 108;
  const cardsX = box.x + seat;
  const cardsY = box.y + (narrow ? 28 : 0);
  const cardsW = box.w - seat;
  const cardsH = box.h - (narrow ? 28 : 0);
  const gap = 8;
  const cardH = Math.max(52, (cardsH - gap * 2) / 3);
  const orchX = box.x + 52;
  const orchY = cardsY + cardsH * 0.46;
  if (!narrow) {
    orchAt(ctx, ink, orchX, orchY, scene.time, 0.62);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = mono(ink, 10, 700);
    ctx.fillStyle = ink.emberText;
    ctx.fillText('IN CHARGE', orchX, orchY + 44);
  } else {
    orchAt(ctx, ink, box.x + 22, box.y + 8, scene.time, 0.34);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = mono(ink, 11, 700);
    ctx.fillStyle = ink.emberText;
    ctx.fillText('ORCH IN CHARGE', box.x + 46, box.y + 8);
  }
  const merge = index > 1 ? 1 : index === 1 ? easeOut(clamp01((u - 0.28) / 0.55)) : 0;
  const named = index > 0 || u >= 0.55;
  const aY = cardsY;
  const bY = lerp(cardsY + cardH + gap, cardsY + cardH * 0.4, merge);
  const cY = lerp(cardsY + (cardH + gap) * 2, cardsY + cardH + gap + 6, merge);
  const targetY = focusY(index, u, aY, bY, cY, cardH, cardsY + cardsH);
  ctx.save();
  ctx.strokeStyle = ink.ember;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(narrow ? box.x + 22 : orchX + 28, narrow ? cardsY - 6 : orchY);
  ctx.lineTo(cardsX, targetY);
  ctx.stroke();
  ctx.restore();
  const cluster: Claim = {
    label: !named ? 'OPUS' : merge > 0.55 ? 'CLUSTER-7' : 'REVIEWER A',
    title: 'Missing owner check',
    cite: merge > 0.55 ? 'lib.rs:30 · 2 reports folded' : 'lib.rs:30',
    accent: ink.ember,
    alpha: 1,
    struck: false,
  };
  if (index === 3) {
    const defense = 'Defense cites lib.rs:18. Verdict moves to partial.';
    const count = u > 0.88 ? defense.length : Math.max(1, Math.floor(easeOut(u) * defense.length));
    cluster.cite = defense.slice(0, count);
    cluster.accent = ink.ok;
  }
  drawClaim(ctx, ink, cardsX, aY, cardsW, cardH + (merge > 0.55 ? 6 : 0), cluster);
  if (merge < 0.98) {
    drawClaim(ctx, ink, cardsX, bY, cardsW, cardH, {
      label: named ? 'REVIEWER B' : 'CODEX',
      title: 'Missing owner check',
      cite: 'lib.rs:30',
      accent: ink.ember,
      alpha: 1 - easeOut(Math.min(1, merge / 0.62)),
      struck: false,
    });
  }
  drawClaim(ctx, ink, cardsX, cY, cardsW, cardH, {
    label: !named ? 'GROK' : index >= 2 ? 'REVIEWER C · CHALLENGER' : 'REVIEWER C',
    title: 'Proxy has no auth gate',
    cite: 'edge.conf:14',
    accent: index >= 2 ? ink.cite : ink.seam,
    alpha: 1,
    struck: false,
  });
  if (index === 1 && merge > 0.94) {
    drawClaim(ctx, ink, cardsX, cardsY + (cardH + gap) * 2, cardsW, cardH, {
      label: 'FOLDED',
      title: 'Reviewer B joins reviewer A',
      cite: 'lib.rs:30 · 2 reports folded',
      accent: ink.ember,
      alpha: 1,
      struck: false,
    });
  }
  if (index === 3) {
    drawClaim(ctx, ink, cardsX, cardsY + (cardH + gap) * 2, cardsW, cardH, {
      label: 'UNSOURCED CHALLENGE',
      title: 'Reentrancy on transfer',
      cite: 'DROPPED · NO CITATION',
      accent: ink.fault,
      alpha: 0.7,
      struck: true,
    });
  }
  if (index === 2) {
    const drop = easeOut(clampDrop(u));
    const ghostY = lerp(cY + cardH + gap, cardsY + cardsH - cardH, drop);
    drawClaim(ctx, ink, cardsX, ghostY, cardsW, cardH, {
      label: 'UNSOURCED CHALLENGE',
      title: 'Reentrancy on transfer',
      cite: drop > 0.55 ? 'DROPPED · NO CITATION' : 'no file:line',
      accent: ink.fault,
      alpha: 1 - drop * 0.2,
      struck: drop > 0.35,
    });
  }
}

function clampDrop(u: number) {
  return Math.max(0, Math.min(1, (u - 0.22) / 0.62));
}

function focusY(index: number, u: number, aY: number, bY: number, cY: number, cardH: number, floor: number) {
  if (index === 0) {
    const sweep = Math.min(2, u * 2.4);
    const step = Math.floor(sweep);
    const frac = sweep - step;
    const ys = [aY, bY, cY];
    const from = ys[step] ?? cY;
    const to = ys[Math.min(2, step + 1)] ?? from;
    return lerp(from, to, frac) + cardH / 2;
  }
  if (index === 2 && u < 0.75) return lerp(cY, floor - cardH, clampDrop(u)) + cardH / 2;
  return aY + cardH / 2;
}

function drawClaim(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  x: number,
  y: number,
  w: number,
  h: number,
  claim: Claim,
) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, claim.alpha));
  panel(ctx, x, y, w, h, claim.accent, ink.plate);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = mono(ink, 11, 700);
  ctx.fillStyle = ink.emberText;
  ctx.fillText(clipText(ctx, claim.label, w - 20), x + 10, y + 14);
  ctx.font = mono(ink, 13, 600);
  ctx.fillStyle = ink.text;
  const titleY = y + h * 0.52;
  ctx.fillText(clipText(ctx, claim.title, w - 20), x + 10, titleY);
  if (claim.struck) {
    ctx.strokeStyle = ink.fault;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 10, titleY);
    ctx.lineTo(x + w - 10, titleY);
    ctx.stroke();
  }
  ctx.font = mono(ink, 11, 600);
  ctx.fillStyle = ink.steel;
  ctx.fillText(clipText(ctx, claim.cite, w - 20), x + 10, y + h - 12);
  ctx.restore();
}
