import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAMPLE_HASH } from './how-sample-hash';
import { BEAT_MS, beat } from './how-scene';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('how scene beats', () => {
  it('walks four equal beats and wraps', () => {
    expect(beat(0, BEAT_MS, 4)).toMatchObject({ index: 0, u: 0 });
    expect(beat(BEAT_MS * 2 + 10, BEAT_MS, 4).index).toBe(2);
    expect(beat(BEAT_MS * 0.5, BEAT_MS, 4).u).toBeCloseTo(0.5, 5);
    expect(beat(BEAT_MS * 4 + 5, BEAT_MS, 4).index).toBe(0);
    expect(beat(-10, BEAT_MS, 4).index).toBe(3);
  });

  it('locks the picture to the bundled sample attestation', () => {
    const recorded = JSON.parse(readFileSync(path.join(here, '../../../public/sample/attestation.json'), 'utf8')) as { report_sha256: string };
    const source = readFileSync(path.join(here, 'how-sample-hash.ts'), 'utf8');
    expect(SAMPLE_HASH).toBe(recorded.report_sha256);
    expect(SAMPLE_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(source).toContain('attestation.json');
    expect(source).not.toMatch(/SAMPLE_HASH = ['"][0-9a-f]{64}['"]/);
  });
});
