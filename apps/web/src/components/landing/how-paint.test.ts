import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { paintHow } from './how-paint';
import { SAMPLE_HASH } from './how-sample-hash';

if (typeof globalThis.Path2D !== 'function') {
  globalThis.Path2D = class { constructor(public d = '') {} } as unknown as typeof Path2D;
}

function paint(stage: number, time: number, still = false, reportHash = 'a'.repeat(64)) {
  const text: string[] = [];
  const ctx = {
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    fillRect() {},
    strokeRect() {},
    rect() {},
    clip() {},
    arc() {},
    scale() {},
    translate() {},
    fillText(value: string) { text.push(value); },
    measureText(value: string) { return { width: String(value).length * 7 }; },
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    globalAlpha: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    lineCap: 'butt' as CanvasLineCap,
  };
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 1100 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 400 });
  canvas.getBoundingClientRect = () => ({ width: 1100, height: 400, left: 0, top: 0, right: 1100, bottom: 400, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
  canvas.getContext = (() => ctx) as unknown as typeof canvas.getContext;
  paintHow(canvas, time, 0.25, stage, still, reportHash);
  return text.join('\n');
}

describe('how stage pictures', () => {
  it('leaves a vertical gap under the picture', () => {
    const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'how.css'), 'utf8');
    expect(css).toMatch(/margin-bottom:\s*var\(--os-s6\)/);
  });

  it('walks contract, infra, and app, then a second pass on the same line', () => {
    expect(paint(0, 0)).toContain('CONTRACT · contracts/vault/src/lib.rs');
    expect(paint(0, 0)).toContain('LEAD · NOT A FINDING YET');
    expect(paint(0, 2800)).toContain('INFRA · infra/nginx/edge.conf');
    expect(paint(0, 5600)).toContain('APP · apps/web/src/pay/intent.ts');
    const pass2 = paint(0, 0, true);
    expect(pass2).toContain('PASS 2 · SAME SNAPSHOT');
    expect(pass2).toContain('lib.rs:30 · DUP');
  });

  it('lets the orchestrator anonymize, fold, drop, and take the defense', () => {
    expect(paint(1, 0)).toContain('ORCH ASSIGNS LABELS');
    expect(paint(1, 0)).toContain('OPUS');
    const folded = paint(1, 2800 * 1.8);
    expect(folded).toContain('CLUSTER-7');
    expect(folded).toContain('2 reports folded');
    expect(paint(1, 2800 * 2.7)).toContain('DROPPED · NO CITATION');
    expect(paint(1, 0, true)).toContain('Verdict moves to partial.');
  });

  it('seats an alternate judge, folds the duplicate, and writes the general review', () => {
    expect(paint(2, 400)).toContain('Author vendor matches the orchestrator.');
    expect(paint(2, 2800 * 1.8)).toContain('cited twice');
    expect(paint(2, 2800 * 2.8)).toContain('UPHELD');
    const review = paint(2, 0, true);
    expect(review).toContain('GENERAL REVIEW');
    expect(review).toContain('high-risk');
  });

  it('locks a report sha256, matches the browser, and attests it', () => {
    expect(paint(3, 800)).toContain('findings-and-scores.json');
    expect(paint(3, 800)).toContain('general-review.json');
    expect(paint(3, 2800 * 1.9)).toContain('LOCKED');
    expect(paint(3, 2800 * 2.95)).toContain('MATCH');
    const attested = paint(3, 0, true);
    expect(attested).toContain('attest');
    expect(attested).toContain('review_attested');
    expect(attested).toContain('The chain stores the hash, not the report.');
  });

  it('draws the sample attestation hash across the lock-in', () => {
    const drawn = paint(3, 2800 * 1.9, false, SAMPLE_HASH).replaceAll('\n', '');
    expect(drawn).toContain(SAMPLE_HASH);
  });
});
